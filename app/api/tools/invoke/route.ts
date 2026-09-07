import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fillBody, fillHeader, fillUrl, type ToolBinding } from "@/lib/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Server-side executor for a tool's HTTP binding.
 *
 * The browser cannot call most third-party APIs itself (CORS), so tool calls are proxied
 * here — both when the agent invokes a tool mid-call and when the user runs one from the
 * tester. Only the resolved request is forwarded; nothing is stored.
 */

const TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 512 * 1024;

/** Reject anything that resolves to the machine we are running on or its private network. */
function isBlockedAddress(address: string) {
  if (/^(::1|::|0\.0\.0\.0)$/.test(address)) return true;
  if (/^f[cd]/i.test(address) || /^fe80:/i.test(address)) return true;         // IPv6 ULA / link-local
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) return false;
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Tool URLs must use http or https.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("That host is not reachable from the tool runner.");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => { throw new Error(`Could not resolve ${host}.`); });
  if (addresses.some(entry => isBlockedAddress(entry.address))) {
    throw new Error("That host resolves to a private address and cannot be called.");
  }
}

type InvokeBody = { binding?: ToolBinding; args?: Record<string, unknown> };

export async function POST(request: Request) {
  let payload: InvokeBody;
  try {
    payload = await request.json() as InvokeBody;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const binding = payload.binding;
  const args = payload.args ?? {};
  if (!binding) return Response.json({ error: "No tool binding supplied." }, { status: 400 });

  if (binding.kind === "mock") {
    return Response.json({ ok: true, status: 200, output: fillBody(binding.response, args) });
  }

  // A control binding is handled by the client running the call, never here.
  if (binding.kind === "control") {
    return Response.json({ error: "Control tools are not executed server-side." }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(fillUrl(binding.url, args));
    await assertPublicHost(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The tool URL is not valid.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }

  const headers = new Headers({ Accept: "application/json, text/plain;q=0.9, */*;q=0.8" });
  for (const header of binding.headers) {
    if (header.key.trim()) headers.set(fillHeader(header.key, args), fillHeader(header.value, args));
  }
  if (binding.auth.type === "bearer" && binding.auth.token) {
    headers.set("Authorization", `Bearer ${binding.auth.token}`);
  } else if (binding.auth.type === "header" && binding.auth.headerName && binding.auth.token) {
    headers.set(binding.auth.headerName, binding.auth.token);
  }

  const sendsBody = binding.method !== "GET" && binding.method !== "DELETE" && binding.body.trim();
  if (sendsBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: binding.method,
      headers,
      body: sendsBody ? fillBody(binding.body, args) : undefined,
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });

    // Read as text: a tool result is handed to the model as a string either way, and this
    // keeps non-JSON APIs (plain text, XML) usable without extra configuration.
    const raw = await upstream.text();
    const output = raw.length > MAX_BODY_BYTES ? raw.slice(0, MAX_BODY_BYTES) : raw;

    return Response.json({
      ok: upstream.ok,
      status: upstream.status,
      output: output || (upstream.ok ? "{}" : `HTTP ${upstream.status}`),
      error: upstream.ok ? undefined : `The API returned ${upstream.status} ${upstream.statusText}.`,
      request: { method: binding.method, url: url.toString() },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const message = aborted
      ? `The tool call timed out after ${TIMEOUT_MS / 1000}s.`
      : error instanceof Error ? error.message : "The tool call failed.";
    return Response.json({
      ok: false,
      output: JSON.stringify({ error: message }),
      error: message,
      request: { method: binding.method, url: url.toString() },
    });
  } finally {
    clearTimeout(timer);
  }
}
