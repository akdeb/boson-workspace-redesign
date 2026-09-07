import { releaseGpu } from "@/lib/live-avatar";

export const runtime = "nodejs";

export async function POST() {
  try {
    return Response.json(await releaseGpu());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not release the GPU.";
    return Response.json({ error: message }, { status: 502 });
  }
}
