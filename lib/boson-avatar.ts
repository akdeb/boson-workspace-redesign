import { AVATAR_MODEL, bosonFetch, bosonJson, speechBody, type SpeechRequest } from "@/lib/boson";

/**
 * Hosted Higgs Avatar renderer (`POST /v1/videos`). This is the default provider: no GPU
 * to warm and no infrastructure of our own. `lib/live-avatar.ts` is the self-hosted Modal
 * alternative, kept for the realtime multi-GPU tier.
 *
 * https://docs.boson.ai/models/higgs-avatar/overview
 */

export type AvatarSize = "640x640" | "640x480" | "480x640";

export const AVATAR_SIZES: AvatarSize[] = ["640x640", "640x480", "480x640"];

export type BosonVideo = {
  id: string;
  object?: "video";
  model?: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  progress?: number;
  size?: string;
  created_at?: number;
  error?: string | null;
};

export type CreateVideoInput = {
  /** The face to animate: an http(s) URL, data URI, or base64-encoded image bytes. */
  refImage: string;
  /** Audio-to-video: driving speech as a URL, data URI, or base64 bytes (max 60 s). */
  audio?: string;
  /** Text-to-video: the gateway synthesizes the speech and lip-syncs to it. */
  speech?: SpeechRequest;
  size?: AvatarSize;
};

export async function createBosonVideo(input: CreateVideoInput) {
  if (!input.audio === !input.speech) {
    throw new Error("Provide exactly one driving input: audio or text.");
  }
  return bosonJson<BosonVideo>("/v1/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AVATAR_MODEL,
      ref_image: input.refImage,
      size: input.size ?? "480x640",
      ...(input.audio ? { input: input.audio } : { input_tts: speechBody(input.speech!) }),
    }),
  });
}

export async function readBosonVideo(videoId: string) {
  return bosonJson<BosonVideo>(`/v1/videos/${encodeURIComponent(videoId)}`);
}

/** The rendered MP4. Streamed back through our own route so the API key stays server-side. */
export async function readBosonVideoContent(videoId: string) {
  return bosonFetch(`/v1/videos/${encodeURIComponent(videoId)}/content`);
}
