import { readStudio } from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the studio needs in one read: agents, tools, cloned-voice labels, uploaded
 * faces, history. The client keeps this as its snapshot and writes through to the routes
 * beside this one. See lib/store/index.ts.
 */
export async function GET() {
  try {
    return Response.json(readStudio());
  } catch (error) {
    console.error("Studio read failed", error);
    return Response.json({ error: "Could not read the studio database." }, { status: 500 });
  }
}
