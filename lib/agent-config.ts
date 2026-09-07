import { parameterSchema, type ToolDefinition } from "@/lib/tools";

/**
 * The Higgs Realtime session configuration, as the studio models it.
 *
 * Every field here maps onto a documented `session.update` parameter — see
 * https://docs.boson.ai/api-reference/realtime/client-events#session-configuration-object.
 * `buildSessionPayload` is the single place that translates this shape into the wire
 * format, so the UI never has to know about the nesting under `audio.input` / `audio.output`.
 */

export const REALTIME_MODEL = "higgs-realtime";
export const TRANSCRIPTION_MODEL = "higgs-stt-3.1";

/** PCM rates the API accepts. Internal processing is always 24 kHz. */
export const AUDIO_RATES = [8000, 16000, 24000, 48000] as const;
export type AudioRate = (typeof AUDIO_RATES)[number];

export type TurnDetectionType = "server_vad" | "semantic_vad" | "manual";
export type NoiseReduction = "off" | "near_field" | "far_field";
export type ToolChoice = "auto" | "none" | "required";
export type OutputModality = "audio" | "text";

export type TurnDetection = {
  type: TurnDetectionType;
  /** VAD detection threshold, 0.0–1.0. */
  threshold: number;
  /** Audio included before detected speech, in milliseconds. */
  prefixPaddingMs: number;
  /** Silence needed to end a turn, in milliseconds. */
  silenceDurationMs: number;
  /** Minimum speech, in seconds, before a segment starts. */
  minSpeechDuration: number;
};

export type AgentConfig = {
  /** System prompt sent as the session `instructions`. */
  instructions: string;
  /** Injected as a user turn on `session.created` so the agent speaks first. Empty = wait. */
  greeting: string;
  /** `"default"`, a preset name, or a cloned `voice_<id>`. */
  voice: string;
  temperature: number;
  /** Per-response cap. Integers are clamped to 4096 server-side; `"inf"` is unbounded. */
  maxOutputTokens: number | "inf";
  truncation: "auto" | "disabled";
  outputModalities: OutputModality[];
  turnDetection: TurnDetection;
  noiseReduction: NoiseReduction;
  transcription: { enabled: boolean; language: string | null };
  /**
   * The language the agent replies in, by name. Empty means "whatever the caller uses".
   *
   * There is no conversation-language field on the realtime session — the docs are explicit
   * that the model detects the spoken language and replies in kind, and that
   * `transcription.language` is a transcription hint only. Pinning the reply therefore has
   * to go through the instructions, which `buildSessionPayload` does.
   */
  replyLanguage: string;
  inputRate: AudioRate;
  outputRate: AudioRate;
  toolChoice: ToolChoice;
  /** Ids of the tools (from the tool library) this agent may call. */
  toolIds: string[];
};

export const DEFAULT_INSTRUCTIONS =
  "You are Higgs Live, a warm and concise conversational voice assistant. Keep replies natural and brief. " +
  "You are speaking aloud, so do not use markdown, lists, emoji, or URLs.";

export const DEFAULT_GREETING = "Open with a casual one-sentence greeting and ask what's on my mind.";

export function defaultAgentConfig(): AgentConfig {
  return {
    instructions: DEFAULT_INSTRUCTIONS,
    greeting: DEFAULT_GREETING,
    voice: "chloe",
    temperature: 0.3,
    maxOutputTokens: "inf",
    truncation: "auto",
    outputModalities: ["audio"],
    turnDetection: {
      type: "server_vad",
      threshold: 0.55,
      prefixPaddingMs: 300,
      silenceDurationMs: 500,
      minSpeechDuration: 0.125,
    },
    noiseReduction: "near_field",
    transcription: { enabled: true, language: null },
    replyLanguage: "",
    inputRate: 24000,
    outputRate: 24000,
    toolChoice: "auto",
    toolIds: [],
  };
}

/** Deep-merges a stored (possibly older, possibly partial) config onto the defaults. */
export function withDefaults(config: Partial<AgentConfig> | undefined): AgentConfig {
  const base = defaultAgentConfig();
  if (!config) return base;
  return {
    ...base,
    ...config,
    turnDetection: { ...base.turnDetection, ...config.turnDetection },
    transcription: { ...base.transcription, ...config.transcription },
    outputModalities: config.outputModalities?.length ? config.outputModalities : base.outputModalities,
    toolIds: config.toolIds ?? base.toolIds,
  };
}

/** The `function` tool entries the model sees. Bindings stay client-side. */
export function toolSchemas(tools: ToolDefinition[]) {
  return tools.map(tool => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: parameterSchema(tool.parameters),
  }));
}

/** The system prompt, plus the reply-language directive when one is set. */
export function withReplyLanguage(config: AgentConfig) {
  const language = config.replyLanguage.trim();
  if (!language) return config.instructions;
  return `${config.instructions}\n\nAlways reply in ${language}, whatever language you are spoken to in. `
    + `If the caller writes or speaks in another language, still answer in ${language}.`;
}

/** Translate an `AgentConfig` into the `session` object of a `session.update` event. */
export function buildSessionPayload(config: AgentConfig, tools: ToolDefinition[]) {
  const { turnDetection: turn } = config;
  return {
    type: "realtime",
    model: REALTIME_MODEL,
    instructions: withReplyLanguage(config),
    output_modalities: config.outputModalities,
    audio: {
      input: {
        format: { type: "audio/pcm", rate: config.inputRate },
        noise_reduction: config.noiseReduction === "off" ? null : { type: config.noiseReduction },
        transcription: config.transcription.enabled
          ? { model: TRANSCRIPTION_MODEL, language: config.transcription.language }
          : null,
        // `null` hands turn-taking to the client, which then commits each turn itself.
        turn_detection: turn.type === "manual" ? null : {
          type: turn.type,
          threshold: turn.threshold,
          prefix_padding_ms: turn.prefixPaddingMs,
          silence_duration_ms: turn.silenceDurationMs,
          min_speech_duration: turn.minSpeechDuration,
        },
      },
      output: {
        format: { type: "audio/pcm", rate: config.outputRate },
        voice: config.voice || "default",
      },
    },
    tools: toolSchemas(tools),
    tool_choice: tools.length ? config.toolChoice : "none",
    temperature: config.temperature,
    max_output_tokens: config.maxOutputTokens,
    truncation: config.truncation,
  };
}

/** Human-readable summary of the parameters that are not at their default. */
export function configSummary(config: AgentConfig) {
  const base = defaultAgentConfig();
  const parts: string[] = [];
  if (config.temperature !== base.temperature) parts.push(`temp ${config.temperature}`);
  if (config.turnDetection.type !== base.turnDetection.type) parts.push(config.turnDetection.type);
  if (config.maxOutputTokens !== base.maxOutputTokens) parts.push(`${config.maxOutputTokens} tokens`);
  if (config.outputModalities[0] !== "audio") parts.push("text-only");
  if (config.replyLanguage) parts.push(`replies in ${config.replyLanguage}`);
  if (config.toolIds.length) parts.push(`${config.toolIds.length} tool${config.toolIds.length > 1 ? "s" : ""}`);
  return parts.join(" · ");
}
