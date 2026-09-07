import { deleteSession } from "@/lib/db/repository";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: RouteContext<"/api/studio/sessions/[sessionId]">) {
  const { sessionId } = await context.params;
  try {
    deleteSession(sessionId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Session delete failed", error);
    return Response.json({ error: "Could not delete the session." }, { status: 500 });
  }
}
