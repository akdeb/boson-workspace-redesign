"use client";

/**
 * Batch avatar rendering: start a job, poll it, hand back the finished clip.
 *
 * This is the path for a whole clip rendered up front (Speech mode, and the silent idle
 * loop). A live conversation instead uses `lib/avatar-stream.ts`, which plays fragments as
 * they are generated.
 */

export type AvatarStatus = "idle" | "synthesizing" | "queued" | "running" | "done" | "error";
export type AvatarRender = { status: AvatarStatus; jobId?: string; videoUrl?: string; error?: string };

export const AVATAR_STATUS_COPY: Record<AvatarStatus, string> = {
  idle: "", synthesizing: "Synthesizing speech…", queued: "Waiting for a renderer…",
  running: "Rendering the avatar…", done: "", error: "",
};

/** Scene description, used only by the self-hosted Modal renderer. */
export const AVATAR_SCENE_PROMPT = "A photorealistic presenter speaking directly to camera in a softly lit studio, natural head motion, expressive lip sync, shallow depth of field.";

export async function startAvatarRender(payload: Record<string, unknown>) {
  const response = await fetch("/api/avatar/render", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null) as { jobId?: string; error?: string } | null;
  if (!response.ok || !body?.jobId) throw new Error(body?.error ?? `Render request failed (${response.status}).`);
  return body.jobId;
}

/** How many consecutive unreadable polls to absorb before treating the job as lost. */
export const POLL_FAILURE_LIMIT = 5;

/** Poll an avatar job until its clip is ready. Rendering runs well behind realtime. */
export async function waitForAvatarClip(jobId: string, onStatus: (status: AvatarStatus) => void, signal: AbortSignal) {
  // A fully cold self-hosted GPU spends ~9 min loading the model before it renders anything;
  // the hosted API queues instead. Either way, one deadline covers the worst case.
  const deadline = Date.now() + 20 * 60 * 1000;
  let unreadablePolls = 0;
  while (!signal.aborted) {
    if (Date.now() > deadline) throw new Error("The avatar render timed out after 20 minutes.");
    await new Promise(resolve => setTimeout(resolve, 2500));
    if (signal.aborted) break;
    const response = await fetch(`/api/avatar/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal });
    const body = await response.json().catch(() => null) as { status?: AvatarStatus; videoUrl?: string; error?: string } | null;

    // A poll that cannot be read is not the render failing — a blip on the way to a status
    // endpoint should not throw away a job that is still going. Only give up on a run of them.
    if (!response.ok) {
      if (++unreadablePolls < POLL_FAILURE_LIMIT) continue;
      throw new Error(body?.error ?? `Could not read render job (${response.status}).`);
    }
    unreadablePolls = 0;

    if (body?.status === "error") throw new Error(body.error ?? "The avatar renderer failed.");
    if (body?.status === "done" && body.videoUrl) return body.videoUrl;
    if (body?.status) onStatus(body.status);
  }
  throw new DOMException("Render cancelled", "AbortError");
}

/**
 * Start a render and wait for its clip, retrying a failed job.
 *
 * The renderer fails intermittently with internal errors of its own ("unknown session
 * '<video id>'"), which a fresh job almost always clears. Retrying beats showing the
 * caller a message that means nothing to them and that a second click would have fixed.
 */
export async function renderAvatarClip(
  payload: Record<string, unknown>,
  onStatus: (status: AvatarStatus, jobId: string) => void,
  signal: AbortSignal,
  attempts = 2,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const jobId = await startAvatarRender(payload);
      onStatus("queued", jobId);
      return await waitForAvatarClip(jobId, status => onStatus(status, jobId), signal);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      console.warn(`Avatar render attempt ${attempt} of ${attempts} failed`, error);
    }
  }
  throw lastError;
}

/** The renderer reports its internal failures verbatim; lead with something actionable. */
export function avatarErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  if (/unknown session|file\.mp4 failed/i.test(raw)) {
    return "The renderer dropped this job twice. Give it another go in a moment.";
  }
  return raw || "The avatar render failed.";
}

