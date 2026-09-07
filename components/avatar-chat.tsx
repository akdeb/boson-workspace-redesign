"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Orb } from "orb-ui";
import { AudioLines } from "lucide-react";
import { BosonRealtimeClient, type BosonActivity } from "@/lib/boson-realtime";
import { avatarErrorMessage, renderAvatarClip, AVATAR_SCENE_PROMPT } from "@/lib/avatar-jobs";
import { canStreamAvatar, streamAvatarClip } from "@/lib/avatar-stream";
import type { AvatarSize } from "@/lib/boson-avatar";
import { faceSrc, facePayload, useStudio } from "@/lib/store/use-studio";
import { agentLook, orbFilter } from "@/lib/agent-look";
import { orbState, orbVolume } from "@/lib/orb-volume";
import type { AgentRecord, FaceRecord, TranscriptEntry } from "@/lib/store/types";
import type { ToolDefinition } from "@/lib/tools";
import { CallControls } from "@/components/call-controls";
import { LoopingClip } from "@/components/looping-clip";
import { useConversation } from "@/components/transcript";

/**
 * The live avatar: an agent from Agent Studio drives a talking head.
 *
 * Each completed agent turn is sent to `POST /v1/videos/stream`, which returns fragmented
 * MP4 as it renders, so the face starts moving well before the clip is finished.
 *
 * The session's own audio output is muted and the caller hears the audio muxed into the
 * video, so the avatar is lip-synced from the very first word. That costs a delay which
 * grows with the length of the reply, and it is the right trade: the point of an avatar is
 * that it looks like a person talking, and a mouth running behind the words does not.
 */

/**
 * How long the stage takes to cross-fade between the idle loop and a spoken turn. Kept in
 * step with the `.avatar-video.live` transition in globals.css: the CSS does the blend, and
 * this is how long to wait before it is safe to tear the faded-out source down.
 */
const STAGE_FADE_MS = 420;

type LiveTurn = {
  controller: AbortController;
  /** Set once the first fragment has been appended, i.e. the avatar is visibly speaking. */
  playing: boolean;
};

export function AvatarChat({ face, size, agent, tools, ready, onSessionChange, onEntries }: {
  face: FaceRecord;
  size: AvatarSize;
  agent: AgentRecord | null;
  tools: ToolDefinition[];
  /** False while a self-hosted renderer is still cold. The hosted API is always ready. */
  ready: boolean;
  /** So the studio can give the panel over to the conversation while a call is running. */
  onSessionChange?: (active: boolean) => void;
  onEntries?: (entries: TranscriptEntry[]) => void;
}) {
  const [activity, setActivity] = useState<BosonActivity>("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [idleUrl, setIdleUrl] = useState<string | null>(null);
  const { addSession, newId } = useStudio();
  const conversation = useConversation();
  const startedAtRef = useRef<number | null>(null);

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<AbortController | null>(null);
  const turnRef = useRef<LiveTurn | null>(null);
  const teardownRef = useRef<number | null>(null);
  const clientRef = useRef<BosonRealtimeClient | null>(null);

  // The realtime client is built once, so its render callback reads the current face and
  // size through refs rather than closing over the first render's props.
  const faceRef = useRef(face);
  const sizeRef = useRef(size); sizeRef.current = size;
  const speakerRef = useRef(speakerMuted); speakerRef.current = speakerMuted;

  useEffect(() => {
    if (faceRef.current.id === face.id) return;
    faceRef.current = face;
    setIdleUrl(null);
  }, [face]);

  /**
   * The idle loop, rendered before it is needed.
   *
   * Eight seconds of silence through the same renderer, so asking for it when the call
   * starts means the opening minute is a photograph. It is requested as soon as the stage
   * is ready and kept in state, so picking a call back up costs nothing.
   *
   * Deliberately no "already requested" flag: strict mode aborts the first attempt and
   * remounts, and a flag that outlived the abort meant the clip was never rendered at all.
   */
  useEffect(() => {
    if (!ready || idleUrl) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const url = await renderAvatarClip(
          { silenceSeconds: 8, ...facePayload(faceRef.current), size: sizeRef.current, prompt: AVATAR_SCENE_PROMPT, numClip: 3 },
          () => {},
          controller.signal,
        );
        if (!controller.signal.aborted) setIdleUrl(url);
      } catch {
        // The still portrait remains the fallback until the face or the page changes.
      }
    })();
    return () => { controller.abort(); };
  }, [ready, idleUrl, face.id]);

  // `MediaSource` does not exist on the server, so support is settled after mount rather
  // than during render — deciding it inline made the status line differ between the
  // server's HTML and the first client render, which React rejects as a hydration mismatch.
  const [streamable, setStreamable] = useState(true);
  useEffect(() => { setStreamable(canStreamAvatar()); }, []);

  /**
   * Stop whatever turn is on screen and dissolve back to the idle loop.
   *
   * Pausing stops the audio at once, but the element keeps its last frame on screen, so the
   * cross-fade has something to fade *out* of. Tearing the source down has to wait for the
   * fade to finish, or the picture would snap to the idle clip instead of blending into it.
   */
  const endTurn = () => {
    turnRef.current?.controller.abort();
    turnRef.current = null;
    setSpeaking(false);
    setRendering(false);

    const video = liveVideoRef.current;
    if (!video) return;
    video.pause();
    if (teardownRef.current !== null) window.clearTimeout(teardownRef.current);
    teardownRef.current = window.setTimeout(() => {
      teardownRef.current = null;
      // A new turn may have claimed the element while the old one was fading out.
      if (turnRef.current) return;
      video.removeAttribute("src");
      video.load();
    }, STAGE_FADE_MS);
  };

  if (!clientRef.current) {
    clientRef.current = new BosonRealtimeClient({
      onActivity: setActivity,
      onMicLevel: setMicLevel,
      onOutputLevel: setOutputLevel,
      onError: setSessionError,
      onTranscript: conversation.addTurn,
      onToolCall: conversation.addToolCall,
      // Speaking over the agent abandons its turn, so the clip being rendered from that
      // turn's audio is stale the moment it is interrupted.
      onBargeIn: endTurn,
      onAgentUtterance: audioB64 => {
        const session = sessionRef.current;
        const video = liveVideoRef.current;
        if (!session || session.signal.aborted || !video) return;

        // Only the newest turn is rendered. Rendering runs behind the conversation, so a
        // turn superseded before it finishes would only ever arrive too late to be right.
        turnRef.current?.controller.abort();
        const controller = new AbortController();
        const turn: LiveTurn = { controller, playing: false };
        turnRef.current = turn;
        setRendering(true);

        void (async () => {
          try {
            const { done } = await streamAvatarClip({
              payload: { audioB64, ...facePayload(faceRef.current), size: sizeRef.current },
              video,
              signal: controller.signal,
              // Buffered, but the init segment carries no picture — keep the idle loop up.
              onFirstFragment: () => {},
              // A frame is actually on screen, so it is safe to cross-fade to it.
              onFirstFrame: () => {
                if (controller.signal.aborted) return;
                turn.playing = true;
                setRendering(false);
                setSpeaking(true);
              },
            });
            await done;
          } catch (error) {
            if (controller.signal.aborted) return;
            setRenderError(avatarErrorMessage(error));
            setRendering(false);
            // The caller hears nothing but the video, so a failed render is a silent turn.
            // Fall back to the session's own audio so the reply is at least heard.
            clientRef.current?.setSpeakerMuted(speakerRef.current);
          }
        })();
      },
    });
  }

  useEffect(() => {
    const client = clientRef.current!;
    return () => {
      sessionRef.current?.abort();
      turnRef.current?.controller.abort();
      if (teardownRef.current !== null) window.clearTimeout(teardownRef.current);
      void client.stop();
    };
  }, []);

  /** The caller hears the video and nothing else, so the session stays silent throughout. */
  useEffect(() => {
    const video = liveVideoRef.current;
    if (video) video.muted = speakerMuted;
    clientRef.current?.setSpeakerMuted(true);
  }, [speakerMuted]);

  const toggleSession = async () => {
    const client = clientRef.current!;
    if (client.active) {
      sessionRef.current?.abort();
      sessionRef.current = null;
      endTurn();
      await client.stop();
      // The conversation is the thing worth keeping — the video was never recorded, so the
      // face and the transcript are what make a past call recognisable in History.
      const entries = conversation.entriesRef.current;
      const turns = entries.filter(entry => entry.kind === "turn").length;
      const calls = entries.filter(entry => entry.kind === "tool").length;
      const seconds = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;
      if (turns && agent) {
        addSession({
          id: newId("avatar-call"), studio: "avatar", title: `Live call · ${agent.name}`,
          detail: `${face.label} · ${turns} turns · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${calls ? ` · ${calls} tool calls` : ""}`,
          faceId: face.id, agentId: agent.id, transcript: entries, createdAt: new Date().toISOString(),
        });
      }
      startedAtRef.current = null;
      return;
    }
    if (!agent) return;

    const controller = new AbortController();
    sessionRef.current = controller;
    setRenderError(null);
    setMicMuted(false);
    setSpeakerMuted(false);
    conversation.reset();
    startedAtRef.current = Date.now();

    // Set before starting, not after: the video carries the audio, so the session's own
    // output must already be silent by the time its first sample arrives — otherwise the
    // reply is heard twice, once live and once from the video.
    client.setSpeakerMuted(true);

    try {
      await client.start({
        config: agent.config,
        tools: tools.filter(tool => agent.config.toolIds.includes(tool.id)),
      });
    } catch { /* the client surfaces the actionable error */ }
  };

  const toggleMic = async () => {
    const next = !micMuted;
    setMicMuted(next);
    try { await clientRef.current?.setMicrophoneEnabled(!next); }
    catch (error) { setMicMuted(false); setSessionError(error instanceof Error ? error.message : "Unable to access the microphone."); }
  };

  const inSession = activity !== "idle" && activity !== "error";
  useEffect(() => { onSessionChange?.(inSession); }, [inSession, onSessionChange]);
  useEffect(() => { onEntries?.(conversation.entries); }, [conversation.entries, onEntries]);

  const running = conversation.entries.filter(entry => entry.kind === "tool" && entry.status === "running");

  // The dock is a status line, not documentation: one short state, one short qualifier.
  const status = !agent ? "Pick an agent"
    : !ready && !inSession ? "Warm up a renderer"
    : micMuted ? "Microphone off"
    : activity === "connecting" ? "Connecting…"
    : activity === "error" ? (sessionError ?? "Could not start the session.")
    : speaking ? "Speaking…"
    : rendering ? "Rendering…"
    : activity === "thinking" ? "Thinking…"
    : inSession ? "Listening…"
    : "Ready when you are";

  const detail = renderError
    ?? (running.length ? `Calling ${running.map(call => (call as { name: string }).name).join(", ")}…`
    : !streamable ? "This browser cannot play streamed video."
    : !agent ? "Chat mode needs an agent to drive the face."
    : inSession ? "Lip-synced to each reply."
    : agent.name);

  return <>
    <div
      className={`avatar-image ${rendering ? "rendering" : ""}`}
      style={{
        aspectRatio: size.replace("x", " / "),
        ...(agent ? { "--agent-ink": agentLook(agent).swatch.ink } as React.CSSProperties : {}),
      }}
    >
      {/* The streamed turn sits on top of the idle loop so switching between them
          does not flash the still image. Off the call, both layers go and the portrait is
          what remains — a face that keeps breathing at you after you hang up is unnerving.
          The rendered clip is kept in state, so picking the call back up costs nothing. */}
      <Image src={faceSrc(face)} alt={`${face.label} avatar`} fill sizes="464px" priority unoptimized={face.kind === "uploaded"} />
      {inSession && idleUrl && <LoopingClip className="avatar-video idle" src={idleUrl} />}
      <video
        ref={liveVideoRef}
        className={`avatar-video live ${speaking ? "on" : ""}`}
        playsInline
        onEnded={endTurn}
      />
    </div>

    <div className="avatar-live">
      <div className="avatar-live-status">
        <div className="avatar-live-orb" style={agent ? { "--orb-filter": orbFilter(agentLook(agent).tone) } as React.CSSProperties : undefined}>
          <Orb
            state={orbState(activity)}
            volume={orbVolume(activity, micLevel, outputLevel)}
            theme="cloud" size={86} interactive={false}
          />
        </div>
        <span>
          <b>{status}</b>
          <small className={renderError ? "avatar-live-error" : ""}>{detail}</small>
        </span>
      </div>

      <div className="avatar-live-actions">
        {inSession
          ? <CallControls
              speakerMuted={speakerMuted} micMuted={micMuted} transcriptOpen={false} showTranscript={false}
              onSpeaker={() => setSpeakerMuted(value => !value)} onMic={toggleMic} onTranscript={() => {}} onEnd={toggleSession}
            />
          : <button className="start-avatar-call" disabled={!ready || !agent} onClick={() => void toggleSession()}><AudioLines />Go live</button>}
      </div>
    </div>
  </>;
}
