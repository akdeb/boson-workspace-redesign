import { deleteVoice, upsertVoice } from "@/lib/db/repository";
import type { VoiceRecord } from "@/lib/store/types";

export const runtime = "nodejs";

/** The label and reference transcript for a cloned voice; Boson owns the voice itself. */
export async function PUT(request: Request, context: RouteContext<"/api/studio/voices/[voiceId]">) {
  const { voiceId } = await context.params;
  try {
    const record = await request.json() as VoiceRecord;
    upsertVoice({ ...record, id: voiceId });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Voice save failed", error);
    return Response.json({ error: "Could not save the voice." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/studio/voices/[voiceId]">) {
  const { voiceId } = await context.params;
  try {
    deleteVoice(voiceId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Voice delete failed", error);
    return Response.json({ error: "Could not delete the voice." }, { status: 500 });
  }
}
