import { defaultProvider, modalConfigured } from "@/lib/avatar-provider";
import { AVATAR_TIER, readServiceStatus, startWarmup } from "@/lib/live-avatar";

export const runtime = "nodejs";

/**
 * Warm-up only applies to the self-hosted Modal renderer. The hosted Higgs Avatar API has
 * no container of ours to boot, so it reports itself as permanently ready.
 */
export async function GET() {
  const provider = defaultProvider();
  if (provider === "boson" || !modalConfigured()) {
    return Response.json({ provider: "boson", tier: AVATAR_TIER, warm: true, warmSecondsRemaining: 0, managed: true });
  }
  try {
    const state = await readServiceStatus();
    return Response.json({ provider, tier: AVATAR_TIER, warm: state.warm, warmSecondsRemaining: state.warm_seconds_remaining });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the GPU status.";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function POST() {
  if (defaultProvider() === "boson" || !modalConfigured()) {
    return Response.json({ warmupId: null, status: "done", warm: true, warmSecondsRemaining: 0 });
  }
  try {
    const record = await startWarmup();
    return Response.json({
      warmupId: record.warmup_id,
      status: record.status,
      warm: record.warm,
      warmSecondsRemaining: record.warm_seconds_remaining,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not warm up the GPU.";
    return Response.json({ error: message }, { status: 502 });
  }
}
