/**
 * Tool calling for Agent Studio.
 *
 * A tool is two halves that the API keeps separate:
 *   - the *schema* the model sees (`name`, `description`, `parameters`), declared in
 *     `session.update` and returned as a `function_call`;
 *   - the *binding* that actually runs, which the API knows nothing about — the client
 *     executes it and hands the result back as a `function_call_output`.
 *
 * The binding here is an HTTP request template, so a user can point a tool at any real API
 * without writing code. Requests go out through `/api/tools/invoke` because a browser
 * cannot call most third-party APIs directly (CORS).
 *
 * https://docs.boson.ai/models/higgs-realtime/guides/tool-calling
 */

export type JsonSchemaType = "string" | "number" | "integer" | "boolean";

export type ToolParameter = {
  name: string;
  type: JsonSchemaType;
  description: string;
  required: boolean;
  /** Optional closed set of values, offered to the model as a JSON-schema `enum`. */
  options?: string[];
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ToolBinding = {
  kind: "http";
  method: HttpMethod;
  /** Supports `{{arg}}` placeholders, URL-encoded on substitution. */
  url: string;
  headers: Array<{ key: string; value: string }>;
  /** JSON body template for write methods. `{{arg}}` placeholders are JSON-escaped. */
  body: string;
  auth: { type: "none" | "bearer" | "header"; token: string; headerName: string };
} | {
  /** No network call: return a fixed payload. Useful for stubbing a tool before it exists. */
  kind: "mock";
  response: string;
} | {
  /**
   * Not a lookup at all — an instruction to the client running the call. `end_call` lets
   * the agent hang up when the conversation is genuinely finished, which is the difference
   * between a call that concludes and one that dangles until the caller closes the tab.
   */
  kind: "control";
  action: "end_call";
};

export type ToolDefinition = {
  id: string;
  /** The function name the model calls. Must match `^[a-zA-Z0-9_-]{1,64}$`. */
  name: string;
  description: string;
  parameters: ToolParameter[];
  binding: ToolBinding;
  /** Shipped with the studio: editable, but restorable and never the user's own. */
  builtin?: boolean;
  /** Free-text note shown in the library, e.g. where the API comes from. */
  source?: string;
};

export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/* ------------------------------------------------------------- templating --- */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Fill `{{arg}}` placeholders, escaping each value for the context it lands in. */
export function fillTemplate(template: string, args: Record<string, unknown>, escape: (value: unknown) => string) {
  return template.replace(PLACEHOLDER, (_match, key: string) => escape(args[key]));
}

const asText = (value: unknown) => (value === undefined || value === null ? "" : String(value));

export const fillUrl = (template: string, args: Record<string, unknown>) =>
  fillTemplate(template, args, value => encodeURIComponent(asText(value)));

export const fillHeader = (template: string, args: Record<string, unknown>) =>
  fillTemplate(template, args, asText);

/** JSON bodies substitute the *encoded* value, so `{{city}}` sits inside its own quotes. */
export const fillBody = (template: string, args: Record<string, unknown>) =>
  fillTemplate(template, args, value => {
    const encoded = JSON.stringify(value ?? null);
    return encoded.startsWith("\"") ? encoded.slice(1, -1) : encoded;
  });

/** Every `{{placeholder}}` a binding references, so the UI can flag unbound ones. */
export function bindingPlaceholders(binding: ToolBinding) {
  // Neither a canned response nor a session command carries a request to fill in.
  if (binding.kind === "mock" || binding.kind === "control") return [];
  const sources = [binding.url, binding.body, ...binding.headers.flatMap(header => [header.key, header.value])];
  const found = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(PLACEHOLDER)) found.add(match[1]);
  }
  return [...found];
}

/* ------------------------------------------------------------ json schema --- */

/** The `parameters` object sent in `session.update`. */
export function parameterSchema(parameters: ToolParameter[]) {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const parameter of parameters) {
    if (!parameter.name) continue;
    properties[parameter.name] = {
      type: parameter.type,
      ...(parameter.description ? { description: parameter.description } : {}),
      ...(parameter.options?.length ? { enum: parameter.options } : {}),
    };
  }
  return {
    type: "object",
    properties,
    required: parameters.filter(parameter => parameter.required && parameter.name).map(parameter => parameter.name),
  };
}

/* ------------------------------------------------------------- execution --- */

export type ToolRun = {
  ok: boolean;
  status?: number;
  /** What gets returned to the model as the `function_call_output`. */
  output: string;
  durationMs: number;
  error?: string;
  /** The resolved request, so the tester can show exactly what went out. */
  request?: { method: string; url: string };
};

const MAX_OUTPUT_CHARS = 6000;

/** Trim a response so a chatty API cannot blow out the model's context. */
export function clampOutput(text: string) {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated ${text.length - MAX_OUTPUT_CHARS} characters]`
    : text;
}

/**
 * Run a tool. Mock bindings resolve locally; HTTP bindings go through the server proxy so
 * third-party APIs are reachable from the browser at all.
 */
export async function runTool(tool: ToolDefinition, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolRun> {
  const startedAt = performance.now();

  if (tool.binding.kind === "control") {
    // The session, not the tool, does the work; acknowledging is all that happens here.
    return {
      ok: true,
      output: JSON.stringify({ ok: true, action: tool.binding.action }),
      durationMs: 0,
    };
  }

  if (tool.binding.kind === "mock") {
    return {
      ok: true,
      output: clampOutput(fillBody(tool.binding.response, args) || "{}"),
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  try {
    const response = await fetch("/api/tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ binding: tool.binding, args }),
      signal,
    });
    const body = await response.json().catch(() => null) as
      | { ok?: boolean; status?: number; output?: string; error?: string; request?: { method: string; url: string } }
      | null;
    const durationMs = Math.round(performance.now() - startedAt);

    if (!response.ok || !body) {
      const error = body?.error ?? `Tool call failed (${response.status}).`;
      return { ok: false, status: response.status, output: JSON.stringify({ error }), durationMs, error };
    }
    return {
      ok: body.ok !== false,
      status: body.status,
      output: clampOutput(body.output ?? ""),
      durationMs,
      error: body.error,
      request: body.request,
    };
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "The tool call failed.";
    return { ok: false, output: JSON.stringify({ error }), durationMs: Math.round(performance.now() - startedAt), error };
  }
}

/* --------------------------------------------------------------- catalog --- */

const noAuth = { type: "none" as const, token: "", headerName: "" };

/**
 * Starter tools that hit real, keyless public APIs, so tool calling can be tried end to end
 * without any setup. Users add their own alongside these.
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    id: "builtin-end-call",
    name: "end_call",
    description:
      "Hang up. Call this in the SAME turn as your goodbye, every time the caller says bye, "
      + "thanks that's all, talk later, or otherwise signals the conversation is over. Saying "
      + "goodbye without calling this leaves the line open. Never announce that you are about "
      + "to end the call — say your closing line and call this.",
    source: "Hangs up the session",
    builtin: true,
    parameters: [
      { name: "reason", type: "string", description: "Why the call is ending, in a few words.", required: false },
    ],
    binding: { kind: "control", action: "end_call" },
  },
  {
    id: "builtin-weather",
    name: "get_weather",
    description: "Get the current weather conditions and temperature for a city.",
    source: "wttr.in · no API key",
    builtin: true,
    parameters: [
      { name: "city", type: "string", description: "City name, e.g. \"Tokyo\" or \"San Francisco\".", required: true },
    ],
    binding: {
      kind: "http",
      method: "GET",
      url: "https://wttr.in/{{city}}?format=j1",
      headers: [],
      body: "",
      auth: noAuth,
    },
  },
  {
    id: "builtin-time",
    name: "get_current_time",
    description: "Get the current date and time in an IANA timezone.",
    source: "timeapi.io · no API key",
    builtin: true,
    parameters: [
      { name: "timezone", type: "string", description: "IANA timezone, e.g. \"Europe/London\" or \"America/New_York\".", required: true },
    ],
    binding: {
      kind: "http",
      method: "GET",
      url: "https://timeapi.io/api/Time/current/zone?timeZone={{timezone}}",
      headers: [],
      body: "",
      auth: noAuth,
    },
  },
  {
    id: "builtin-exchange",
    name: "get_exchange_rate",
    description: "Get the latest exchange rate between two currencies.",
    source: "frankfurter.app · no API key",
    builtin: true,
    parameters: [
      { name: "from", type: "string", description: "Base currency code, e.g. \"USD\".", required: true },
      { name: "to", type: "string", description: "Target currency code, e.g. \"EUR\".", required: true },
    ],
    binding: {
      kind: "http",
      method: "GET",
      url: "https://api.frankfurter.app/latest?from={{from}}&to={{to}}",
      headers: [],
      body: "",
      auth: noAuth,
    },
  },
  {
    id: "builtin-wikipedia",
    name: "search_wikipedia",
    description: "Search Wikipedia and return short summaries of the top matching articles.",
    source: "wikipedia.org · no API key",
    builtin: true,
    parameters: [
      { name: "query", type: "string", description: "What to look up.", required: true },
    ],
    binding: {
      kind: "http",
      method: "GET",
      url: "https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&srsearch={{query}}",
      headers: [],
      body: "",
      auth: noAuth,
    },
  },
  {
    id: "builtin-booking",
    name: "book_table",
    description: "Reserve a table at the restaurant and return the confirmation code.",
    source: "Mock response — swap in your own booking API",
    builtin: true,
    parameters: [
      { name: "name", type: "string", description: "Name the booking is under.", required: true },
      { name: "party_size", type: "integer", description: "Number of guests.", required: true },
      { name: "time", type: "string", description: "Requested time, e.g. \"Friday 7:30pm\".", required: true },
    ],
    binding: {
      kind: "mock",
      response: '{"confirmed":true,"reference":"BK-4192","name":"{{name}}","party_size":{{party_size}},"time":"{{time}}"}',
    },
  },
];

export function emptyTool(id: string): ToolDefinition {
  return {
    id,
    name: "",
    description: "",
    parameters: [],
    binding: { kind: "http", method: "GET", url: "https://", headers: [], body: "", auth: noAuth },
  };
}

/** Blocking reasons for a tool that cannot be declared to the model yet. */
export function toolProblems(tool: ToolDefinition) {
  const problems: string[] = [];
  if (!TOOL_NAME_PATTERN.test(tool.name)) problems.push("Name must be 1–64 characters of letters, digits, _ or -.");
  if (!tool.description.trim()) problems.push("Add a description — it is how the model decides when to call the tool.");
  if (tool.binding.kind === "http" && !/^https?:\/\/\S+$/i.test(tool.binding.url)) problems.push("Enter an http(s) URL.");
  const names = tool.parameters.map(parameter => parameter.name).filter(Boolean);
  if (new Set(names).size !== names.length) problems.push("Parameter names must be unique.");
  const unbound = bindingPlaceholders(tool.binding).filter(key => !names.includes(key));
  if (unbound.length) problems.push(`No parameter named ${unbound.map(key => `\`${key}\``).join(", ")}.`);
  return problems;
}
