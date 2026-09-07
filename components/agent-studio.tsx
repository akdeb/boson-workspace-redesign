"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, AudioLines, Bot, Check, Copy, Headset, LayoutList,
  MessageSquareText, Pencil, Phone, Plus, Search, Trash2, Waypoints, Wrench,
} from "lucide-react";
import { defaultAgentConfig, withDefaults, type AgentConfig } from "@/lib/agent-config";
import { BUILTIN_AGENTS } from "@/lib/store/seed";
import { AGENT_ICONS, agentLook, orbFilter } from "@/lib/agent-look";
import { useStudio, useVoiceLibrary, voiceLabel } from "@/lib/store/use-studio";
import type { AgentRecord, SessionRecord, VoiceRecord } from "@/lib/store/types";
import { Orb } from "orb-ui";
import { Shell } from "@/components/shell";
import { AgentAdvanced, AgentConfiguration, AgentTools, AgentVoice } from "@/components/agent-panel";
import { TryItLive } from "@/components/try-it-live";
import { Transcript } from "@/components/transcript";
import { ToolsModal } from "@/components/tools-panel";
import { CloneVoiceModal } from "@/components/voice-clone";
import { AgentBuilderModal, draftToConfig } from "@/components/agent-builder";

/**
 * Agent Studio, as a library of agents rather than a playground with a settings rail.
 *
 * An agent is the unit of work here: it owns its prompt, its tools, and — the question
 * this answers — its voice. The avatar picks an agent; the agent picks a voice. So the
 * settings get a whole page instead of a 380px column, and the call that used to fill the
 * canvas becomes a drawer you can open while you edit.
 */

/* ------------------------------------------------------------------- shared --- */

/**
 * An agent's mark: its icon on a tile of its own colour.
 *
 * The shipped agents come with one, a drafted agent is given one by the builder, and
 * anything else falls back to a stable choice off its id — so no agent is ever anonymous.
 * See lib/agent-look.ts.
 */
function AgentMark({ agent, size }: { agent: { id: string; color?: string; icon?: string }; size: number }) {
  const { icon, swatch } = agentLook(agent);
  const Icon = AGENT_ICONS[icon];
  // Sized in whole pixels rather than a percentage: 52% of 34px is 17.68, and a
  // fractional SVG box lands the glyph half a pixel off centre.
  const glyph = Math.round(size * 0.52 / 2) * 2;
  return <span
    className="agent-mark"
    style={{ width: size, height: size, background: swatch.tile, color: swatch.ink }}
    aria-hidden="true"
  ><Icon width={glyph} height={glyph} /></span>;
}

function relativeTime(iso: string) {
  const when = new Date(iso);
  const seconds = Math.max(0, (Date.now() - when.getTime()) / 1000);
  if (seconds < 60) return "just now";
  // Past a month "5 weeks ago" stops meaning anything — show the date instead.
  if (seconds > 2_592_000) return when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const steps: Array<[number, string]> = [[60, "minute"], [3600, "hour"], [86400, "day"], [604800, "week"]];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const [unit, name] = steps[index];
    const value = Math.floor(seconds / unit);
    if (value >= 1) return `${value} ${name}${value > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

/**
 * The shipped scenarios, offered as one-click starting points.
 *
 * Sourced from the seed constants rather than from whatever is in the database, so a
 * template still works after you have renamed or deleted the agent it was seeded from —
 * a starting point that disappears because you used it is not a starting point.
 */
const TEMPLATE_IDS = ["agent-higgs-live", "agent-receptionist", "agent-interviewer", "agent-support"];

function useCreateAgent() {
  const studio = useStudio();
  const router = useRouter();
  return useCallback((
    from?: AgentRecord,
    name?: string,
    overrides?: { summary?: string; config?: Partial<AgentConfig>; color?: string; icon?: string },
  ) => {
    const now = new Date().toISOString();
    const base: AgentRecord = from
      ? { ...from, id: studio.newId("agent"), name: name ?? `${from.name} copy`, builtin: undefined, createdAt: now, updatedAt: now }
      : {
          id: studio.newId("agent"), name: name ?? "New agent", summary: "Describe what this agent does.",
          config: withDefaults(defaultAgentConfig()), createdAt: now, updatedAt: now,
        };
    const record: AgentRecord = {
      ...base,
      summary: overrides?.summary ?? base.summary,
      config: withDefaults({ ...base.config, ...overrides?.config }),
      ...(overrides?.color ? { color: overrides.color } : {}),
      ...(overrides?.icon ? { icon: overrides.icon } : {}),
    };
    studio.saveAgent(record);
    router.push(`/workspace/agent-studio/${record.id}`);
    return record;
  }, [studio, router]);
}

/**
 * The builder, wherever "Create agent" is pressed.
 *
 * Both the landing and the library open the same dialog: creating an agent should be one
 * flow with one entry, not a different thing depending on which page you happened to be on.
 * "Skip" inside it is the blank agent, which is why there is no separate button for that.
 */
function BuilderHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createAgent = useCreateAgent();
  if (!open) return null;
  return <AgentBuilderModal
    onClose={onClose}
    onBlank={() => { onClose(); createAgent(); }}
    onCreate={draft => {
      onClose();
      createAgent(undefined, draft.name, {
        summary: draft.summary, config: draftToConfig(draft),
        color: draft.color, icon: draft.icon,
      });
    }}
  />;
}

/* ------------------------------------------------------------- the landing --- */

/**
 * What Agent Studio opens on: the orb, and something to say to it.
 *
 * The point of this product is the half-second where a voice answers you, so that is what
 * the first screen is — pick an agent, go live. Managing the library is a second click,
 * not the front door.
 */
const LANDING_SLOTS = 4;

export function AgentLandingPage({ startCreating = false }: { startCreating?: boolean }) {
  const studio = useStudio();
  const router = useRouter();
  const { voices } = useVoiceLibrary(studio.voices);
  const createAgent = useCreateAgent();
  const [agentId, setAgentId] = useState("");
  const [live, setLive] = useState(false);
  const [building, setBuilding] = useState(startCreating);
  // The stage owns the call; the landing only needs to know so it does not offer to
  // navigate away from one in progress.
  const [inSession, setInSession] = useState(false);
  const onSessionChange = useCallback((active: boolean) => setInSession(active), []);

  const agent = studio.agents.find(record => record.id === agentId) ?? studio.agents[0] ?? null;

  const shown = studio.agents.slice(0, LANDING_SLOTS);
  const spare = studio.agents.length - shown.length;

  return <Shell studio="agent">
    <main className="landing">
      {!live && <>
        <div className="landing-hero" style={agent ? { "--orb-filter": orbFilter(agentLook(agent).tone) } as React.CSSProperties : undefined}>
          <Orb state="listening" volume={.28} theme="cloud" size={260} interactive={false} aria-label="Higgs Realtime" />
          <h1>Higgs Realtime Agents</h1>
          <p>Pick an agent and start talking. It answers in its own voice, and can reach for its tools mid-sentence.</p>
        </div>

        <div className="landing-agents">
          {shown.map(record => {
            const edit = () => router.push(`/workspace/agent-studio/${record.id}`);
            return <div
              key={record.id}
              className={`landing-agent ${agent?.id === record.id ? "selected" : ""}`}
              role="radio" aria-checked={agent?.id === record.id} tabIndex={0}
              onClick={() => setAgentId(record.id)}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setAgentId(record.id); } }}
            >
              <AgentMark agent={record} size={34} />
              <span className="landing-agent-copy">
                <b>{record.name}</b>
                <small>{record.summary}</small>
              </span>
              <em>{voiceLabel(voices, record.config.voice)}</em>
              <button
                className="landing-agent-edit" title={`Edit ${record.name}`} aria-label={`Edit ${record.name}`}
                onClick={event => { event.stopPropagation(); edit(); }}
              ><Pencil aria-hidden="true" /></button>
            </div>;
          })}
        </div>

        {/* One door, in the flow. A "…" would promise per-agent actions; what is actually
            behind this is the rest of the library, so it says so — and only when there is
            a rest to see. */}
        <button className="landing-more" disabled={inSession} onClick={() => router.push("/workspace/agent-studio/manage")}>
          {spare > 0 ? `See all ${studio.agents.length} agents` : "Manage agents"}
          <ArrowRight aria-hidden="true" />
        </button>

        <div className="landing-actions">
          <button className="start-chat" disabled={!agent} onClick={() => setLive(true)}>
            <AudioLines />Go live
          </button>
          <button className="landing-create" onClick={() => setBuilding(true)}>
            <Plus aria-hidden="true" />Create agent
          </button>
        </div>
      </>}

      <BuilderHost open={building} onClose={() => setBuilding(false)} />

    </main>
  </Shell>;
}

/* ---------------------------------------------------------------- the list --- */

export function AgentListPage() {
  const studio = useStudio();
  const router = useRouter();
  const { voices } = useVoiceLibrary(studio.voices);
  const createAgent = useCreateAgent();
  const [query, setQuery] = useState("");
  const [building, setBuilding] = useState(false);

  const shown = studio.agents.filter(agent =>
    `${agent.name} ${agent.summary}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <Shell studio="agent">
    <main className="library">
      <button className="back-link" onClick={() => router.push("/workspace/agent-studio")}>
        <ArrowLeft aria-hidden="true" />Back
      </button>
      <header className="library-head">
        <div>
          <h1>Agents</h1>
          <p>Build, configure, and test realtime voice agents.</p>
        </div>
      </header>

      <div className="library-bar">
        <label className="library-search">
          <Search aria-hidden="true" />
          <input value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search agents" aria-label="Search agents" />
        </label>
        <button className="primary create-agent" onClick={() => setBuilding(true)}><Plus aria-hidden="true" />Create agent</button>
      </div>

      <div className="library-table" role="table" aria-label="Agents">
        <div className="library-row head" role="row"><span role="columnheader">Agent</span><span role="columnheader">Voice</span><span role="columnheader">Tools</span><span role="columnheader">Updated</span><span /></div>
        {shown.map(agent => {
          const open = () => router.push(`/workspace/agent-studio/${agent.id}`);
          return <div
            className="library-row" key={agent.id} role="row" tabIndex={0} onClick={open}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}
          >
            <span className="library-agent" role="cell">
              <AgentMark agent={agent} size={34} />
              <span className="library-agent-copy"><b>{agent.name}</b><small>{agent.summary}</small></span>
            </span>
            <span className="library-cell" role="cell">{voiceLabel(voices, agent.config.voice)}</span>
            <span className="library-cell" role="cell">{agent.config.toolIds.length || "—"}</span>
            <span className="library-cell" role="cell">{relativeTime(agent.updatedAt)}</span>
            {/* Straight into a live session, skipping the settings page you did not come
                here for. Same word and same icon as every other way in. */}
            <button
              className="library-call" title={`Go live with ${agent.name}`} aria-label={`Go live with ${agent.name}`}
              onClick={event => { event.stopPropagation(); router.push(`/workspace/agent-studio/${agent.id}?call=1`); }}
            ><AudioLines aria-hidden="true" />Live</button>
          </div>;
        })}
        {!shown.length && <div className="no-results">No agents match your search.</div>}
      </div>

      <div className="library-templates">
        {TEMPLATE_IDS.map(id => {
          const seed = BUILTIN_AGENTS.find(agent => agent.id === id)!;
          return <button key={id} onClick={() => createAgent(seed, seed.name)}>
            {id === "agent-higgs-live"
              ? <span className="agent-mark brand" style={{ width: 30, height: 30 }} aria-hidden="true" />
              : <AgentMark agent={seed} size={30} />}
            {seed.name}
          </button>;
        })}
      </div>

      <BuilderHost open={building} onClose={() => setBuilding(false)} />
    </main>
  </Shell>;
}

/**
 * "Changes saved", once you stop.
 *
 * Edits write through on every keystroke, so a toast per change would be a strobe light.
 * The ping is debounced instead: typing collapses into one confirmation shortly after you
 * stop, and leaving a field (`ping(BLUR_DELAY)`) brings it forward to almost immediate.
 */
const SETTLE_DELAY = 900;
const BLUR_DELAY = 120;
const TOAST_DURATION = 2000;

function useSaveToast() {
  const [visible, setVisible] = useState(false);
  const settle = useRef<number | null>(null);
  const dismiss = useRef<number | null>(null);

  useEffect(() => () => {
    if (settle.current) window.clearTimeout(settle.current);
    if (dismiss.current) window.clearTimeout(dismiss.current);
  }, []);

  const ping = useCallback((delay: number = SETTLE_DELAY) => {
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      settle.current = null;
      setVisible(true);
      if (dismiss.current) window.clearTimeout(dismiss.current);
      dismiss.current = window.setTimeout(() => setVisible(false), TOAST_DURATION);
    }, delay);
  }, []);

  return { visible, ping };
}

function SavedToast({ visible }: { visible: boolean }) {
  return <div className={`saved-toast ${visible ? "on" : ""}`} role="status" aria-live="polite">
    <Check aria-hidden="true" />Changes saved
  </div>;
}

/* -------------------------------------------------------------- the detail --- */

type Tab = "configuration" | "tools" | "voice" | "advanced" | "conversations";

export function AgentDetailPage({ agentId, startInCall = false }: { agentId: string; startInCall?: boolean }) {
  const studio = useStudio();
  const router = useRouter();
  const { voices, refresh: refreshVoices } = useVoiceLibrary(studio.voices);
  const createAgent = useCreateAgent();
  const [tab, setTab] = useState<Tab>("configuration");
  const [live, setLive] = useState(startInCall);
  const [inSession, setInSession] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [managingTools, setManagingTools] = useState(false);
  const onSessionChange = useCallback((active: boolean) => setInSession(active), []);
  const { visible: saved, ping } = useSaveToast();

  const agent = studio.agents.find(record => record.id === agentId) ?? null;

  const patchConfig = useCallback((changes: Partial<AgentConfig>) => {
    if (!agent) return;
    studio.saveAgent({ ...agent, config: { ...agent.config, ...changes }, updatedAt: new Date().toISOString() });
    ping();
  }, [agent, studio, ping]);

  const deleteVoice = (id: string) => {
    studio.deleteVoice(id);
    if (agent?.config.voice === id) patchConfig({ voice: "chloe" });
  };

  const onCloned = (voice: VoiceRecord) => {
    studio.saveVoice(voice);
    void refreshVoices(true);
    setCloning(false);
    patchConfig({ voice: voice.id });
  };

  if (!agent) {
    return <Shell studio="agent"><main className="library">
      <button className="back-link" onClick={() => router.push("/workspace/agent-studio")}><ArrowLeft aria-hidden="true" />Back</button>
      <div className="no-results">That agent no longer exists.</div>
    </main></Shell>;
  }

  const rename = (changes: Partial<AgentRecord>) => {
    studio.saveAgent({ ...agent, ...changes, updatedAt: new Date().toISOString() });
    ping();
  };
  const onFieldBlur = () => ping(BLUR_DELAY);

  const conversations = studio.sessions.filter(session => session.agentId === agent.id);

  return <Shell studio="agent">
    <main className="detail">
      <div className="detail-scroll">
        <button className="back-link" onClick={() => router.push("/workspace/agent-studio")}><ArrowLeft aria-hidden="true" />Back</button>

        <header className="detail-head">
          <div className="detail-title">
            <input className="agent-name" value={agent.name} disabled={inSession} maxLength={40}
              onBlur={onFieldBlur} onChange={event => rename({ name: event.currentTarget.value })} />
            <input className="agent-summary" value={agent.summary} disabled={inSession} maxLength={80}
              onBlur={onFieldBlur} onChange={event => rename({ summary: event.currentTarget.value })} />
          </div>
          <div className="detail-actions">
            <button className="try-live" onClick={() => setLive(true)} disabled={live}>
              <AudioLines aria-hidden="true" />Live
            </button>
            <button onClick={() => createAgent(agent)} disabled={inSession} title="Duplicate this agent"><Copy aria-hidden="true" />Duplicate</button>
            {studio.agents.length > 1 && <button
              className="danger" disabled={inSession} title="Delete this agent"
              onClick={() => { studio.deleteAgent(agent.id); router.push("/workspace/agent-studio"); }}
            ><Trash2 aria-hidden="true" /></button>}
          </div>
        </header>

        <nav className="detail-tabs" role="tablist">
          {([
            ["configuration", "Configuration"], ["tools", "Tools"], ["voice", "Voice"],
            ["advanced", "Advanced"], ["conversations", "Conversations"],
          ] as Array<[Tab, string]>)
            .map(([id, text]) => <button key={id} role="tab" aria-selected={tab === id}
              className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{text}</button>)}
        </nav>

        {tab === "configuration" && <AgentConfiguration
          config={agent.config} patch={patchConfig} locked={inSession} onFieldBlur={onFieldBlur}
          look={agent} setLook={changes => { rename(changes); }}
        />}
        {tab === "tools" && <AgentTools
          config={agent.config} patch={patchConfig} tools={studio.tools}
          onManageTools={() => setManagingTools(true)} locked={inSession}
        />}
        {tab === "advanced" && <AgentAdvanced
          config={agent.config} patch={patchConfig} locked={inSession} onFieldBlur={onFieldBlur}
        />}
        {tab === "voice" && <AgentVoice
          config={agent.config} patch={patchConfig} voices={voices}
          onClone={() => setCloning(true)} onDeleteVoice={deleteVoice}
          locked={inSession} onFieldBlur={onFieldBlur}
        />}
        {tab === "conversations" && <ConversationList sessions={conversations} onDelete={studio.deleteSession} />}
      </div>

      {live && <TryItLive
        agent={agent} tools={studio.tools} voices={voices} autoStart={startInCall}
        onClose={() => setLive(false)} onSessionChange={onSessionChange}
      />}
    </main>

    <SavedToast visible={saved} />

    {cloning && <CloneVoiceModal onClose={() => setCloning(false)} onCreated={onCloned} />}
    {managingTools && <ToolsModal
      tools={studio.tools} onClose={() => setManagingTools(false)}
      onSave={studio.saveTool} onDelete={studio.deleteTool} newId={studio.newId}
    />}
  </Shell>;
}

/** Past calls with this agent, each expanding into the conversation that was had. */
export function ConversationList({ sessions, onDelete }: {
  sessions: SessionRecord[]; onDelete?: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!sessions.length) {
    return <div className="history-empty">
      <span><Wrench aria-hidden="true" /></span>
      <h3>No conversations yet</h3>
      <p>Calls you make with <b>Try it live</b> are kept here, tool calls and all.</p>
    </div>;
  }
  return <div className="conversation-list">
    {sessions.map(session => <article className={`conversation ${open === session.id ? "open" : ""}`} key={session.id}>
      <button className="conversation-head" onClick={() => setOpen(open === session.id ? null : session.id)}>
        <span><b>{session.title}</b><small>{session.detail}</small></span>
        <time>{new Date(session.createdAt).toLocaleString()}</time>
      </button>
      {open === session.id && <div className="conversation-body">
        <Transcript entries={session.transcript ?? []} empty="This call had no transcript." />
        {onDelete && <button className="link-button danger" onClick={() => onDelete(session.id)}>
          <Trash2 aria-hidden="true" />Delete this conversation
        </button>}
      </div>}
    </article>)}
  </div>;
}
