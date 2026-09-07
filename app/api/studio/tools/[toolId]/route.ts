import { deleteTool, upsertTool } from "@/lib/db/repository";
import type { ToolDefinition } from "@/lib/tools";

export const runtime = "nodejs";

export async function PUT(request: Request, context: RouteContext<"/api/studio/tools/[toolId]">) {
  const { toolId } = await context.params;
  try {
    const record = await request.json() as ToolDefinition;
    upsertTool({ ...record, id: toolId });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Tool save failed", error);
    return Response.json({ error: "Could not save the tool." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/studio/tools/[toolId]">) {
  const { toolId } = await context.params;
  try {
    deleteTool(toolId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Tool delete failed", error);
    return Response.json({ error: "Could not delete the tool." }, { status: 500 });
  }
}
