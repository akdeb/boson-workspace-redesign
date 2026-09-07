"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Orb } from "orb-ui";
import { AudioLines, Mic, Settings2, X } from "lucide-react";
import { BosonRealtimeClient, type BosonActivity } from "@/lib/boson-realtime";
import { useStudio, voiceLabel } from "@/lib/store/use-studio";
import { agentLook, orbFilter } from "@/lib/agent-look";
import { orbState, orbVolume } from "@/lib/orb-volume";
import type { AgentRecord, VoiceRecord } from "@/lib/store/types";
import type { ToolDefinition } from "@/lib/tools";
import { CallControls } from "@/components/call-controls";
import { LiveSettingsSheet } from "@/components/live-settings";
import { ToolActivity, Transcript, useConversation } from "@/components/transcript";

/**
 * A live call with the agent you are editing.
 *
 * It takes the whole workspace rather than a rail down one side — you are talking to
 * something, and the orb reacting to your voice is the substance of that, not a detail.
 * Ending a call files the whole conversation — turns and tool calls in the order they
 * happened — under the agent's Conversations tab.
 */

const STATUS: Record<BosonActivity, string> = {
  idle: "Ready when you are.",
  connecting: "Connecting to Higgs Realtime…",
  listening: "Listening… speak naturally.",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Could not start the session.",
};

export function TryItLive({ agent, tools, voices, onClose, onSessionChange, onEnded, autoStart = false }: {
  agent: AgentRecord;
  tools: ToolDefinition[];
  voices: VoiceRecord[];
  onClose: () => void;
  onSessionChange: (active: boolean) => void;
  /**
   * Where hanging up leaves you. Defaults to closing the stage; the landing sends you to
   * the agent's page instead, since a finished call is usually a call you want to adjust.
   */
  onEnded?: () => void;
  /** Opened by a "Go live" that already meant it — connect without asking twice. */
  autoStart?: boolean;
}) {
  const { addSession, newId } = useStudio();
  const conversation = useConversation();
  const [activity, setActivity] = useState<BosonActivity>("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [talking, setTalking] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<BosonRealtimeClient | null>(null);

  // The client is built once; the callbacks read the live agent through a ref rather than
  // closing over the first render's props.
  const agentRef = useRef(agent); agentRef.current = agent;
  const endedRef = useRef<() => void>(() => {});
  endedRef.current = onEnded ?? onClose;

  if (!clientRef.current) {
    clientRef.current = new BosonRealtimeClient({
      onActivity: setActivity,
      onMicLevel: setMicLevel,
      onOutputLevel: setOutputLevel,
      onError: setError,
      onTranscript: conversation.addTurn,
      onToolCall: conversation.addToolCall,
    });
  }

  /**
   * Connecting and disconnecting run one at a time, in the order they were asked for.
   *
   * A call owns a microphone, an audio context and a socket, none of which tolerate being
   * opened twice at once. React's strict mode mounts every component twice in development,
   * so an auto-started call gets start → stop → start; without this queue the stop landed
   * *inside* the first start, closing the audio context it was still loading its worklet
   * into — which surfaced as "Unable to load a worklet's module" and a call that never
   * began. Serialising also fixes hanging up and immediately going live again.
   */
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback((operation: () => Promise<void>) => {
    const next = queueRef.current.then(operation, operation);
    queueRef.current = next.catch(() => {});
    return next;
  }, []);

  // The operations are redefined every render, so the effect reaches them through refs
  // rather than closing over the first render's copies.
  const startRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  /**
   * Hang up when the component really goes away — and only then.
   *
   * React's strict mode mounts every component twice in development: mount, unmount,
   * mount. Hanging up in the cleanup therefore ended the call that had just been placed,
   * which is what "user ended session" was. A real unmount is one we are still absent from
   * a tick later, so the teardown asks that question before acting on it.
   */
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    if (autoStart) startRef.current();
    return () => {
      mountedRef.current = false;
      window.setTimeout(() => { if (!mountedRef.current) stopRef.current(); }, 0);
    };
  }, [autoStart]);

  const inSession = activity !== "idle" && activity !== "error";
  useEffect(() => { onSessionChange(inSession); }, [inSession, onSessionChange]);

  useEffect(() => {
    if (!startedAtRef.current || !inSession) return;
    const update = () => setElapsed(Math.floor((Date.now() - startedAtRef.current!) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [inSession]);

  // Keep the newest turn in view; a transcript you have to chase is no use during a call.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [conversation.entries]);

  const sessionTools = useMemo(
    () => tools.filter(tool => agent.config.toolIds.includes(tool.id)),
    [tools, agent.config.toolIds],
  );
  const sessionToolsRef = useRef(sessionTools); sessionToolsRef.current = sessionTools;

  /** Hang up, and file the conversation if there was one. */
  const stopSession = () => enqueue(async () => {
    const client = clientRef.current!;
    if (!client.active) return;
    await client.stop();
    const entries = conversation.entriesRef.current;
    const turns = entries.filter(entry => entry.kind === "turn").length;
    const calls = entries.filter(entry => entry.kind === "tool").length;
    if (turns) {
      addSession({
        id: newId("call"), studio: "agent", title: agentRef.current.name,
        detail: `${turns} turns · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}${calls ? ` · ${calls} tool calls` : ""}`,
        agentId: agentRef.current.id,
        transcript: entries, createdAt: new Date().toISOString(),
      });
    }
    startedAtRef.current = null;
    setElapsed(0);
    setTranscriptOpen(false);
  });

  const startSession = () => enqueue(async () => {
    const client = clientRef.current!;
    if (client.active) return;
    conversation.reset();
    setMicMuted(false); setSpeakerMuted(false); setTalking(false); setError(null);
    setActivity("connecting");
    startedAtRef.current = Date.now();
    try {
      await client.start({ config: agentRef.current.config, tools: sessionToolsRef.current });
    } catch (caught) {
      // The client reports its own connection failures, but a microphone the browser
      // refuses lands here — and a call started for you must not sit there looking idle.
      setActivity("error");
      setError(caught instanceof Error ? caught.message : "Could not start the session.");
      startedAtRef.current = null;
    }
  });

  /**
   * Hanging up is a decision about where you want to be next, so it hands you on — unlike
   * the teardown on unmount, which must stay silent.
   */
  const toggleSession = () => (clientRef.current!.active
    ? stopSession().then(() => { endedRef.current(); })
    : startSession());

  startRef.current = () => { void startSession(); };
  stopRef.current = () => { void stopSession(); };

  const toggleMic = async () => {
    const next = !micMuted;
    setMicMuted(next);
    try { await clientRef.current?.setMicrophoneEnabled(!next); }
    catch (caught) { setMicMuted(false); setError(caught instanceof Error ? caught.message : "Unable to access the microphone."); }
  };
  const toggleSpeaker = () => {
    const next = !speakerMuted;
    setSpeakerMuted(next);
    clientRef.current?.setSpeakerMuted(next);
  };

  // Push-to-talk: holding captures, releasing commits the turn.
  const pushToTalk = agent.config.turnDetection.type === "manual";
  const holdStart = () => { setTalking(true); clientRef.current?.clearTurn(); };
  const holdEnd = () => { if (!talking) return; setTalking(false); clientRef.current?.commitTurn(); };

  const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const status = activity === "error" ? (error ?? STATUS.error) : micMuted ? "Microphone off" : STATUS[activity];

  return <div className={`live-stage ${settingsOpen ? "with-settings" : ""}`} role="dialog" aria-modal="true" aria-label={`${agent.name} live`}>
    <header className="live-stage-head">
      <div>
        <b>{agent.name}</b>
        <small>{voiceLabel(voices, agent.config.voice)}{sessionTools.length ? ` · ${sessionTools.length} tools` : ""}</small>
      </div>
      <div className="live-stage-actions">
        {/* Shows what the agent is set to without touching the call. Changing any of it
            means ending the session, which the sheet offers. */}
        <button
          aria-label="Agent settings" title="Agent settings"
          className={settingsOpen ? "on" : ""}
          onClick={() => setSettingsOpen(value => !value)}
        ><Settings2 /></button>
        <button aria-label="Close" onClick={onClose}><X /></button>
      </div>
    </header>

    {/* The call is the whole surface, not a column beside the settings: a conversation you
        are having deserves more room than a 400px rail, and the orb is the point of it. */}
    <div className="live-stage-body">
      {transcriptOpen && (inSession || conversation.entries.length)
        ? <div className="live-stage-transcript" ref={scrollRef}>
            <Transcript entries={conversation.entries} empty="Say something to get started." />
          </div>
        : <div className="live-stage-orb" style={{ "--orb-filter": orbFilter(agentLook(agent).tone) } as React.CSSProperties}>
            <Orb
              state={orbState(activity)}
              volume={orbVolume(activity, micLevel, outputLevel)}
              theme="cloud" size={280} interactive={false}
            />
            <h2>{agent.name}</h2>
            <p className={activity === "error" ? "realtime-error" : ""}>{status}</p>
            {inSession && <span className="session-time"><i />{activity === "connecting" ? "Connecting…" : time}</span>}
            <ToolActivity entries={conversation.entries} limit={2} />
          </div>}
    </div>

    {settingsOpen && <LiveSettingsSheet
      agent={agent} voices={voices} tools={tools} inSession={inSession}
      onClose={() => setSettingsOpen(false)}
      onEdit={() => {
        setSettingsOpen(false);
        void (clientRef.current!.active ? toggleSession() : Promise.resolve(endedRef.current()));
      }}
    />}

    <footer className="live-stage-foot">
      {inSession ? <>
        {pushToTalk && <button
          className={`push-to-talk ${talking ? "talking" : ""}`}
          onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd}
        ><Mic aria-hidden="true" />{talking ? "Release to send" : "Hold to talk"}</button>}
        <CallControls
          speakerMuted={speakerMuted} micMuted={micMuted} transcriptOpen={transcriptOpen}
          onSpeaker={toggleSpeaker} onMic={toggleMic}
          onTranscript={() => setTranscriptOpen(value => !value)} onEnd={() => void toggleSession()}
        />
      </> : <button className="start-chat" onClick={() => void toggleSession()}>
        <AudioLines />{conversation.entries.length ? "Go live again" : "Go live"}
      </button>}
    </footer>
  </div>;
}
