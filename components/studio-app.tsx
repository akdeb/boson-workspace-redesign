"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines, Check, ChevronDown, Flame, Pencil, Plus, Trash2,
} from "lucide-react";
import { AVATAR_SIZES, type AvatarSize } from "@/lib/boson-avatar";
import {
  avatarErrorMessage, renderAvatarClip, AVATAR_SCENE_PROMPT, AVATAR_STATUS_COPY,
  type AvatarRender, type AvatarStatus,
} from "@/lib/avatar-jobs";
import { agentLook } from "@/lib/agent-look";
import { AvatarChat } from "@/components/avatar-chat";
import {
  faceLibrary, faceSrc, faceSrcById, facePayload, findFace, useStudio, useVoiceLibrary, voiceLabel,
} from "@/lib/store/use-studio";
import type { AgentRecord, FaceRecord, TranscriptEntry, VoiceRecord } from "@/lib/store/types";
import { Composer, ComposerFooter, PresetRow, enhanceScript } from "@/components/composer";
import { Shell, type Studio } from "@/components/shell";
import { Toggle } from "@/components/agent-panel";
import { VoiceSection } from "@/components/voice-picker";
import { FaceSection, UploadFaceModal } from "@/components/face-picker";
import { BubbleTranscript, Transcript } from "@/components/transcript";
import { CloneVoiceModal } from "@/components/voice-clone";

const avatarPresets: Record<string, string> = {
  "Welcome message": "Hi, I'm your Boson AI avatar. Write your script in any language, choose a face, and I'll bring it to life for you.",
  "Product launch": "Meet the product designed to make your work simpler, faster, and more creative.",
  "Quarterly update": "Welcome to our quarterly update. Here are the milestones we reached together.",
  "Course intro": "Welcome to the course. Let's begin with the ideas that will shape everything ahead.",
};

const ttsPresets: Record<string, string> = {
  "Welcome message": "Welcome! It's great to have you here.",
  "Product launch": "Today, we're excited to introduce something new.",
  "Multilingual": "Hello, bonjour, hola — any language works.",
  "Teaching": "Let's break this idea down step by step.",
};

function PanelTabs({ main, history, setHistory }: { main: string; history: boolean; setHistory: (value: boolean) => void }) {
  return <div className="panel-tabs">
    <button className={!history ? "active" : ""} onClick={() => setHistory(false)}>{main}</button>
    <button className={history ? "active" : ""} onClick={() => setHistory(true)}>History</button>
  </div>;
}

/**
 * History for one studio.
 *
 * An avatar entry leads with the face it was rendered or spoken with — a wall of identical
 * text rows tells you nothing about which of six takes you are looking at — and a call
 * opens into the conversation that was actually had, tool calls in place.
 */
function HistoryPanel({ studio, faces }: { studio: Studio; faces: FaceRecord[] }) {
  const { sessions, deleteSession } = useStudio();
  const [open, setOpen] = useState<string | null>(null);
  const shown = sessions.filter(session => session.studio === studio);

  if (!shown.length) return <div className="history-empty">
    <span>◷</span><h3>No history yet</h3><p>Your generated sessions will appear here.</p>
  </div>;

  return <div className="panel-scroll history-list">
    {shown.map(session => {
      const expandable = !!session.transcript?.length;
      const expanded = open === session.id;
      return <div className={`history-item ${expanded ? "open" : ""}`} key={session.id}>
        <div className="history-main">
          {session.faceId && <span className="history-thumb">
            <Image src={faceSrcById(faces, session.faceId)} alt="" width={44} height={58}
              unoptimized={findFace(faces, session.faceId)?.kind === "uploaded"} />
          </span>}
          <span className="history-copy">
            <b>{session.title}</b>
            <small>{session.detail}</small>
            <time>{new Date(session.createdAt).toLocaleString()}</time>
          </span>
          <button className="history-remove" aria-label="Delete" onClick={() => deleteSession(session.id)}><Trash2 /></button>
        </div>
        {expandable && <button className="history-expand" onClick={() => setOpen(expanded ? null : session.id)}>
          {expanded ? "Hide conversation" : `View conversation · ${session.transcript!.length} entries`}
        </button>}
        {expanded && <div className="history-transcript"><Transcript entries={session.transcript!} /></div>}
      </div>;
    })}
  </div>;
}

/* ------------------------------------------------------------ voice studio --- */

/** Voice Studio is text-to-speech; the realtime conversation lives in Agent Studio. */
function VoiceMain({ voice, voices }: { voice: string; voices: VoiceRecord[] }) {
  const { addSession, newId } = useStudio();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const clipRef = useRef<string | null>(null);
  clipRef.current = clipUrl;
  useEffect(() => () => { if (clipRef.current) URL.revokeObjectURL(clipRef.current); }, []);

  const label = voiceLabel(voices, voice);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, format: "mp3" }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Generation failed (${response.status}).`);
      }
      if (clipUrl) URL.revokeObjectURL(clipUrl);
      setClipUrl(URL.createObjectURL(await response.blob()));
      addSession({
        id: newId("tts"), studio: "voice", title: text.slice(0, 60),
        detail: `Higgs TTS 3 · ${label}`, createdAt: new Date().toISOString(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Speech synthesis failed.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="voice-main">
    <header className="voice-header"><h1>Voice Studio</h1><button disabled={!clipUrl && !text} onClick={() => { setText(""); setClipUrl(null); setError(null); }}><Plus />New session</button></header>
    <div className="voice-canvas">
      <div className="tts-intro">
        <div className="wave-tile"><AudioLines /></div>
        <h2>Type anything. Click generate.</h2>
        <p className={error ? "realtime-error" : ""}>{error ?? `${label} will start playing instantly.`}</p>
        {clipUrl && <audio className="tts-player" src={clipUrl} controls autoPlay />}
      </div>
      <div className="composer-wrap">
        <PresetRow labels={Object.keys(ttsPresets)} onPick={preset => setText(ttsPresets[preset])} />
        <Composer value={text} onChange={setText} placeholder="Type anything. Click generate to hear it instantly. Any language works.">
          <ComposerFooter
            enabled={!!text.trim()} busy={busy} onGenerate={() => void generate()}
            onEnhance={async () => setText(await enhanceScript(text))}
          />
        </Composer>
      </div>
    </div>
  </main>;
}

/* ----------------------------------------------------------- avatar studio --- */

function formatCountdown(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

type GpuWarmth = ReturnType<typeof useGpuWarmth>;

/**
 * The self-hosted renderer scales to zero and has to load a 14B model on a cold container,
 * so it is warmed explicitly. The hosted Higgs Avatar API manages its own capacity and
 * reports `managed`, which collapses this whole control down to nothing.
 */
function useGpuWarmth() {
  const [state, setState] = useState<"unknown" | "cold" | "warming" | "warm">("unknown");
  const [managed, setManaged] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState<"single" | "realtime">("single");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const applyState = (warm: boolean, secondsRemaining: number) => {
    setRemaining(warm ? secondsRemaining : 0);
    setState(warm ? "warm" : "cold");
  };

  const refresh = async () => {
    try {
      const response = await fetch("/api/avatar/warmup", { cache: "no-store" });
      const body = await response.json().catch(() => null) as
        { tier?: "single" | "realtime"; warm?: boolean; managed?: boolean; warmSecondsRemaining?: number } | null;
      if (!response.ok || !body) throw new Error(`GPU status unavailable (${response.status}).`);
      if (body.tier) setTier(body.tier);
      setManaged(!!body.managed);
      applyState(!!body.warm, body.warmSecondsRemaining ?? 0);
    } catch {
      // Never leave the control invisible: an unreadable status falls back to cold so the
      // warm-up button stays reachable. A warm-up already in flight keeps its own state.
      setState(current => current === "warming" ? current : "cold");
    }
  };

  useEffect(() => {
    void refresh();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modal's scaledown window counts *idle* time only: it starts when the container finishes
  // its last request. So the countdown freezes while a render is in flight, and the render
  // resets it on the way out.
  useEffect(() => {
    if (state !== "warm" || busy || managed) return;
    const timer = window.setInterval(() => setRemaining(value => {
      if (value <= 1) { setState("cold"); return 0; }
      return value - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [state, busy, managed]);

  useEffect(() => {
    if (state !== "warming") { setElapsed(0); return; }
    const timer = window.setInterval(() => setElapsed(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  const warmUp = async () => {
    if (state === "warming" || state === "warm") return;
    setError(null); setState("warming");
    try {
      const response = await fetch("/api/avatar/warmup", { method: "POST" });
      const body = await response.json() as { warmupId?: string | null; status?: string; warmSecondsRemaining?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Warm-up failed (${response.status}).`);
      if (body.status === "done" || !body.warmupId) { applyState(true, body.warmSecondsRemaining ?? 0); return; }

      const warmupId = body.warmupId;
      pollRef.current = window.setInterval(async () => {
        try {
          const poll = await fetch(`/api/avatar/warmup/${warmupId}`, { cache: "no-store" });
          const record = await poll.json() as { status?: string; error?: string; warmSecondsRemaining?: number };
          if (record.status !== "done" && record.status !== "error") return;
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          if (record.status === "error") { setError(record.error ?? "The GPU failed to warm up."); setState("cold"); }
          else applyState(true, record.warmSecondsRemaining ?? 0);
        } catch { /* a dropped poll is not fatal; the next tick retries */ }
      }, 5000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not warm up the GPU.");
      setState("cold");
    }
  };

  const release = async () => {
    setError(null);
    try {
      const response = await fetch("/api/avatar/release", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Could not release the GPU (${response.status}).`);
      }
      applyState(false, 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not release the GPU.");
    }
  };

  /** Wrap a render so the idle countdown pauses for its duration and re-syncs after. */
  const trackWork = async <T,>(work: () => Promise<T>) => {
    setBusy(true);
    try { return await work(); }
    finally { setBusy(false); if (!managed) void refresh(); }
  };

  return { state, managed, remaining, elapsed, busy, tier, error, warmUp, release, refresh, trackWork };
}

function GpuStatus({ gpu }: { gpu: GpuWarmth }) {
  if (gpu.state === "unknown") return null;
  // The hosted API manages its own capacity, so there is nothing to warm, release, or wait
  // for — a permanent "hosted" badge is a label with no action behind it. Progress during a
  // render is already on the stage itself.
  if (gpu.managed) return null;
  if (gpu.state === "warm") return <div className="gpu-status warm">
    <span title="Modal counts idle time only, so this pauses while a render is running and resets when it finishes">
      <i className={gpu.busy ? "pulse" : ""} />{gpu.busy ? "GPU busy · rendering" : `GPU warm · ${formatCountdown(gpu.remaining)} left`}
    </span>
    <button disabled={gpu.busy} onClick={() => void gpu.release()} title="Shut the GPU down now instead of paying out the idle window">Release</button>
  </div>;
  if (gpu.state === "warming") return <div className="gpu-status warming">
    <span title="Loading the 14B model and compiling it — a one-time cost per container, so the first render is fast">
      <i className="pulse" />Warming up GPU · {formatCountdown(gpu.elapsed)} / ~{gpu.tier === "realtime" ? "8" : "2"} min
    </span>
  </div>;
  return <div className="gpu-status cold">
    <button className="warm-button" onClick={() => void gpu.warmUp()} title="Loads the model on a GPU so the next generation starts immediately">
      <Flame aria-hidden="true" />Warm up GPU
    </button>
    {gpu.error && <em>{gpu.error}</em>}
  </div>;
}

/**
 * The aspect ratio, drawn. "640x480" is two numbers you have to divide before you know
 * which way up the video is; a wide box is not.
 */
function SizeGlyph({ size }: { size: AvatarSize }) {
  const [width, height] = size.split("x").map(Number);
  const longest = Math.max(width, height);
  const boxWidth = (width / longest) * 13;
  const boxHeight = (height / longest) * 13;
  // Pinned to a fixed left edge rather than centred: three shapes of different widths
  // centred in the same box give three different left edges, which reads as a ragged column.
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="size-glyph">
    <rect
      x="1.5" y={(16 - boxHeight) / 2} width={boxWidth} height={boxHeight}
      rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.5"
    />
  </svg>;
}

/**
 * Output size, collapsed to the value in force.
 *
 * Three permanently-visible pills to choose between is two pills of noise sat on top of
 * the picture the whole control is about.
 */
function SizeMenu({ size, setSize }: { size: AvatarSize; setSize: (size: AvatarSize) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [open]);

  return <div className="size-menu" onPointerDown={event => event.stopPropagation()}>
    <button className="size-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <SizeGlyph size={size} />{size}<ChevronDown aria-hidden="true" />
    </button>
    {open && <div className="size-options" role="listbox" aria-label="Output size">
      {AVATAR_SIZES.map(option => <button
        key={option} role="option" aria-selected={size === option} className={size === option ? "active" : ""}
        onClick={() => { setSize(option); setOpen(false); }}
      ><SizeGlyph size={option} />{option}{size === option && <Check aria-hidden="true" />}</button>)}
    </div>}
  </div>;
}

function AvatarStage({ face, agent, videoUrl, status, error, size, muted = false, loop = false, onEnded }: {
  face: FaceRecord; agent: AgentRecord | null; videoUrl: string | null; status: AvatarStatus;
  error?: string | null; size: AvatarSize; muted?: boolean; loop?: boolean; onEnded?: () => void;
}) {
  const busy = !videoUrl && (status === "synthesizing" || status === "queued" || status === "running");
  const [width, height] = size.split("x").map(Number);
  // Same halo as a live reply: the picture glows in the agent's colour while it renders,
  // rather than being covered by a dark sheet with a spinner on it.
  return <div
    className={`avatar-image ${busy ? "rendering" : ""}`}
    style={{
      aspectRatio: `${width} / ${height}`,
      ...(agent ? { "--agent-ink": agentLook(agent).swatch.ink } as React.CSSProperties : {}),
    }}
  >
    {videoUrl
      ? <video key={videoUrl} className="avatar-video" src={videoUrl} autoPlay playsInline loop={loop} muted={muted} controls={!muted && !loop} onEnded={onEnded} />
      : <Image src={faceSrc(face)} alt={`${face.label} avatar`} fill sizes="464px" priority unoptimized={face.kind === "uploaded"} />}
    {status === "error" && error && <div className="avatar-overlay error"><b>{error}</b></div>}
  </div>;
}

/** Scripted speech: the face says what you type, in its agent's voice. */
function AvatarSpeech({ face, agent, voices, size, gpu }: {
  face: FaceRecord; agent: AgentRecord | null; voices: VoiceRecord[]; size: AvatarSize; gpu: GpuWarmth;
}) {
  const { addSession, newId } = useStudio();
  const [text, setText] = useState(avatarPresets["Welcome message"]);
  const [render, setRender] = useState<AvatarRender>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const voice = agent?.config.voice ?? "default";

  const generate = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRender({ status: "synthesizing" });
    try {
      await gpu.trackWork(async () => {
        let jobId = "";
        const videoUrl = await renderAvatarClip(
          { text, ...facePayload(face), voice, size, prompt: AVATAR_SCENE_PROMPT },
          (status, id) => { jobId = id; setRender({ status, jobId: id }); },
          controller.signal,
        );
        setRender({ status: "done", jobId, videoUrl });
        addSession({
          id: newId("avatar"), studio: "avatar", title: text.slice(0, 60),
          detail: `${face.label} · ${voiceLabel(voices, voice)} · ${size}`,
          faceId: face.id, agentId: agent?.id, createdAt: new Date().toISOString(),
        });
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setRender({ status: "error", error: avatarErrorMessage(error) });
    }
  };

  const busy = render.status === "synthesizing" || render.status === "queued" || render.status === "running";
  const ready = (gpu.managed || gpu.state === "warm") && !!agent;
  return <>
    <AvatarStage face={face} agent={agent} videoUrl={render.videoUrl ?? null} status={render.status} error={render.error} size={size} />
    <div className="avatar-composer">
      <PresetRow labels={Object.keys(avatarPresets)} onPick={preset => setText(avatarPresets[preset])} />
      <Composer value={text} onChange={setText}>
        <ComposerFooter
          enabled={ready && !!text.trim()}
          busy={busy}
          onGenerate={() => void generate()}
          onEnhance={async () => setText(await enhanceScript(text))}
          note={!agent ? "Pick an agent first"
            : busy ? AVATAR_STATUS_COPY[render.status] || "Rendering…"
            : ready ? undefined
            : (gpu.state === "warming" ? "Warming up GPU…" : "Warm up GPU first")}
        />
      </Composer>
    </div>
  </>;
}

function AvatarMain({ face, agent, voices, size, setSize, realtime, onSessionChange, onEntries }: {
  face: FaceRecord; agent: AgentRecord | null; voices: VoiceRecord[];
  size: AvatarSize; setSize: (size: AvatarSize) => void;
  /** On, you talk to the avatar. Off, you write a script for it to read. */
  realtime: boolean;
  onSessionChange: (active: boolean) => void;
  onEntries: (entries: TranscriptEntry[]) => void;
}) {
  const { tools } = useStudio();
  const gpu = useGpuWarmth();
  return <main className="avatar-main"><div className="dot-grid" /><div className="avatar-content">
    <div className="avatar-topbar">
      <SizeMenu size={size} setSize={setSize} />
      <GpuStatus gpu={gpu} />
    </div>
    {realtime
      ? <AvatarChat
          face={face} size={size} agent={agent} tools={tools}
          ready={gpu.managed || gpu.state === "warm"}
          onSessionChange={onSessionChange} onEntries={onEntries}
        />
      : <AvatarSpeech face={face} agent={agent} voices={voices} size={size} gpu={gpu} />}
  </div></main>;
}

/**
 * The avatar's settings: a face, and the agent that drives it.
 *
 * There is deliberately no voice picker here. The voice belongs to the agent — the same
 * one whether it is reading a script or holding a conversation — so this shows which voice
 * you are getting and sends you to Agent Studio to change it. Face → agent → voice.
 */
function AvatarPanel({ faces, faceId, setFaceId, agents, agentId, setAgentId, voices, onUpload, onDeleteFace, realtime, setRealtime }: {
  faces: FaceRecord[]; faceId: string; setFaceId: (id: string) => void;
  agents: AgentRecord[]; agentId: string; setAgentId: (id: string) => void;
  voices: VoiceRecord[]; onUpload: () => void; onDeleteFace: (id: string) => void;
  realtime: boolean; setRealtime: (on: boolean) => void;
}) {
  const router = useRouter();
  const [history, setHistory] = useState(false);

  return <aside className="settings-panel avatar-panel">
    <PanelTabs main="Avatar" history={history} setHistory={setHistory} />
    {history ? <HistoryPanel studio="avatar" faces={faces} /> : <div className="panel-scroll">
      {/* One switch instead of two tabs floating over the picture: it is a property of the
          session, and the composer below the stage follows it. */}
      <div className="panel-section-head">
        <h2>Realtime</h2>
        <Toggle label="Realtime" on={realtime} onChange={setRealtime} />
      </div>
      <p className="help">{realtime
        ? "Talk to the avatar and it answers live."
        : "Write a script and the avatar reads it."}</p>

      <FaceSection faces={faces} selected={faceId} onSelect={setFaceId} onUpload={onUpload} onDelete={onDeleteFace} />

      <div className="panel-section-head">
        <h2 className="panel-section">Agent</h2>
        <button className="link-button" onClick={() => router.push("/workspace/agent-studio?create=1")}>
          <Plus aria-hidden="true" />New agent
        </button>
      </div>
      <p className="help">Holds the conversation. Its voice is the avatar&apos;s voice.</p>
      {/* The voice sits on the row that owns it, so choosing an agent and seeing what it
          will sound like are the same glance. The pencil opens that agent in Agent Studio,
          which is where the voice is actually changed. */}
      <div className="agent-picks">
        {agents.map(record => <div
          key={record.id}
          className={`agent-pick ${agentId === record.id ? "on" : ""}`}
          role="radio" aria-checked={agentId === record.id} tabIndex={0}
          onClick={() => setAgentId(record.id)}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setAgentId(record.id); } }}
        >
          <span className="agent-pick-copy"><b>{record.name}</b><small>{record.summary}</small></span>
          <em className="agent-pick-voice" title={`Speaks as ${voiceLabel(voices, record.config.voice)}`}>
            {voiceLabel(voices, record.config.voice)}
          </em>
          <button
            className="agent-pick-edit" aria-label={`Edit ${record.name}`}
            title="Edit this agent's voice, prompt, and tools"
            onClick={event => { event.stopPropagation(); router.push(`/workspace/agent-studio/${record.id}`); }}
          ><Pencil aria-hidden="true" /></button>
        </div>)}
      </div>
    </div>}
  </aside>;
}

/**
 * The conversation, in the panel the settings usually occupy.
 *
 * Mid-call the face is the thing worth looking at and the settings are not changeable
 * anyway, so the column gives itself over to what is being said — turns and tool calls in
 * the order they happened, same as Agent Studio.
 */
function LiveTranscriptPanel({ agent, entries }: { agent: AgentRecord | null; entries: TranscriptEntry[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [entries]);

  const tint = agent ? agentLook(agent).swatch.ink : "var(--blue)";

  return <aside className="settings-panel live-chat">
    <div className="panel-scroll live-panel" ref={scrollRef}>
      <BubbleTranscript
        entries={entries}
        tint={tint}
        empty={`Say something and ${agent?.name ?? "the agent"} will answer.`}
      />
    </div>
  </aside>;
}

/* ------------------------------------------------------------------ shell --- */

export default function StudioApp({ initialStudio }: { initialStudio: "voice" | "avatar" }) {
  const studio = useStudio();
  const { voices, refresh: refreshVoices } = useVoiceLibrary(studio.voices);
  const faces = useMemo(() => faceLibrary(studio.faces), [studio.faces]);

  const [ttsVoice, setTtsVoice] = useState("chloe");
  const [faceId, setFaceId] = useState("Maya");
  const [avatarSize, setAvatarSize] = useState<AvatarSize>("480x640");
  const [avatarAgentId, setAvatarAgentId] = useState("");
  const [realtime, setRealtime] = useState(true);
  const [avatarInSession, setAvatarInSession] = useState(false);
  const [avatarEntries, setAvatarEntries] = useState<TranscriptEntry[]>([]);
  const onAvatarSession = useCallback((active: boolean) => setAvatarInSession(active), []);
  const onAvatarEntries = useCallback((entries: TranscriptEntry[]) => setAvatarEntries(entries), []);
  const [cloning, setCloning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [panelHistory, setPanelHistory] = useState(false);

  const avatarAgent = studio.agents.find(record => record.id === avatarAgentId) ?? studio.agents[0] ?? null;
  const face = findFace(faces, faceId) ?? faces[0];

  const onCloned = (voice: VoiceRecord) => {
    studio.saveVoice(voice);
    void refreshVoices(true);
    setCloning(false);
    setTtsVoice(voice.id);
  };

  const deleteFace = (id: string) => {
    studio.deleteFace(id);
    if (faceId === id) setFaceId("Maya");
  };

  const deleteVoice = (id: string) => {
    studio.deleteVoice(id);
    if (ttsVoice === id) setTtsVoice("chloe");
  };

  const onUploaded = (uploaded: FaceRecord) => {
    studio.saveFace(uploaded);
    setUploading(false);
    // A face you just added is almost always the one you wanted to use next.
    setFaceId(uploaded.id);
  };

  if (initialStudio === "voice") {
    return <Shell studio="voice">
      <VoiceMain voice={ttsVoice} voices={voices} />
      <aside className="settings-panel">
        <PanelTabs main="Settings" history={panelHistory} setHistory={setPanelHistory} />
        {panelHistory ? <HistoryPanel studio="voice" faces={faces} /> : <div className="panel-scroll">
          <VoiceSection voices={voices} selected={ttsVoice} onSelect={setTtsVoice} onClone={() => setCloning(true)} onDelete={deleteVoice} />
          <h2 className="panel-section">Model</h2>
          <div className="model-field">Higgs TTS 3</div>
          <p className="help config-summary">
            Cloned voices work everywhere a preset does — in TTS, in a realtime agent, and in an avatar.
          </p>
        </div>}
      </aside>
      {cloning && <CloneVoiceModal onClose={() => setCloning(false)} onCreated={onCloned} />}
    </Shell>;
  }

  return <Shell studio="avatar">
    <AvatarMain
      face={face} agent={avatarAgent} voices={voices} size={avatarSize} setSize={setAvatarSize}
      realtime={realtime} onSessionChange={onAvatarSession} onEntries={onAvatarEntries}
    />
    {avatarInSession ? <LiveTranscriptPanel agent={avatarAgent} entries={avatarEntries} /> : <AvatarPanel
      faces={faces} faceId={face?.id ?? "Maya"} setFaceId={setFaceId}
      agents={studio.agents} agentId={avatarAgent?.id ?? ""} setAgentId={setAvatarAgentId}
      voices={voices} onUpload={() => setUploading(true)} onDeleteFace={deleteFace}
      realtime={realtime} setRealtime={setRealtime}
    />}
    {uploading && <UploadFaceModal onClose={() => setUploading(false)} onCreated={onUploaded} newId={studio.newId} />}
  </Shell>;
}

