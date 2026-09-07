/**
 * Avatar Studio renders through one of two backends:
 *
 *  - `boson`  — the hosted Higgs Avatar API (`POST /v1/videos`). No GPU to warm, no
 *               infrastructure of ours. https://docs.boson.ai/models/higgs-avatar/overview
 *  - `modal`  — the self-hosted LiveAvatar service in ../boson-server, which is what the
 *               realtime multi-GPU tier runs on and needs an explicit warm-up.
 *
 * The provider is chosen per request, falling back to `AVATAR_PROVIDER` and then to
 * whichever one is actually configured.
 */

export type AvatarProvider = "boson" | "modal";

/** Hosted job ids are prefixed so a poll can be routed without extra state. */
const HOSTED_PREFIX = "boson:";

export function hostedJobId(videoId: string) {
  return `${HOSTED_PREFIX}${videoId}`;
}

export function parseJobId(jobId: string) {
  return jobId.startsWith(HOSTED_PREFIX)
    ? { provider: "boson" as const, id: jobId.slice(HOSTED_PREFIX.length) }
    : { provider: "modal" as const, id: jobId };
}

export function modalConfigured() {
  return !!(process.env.LIVE_AVATAR_URL?.trim() && process.env.LIVE_AVATAR_TOKEN?.trim());
}

/** Hosted is the default; the self-hosted renderer is opt-in via `AVATAR_PROVIDER=modal`. */
export function defaultProvider(): AvatarProvider {
  const configured = process.env.AVATAR_PROVIDER?.trim().toLowerCase();
  return configured === "modal" && modalConfigured() ? "modal" : "boson";
}

export function resolveProvider(requested?: string): AvatarProvider {
  if (requested === "modal") return "modal";
  if (requested === "boson") return "boson";
  return defaultProvider();
}
