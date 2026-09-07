"use client";

import { Pencil, X } from "lucide-react";
import type { AgentConfig } from "@/lib/agent-config";
import { voiceLabel } from "@/lib/store/use-studio";
import type { AgentRecord, VoiceRecord } from "@/lib/store/types";
import type { ToolDefinition } from "@/lib/tools";

/**
 * What the agent on the other end of the call is configured to do.
 *
 * Read-only on purpose. Changing the prompt, the voice or the tools mid-session would
 * describe an agent you are not talking to — the session was configured when it opened and
 * cannot be reconfigured under it — so this answers "what is it set to?" and hands you to
 * the settings page, ending the call, when the answer is "not that".
 */

const TURN_LABELS: Record<string, string> = {
  server_vad: "Server VAD",
  semantic_vad: "Semantic",
  manual: "Push to talk",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="live-field">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>;
}

export function LiveSettingsSheet({ agent, voices, tools, onClose, onEdit, inSession }: {
  agent: AgentRecord;
  voices: VoiceRecord[];
  tools: ToolDefinition[];
  onClose: () => void;
  /** Ends the call and opens the agent's settings page. */
  onEdit: () => void;
  inSession: boolean;
}) {
  const config: AgentConfig = agent.config;
  const chosen = tools.filter(tool => config.toolIds.includes(tool.id));
  const turn = config.turnDetection;

  return <aside className="live-settings" aria-label={`${agent.name} settings`}>
    <header>
      <div>
        <b>Settings</b>
        <small>{agent.name}</small>
      </div>
      <button aria-label="Close" onClick={onClose}><X /></button>
    </header>

    <div className="live-settings-scroll">
      <p className="live-settings-note">
        {inSession
          ? "Read-only while the call is running — the session was configured when it opened."
          : "Read-only. Open the agent to change any of this."}
      </p>

      <dl>
        <Field label="Voice">{voiceLabel(voices, config.voice)}</Field>
        <Field label="Model">Higgs Realtime</Field>
        <Field label="Instructions"><pre>{config.instructions}</pre></Field>
        <Field label="Welcome message">
          {config.greeting ? <pre>{config.greeting}</pre> : <em>Waits for the caller</em>}
        </Field>
        <Field label="Tools">
          {chosen.length
            ? <ul className="live-tool-list">
                {chosen.map(tool => <li key={tool.id}><code>{tool.name}</code>{tool.description}</li>)}
              </ul>
            : <em>None</em>}
        </Field>
        {chosen.length > 0 && <Field label="Tool choice">{config.toolChoice}</Field>}
        <Field label="Turn detection">
          {TURN_LABELS[turn.type] ?? turn.type}
          {turn.type !== "manual" && <span className="live-sub">
            threshold {turn.threshold.toFixed(2)} · {turn.silenceDurationMs} ms silence ·
            {" "}{turn.prefixPaddingMs} ms padding · {turn.minSpeechDuration}s minimum
          </span>}
        </Field>
        <Field label="Temperature">{config.temperature.toFixed(2)}</Field>
        <Field label="Max output tokens">{config.maxOutputTokens === "inf" ? "Unlimited" : config.maxOutputTokens}</Field>
        <Field label="Response format">{config.outputModalities[0] === "audio" ? "Audio" : "Text"}</Field>
        <Field label="Context handling">{config.truncation === "auto" ? "Auto" : "Disabled"}</Field>
        <Field label="Input transcription">
          {config.transcription.enabled
            ? `On${config.transcription.language ? ` · ${config.transcription.language}` : " · auto"}`
            : "Off"}
        </Field>
        <Field label="Noise reduction">{config.noiseReduction.replace("_", " ")}</Field>
        <Field label="Audio rates">{config.inputRate / 1000} kHz in · {config.outputRate / 1000} kHz out</Field>
      </dl>
    </div>

    <footer>
      <button className="live-settings-edit" onClick={onEdit}>
        <Pencil aria-hidden="true" />{inSession ? "End call and edit" : "Edit this agent"}
      </button>
    </footer>
  </aside>;
}
