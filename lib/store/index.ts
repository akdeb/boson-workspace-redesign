"use client";

import { seedData } from "@/lib/store/seed";
import type { AgentRecord, FaceRecord, SessionRecord, StudioData, ToolRecord, VoiceRecord } from "@/lib/store/types";

export { BUILTIN_AGENTS, PRESET_FACES, PRESET_FACE_NAMES, PRESET_VOICES, seedData } from "@/lib/store/seed";

/**
 * ── Persistence ──────────────────────────────────────────────────────────────────────
 *
 * Every read and write the studio performs goes through the `StudioStore` interface below.
 * The implementation is a write-through cache over `/api/studio/*`, which is backed by SQL
 * (`lib/db/`). Nothing in the UI touches storage directly.
 *
 * `read()` has to be synchronous — `useSyncExternalStore` needs a snapshot on every render
 * — so the store keeps the last known state in memory and reconciles it against the server
 * in the background. A write updates the cache first and notifies immediately, then goes
 * to the API; a failed write re-reads rather than leaving the screen showing a lie.
 *
 * Cloned voices are the one split brain: Boson's own `GET /v1/audio/voices` is the source
 * of truth for what a key may use, and what we keep here is the label and reference
 * transcript, which it does not return. See `useVoiceLibrary`.
 */

export interface StudioStore {
  read(): StudioData;
  saveAgent(record: AgentRecord): void;
  deleteAgent(id: string): void;
  saveTool(record: ToolRecord): void;
  deleteTool(id: string): void;
  saveVoice(record: VoiceRecord): void;
  deleteVoice(id: string): void;
  saveFace(record: FaceRecord): void;
  deleteFace(id: string): void;
  addSession(record: SessionRecord): void;
  deleteSession(id: string): void;
  subscribe(listener: () => void): () => void;
}

class ApiStudioStore implements StudioStore {
  /** The seed stands in until the first read lands, so SSR and first paint have content. */
  private data: StudioData = seedData();
  private listeners = new Set<() => void>();
  private refreshing: Promise<void> | null = null;

  constructor() {
    if (typeof window !== "undefined") void this.refresh();
  }

  read() { return this.data; }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  /** Pull the authoritative state. Concurrent callers share one request. */
  private refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const response = await fetch("/api/studio", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as StudioData;
        this.data = {
          agents: body.agents ?? [], tools: body.tools ?? [], voices: body.voices ?? [],
          faces: body.faces ?? [], sessions: body.sessions ?? [],
        };
        this.emit();
      } catch {
        // Offline or mid-restart: keep showing what we have rather than emptying the app.
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Apply locally and notify at once, then persist. A rejected write re-reads. */
  private write(apply: (data: StudioData) => StudioData, request: () => Promise<Response>) {
    this.data = apply(this.data);
    this.emit();
    void (async () => {
      try {
        const response = await request();
        if (!response.ok) await this.refresh();
      } catch {
        await this.refresh();
      }
    })();
  }

  private put(path: string, record: unknown) {
    return fetch(path, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record),
    });
  }

  private upsert<K extends "agents" | "tools" | "voices" | "faces">(key: K, record: { id: string }) {
    return (data: StudioData): StudioData => {
      const list = data[key] as Array<{ id: string }>;
      const index = list.findIndex(existing => existing.id === record.id);
      const next = [...list];
      if (index >= 0) next[index] = record; else next.push(record);
      // Agents are listed newest first. Sorting here as well as in SQL means a new one
      // appears at the top on the optimistic write, not only after the next read.
      if (key === "agents") {
        (next as AgentRecord[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
      return { ...data, [key]: next };
    };
  }

  private remove<K extends "agents" | "tools" | "voices" | "faces" | "sessions">(key: K, id: string) {
    return (data: StudioData): StudioData => ({
      ...data, [key]: (data[key] as Array<{ id: string }>).filter(record => record.id !== id),
    });
  }

  saveAgent(record: AgentRecord) {
    this.write(this.upsert("agents", record), () => this.put(`/api/studio/agents/${encodeURIComponent(record.id)}`, record));
  }
  deleteAgent(id: string) {
    this.write(this.remove("agents", id), () => fetch(`/api/studio/agents/${encodeURIComponent(id)}`, { method: "DELETE" }));
  }

  saveTool(record: ToolRecord) {
    this.write(this.upsert("tools", record), () => this.put(`/api/studio/tools/${encodeURIComponent(record.id)}`, record));
  }
  deleteTool(id: string) {
    this.write(this.remove("tools", id), () => fetch(`/api/studio/tools/${encodeURIComponent(id)}`, { method: "DELETE" }));
  }

  saveVoice(record: VoiceRecord) {
    this.write(this.upsert("voices", record), () => this.put(`/api/studio/voices/${encodeURIComponent(record.id)}`, record));
  }
  /**
   * Boson owns cloned voices and keeps listing them, so removing our row is not enough —
   * the voice would reappear on the next read. The row is replaced with a tombstone the
   * voice library filters on, and the upstream delete is attempted alongside it.
   */
  deleteVoice(id: string) {
    const tombstone: VoiceRecord = { id, label: "", kind: "deleted", tag: "", description: "" };
    this.write(this.upsert("voices", tombstone), async () => {
      void fetch(`/api/voices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      return this.put(`/api/studio/voices/${encodeURIComponent(id)}`, tombstone);
    });
  }

  saveFace(record: FaceRecord) {
    this.write(this.upsert("faces", record), () => this.put(`/api/studio/faces/${encodeURIComponent(record.id)}`, record));
  }
  deleteFace(id: string) {
    this.write(this.remove("faces", id), () => fetch(`/api/studio/faces/${encodeURIComponent(id)}`, { method: "DELETE" }));
  }

  addSession(record: SessionRecord) {
    this.write(
      data => ({ ...data, sessions: [record, ...data.sessions.filter(existing => existing.id !== record.id)] }),
      () => fetch("/api/studio/sessions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record),
      }),
    );
  }
  deleteSession(id: string) {
    this.write(this.remove("sessions", id), () => fetch(`/api/studio/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }));
  }
}

let instance: StudioStore | null = null;

/** One store per page, shared by every `useStudio()` mount. */
export function createStore(): StudioStore {
  if (!instance) instance = new ApiStudioStore();
  return instance;
}

export function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
