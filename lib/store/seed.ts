import { defaultAgentConfig, withDefaults, type AgentConfig } from "@/lib/agent-config";
import { BUILTIN_TOOLS } from "@/lib/tools";
import type { AgentRecord, FaceRecord, StudioData, VoiceRecord } from "@/lib/store/types";

/**
 * The records the studio ships with, and the constants that are part of the build rather
 * than rows anyone can edit.
 *
 * No `"use client"` here on purpose: the API route handlers seed the database from this
 * module, and the browser reads the same constants for its pickers.
 */

/** Six preset speakers from Higgs TTS 3. https://docs.boson.ai/models/higgs-tts/voices */
export const PRESET_VOICES: VoiceRecord[] = [
  { id: "chloe", label: "Chloe", kind: "preset", tag: "EN", description: "A friendly and clear female voice with an engaging, informative tone." },
  { id: "eleanor", label: "Eleanor", kind: "preset", tag: "EN", description: "A calm, articulate female voice with a clear, professional delivery." },
  { id: "nora", label: "Nora", kind: "preset", tag: "EN", description: "A female speaker with a calm, clear, and narrative voice." },
  { id: "jake", label: "Jake", kind: "preset", tag: "EN", description: "A male speaker with an energetic and slightly dramatic tone." },
  { id: "marcus", label: "Marcus", kind: "preset", tag: "EN", description: "A male speaker with an enthusiastic, confident delivery." },
  { id: "oliver", label: "Oliver", kind: "preset", tag: "EN", description: "A calm, articulate male voice with a thoughtful American accent." },
  { id: "default", label: "Default", kind: "preset", tag: "EN", description: "The built-in preset, always available on every model." },
];

/**
 * The faces bundled under `public/assets`. A preset travels to the renderer as a bare name
 * and is resolved server-side; an uploaded face carries its own pixels. See
 * `lib/store/types.ts` and `lib/face-image.ts`.
 */
export const PRESET_FACE_NAMES = [
  "Maya", "Andre", "Camila", "Ethan", "Fiona", "Helen", "James", "Kai", "Nova", "Pia", "Rachel", "Theo", "Wei",
];

export const PRESET_FACES: FaceRecord[] = PRESET_FACE_NAMES.map(name => ({
  id: name, label: name, kind: "preset" as const,
}));

function agent(
  id: string,
  name: string,
  summary: string,
  instructions: string,
  greeting: string,
  extra: Partial<AgentConfig> = {},
  look: { color?: string; icon?: string } = {},
): AgentRecord {
  const now = new Date(0).toISOString();
  return {
    id, name, summary, builtin: true, createdAt: now, updatedAt: now, ...look,
    config: withDefaults({ ...defaultAgentConfig(), instructions, greeting, ...extra }),
  };
}

/** The four scenarios the studio has always shipped, now as editable agent records. */
export const BUILTIN_AGENTS: AgentRecord[] = [
  agent(
    "agent-higgs-live", "Higgs Live", "Experience Higgs Realtime",
    "You are Higgs Live, a warm and concise conversational voice assistant. Keep replies natural and brief. You are speaking aloud, so do not use markdown, lists, emoji, or URLs.",
    "Open with a casual one-sentence greeting and ask what's on my mind.",
    { voice: "chloe" },
    { color: "blue", icon: "radio-tower" },
  ),
  agent(
    "agent-receptionist", "Receptionist", "Books tables and answers café questions.",
    "You are a friendly restaurant receptionist. Help callers book tables and answer café questions. Use the booking tool to confirm a reservation, and read the confirmation reference back to the caller. Ask only for details needed to complete the booking. Keep spoken replies short and natural.",
    "Welcome me briefly and ask how you can help with my visit or reservation.",
    { voice: "eleanor", toolIds: ["builtin-booking", "builtin-time"] },
    { color: "amber", icon: "phone" },
  ),
  agent(
    "agent-interviewer", "AI Interviewer", "Runs a mock interview and gives feedback.",
    "You are an experienced mock interviewer. Ask one interview question at a time, listen carefully, and give concise, constructive feedback before continuing.",
    "Introduce yourself briefly and ask me to tell you about myself.",
    { voice: "marcus", turnDetection: { type: "semantic_vad", threshold: 0.55, prefixPaddingMs: 300, silenceDurationMs: 700, minSpeechDuration: 0.125 } },
    { color: "violet", icon: "message" },
  ),
  agent(
    "agent-support", "Customer Support", "Handles support calls and requests.",
    "You are a calm customer support agent. Clarify the issue, propose practical next steps, and confirm whether the request is resolved. Look up facts with your tools rather than guessing. Keep spoken replies concise.",
    "Welcome me briefly and ask what you can help resolve today.",
    { voice: "oliver", toolIds: ["builtin-weather", "builtin-wikipedia"] },
    { color: "rose", icon: "headset" },
  ),
];

export function seedData(): StudioData {
  return { agents: BUILTIN_AGENTS, tools: BUILTIN_TOOLS, voices: [], faces: [], sessions: [] };
}
