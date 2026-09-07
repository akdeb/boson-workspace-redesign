import { parseJobId } from "@/lib/avatar-provider";
import { readBosonVideo } from "@/lib/boson-avatar";
import { readAvatarJob } from "@/lib/live-avatar";

export const runtime = "nodejs";

/** Both providers are normalised onto the studio's own queued/running/done/error states. */
export async function GET(_request: Request, context: RouteContext<"/api/avatar/jobs/[jobId]">) {
  const { jobId } = await context.params;
  const target = parseJobId(jobId);

  try {
    if (target.provider === "boson") {
      const video = await readBosonVideo(target.id);
      const status = video.status === "completed" ? "done"
        : video.status === "failed" ? "error"
        : video.status === "in_progress" ? "running" : "queued";
      return Response.json({
        jobId,
        status,
        progress: video.progress,
        error: video.error ?? undefined,
        // Videos are proxied so the API key stays server-side.
        videoUrl: status === "done" ? `/api/avatar/video/${encodeURIComponent(jobId)}` : undefined,
      });
    }

    const job = await readAvatarJob(target.id);
    return Response.json({
      jobId,
      status: job.status,
      error: job.error,
      renderSeconds: job.render_seconds,
      videoUrl: job.status === "done" ? `/api/avatar/video/${encodeURIComponent(jobId)}` : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the avatar job.";
    return Response.json({ error: message }, { status: 502 });
  }
}
