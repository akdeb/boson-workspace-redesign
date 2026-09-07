import { MissingKeyError } from "@/lib/agent-builder";
import { tagCatalogue } from "@/lib/speech-tags";

export const runtime = "nodejs";
export const maxDuration = 30;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Mark a script up with Higgs TTS control tags.
 *
 * Reading the tag reference and placing `<|emotion:relief|>` by hand is the slow part of
 * getting a line to sound like anything; a small model does it in one pass. The words are
 * left alone — only tags are added — so what comes back is still the script you wrote.
 */
const SYSTEM = [
  "You add Higgs TTS 3 inline control tags to a script. Return only the marked-up script.",
  "",
  "Rules:",
  "- Never change, add, remove or reorder the words. Tags are the only thing you may insert.",
  "- Syntax is exactly `<|category:value|>`. Use only the tags listed below; invent nothing.",
  "- A delivery tag (style, emotion) leads the sentence it applies to.",
  "- A pause or sound effect sits exactly where the break or sound belongs.",
  "- Be sparing. Two to five tags in a short script is plenty; a tag on every clause reads as noise.",
  "- If the script already has tags, keep the ones that fit and do not duplicate them.",
  "",
  "Available tags:",
  tagCatalogue(),
].join("\n");

export async function POST(request: Request) {
  let body: { text?: string };
  try {
    body = await request.json() as { text?: string };
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) return Response.json({ error: "Nothing to enhance." }, { status: 400 });

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return Response.json(
      { error: new MissingKeyError("Set OPENAI_API_KEY to enhance a script with control tags.").message },
      { status: 501 },
    );
  }

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
        temperature: 0.5,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`The enhancer failed (${response.status}). ${detail.slice(0, 160)}`);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const enhanced = payload.choices?.[0]?.message?.content?.trim();
    if (!enhanced) throw new Error("The enhancer returned nothing.");
    return Response.json({ text: enhanced });
  } catch (error) {
    console.error("Enhance failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not enhance the script." },
      { status: 502 },
    );
  }
}
