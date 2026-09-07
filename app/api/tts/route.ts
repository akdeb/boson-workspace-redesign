import { createSpeech, errorMessage, errorStatus } from "@/lib/boson";

export const runtime = "nodejs";
export const maxDuration = 120;

type SpeechBody = {
  text?: string;
  /** A preset name or a cloned `voice_<id>`. Ignored when `refAudio` is present. */
  voice?: string;
  format?: "mp3" | "wav" | "opus" | "flac" | "aac";
  /** One-off cloning: preview a reference clip without registering a voice first. */
  refAudio?: string;
  refText?: string;
};

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
};

/** Synthesize speech with Higgs TTS 3 and stream the audio straight back to the player. */
export async function POST(request: Request) {
  let body: SpeechBody;
  try {
    body = await request.json() as SpeechBody;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) return Response.json({ error: "Enter some text to speak." }, { status: 400 });
  if (text.length > 5000) return Response.json({ error: "Text is limited to 5000 characters." }, { status: 400 });

  const format = body.format ?? "mp3";
  try {
    const audio = await createSpeech({
      input: text,
      voice: body.voice,
      responseFormat: format,
      refAudio: body.refAudio,
      refText: body.refText,
    });
    return new Response(new Uint8Array(audio), {
      headers: { "Content-Type": CONTENT_TYPES[format] ?? "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error, "Speech synthesis failed.") }, { status: errorStatus(error) });
  }
}
