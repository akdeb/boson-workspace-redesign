import { draftAgent, MissingKeyError, type BuilderMessage } from "@/lib/agent-builder";
import { readStudio } from "@/lib/db/repository";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One turn of the "describe your agent" conversation. See lib/agent-builder.ts. */
export async function POST(request: Request) {
  let body: { messages?: BuilderMessage[] };
  try {
    body = await request.json() as { messages?: BuilderMessage[] };
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const messages = (body.messages ?? []).filter(message => message.content?.trim());
  if (!messages.length) return Response.json({ error: "Say what the agent is for." }, { status: 400 });

  try {
    // The tools the model may attach are whatever this workspace actually has.
    return Response.json(await draftAgent(messages, readStudio().tools));
  } catch (error) {
    if (error instanceof MissingKeyError) {
      return Response.json({ error: error.message }, { status: 501 });
    }
    console.error("Agent build failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not draft the agent." },
      { status: 502 },
    );
  }
}
