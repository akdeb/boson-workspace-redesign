import type { AgentConfig } from "@/lib/agent-config";
import type { ToolDefinition } from "@/lib/tools";

/**
 * Records the studio persists. These shapes are the contract the database will have to
 * satisfy — see `lib/store/index.ts` for the repository interface and the placeholder
 * implementation behind it.
 */

/** `deleted` is a tombstone: Boson keeps listing a voice we no longer want offered. */
export type VoiceKind = "preset" | "cloned" | "deleted";

export type VoiceRecord = {
  /** What goes in `voice` on the wire: a preset name, or a `voice_<sha>` from cloning. */
  id: string;
  label: string;
  kind: VoiceKind;
  /** Display tag: language for presets, "Cloned" for custom voices. */
  tag: string;
  description: string;
  createdAt?: string;
  /** Transcript of the reference audio, echoed back by the voices API. */
  refText?: string;
};

export type FaceKind = "preset" | "uploaded";

/**
 * A face the avatar renderer can animate. Presets are bundled PNGs under `public/assets`
 * and travel as a bare name, which the server resolves. An uploaded face has no file on
 * the server, so it carries its own pixels: a JPEG data URI, downscaled in the browser to
 * the largest output size before it is ever stored. See `lib/face-image.ts`.
 */
export type FaceRecord = {
  /** Preset faces use their name (`"Maya"`); uploads use a generated `face-…` id. */
  id: string;
  label: string;
  kind: FaceKind;
  /** Uploaded faces only: the reference image as a `data:image/jpeg;base64,…` URI. */
  dataUri?: string;
  createdAt?: string;
};

export type AgentRecord = {
  id: string;
  name: string;
  /** One-line summary shown on the scenario card. */
  summary: string;
  config: AgentConfig;
  /** An `AgentTone` name. Drives the icon tile and the orb's hue. See lib/agent-look.ts. */
  color?: string;
  /** An `AgentIcon` name. */
  icon?: string;
  /** Shipped with the studio rather than created by the user. */
  builtin?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ToolRecord = ToolDefinition;

/** One line of a recorded conversation, in the order it happened. */
export type TranscriptEntry =
  | { kind: "turn"; role: "user" | "agent"; text: string; latencyMs?: number }
  | {
      kind: "tool";
      callId: string;
      name: string;
      args: Record<string, unknown>;
      status: "running" | "ok" | "error";
      durationMs?: number;
      output?: string;
      error?: string;
    };

/** A finished generation or call, for the History tab. */
export type SessionRecord = {
  id: string;
  studio: "voice" | "agent" | "avatar";
  title: string;
  detail: string;
  createdAt: string;
  /** Face id this session was rendered or spoken with, for the history thumbnail. */
  faceId?: string;
  /** Agent that drove the session, so an agent's own Conversations tab can filter. */
  agentId?: string;
  /** The whole conversation, for sessions that had one. */
  transcript?: TranscriptEntry[];
};

export type StudioData = {
  agents: AgentRecord[];
  tools: ToolRecord[];
  voices: VoiceRecord[];
  faces: FaceRecord[];
  sessions: SessionRecord[];
};
