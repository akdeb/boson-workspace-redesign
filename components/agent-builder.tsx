"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Briefcase, CalendarDays, Headset, Loader2, TrendingUp, UserRoundCheck, X } from "lucide-react";
import { AGENT_TONES } from "@/lib/agent-look";
import type { AgentDraft, BuilderMessage } from "@/lib/agent-builder";
import type { AgentConfig } from "@/lib/agent-config";

/**
 * "Describe what you want, get an agent."
 *
 * The slow part of making an agent is writing its system prompt, so this asks for the use
 * case in plain words and drafts the rest. The draft is shown as it forms — you can create
 * it the moment it looks right rather than answering every question first.
 */

const OPENING = "What are you building? Describe the use case in your own words, or pick one below.";

/**
 * Starting points, each a short label over a fuller brief.
 *
 * The label is what fits on a chip; the prompt is what the model actually needs, so the
 * first turn is a real description rather than two words it has to interrogate.
 */
const STARTERS: Array<{ label: string; prompt: string; icon: React.ReactNode; tone: keyof typeof AGENT_TONES }> = [
  {
    label: "Customer Support",
    prompt: "A customer support agent that handles account and order questions on the phone, and escalates when it cannot resolve something.",
    icon: <Headset />, tone: "rose",
  },
  {
    label: "Sales Associate",
    prompt: "An outbound sales associate that qualifies inbound leads, asks about budget and timeline, and books a follow-up.",
    icon: <TrendingUp />, tone: "emerald",
  },
  {
    label: "Appointment Scheduler",
    prompt: "An appointment scheduler for a clinic that books, moves and cancels appointments and confirms the details back.",
    icon: <CalendarDays />, tone: "amber",
  },
  {
    label: "Personal Assistant",
    prompt: "A personal assistant that takes messages, answers everyday questions, and keeps replies brief and warm.",
    icon: <Briefcase />, tone: "indigo",
  },
  {
    label: "Lead Qualification",
    prompt: "A lead qualification agent that greets a caller, works out whether they are a fit, and hands off warm leads.",
    icon: <UserRoundCheck />, tone: "sky",
  },
];

export function AgentBuilderModal({ onClose, onCreate, onBlank }: {
  onClose: () => void;
  /** Create the drafted agent and open it. */
  onCreate: (draft: AgentDraft) => void;
  /** "Skip" — an empty agent, the same as Start from scratch. */
  onBlank: () => void;
}) {
  const [messages, setMessages] = useState<BuilderMessage[]>([]);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, busy]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [messages, busy]);

  const send = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    const next: BuilderMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/agents/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const body = await response.json() as { reply?: string; ready?: boolean; draft?: AgentDraft; error?: string };
      if (!response.ok) throw new Error(body.error ?? `The builder failed (${response.status}).`);
      setMessages([...next, { role: "assistant", content: body.reply ?? "" }]);
      if (body.draft) setDraft(body.draft);
      setReady(!!body.ready);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the builder.");
      // The user's message stays in the transcript, so retrying does not retype it.
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="picker-modal builder-modal" role="dialog" aria-modal="true" aria-labelledby="builder-title">
      <div className="modal-head">
        <h2 id="builder-title">Build an agent</h2>
        <button className="modal-head-action ghost" onClick={onBlank}>Skip</button>
        <button aria-label="Close" onClick={onClose} disabled={busy}><X /></button>
      </div>

      <div className="builder-thread" ref={scrollRef}>
        <p className="builder-line assistant">{OPENING}</p>
        {messages.map((message, index) => <p key={index} className={`builder-line ${message.role}`}>{message.content}</p>)}
        {busy && <p className="builder-line assistant thinking"><Loader2 className="spin" aria-hidden="true" />Thinking…</p>}
        {error && <p className="builder-line error">{error}</p>}

        {draft && <div className={`builder-draft ${ready ? "ready" : ""}`}>
          <h3>{draft.name}</h3>
          <p className="builder-draft-summary">{draft.summary}</p>
          <dl>
            <dt>Voice</dt><dd>{draft.voice}</dd>
            {draft.toolIds.length > 0 && <><dt>Tools</dt><dd>{draft.toolIds.length}</dd></>}
            <dt>Greeting</dt><dd>{draft.greeting}</dd>
          </dl>
          <pre>{draft.instructions}</pre>
          {/* The action lives on the draft rather than in a footer: it acts on this thing,
              and there is nothing else in the dialog to confirm or cancel. */}
          <button className="builder-create" disabled={busy} onClick={() => onCreate(draft)}>
            Create {draft.name}
          </button>
        </div>}
      </div>

      {!messages.length && <div className="builder-starters">
        {STARTERS.map(starter => <button key={starter.label} disabled={busy} onClick={() => void send(starter.prompt)}>
          <span
            className="starter-icon"
            style={{ background: AGENT_TONES[starter.tone].tile, color: AGENT_TONES[starter.tone].ink }}
            aria-hidden="true"
          >{starter.icon}</span>
          {starter.label}
        </button>)}
      </div>}

      <div className="builder-composer">
        <input
          value={text}
          disabled={busy}
          placeholder="Describe your agent's use case…"
          onChange={event => setText(event.currentTarget.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void send(text); } }}
        />
        <button aria-label="Send" disabled={!text.trim() || busy} onClick={() => void send(text)}><ArrowUp /></button>
      </div>

    </section>
  </div>;
}

/** The parts of an `AgentConfig` a draft supplies; the rest keeps its defaults. */
export function draftToConfig(draft: AgentDraft): Partial<AgentConfig> {
  return {
    instructions: draft.instructions,
    greeting: draft.greeting,
    voice: draft.voice,
    toolIds: draft.toolIds,
  };
}
