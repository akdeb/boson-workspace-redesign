import { withDefaults } from "@/lib/agent-config";
import { BUILTIN_TOOLS, type ToolDefinition } from "@/lib/tools";
import { BUILTIN_AGENTS } from "@/lib/store/seed";
import type { AgentRecord, FaceRecord, SessionRecord, StudioData, VoiceRecord } from "@/lib/store/types";
import { getDb } from "@/lib/db/driver";

/**
 * Every query the studio runs, in one place.
 *
 * Plain parameterised SQL with `?` placeholders — nothing here is SQLite-specific, so this
 * file is unchanged when the driver is pointed at Supabase. See lib/db/driver.ts.
 */

const SESSION_LIMIT = 200;

/* -------------------------------------------------------------- row mapping --- */

const json = <T,>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

type AgentRow = { id: string; name: string; summary: string; config: string; color: string | null; icon: string | null; builtin: number; created_at: string; updated_at: string };
type ToolRow = { id: string; name: string; description: string; parameters: string; binding: string; builtin: number; created_at: string; updated_at: string };
type VoiceRow = { id: string; label: string; kind: string; tag: string; description: string; ref_text: string; created_at: string };
type FaceRow = { id: string; label: string; kind: string; data_uri: string; created_at: string };
type SessionRow = { id: string; studio: string; title: string; detail: string; face_id: string | null; agent_id: string | null; transcript: string; created_at: string };

function toAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id, name: row.name, summary: row.summary,
    config: withDefaults(json(row.config, undefined)),
    ...(row.color ? { color: row.color } : {}),
    ...(row.icon ? { icon: row.icon } : {}),
    ...(row.builtin ? { builtin: true } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function toTool(row: ToolRow): ToolDefinition {
  return {
    id: row.id, name: row.name, description: row.description,
    parameters: json(row.parameters, []),
    ...json<Partial<ToolDefinition>>(row.binding, {} as Partial<ToolDefinition>),
    ...(row.builtin ? { builtin: true } : {}),
  } as ToolDefinition;
}

function toVoice(row: VoiceRow): VoiceRecord {
  return {
    id: row.id, label: row.label, kind: row.kind as VoiceRecord["kind"], tag: row.tag,
    description: row.description, refText: row.ref_text || undefined, createdAt: row.created_at,
  };
}

function toFace(row: FaceRow): FaceRecord {
  return {
    id: row.id, label: row.label, kind: row.kind as FaceRecord["kind"],
    dataUri: row.data_uri || undefined, createdAt: row.created_at,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id, studio: row.studio as SessionRecord["studio"], title: row.title, detail: row.detail,
    faceId: row.face_id ?? undefined, agentId: row.agent_id ?? undefined,
    transcript: json(row.transcript, []), createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ seeding --- */

/**
 * Put the shipped agents and tools in the database — each one exactly once, ever.
 *
 * A single "seeded" flag was wrong: it meant a builtin added in a later release never
 * reached a database that already existed, which is how `end_call` failed to appear. What
 * is remembered instead is *which ids* have been seeded, so a new builtin is inserted on
 * the next read while one you deleted stays deleted.
 */
function seedOnce() {
  const db = getDb();
  const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", ["seeded_ids"]);
  const seen = new Set<string>(row ? JSON.parse(row.value) as string[] : []);

  // Databases from before this key existed have their builtins already; treat the old
  // flag as "everything shipped at the time was seeded".
  if (!row && db.get("SELECT value FROM meta WHERE key = ?", ["seeded"])) {
    for (const record of db.all<{ id: string }>("SELECT id FROM agents UNION SELECT id FROM tools")) {
      seen.add(record.id);
    }
  }

  const fresh: string[] = [];
  const now = Date.now();
  BUILTIN_AGENTS.forEach((agent, index) => {
    if (seen.has(agent.id)) return;
    // Staggered by a millisecond each so the shipped order survives a plain recency sort
    // instead of being left to whatever the database returns for identical timestamps.
    const stamp = new Date(now - index).toISOString();
    upsertAgent({ ...agent, createdAt: stamp, updatedAt: stamp });
    fresh.push(agent.id);
  });
  for (const tool of BUILTIN_TOOLS) {
    if (seen.has(tool.id)) continue;
    upsertTool(tool);
    fresh.push(tool.id);
  }

  if (!fresh.length && row) return;
  for (const id of fresh) seen.add(id);
  const value = JSON.stringify([...seen]);
  db.run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    ["seeded_ids", value],
  );
}

/* -------------------------------------------------------------------- reads --- */

export function readStudio(): StudioData {
  seedOnce();
  const db = getDb();
  return {
    // Most recently touched first, builtins included — an agent you just made is the one
    // you are looking for, and pinning the shipped ones on top buries it at the bottom.
    agents: db.all<AgentRow>("SELECT * FROM agents ORDER BY updated_at DESC").map(toAgent),
    tools: db.all<ToolRow>("SELECT * FROM tools ORDER BY builtin DESC, name ASC").map(toTool),
    voices: db.all<VoiceRow>("SELECT * FROM voices ORDER BY created_at DESC").map(toVoice),
    faces: db.all<FaceRow>("SELECT * FROM faces ORDER BY created_at DESC").map(toFace),
    sessions: db.all<SessionRow>("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?", [SESSION_LIMIT]).map(toSession),
  };
}

/* ------------------------------------------------------------------- writes --- */

/**
 * `INSERT … ON CONFLICT DO UPDATE` is the one statement whose spelling differs between
 * SQLite and Postgres only in whitespace — both accept exactly this form.
 */
export function upsertAgent(record: AgentRecord) {
  getDb().run(
    `INSERT INTO agents (id, name, summary, config, color, icon, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, summary = excluded.summary, config = excluded.config,
       color = excluded.color, icon = excluded.icon, updated_at = excluded.updated_at`,
    [record.id, record.name, record.summary, JSON.stringify(record.config),
     record.color ?? null, record.icon ?? null,
     !!record.builtin, record.createdAt, record.updatedAt],
  );
}

export function deleteAgent(id: string) {
  getDb().run("DELETE FROM agents WHERE id = ?", [id]);
}

export function upsertTool(record: ToolDefinition) {
  const { id, name, description, parameters, builtin, ...binding } = record;
  const now = new Date().toISOString();
  getDb().run(
    `INSERT INTO tools (id, name, description, parameters, binding, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, description = excluded.description,
       parameters = excluded.parameters, binding = excluded.binding, updated_at = excluded.updated_at`,
    [id, name, description, JSON.stringify(parameters), JSON.stringify(binding), !!builtin, now, now],
  );
}

export function deleteTool(id: string) {
  getDb().run("DELETE FROM tools WHERE id = ?", [id]);
}

export function upsertVoice(record: VoiceRecord) {
  getDb().run(
    `INSERT INTO voices (id, label, kind, tag, description, ref_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       label = excluded.label, tag = excluded.tag,
       description = excluded.description, ref_text = excluded.ref_text`,
    [record.id, record.label, record.kind, record.tag, record.description,
     record.refText ?? "", record.createdAt ?? new Date().toISOString()],
  );
}

export function deleteVoice(id: string) {
  getDb().run("DELETE FROM voices WHERE id = ?", [id]);
}

export function upsertFace(record: FaceRecord) {
  getDb().run(
    `INSERT INTO faces (id, label, kind, data_uri, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET label = excluded.label, data_uri = excluded.data_uri`,
    [record.id, record.label, record.kind, record.dataUri ?? "", record.createdAt ?? new Date().toISOString()],
  );
}

export function deleteFace(id: string) {
  getDb().run("DELETE FROM faces WHERE id = ?", [id]);
}

export function insertSession(record: SessionRecord) {
  const db = getDb();
  db.run(
    `INSERT INTO sessions (id, studio, title, detail, face_id, agent_id, transcript, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, detail = excluded.detail, transcript = excluded.transcript`,
    [record.id, record.studio, record.title, record.detail, record.faceId ?? null,
     record.agentId ?? null, JSON.stringify(record.transcript ?? []), record.createdAt],
  );
  // Keep the table from growing without bound; the History tab never reaches this far back.
  db.run(
    `DELETE FROM sessions WHERE id NOT IN
       (SELECT id FROM sessions ORDER BY created_at DESC LIMIT ?)`,
    [SESSION_LIMIT],
  );
}

export function deleteSession(id: string) {
  getDb().run("DELETE FROM sessions WHERE id = ?", [id]);
}
