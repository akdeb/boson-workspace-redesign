"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createStore, newId, PRESET_FACES, PRESET_VOICES } from "@/lib/store";
import type { AgentRecord, FaceRecord, SessionRecord, StudioData, ToolRecord, VoiceRecord } from "@/lib/store/types";

/** React binding for the studio store. Every mutation re-renders every subscriber. */
export function useStudio() {
  const store = useMemo(() => createStore(), []);
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const data = useSyncExternalStore<StudioData>(
    subscribe,
    () => store.read(),
    () => store.read(),
  );

  return {
    ...data,
    saveAgent: useCallback((record: AgentRecord) => store.saveAgent(record), [store]),
    deleteAgent: useCallback((id: string) => store.deleteAgent(id), [store]),
    saveTool: useCallback((record: ToolRecord) => store.saveTool(record), [store]),
    deleteTool: useCallback((id: string) => store.deleteTool(id), [store]),
    saveVoice: useCallback((record: VoiceRecord) => store.saveVoice(record), [store]),
    deleteVoice: useCallback((id: string) => store.deleteVoice(id), [store]),
    saveFace: useCallback((record: FaceRecord) => store.saveFace(record), [store]),
    deleteFace: useCallback((id: string) => store.deleteFace(id), [store]),
    addSession: useCallback((record: SessionRecord) => store.addSession(record), [store]),
    deleteSession: useCallback((id: string) => store.deleteSession(id), [store]),
    newId,
  };
}

/**
 * Cloned voices, shared across every mount.
 *
 * The realtime gateway validates a session's voice against the same voices endpoint we read
 * here, so refetching on every studio navigation can rate-limit an agent out of starting a
 * call. One list is fetched, remembered, and reused; `refresh(true)` forces a new read after
 * a clone.
 */
const voiceCache: { voices: VoiceRecord[] | null; inFlight: Promise<VoiceRecord[]> | null } = {
  voices: null,
  inFlight: null,
};

async function fetchVoices(force: boolean) {
  if (!force && voiceCache.voices) return voiceCache.voices;
  if (!force && voiceCache.inFlight) return voiceCache.inFlight;
  voiceCache.inFlight = (async () => {
    try {
      const response = await fetch("/api/voices", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { voices?: VoiceRecord[] } | null;
      // A failed read keeps whatever we already had rather than emptying the picker.
      const voices = body?.voices ?? voiceCache.voices ?? [];
      voiceCache.voices = voices;
      return voices;
    } finally {
      voiceCache.inFlight = null;
    }
  })();
  return voiceCache.inFlight;
}

export function useVoiceLibrary(localVoices: VoiceRecord[]) {
  const [remote, setRemote] = useState<VoiceRecord[]>(() => voiceCache.voices ?? []);
  const [loading, setLoading] = useState(voiceCache.voices === null);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setRemote(await fetchVoices(force));
    } catch {
      setRemote(voiceCache.voices ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const voices = useMemo(() => {
    const labels = new Map(localVoices.map(voice => [voice.id, voice]));
    // A voice you deleted stays in Boson's list; the tombstone is what keeps it out of here.
    const buried = new Set(localVoices.filter(voice => voice.kind === "deleted").map(voice => voice.id));
    const cloned = remote
      .filter(voice => !buried.has(voice.id))
      .map(voice => ({ ...voice, ...labels.get(voice.id), kind: "cloned" as const, tag: "Cloned" }));
    // A voice created this session shows immediately, before the list refetches.
    for (const voice of localVoices) {
      if (voice.kind === "deleted") continue;
      if (!cloned.some(existing => existing.id === voice.id)) cloned.push({ ...voice, kind: "cloned", tag: "Cloned" });
    }
    return [...PRESET_VOICES, ...cloned];
  }, [localVoices, remote]);

  return { voices, cloned: voices.filter(voice => voice.kind === "cloned"), loading, refresh };
}

export function findVoice(voices: VoiceRecord[], id: string) {
  return voices.find(voice => voice.id === id);
}

export function voiceLabel(voices: VoiceRecord[], id: string) {
  return findVoice(voices, id)?.label ?? id;
}

/**
 * Every face the studio can animate: the ones you uploaded first, then the bundled presets.
 *
 * `faces` in the store holds uploads only, the same split the voice library uses — a preset
 * is a constant of the build, not a record anyone can edit.
 */
export function faceLibrary(uploaded: FaceRecord[]): FaceRecord[] {
  const mine = [...uploaded].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return [...mine, ...PRESET_FACES];
}

export function findFace(faces: FaceRecord[], id: string) {
  return faces.find(face => face.id === id);
}

export function faceLabel(faces: FaceRecord[], id: string) {
  return findFace(faces, id)?.label ?? id;
}

/** What an `<img>` shows for a face: the bundled PNG, or the upload's own data URI. */
export function faceSrc(face: FaceRecord | undefined) {
  if (!face) return "/assets/Maya.png";
  return face.kind === "preset" ? `/assets/${face.id}.png` : face.dataUri!;
}

export function faceSrcById(faces: FaceRecord[], id: string) {
  return faceSrc(findFace(faces, id));
}

/**
 * What the render routes need to draw this face: a preset travels as a name the server
 * resolves, an upload as the pixels themselves. Spread straight into a render payload.
 */
export function facePayload(face: FaceRecord | undefined) {
  if (face?.kind === "uploaded") return { faceImage: face.dataUri, face: face.label };
  return { face: face?.id ?? "Maya" };
}
