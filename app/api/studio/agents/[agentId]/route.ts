import { deleteAgent, upsertAgent } from "@/lib/db/repository";
import type { AgentRecord } from "@/lib/store/types";

export const runtime = "nodejs";

export async function PUT(request: Request, context: RouteContext<"/api/studio/agents/[agentId]">) {
  const { agentId } = await context.params;
  try {
    const record = await request.json() as AgentRecord;
    upsertAgent({ ...record, id: agentId });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Agent save failed", error);
    return Response.json({ error: "Could not save the agent." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/studio/agents/[agentId]">) {
  const { agentId } = await context.params;
  try {
    deleteAgent(agentId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Agent delete failed", error);
    return Response.json({ error: "Could not delete the agent." }, { status: 500 });
  }
}
