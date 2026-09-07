import { parseJobId } from "@/lib/avatar-provider";
import { readBosonVideoContent } from "@/lib/boson-avatar";
import { readAvatarVideo } from "@/lib/live-avatar";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/avatar/video/[jobId]">) {
  const { jobId } = await context.params;
  const target = parseJobId(jobId);
  try {
    const upstream = target.provider === "boson"
      ? await readBosonVideoContent(target.id)
      : await readAvatarVideo(target.id);
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "Video is not ready." }, { status: upstream.status });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch the avatar video.";
    return Response.json({ error: message }, { status: 502 });
  }
}
