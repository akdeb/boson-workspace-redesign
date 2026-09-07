export const runtime = "nodejs";

const DEFAULT_BOSON_BASE_URL = "https://api.boson.ai";
const EPHEMERAL_TTL_SECONDS = 600;

export async function POST() {
  const apiKey = process.env.BOSON_API_KEY?.trim();

  if (!apiKey) {
    return Response.json(
      { error: "BOSON_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  try {
    const baseUrl = (process.env.BOSON_BASE_URL ?? DEFAULT_BOSON_BASE_URL).replace(/\/$/, "");
    const upstream = await fetch(`${baseUrl}/v1/realtime/client_secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expires_after: { seconds: EPHEMERAL_TTL_SECONDS } }),
      cache: "no-store",
    });

    const body = await upstream.json().catch(() => null) as
      | { value?: string; expires_at?: number; error?: unknown }
      | null;

    if (!upstream.ok || !body?.value) {
      console.error("Boson client secret request failed", upstream.status, body);
      return Response.json(
        { error: `Boson authentication failed (${upstream.status}).` },
        { status: upstream.ok ? 502 : upstream.status },
      );
    }

    return Response.json({ value: body.value, expires_at: body.expires_at });
  } catch (error) {
    console.error("Unable to mint Boson client secret", error);
    return Response.json({ error: "Unable to reach the Boson API." }, { status: 502 });
  }
}
