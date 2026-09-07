import { insertSession } from "@/lib/db/repository";
import type { SessionRecord } from "@/lib/store/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    insertSession(await request.json() as SessionRecord);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Session save failed", error);
    return Response.json({ error: "Could not save the session." }, { status: 500 });
  }
}
