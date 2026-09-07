-- Studio persistence, SQLite dialect (see schema.postgres.sql for the Supabase twin).
--
-- Deliberately boring: text ids, ISO-8601 text timestamps, JSON-encoded text for the
-- nested shapes (agent config, tool parameters, transcripts). Every column type here has
-- an exact Postgres equivalent, so moving to Supabase is running the twin schema and
-- swapping the driver in lib/db/driver.ts — no query in lib/db/repository.ts changes.

CREATE TABLE IF NOT EXISTS agents (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  summary     text NOT NULL DEFAULT '',
  config      text NOT NULL,              -- JSON: AgentConfig
  color       text,                      -- AgentTone name; see lib/agent-look.ts
  icon        text,                      -- AgentIcon name
  builtin     integer NOT NULL DEFAULT 0, -- boolean
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);

CREATE TABLE IF NOT EXISTS tools (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  parameters  text NOT NULL,              -- JSON: ToolParameter[]
  binding     text NOT NULL,              -- JSON: the rest of ToolDefinition
  builtin     integer NOT NULL DEFAULT 0,
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);

-- Cloned voices. Boson's own /v1/audio/voices is the source of truth for what a key may
-- use; what lives here is the label and reference transcript, which it does not return.
CREATE TABLE IF NOT EXISTS voices (
  id          text PRIMARY KEY,           -- voice_<sha> from the cloning API
  label       text NOT NULL,
  kind        text NOT NULL DEFAULT 'cloned',
  tag         text NOT NULL DEFAULT 'Cloned',
  description text NOT NULL DEFAULT '',
  ref_text    text NOT NULL DEFAULT '',
  created_at  text NOT NULL
);

-- Uploaded faces. `data_uri` holds a downscaled JPEG; on Supabase this becomes a Storage
-- object and the column becomes its public URL.
CREATE TABLE IF NOT EXISTS faces (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  kind        text NOT NULL DEFAULT 'uploaded',
  data_uri    text NOT NULL DEFAULT '',
  created_at  text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          text PRIMARY KEY,
  studio      text NOT NULL,              -- 'voice' | 'agent' | 'avatar'
  title       text NOT NULL DEFAULT '',
  detail      text NOT NULL DEFAULT '',
  face_id     text,
  agent_id    text,
  transcript  text NOT NULL DEFAULT '[]', -- JSON: TranscriptEntry[]
  created_at  text NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_studio_created ON sessions (studio, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_agent ON sessions (agent_id);

-- One-time bookkeeping, so seeding the shipped agents and tools happens once and a
-- deleted builtin stays deleted instead of reappearing on the next read.
CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

