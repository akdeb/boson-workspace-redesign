/**
 * Shared server-side client for the Boson REST API. Everything here runs in a route
 * handler so `BOSON_API_KEY` never reaches the browser.
 */

const DEFAULT_BOSON_BASE_URL = "https://api.boson.ai";

export const TTS_MODEL = "higgs-tts-3";
export const AVATAR_MODEL = "higgs-avatar";
export const REALTIME_MODEL = "higgs-realtime";
export const STT_MODEL = "higgs-stt-3.1";

export function bosonBaseUrl() {
  return (process.env.BOSON_BASE_URL ?? DEFAULT_BOSON_BASE_URL).replace(/\/$/, "");
}

export function bosonApiKey() {
  const apiKey = process.env.BOSON_API_KEY?.trim();
  if (!apiKey) throw new Error("BOSON_API_KEY is not configured on the server.");
  return apiKey;
}

/** A Boson error body is `{ error: { message, type } }`; fall back to the raw text. */
async function readError(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; type?: string }; detail?: string };
    return parsed.error?.message ?? parsed.detail ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

export async function bosonFetch(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${bosonBaseUrl()}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${bosonApiKey()}`, ...init.headers },
    cache: "no-store",
  });
  return response;
}

export async function bosonJson<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await bosonFetch(pathname, init);
  if (!response.ok) {
    const detail = await readError(response);
    console.error(`Boson ${pathname} failed`, response.status, detail);
    throw new BosonError(detail || `Boson request failed (${response.status}).`, response.status);
  }
  return await response.json() as T;
}

export class BosonError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BosonError";
  }
}

export function errorStatus(error: unknown) {
  return error instanceof BosonError ? error.status : 502;
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/* ---------------------------------------------------------------- voices --- */

/**
 * The live API returns `voice_id` / `title`; the published OpenAPI schema names the same
 * fields `voice` / `description`. Read either so neither shape breaks the studio.
 */
export type BosonVoice = {
  voice?: string;
  voice_id?: string;
  title?: string | null;
  description?: string | null;
  ref_text?: string;
  created_at?: string | null;
};

export function voiceId(voice: BosonVoice) {
  return voice.voice ?? voice.voice_id ?? "";
}

export async function listBosonVoices() {
  const body = await bosonJson<{ data?: BosonVoice[] }>("/v1/audio/voices");
  return (body.data ?? []).filter(voice => voiceId(voice));
}

/**
 * Register a reusable voice. `title` and `description` cover both field names the API has
 * used; whichever it recognises is what comes back on the record.
 *
 * The id is a hash of the audio, so re-registering the same clip returns the *existing*
 * record — including its original title — rather than applying the new one.
 */
export async function createBosonVoice(input: { refAudio: string; refText: string; title: string; description?: string }) {
  return bosonJson<BosonVoice>("/v1/audio/voices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref_audio: input.refAudio,
      ref_text: input.refText,
      title: input.title,
      description: input.description || input.title,
    }),
  });
}

/**
 * Delete a cloned voice. The API has not always supported this, so a 404/405 is reported
 * rather than thrown — the caller falls back to hiding the voice locally.
 */
export async function deleteBosonVoice(id: string) {
  const response = await bosonFetch(`/v1/audio/voices/${encodeURIComponent(id)}`, { method: "DELETE" });
  return { ok: response.ok, status: response.status };
}

/* ------------------------------------------------------------------- stt --- */

/**
 * Transcribe a clip with `higgs-stt-3.1`, the same model the realtime session uses for
 * input transcripts.
 *
 * Cloning needs the reference text, but asking someone to type out what they just recorded
 * is busywork the model can do itself — so the studio no longer collects it and this fills
 * it in. https://docs.boson.ai/models/higgs-stt
 */
export async function transcribeAudio(dataUri: string) {
  const match = /^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUri.trim());
  if (!match) throw new Error("Reference audio must be a base64 audio data URI.");

  const bytes = Buffer.from(match[2], "base64");
  const form = new FormData();
  form.append("model", STT_MODEL);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: match[1] }), "reference.wav");

  const body = await bosonJson<{ text?: string }>("/v1/audio/transcriptions", { method: "POST", body: form });
  const text = (body.text ?? "").trim();
  if (!text) throw new Error("The reference clip came back with no speech in it.");
  return text;
}

/* ------------------------------------------------------------------- tts --- */

export type SpeechRequest = {
  input: string;
  voice?: string;
  responseFormat?: "mp3" | "opus" | "pcm" | "wav" | "aac" | "flac";
  /** One-off cloning: reference audio as a URL, data URI, or base64 bytes. */
  refAudio?: string;
  refText?: string;
};

export function speechBody(request: SpeechRequest) {
  const useReference = !!request.refAudio;
  return {
    model: TTS_MODEL,
    input: request.input,
    response_format: request.responseFormat ?? "mp3",
    // `voice` is mutually exclusive with ref_audio/ref_text.
    ...(useReference
      ? { ref_audio: request.refAudio, ...(request.refText ? { ref_text: request.refText } : {}) }
      : { voice: request.voice || "default" }),
  };
}

export async function createSpeech(request: SpeechRequest) {
  const response = await bosonFetch("/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(speechBody(request)),
  });
  if (!response.ok) {
    const detail = await readError(response);
    console.error("Boson TTS failed", response.status, detail);
    throw new BosonError(detail || `Higgs TTS failed (${response.status}).`, response.status);
  }
  return Buffer.from(await response.arrayBuffer());
}
