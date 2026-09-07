import { AVATAR_MODEL, bosonFetch, errorMessage, errorStatus, speechBody } from "@/lib/boson";
import type { AvatarSize } from "@/lib/boson-avatar";
import { resolveFaceReference } from "@/lib/face-image";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Live avatar delivery: `POST /v1/videos/stream` returns fragmented MP4 as it is generated,
 * so playback starts before the clip is finished. The fragments are piped straight through
 * to the browser, which appends them to a Media Source Extensions buffer.
 *
 * https://docs.boson.ai/models/higgs-avatar/streaming-video
 *
 * The audio the caller hears is the audio muxed into this video, which is why the result is
 * lip-synced rather than merely close: both come from the same turn of speech.
 */

type StreamRequest = {
  /** The agent's spoken turn as a base64 WAV. */
  audioB64?: string;
  /** Text to synthesize instead, when driving the avatar from a script. */
  text?: string;
  voice?: string;
  face?: string;
  /** An uploaded face as a JPEG data URI. Takes precedence over `face` when present. */
  faceImage?: string;
  size?: AvatarSize;
};

export async function POST(request: Request) {
  let body: StreamRequest;
  try {
    body = await request.json() as StreamRequest;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!body.audioB64 && !text) {
    return Response.json({ error: "Provide `audioB64` or `text`." }, { status: 400 });
  }

  const size = body.size ?? "480x640";
  try {
    const refImage = await resolveFaceReference(body.face, body.faceImage, size);
    const upstream = await bosonFetch("/v1/videos/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AVATAR_MODEL,
        ref_image: refImage,
        size,
        ...(body.audioB64
          ? { input: body.audioB64 }
          : { input_tts: speechBody({ input: text!, voice: body.voice, responseFormat: "wav" }) }),
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error("Avatar stream failed", upstream.status, detail.slice(0, 300));
      return Response.json(
        { error: `The avatar stream failed (${upstream.status}).` },
        { status: upstream.status },
      );
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
        // Same-origin, so the browser can read this without an expose-headers dance.
        "X-Video-Id": upstream.headers.get("x-video-id") ?? "",
      },
    });
  } catch (error) {
    console.error("Avatar stream failed", error);
    return Response.json(
      { error: errorMessage(error, "Could not start the avatar stream.") },
      { status: errorStatus(error) },
    );
  }
}
