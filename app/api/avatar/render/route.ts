import { createSpeech, errorMessage, errorStatus } from "@/lib/boson";
import { createBosonVideo, type AvatarSize } from "@/lib/boson-avatar";
import { hostedJobId, resolveProvider } from "@/lib/avatar-provider";
import { resolveFacePng, resolveFaceReference } from "@/lib/face-image";
import { AVATAR_TIER, createAvatarJob } from "@/lib/live-avatar";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * A silent PCM WAV. The models are purely audio-driven and have no documented idle mode, so
 * silence is what drives a "listening" clip: closed mouth, natural blinks and head motion.
 */
function silentWav(seconds: number, sampleRate = 24_000) {
  const samples = Math.round(seconds * sampleRate);
  const bytes = samples * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);          // PCM
  buffer.writeUInt16LE(1, 22);          // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(bytes, 40);
  return buffer.toString("base64");
}

type RenderRequest = {
  /** Script to speak. Ignored when `audioB64` is supplied. */
  text?: string;
  /** Pre-rendered WAV (base64) — used by Chat mode to animate the live agent's own audio. */
  audioB64?: string;
  face?: string;
  /** An uploaded face as a JPEG data URI. Takes precedence over `face` when present. */
  faceImage?: string;
  /** Preset name or cloned `voice_<id>`. */
  voice?: string;
  /** Render a silent "listening" loop of this many seconds instead of speech. */
  silenceSeconds?: number;
  /** `"boson"` for the hosted Higgs Avatar API, `"modal"` for the self-hosted renderer. */
  provider?: string;
  size?: AvatarSize;
  /** Modal only: scene description and clip count. */
  prompt?: string;
  numClip?: number;
  tier?: "single" | "realtime";
};

export async function POST(request: Request) {
  let body: RenderRequest;
  try {
    body = await request.json() as RenderRequest;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const text = body.text?.trim();
  const silenceSeconds = body.silenceSeconds;
  if (!text && !body.audioB64 && !silenceSeconds) {
    return Response.json({ error: "Provide `text`, `audioB64`, or `silenceSeconds`." }, { status: 400 });
  }

  const provider = resolveProvider(body.provider);

  const face = body.face ?? "Maya";
  const size = body.size ?? "480x640";

  try {
    if (provider === "boson") {
      // The hosted API can synthesize the speech itself, so a text render is one call:
      // `input_tts` carries the same body as POST /v1/audio/speech, cloned voices included.
      const video = await createBosonVideo({
        // Downscaled to the output size: the full-resolution PNG is ~2.7 MB of base64 and
        // its upload dominates the time to first frame. See lib/face-image.ts.
        refImage: await resolveFaceReference(face, body.faceImage, size),
        size,
        ...(text && !body.audioB64 && !silenceSeconds
          ? { speech: { input: text, voice: body.voice, responseFormat: "wav" as const } }
          : { audio: silenceSeconds ? silentWav(silenceSeconds) : body.audioB64! }),
      });
      return Response.json({ jobId: hostedJobId(video.id), status: "queued", provider });
    }

    const audioB64 = silenceSeconds
      ? silentWav(silenceSeconds)
      : body.audioB64 ?? (await createSpeech({ input: text!, voice: body.voice, responseFormat: "wav" })).toString("base64");

    const jobId = await createAvatarJob({
      audioB64,
      // The self-hosted renderer is told to expect `.png`, so it keeps the original.
      imageB64: await resolveFacePng(face, body.faceImage),
      prompt: body.prompt,
      numClip: body.numClip,
      tier: body.tier ?? AVATAR_TIER,
    });
    return Response.json({ jobId, status: "queued", provider });
  } catch (error) {
    console.error("Avatar render failed", error);
    return Response.json(
      { error: errorMessage(error, "Could not start the avatar render.") },
      { status: errorStatus(error) },
    );
  }
}
