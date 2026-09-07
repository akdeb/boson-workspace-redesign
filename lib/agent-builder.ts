import { ICON_ORDER, TONE_ORDER } from "@/lib/agent-look";
import { PRESET_VOICES } from "@/lib/store/seed";
import type { ToolDefinition } from "@/lib/tools";

/**
 * Drafting an agent from a conversation.
 *
 * Writing a good system prompt is the slowest part of making an agent, and it is the part
 * a model is best at. So the "create" path is a short chat: describe the use case, and a
 * cheap model fills in the name, summary, instructions, greeting, voice and tools. The
 * result is an ordinary agent record — nothing about it is special once it exists.
 *
 * This is the one place the studio calls a provider other than Boson, because Boson has no
 * text-completion model of its own. `OPENAI_MODEL` overrides the default.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export type BuilderMessage = { role: "user" | "assistant"; content: string };

export type AgentDraft = {
  name: string;
  summary: string;
  instructions: string;
  greeting: string;
  voice: string;
  toolIds: string[];
  /** An `AgentTone` and an `AgentIcon` — how the agent looks. See lib/agent-look.ts. */
  color: string;
  icon: string;
};

export type BuilderTurn = {
  /** What to say back in the chat. */
  reply: string;
  /** True once the draft is good enough to create. */
  ready: boolean;
  draft: AgentDraft | null;
};

export class MissingKeyError extends Error {}

/** The shape the model must answer in, so a turn is never free-form prose we have to parse. */
function schema(tools: ToolDefinition[]) {
  return {
    name: "agent_draft_turn",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["reply", "ready", "draft"],
      properties: {
        reply: { type: "string", description: "One short conversational message to the user." },
        ready: { type: "boolean", description: "True when the draft is complete enough to create." },
        draft: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["name", "summary", "instructions", "greeting", "voice", "toolIds", "color", "icon"],
          properties: {
            name: { type: "string" },
            summary: { type: "string" },
            instructions: { type: "string" },
            greeting: { type: "string" },
            voice: { type: "string", enum: PRESET_VOICES.map(voice => voice.id) },
            toolIds: { type: "array", items: { type: "string", enum: tools.map(tool => tool.id) } },
            color: { type: "string", enum: TONE_ORDER },
            icon: { type: "string", enum: ICON_ORDER },
          },
        },
      },
    },
  };
}

function systemPrompt(tools: ToolDefinition[]) {
  return [
    "You help someone set up a realtime *voice* agent in two or three exchanges. Be brisk.",
    "",
    "Ask at most one short question per turn, and only when the answer would genuinely change",
    "the agent. If the user's first message already describes a use case, draft immediately and",
    "set ready to true — do not interrogate them.",
    "",
    "Always return your current best draft, even mid-conversation, so the user can see it forming.",
    "",
    "`instructions` is the system prompt the agent runs on. Write it in the second person, cover",
    "the agent's role, how it should handle the common cases, and what it must not do. It is",
    "spoken aloud, so require plain sentences: no markdown, lists, emoji, or URLs.",
    "",
    "`greeting` is what the agent opens with, phrased as a direction to itself, one sentence.",
    "`name` is two or three words. `summary` is one short sentence, under 80 characters.",
    "",
    "`color` and `icon` are how the agent is recognised in a list — pick an icon that says",
    "what it does, and a colour that suits it rather than the same one every time.",
    "",
    `Voices: ${PRESET_VOICES.map(voice => `${voice.id} (${voice.description})`).join("; ")}`,
    tools.length
      ? `Tools it may be given: ${tools.map(tool => `${tool.id} — ${tool.name}: ${tool.description}`).join("; ")}. Only attach tools the use case actually needs.`
      : "No tools are available; leave toolIds empty.",
  ].join("\n");
}

export async function draftAgent(messages: BuilderMessage[], tools: ToolDefinition[]): Promise<BuilderTurn> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new MissingKeyError("Set OPENAI_API_KEY to build agents from a description.");

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
      temperature: 0.4,
      messages: [{ role: "system", content: systemPrompt(tools) }, ...messages],
      response_format: { type: "json_schema", json_schema: schema(tools) },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`The agent builder failed (${response.status}). ${detail.slice(0, 200)}`);
  }

  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("The agent builder returned nothing.");

  const turn = JSON.parse(content) as BuilderTurn;
  return { reply: turn.reply, ready: !!turn.ready && !!turn.draft, draft: turn.draft ?? null };
}
