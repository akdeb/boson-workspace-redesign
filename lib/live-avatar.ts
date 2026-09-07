import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Server-side client for the LiveAvatar service deployed on Modal
 * (see ../boson-server/modal_app.py). The bearer token never leaves the server.
 */

export type AvatarJob = {
  job_id: string;
  status: "queued" | "running" | "done" | "error";
  error?: string;
  render_seconds?: number;
  video_url?: string;
};

/** Which pipeline the app drives: `realtime` is the 5-GPU tier, `single` the 1-GPU one. */
export const AVATAR_TIER: "single" | "realtime" =
  process.env.LIVE_AVATAR_TIER === "realtime" ? "realtime" : "single";

function serviceConfig() {
  const baseUrl = process.env.LIVE_AVATAR_URL?.trim().replace(/\/$/, "");
  const token = process.env.LIVE_AVATAR_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new Error("LIVE_AVATAR_URL and LIVE_AVATAR_TOKEN must be set to use the avatar renderer.");
  }
  return { baseUrl, token };
}

async function callService(pathname: string, init: RequestInit = {}) {
  const { baseUrl, token } = serviceConfig();
  const request = () => fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  try {
    return await request();
  } catch (error) {
    console.warn(`Retrying ${pathname} after a transport failure`, error);
    return request();
  }
}

/** Read a bundled face PNG from /public/assets and return it base64-encoded. */
const faceCache = new Map<string, string>();

export async function readFaceImage(face: string) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(face)) throw new Error(`Unsupported face name: ${face}`);
  const cached = faceCache.get(face);
  if (cached) return cached;
  const file = path.join(process.cwd(), "public", "assets", `${face}.png`);
  const encoded = (await readFile(file)).toString("base64");
  faceCache.set(face, encoded);
  return encoded;
}

export async function createAvatarJob(input: {
  audioB64: string;
  imageB64: string;
  prompt?: string;
  numClip?: number;
  imageExt?: string;
  audioExt?: string;
  tier?: "single" | "realtime";
}) {
  const response = await callService("/v1/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_b64: input.audioB64,
      image_b64: input.imageB64,
      prompt: input.prompt ?? "",
      num_clip: input.numClip ?? 100,
      image_ext: input.imageExt ?? ".png",
      audio_ext: input.audioExt ?? ".wav",
      tier: input.tier ?? AVATAR_TIER,
    }),
  });

  const body = await response.json().catch(() => null) as { job_id?: string; detail?: string } | null;
  if (!response.ok || !body?.job_id) {
    throw new Error(body?.detail ?? `Avatar service rejected the job (${response.status}).`);
  }
  return body.job_id;
}

export async function readAvatarJob(jobId: string): Promise<AvatarJob> {
  const response = await callService(`/v1/jobs/${encodeURIComponent(jobId)}`);
  const body = await response.json().catch(() => null) as AvatarJob | { detail?: string } | null;
  if (!response.ok || !body || !("status" in body)) {
    const detail = body && "detail" in body ? body.detail : undefined;
    throw new Error(detail ?? `Could not read job ${jobId} (${response.status}).`);
  }
  return body;
}

export async function readAvatarVideo(jobId: string) {
  return callService(`/v1/videos/${encodeURIComponent(jobId)}.mp4`);
}

export type WarmState = { warm: boolean; warm_seconds_remaining: number };

export type WarmupRecord = WarmState & {
  warmup_id: string | null;
  status: "queued" | "running" | "done" | "error";
  load_seconds?: number;
  error?: string;
};

/** Boot a GPU container ahead of time so the next render skips the ~9 min weight load. */
export async function startWarmup(): Promise<WarmupRecord> {
  const response = await callService(`/v1/warmup?tier=${AVATAR_TIER}`, { method: "POST" });
  const body = await response.json().catch(() => null) as WarmupRecord | { detail?: string } | null;
  if (!response.ok || !body || !("status" in body)) {
    const detail = body && "detail" in body ? body.detail : undefined;
    throw new Error(detail ?? `Could not warm up the GPU (${response.status}).`);
  }
  return body;
}

export async function readWarmup(warmupId: string): Promise<WarmupRecord> {
  const response = await callService(`/v1/warmup/${encodeURIComponent(warmupId)}`);
  const body = await response.json().catch(() => null) as WarmupRecord | { detail?: string } | null;
  if (!response.ok || !body || !("status" in body)) {
    const detail = body && "detail" in body ? body.detail : undefined;
    throw new Error(detail ?? `Could not read warmup ${warmupId} (${response.status}).`);
  }
  return body;
}

export async function readServiceStatus(): Promise<WarmState> {
  const response = await callService(`/v1/status?tier=${AVATAR_TIER}`);
  const body = await response.json().catch(() => null) as WarmState | null;
  if (!response.ok || !body) throw new Error(`Could not read GPU status (${response.status}).`);
  return body;
}

/** Drop the warm GPU container now instead of paying out the idle window. */
export async function releaseGpu(): Promise<{ released: boolean; reason?: string }> {
  const response = await callService(`/v1/release?tier=${AVATAR_TIER}`, { method: "POST" });
  const body = await response.json().catch(() => null) as { released?: boolean; reason?: string; detail?: string } | null;
  if (!response.ok || !body) throw new Error(body?.detail ?? `Could not release the GPU (${response.status}).`);
  return { released: !!body.released, reason: body.reason };
}
