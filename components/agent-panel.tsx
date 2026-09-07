"use client";

import { useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import {
  AUDIO_RATES, configSummary, type AgentConfig, type AudioRate, type NoiseReduction,
  type ToolChoice, type TurnDetectionType,
} from "@/lib/agent-config";
import type { ToolDefinition } from "@/lib/tools";
import type { VoiceRecord } from "@/lib/store/types";
import { VoiceField } from "@/components/voice-picker";
import { ToolSelector } from "@/components/tools-panel";
import { AGENT_ICONS, AGENT_TONES, ICON_ORDER, TONE_ORDER, agentLook } from "@/lib/agent-look";
import { languageByName, languageName } from "@/lib/languages";
import { LanguagePicker } from "@/components/language-picker";

/**
 * The agent's settings, as a page rather than a rail.
 *
 * Every parameter is one full-width row: what it is on the left, the answer on the right.
 * Nothing that has a chosen value shows its whole option list inline — a picker that only
 * matters while you are picking belongs in a modal or behind a disclosure, or the page
 * turns into the wall of controls this replaced.
 *
 * See lib/agent-config.ts for how each field maps onto `session.update`.
 * https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions
 */

type Patch = (changes: Partial<AgentConfig>) => void;

export function Row({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  return <div className="config-row">
    <div className="config-label"><b>{label}</b>{hint && <small>{hint}</small>}</div>
    {children && <div className="config-control">{children}</div>}
  </div>;
}

/** A row whose control is a full-width field underneath it rather than beside it. */
function Block({ label, hint, action, children }: {
  label: string; hint?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return <section className="config-block">
    <div className="config-row">
      <div className="config-label"><b>{label}</b>{hint && <small>{hint}</small>}</div>
      {action && <div className="config-control">{action}</div>}
    </div>
    {children}
  </section>;
}

export function Toggle({ on, onChange, disabled, label }: {
  on: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string;
}) {
  return <button
    role="switch" aria-checked={on} aria-label={label} disabled={disabled}
    className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}
  ><i /></button>;
}

function Select<T extends string | number>({ value, options, onChange, disabled }: {
  value: T; options: Array<[T, string]>; onChange: (next: T) => void; disabled?: boolean;
}) {
  return <div className="field-select">
    <select value={value} disabled={disabled} onChange={event => {
      const raw = event.currentTarget.value;
      onChange((typeof value === "number" ? Number(raw) : raw) as T);
    }}>
      {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
    </select>
    <ChevronDown aria-hidden="true" />
  </div>;
}

function Slider({ value, min, max, step, format, onChange, disabled }: {
  value: number; min: number; max: number; step: number; format: (value: number) => string;
  onChange: (value: number) => void; disabled?: boolean;
}) {
  return <div className="slider">
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={event => onChange(Number(event.currentTarget.value))} />
    <span>{format(value)}</span>
  </div>;
}

/* ----------------------------------------------------------- configuration --- */

export function AgentConfiguration({ config, patch, look, setLook, locked, onFieldBlur }: {
  config: AgentConfig; patch: Patch; locked: boolean;
  /** The agent's own colour and icon, which live on the record rather than the config. */
  look: { id: string; color?: string; icon?: string };
  setLook: (changes: { color?: string; icon?: string }) => void;
  /** Leaving a free-text field brings the "saved" confirmation forward. */
  onFieldBlur?: () => void;
}) {
  const chosen = agentLook(look);
  return <div className="config-page">
    <Block label="Instructions" hint="Sent as the session instructions when the call starts">
      <textarea
        className="prompt-field" value={config.instructions} disabled={locked} onBlur={onFieldBlur}
        onChange={event => patch({ instructions: event.currentTarget.value })}
      />
    </Block>

    <Row label="Model" hint="The realtime model that powers this agent">
      <span className="field-static">Higgs Realtime</span>
    </Row>

    {/* An empty greeting is how the API is told to wait, so the toggle is not cosmetic:
        turning it off clears the field, and turning it back on restores a usable default. */}
    <Block
      label="Welcome message"
      hint="When on, the agent speaks first. When off, it waits for the caller."
      action={<Toggle
        label="Welcome message" on={!!config.greeting} disabled={locked}
        onChange={on => patch({ greeting: on ? "Open with a casual one-sentence greeting and ask what's on my mind." : "" })}
      />}
    >
      {!!config.greeting && <textarea
        className="prompt-field short" value={config.greeting} disabled={locked} onBlur={onFieldBlur}
        onChange={event => patch({ greeting: event.currentTarget.value })}
      />}
    </Block>

    {/* Appearance sits at the end of the page it describes: the colour is how you pick this
        agent out of a list, and the hue the orb takes when you talk to it. */}
    <Block label="Appearance" hint="The colour and icon this agent wears — in every list, and in the orb.">
      <div className="look-picker">
        <div className="look-swatches" role="radiogroup" aria-label="Agent colour">
          {TONE_ORDER.map(tone => <button
            key={tone}
            role="radio" aria-checked={chosen.tone === tone} aria-label={AGENT_TONES[tone].label}
            title={AGENT_TONES[tone].label}
            className={`look-swatch ${chosen.tone === tone ? "on" : ""}`}
            style={{ background: AGENT_TONES[tone].tile, color: AGENT_TONES[tone].ink }}
            disabled={locked}
            onClick={() => setLook({ color: tone })}
          ><i /></button>)}
        </div>
        <div className="look-icons" role="radiogroup" aria-label="Agent icon">
          {ICON_ORDER.map(name => {
            const Icon = AGENT_ICONS[name];
            const on = chosen.icon === name;
            return <button
              key={name}
              role="radio" aria-checked={on} aria-label={name} title={name}
              className={`look-icon ${on ? "on" : ""}`}
              style={on ? { background: chosen.swatch.tile, color: chosen.swatch.ink } : undefined}
              disabled={locked}
              onClick={() => setLook({ icon: name })}
            ><Icon /></button>;
          })}
        </div>
      </div>
    </Block>
  </div>;
}

/* ------------------------------------------------------------------- tools --- */

export function AgentTools({ config, patch, tools, onManageTools, locked }: {
  config: AgentConfig; patch: Patch; tools: ToolDefinition[]; onManageTools: () => void; locked: boolean;
}) {
  const toggleTool = (id: string) => patch({
    toolIds: config.toolIds.includes(id) ? config.toolIds.filter(toolId => toolId !== id) : [...config.toolIds, id],
  });

  return <div className="config-page">
    {/* Every tool, on the page. Hiding the library behind "Add tool" made choosing what an
        agent can do a click away from the tab whose entire job is choosing it. */}
    <Block
      label="Tools"
      hint="Functions the agent can call mid-conversation. Results come back as function_call_output."
      action={<button className="field-button ghost" onClick={onManageTools}>
        <Wrench aria-hidden="true" />Manage tools
      </button>}
    >
      <ToolSelector
        tools={tools} selected={config.toolIds} onToggle={toggleTool}
        onManage={onManageTools} disabled={locked} hideManage
      />
    </Block>

    {config.toolIds.length > 0 && <Row label="Tool choice" hint="When the model is allowed to reach for a tool">
      <Select value={config.toolChoice} disabled={locked}
        options={[["auto", "Auto"], ["required", "Required"], ["none", "None"]] as Array<[ToolChoice, string]>}
        onChange={toolChoice => patch({ toolChoice })} />
    </Row>}
  </div>;
}

/* ---------------------------------------------------------------- advanced --- */

/** Turn-taking and generation: the parameters you reach for once the agent works. */
export function AgentAdvanced({ config, patch, locked, onFieldBlur }: {
  config: AgentConfig; patch: Patch; locked: boolean; onFieldBlur?: () => void;
}) {
  const turn = config.turnDetection;
  const vad = turn.type !== "manual";

  return <div className="config-page">
    <Row label="Turn detection" hint={
      turn.type === "server_vad" ? "Voice activity ends the turn after a pause; speaking over the agent interrupts it."
        : turn.type === "semantic_vad" ? "Judges whether you have actually finished, so natural pauses cut you off less often."
        : "The client commits each turn — nothing is sent until you release the talk button."
    }>
      <Select value={turn.type} disabled={locked}
        options={[["server_vad", "Server VAD"], ["semantic_vad", "Semantic"], ["manual", "Push to talk"]] as Array<[TurnDetectionType, string]>}
        onChange={type => patch({ turnDetection: { ...turn, type } })} />
    </Row>

    {vad && <div className="config-nested">
      <Row label="Threshold" hint="How loud counts as speech">
        <Slider value={turn.threshold} min={0} max={1} step={0.05} disabled={locked}
          format={value => value.toFixed(2)}
          onChange={threshold => patch({ turnDetection: { ...turn, threshold } })} />
      </Row>
      <Row label="Silence to end turn">
        <Slider value={turn.silenceDurationMs} min={100} max={2000} step={50} disabled={locked}
          format={value => `${value} ms`}
          onChange={silenceDurationMs => patch({ turnDetection: { ...turn, silenceDurationMs } })} />
      </Row>
      <Row label="Prefix padding" hint="Audio kept from before speech was detected">
        <Slider value={turn.prefixPaddingMs} min={0} max={1000} step={50} disabled={locked}
          format={value => `${value} ms`}
          onChange={prefixPaddingMs => patch({ turnDetection: { ...turn, prefixPaddingMs } })} />
      </Row>
      <Row label="Minimum speech">
        <Slider value={turn.minSpeechDuration} min={0.05} max={1} step={0.025} disabled={locked}
          format={value => `${value.toFixed(3)} s`}
          onChange={minSpeechDuration => patch({ turnDetection: { ...turn, minSpeechDuration } })} />
      </Row>
    </div>}

    <Row label="Temperature" hint="Higher is more varied">
      <Slider value={config.temperature} min={0} max={1.2} step={0.05} disabled={locked}
        format={value => value.toFixed(2)} onChange={temperature => patch({ temperature })} />
    </Row>

    <Row label="Max output tokens" hint="Per response; integers clamp to 4096">
      <div className="token-cap">
        <button className={config.maxOutputTokens === "inf" ? "active" : ""} disabled={locked}
          onClick={() => patch({ maxOutputTokens: "inf" })}>Unlimited</button>
        <input
          type="number" min={16} max={4096} step={16} placeholder="4096" disabled={locked} onBlur={onFieldBlur}
          value={config.maxOutputTokens === "inf" ? "" : config.maxOutputTokens}
          onChange={event => {
            const value = Number(event.currentTarget.value);
            patch({ maxOutputTokens: Number.isFinite(value) && value > 0 ? Math.min(4096, value) : "inf" });
          }}
        />
      </div>
    </Row>

    <Row label="Context handling" hint="Auto summarizes long conversations">
      <Select value={config.truncation} disabled={locked}
        options={[["auto", "Auto"], ["disabled", "Disabled"]] as Array<["auto" | "disabled", string]>}
        onChange={truncation => patch({ truncation })} />
    </Row>

    {configSummary(config) && <p className="config-summary">Overrides: {configSummary(config)}</p>}
  </div>;
}

/* ------------------------------------------------------------------- voice --- */

export function AgentVoice({ config, patch, voices, onClone, onDeleteVoice, locked, onFieldBlur }: {
  config: AgentConfig; patch: Patch; voices: VoiceRecord[]; onClone: () => void;
  onDeleteVoice?: (id: string) => void; locked: boolean;
  onFieldBlur?: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  return <div className="config-page">
    <Row label="Voice" hint="Choose a preset or one of your cloned voices.">
      <VoiceField voices={voices} selected={config.voice} disabled={locked} onClone={onClone}
        onDelete={onDeleteVoice} onSelect={voice => patch({ voice })} />
    </Row>

    <Row label="Response format" hint="Spoken audio, or text only">
      <Select value={config.outputModalities[0]} disabled={locked}
        options={[["audio", "Audio"], ["text", "Text"]] as Array<["audio" | "text", string]>}
        onChange={modality => patch({ outputModalities: [modality] })} />
    </Row>

    {/* Two different mechanisms behind one heading, which the hints say plainly: the caller's
        language is a real API field, the reply language is a line appended to the prompt. */}
    <Row label="Caller speaks" hint="Biases transcription toward one language. Higgs detects it on its own otherwise.">
      <LanguagePicker
        transcribableOnly
        anyLabel="Detect automatically"
        disabled={locked || !config.transcription.enabled}
        value={languageName(config.transcription.language ?? "")}
        onChange={name => patch({
          transcription: { ...config.transcription, language: languageByName(name)?.code ?? null },
        })}
      />
    </Row>

    <Row label="Agent replies in" hint="Added to the instructions. Left open, it answers in whatever language it hears.">
      <LanguagePicker
        anyLabel="Match the caller"
        disabled={locked}
        value={config.replyLanguage}
        onChange={replyLanguage => patch({ replyLanguage })}
      />
    </Row>

    <Row label="Input transcription" hint="Emits transcripts of your speech via higgs-stt-3.1">
      <Toggle label="Input transcription" on={config.transcription.enabled} disabled={locked}
        onChange={enabled => patch({ transcription: { ...config.transcription, enabled } })} />
    </Row>

    <Row label="Noise reduction" hint="Denoise your microphone before the model hears it">
      <Select value={config.noiseReduction} disabled={locked}
        options={[["near_field", "Near field"], ["far_field", "Far field"], ["off", "Off"]] as Array<[NoiseReduction, string]>}
        onChange={noiseReduction => patch({ noiseReduction })} />
    </Row>

    <button className="advanced-toggle" onClick={() => setAdvanced(value => !value)}>
      {advanced ? "Hide" : "Show"} advanced audio settings
    </button>

    {advanced && <div className="config-nested">
      <Row label="Input sample rate">
        <Select value={config.inputRate} disabled={locked}
          options={AUDIO_RATES.map(rate => [rate, `${rate / 1000} kHz`] as [AudioRate, string])}
          onChange={inputRate => patch({ inputRate })} />
      </Row>
      <Row label="Output sample rate">
        <Select value={config.outputRate} disabled={locked}
          options={AUDIO_RATES.map(rate => [rate, `${rate / 1000} kHz`] as [AudioRate, string])}
          onChange={outputRate => patch({ outputRate })} />
      </Row>
    </div>}

  </div>;
}
