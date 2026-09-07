import { readWarmup } from "@/lib/live-avatar";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/avatar/warmup/[warmupId]">) {
  const { warmupId } = await context.params;
  try {
    const record = await readWarmup(warmupId);
    return Response.json({
      warmupId: record.warmup_id,
      status: record.status,
      error: record.error,
      loadSeconds: record.load_seconds,
      warm: record.warm,
      warmSecondsRemaining: record.warm_seconds_remaining,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the warmup.";
    return Response.json({ error: message }, { status: 502 });
  }
}
