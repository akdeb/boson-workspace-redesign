"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload, X } from "lucide-react";
import {
  ACCEPTED_AUDIO, CLONE_MAX_SECONDS, CLONE_MIN_SECONDS, ClipRecorder,
  clipAdvice, clipProblem, playPreview, toClonableClip, type ClonableClip,
} from "@/lib/audio";
import type { VoiceRecord } from "@/lib/store/types";

/**
 * Voice cloning against `POST /v1/audio/voices`.
 * https://docs.boson.ai/models/higgs-tts/voices#custom-voices
 *
 * The API keys a voice off the audio content, so re-cloning the same clip returns the same
 * `voice_<sha>` rather than a duplicate — creating is safe to retry.
 *
 * Cloning needs a verbatim transcript of the reference clip, but that is not something to
 * ask a person for: `POST /api/voices` transcribes the clip with `higgs-stt-3.1` instead.
 */

export function CloneVoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (voice: VoiceRecord) => void }) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [clip, setClip] = useState<ClonableClip | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const clipRef = useRef<ClonableClip | null>(null);
  clipRef.current = clip;

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, busy]);

  useEffect(() => () => {
    recorderRef.current?.cancel();
    if (clipRef.current) URL.revokeObjectURL(clipRef.current.previewUrl);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const acceptClip = async (blob: Blob, filename: string) => {
    setError(null);
    try {
      const next = await toClonableClip(blob, filename);
      if (clip) URL.revokeObjectURL(clip.previewUrl);
      setClip(next);
    } catch {
      setError("That audio could not be decoded. Try a wav, mp3, m4a, or flac file.");
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      setRecording(false);
      const blob = await recorderRef.current!.stop();
      await acceptClip(blob, "recording.wav");
      return;
    }
    setError(null);
    setSeconds(0);
    recorderRef.current = new ClipRecorder();
    try {
      await recorderRef.current.start();
      setRecording(true);
    } catch {
      setError("Could not access the microphone.");
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No `refText`: the route transcribes the clip with higgs-stt-3.1 rather than
        // making you type out what you just said.
        body: JSON.stringify({ refAudio: clip!.dataUri, label: label.trim(), description: description.trim() }),
      });
      const body = await response.json().catch(() => null) as { voice?: VoiceRecord; error?: string } | null;
      if (!response.ok || !body?.voice) throw new Error(body?.error ?? `Cloning failed (${response.status}).`);
      onCreated(body.voice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clone the voice.");
    } finally {
      setBusy(false);
    }
  };

  const blocker = clipProblem(clip);
  const advice = clipAdvice(clip);
  const ready = !blocker && !!clip && !!label.trim() && !recording;

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="picker-modal clone-modal" role="dialog" aria-modal="true" aria-labelledby="clone-title">
      <div className="modal-head">
        <h2 id="clone-title">Clone a voice</h2>
        <button aria-label="Close" onClick={onClose} disabled={busy}><X /></button>
      </div>
      <p className="clone-lede">
        Give Higgs {CLONE_MIN_SECONDS}–{CLONE_MAX_SECONDS} seconds of clean speech. The voice becomes a
        reusable <code>voice_…</code> id you can hand to TTS, an agent, or an avatar.
      </p>

      <div className="clone-body single">
        <div className={`clone-recorder ${recording ? "recording" : ""}`}>
          <button className="record-button" onClick={() => void toggleRecording()} disabled={busy}>
            {recording ? <Square /> : <Mic />}
          </button>
          <b>{recording ? `Recording · ${seconds}s` : clip ? "Reference clip ready" : "Record a reference clip"}</b>
          <small>
            {recording
              ? `Keep talking, then stop. Aim for ${CLONE_MIN_SECONDS}–${CLONE_MAX_SECONDS}s.`
              : `Say anything at your natural pace, somewhere quiet — ${CLONE_MIN_SECONDS}–${CLONE_MAX_SECONDS}s is plenty.`}
          </small>
          <button className="link-button" onClick={() => fileRef.current?.click()} disabled={recording || busy}>
            <Upload aria-hidden="true" />Upload a file instead
          </button>
          <input
            ref={fileRef} type="file" accept={ACCEPTED_AUDIO} hidden
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void acceptClip(file, file.name);
            }}
          />
        </div>

        {clip && <div className="clone-clip">
          <div>
            <b>{clip.filename}</b>
            <small>{clip.seconds.toFixed(1)}s · {(clip.bytes / 1024).toFixed(0)} KB · 24 kHz mono WAV</small>
          </div>
          <button onClick={() => playPreview(clip.previewUrl)}>Play</button>
        </div>}

        <label className="field">
          <span>Name</span>
          <input value={label} onChange={event => setLabel(event.currentTarget.value)} placeholder="e.g. Sam — narration" maxLength={60} />
        </label>
        <label className="field">
          <span>Description <em>optional</em></span>
          <input value={description} onChange={event => setDescription(event.currentTarget.value)} placeholder="Warm, mid-paced, British" maxLength={120} />
        </label>

        {(blocker || advice) && <p className={`clone-hint ${blocker ? "blocking" : ""}`}>{blocker ?? advice}</p>}
        {error && <p className="clone-hint blocking">{error}</p>}
      </div>

      <div className="modal-actions">
        <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="primary" disabled={!ready || busy} onClick={() => void create()}>
          {busy ? "Cloning…" : "Create voice"}
        </button>
      </div>
    </section>
  </div>;
}
