import { deleteFace, upsertFace } from "@/lib/db/repository";
import type { FaceRecord } from "@/lib/store/types";

export const runtime = "nodejs";

export async function PUT(request: Request, context: RouteContext<"/api/studio/faces/[faceId]">) {
  const { faceId } = await context.params;
  try {
    const record = await request.json() as FaceRecord;
    upsertFace({ ...record, id: faceId });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Face save failed", error);
    return Response.json({ error: "Could not save the face." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/studio/faces/[faceId]">) {
  const { faceId } = await context.params;
  try {
    deleteFace(faceId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Face delete failed", error);
    return Response.json({ error: "Could not delete the face." }, { status: 500 });
  }
}
