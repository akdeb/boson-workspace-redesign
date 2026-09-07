import { draftAgent, MissingKeyError, type BuilderMessage } from "@/lib/agent-builder";
import { readStudio } from "@/lib/db/repository";
import type { ToolDefinition } from "@/lib/tools";

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

  // The tools the model may attach are whatever this workspace actually has — but a
  // database that will not open is no reason to refuse to draft an agent.
  let tools: ToolDefinition[] = [];
  try {
    tools = readStudio().tools;
  } catch (error) {
    console.warn("Agent builder could not read the tool library", error);
  }

  try {
    return Response.json(await draftAgent(messages, tools));
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
