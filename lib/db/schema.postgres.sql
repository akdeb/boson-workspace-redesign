-- The Supabase twin of schema.sql. Paste into the SQL editor (or a migration) and point
-- lib/db/driver.ts at Postgres; lib/db/repository.ts is unchanged either way.
--
-- Differences from the SQLite file, all mechanical:
--   integer 0/1  ->  boolean
--   text JSON    ->  jsonb
--   text time    ->  timestamptz
-- The repository writes ISO-8601 strings and JSON strings, both of which Postgres casts
-- into these types on insert, so the same parameters work against either schema.

CREATE TABLE IF NOT EXISTS agents (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  summary     text NOT NULL DEFAULT '',
  config      jsonb NOT NULL,
  color       text,
  icon        text,
  builtin     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS tools (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  parameters  jsonb NOT NULL,
  binding     jsonb NOT NULL,
  builtin     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS voices (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  kind        text NOT NULL DEFAULT 'cloned',
  tag         text NOT NULL DEFAULT 'Cloned',
  description text NOT NULL DEFAULT '',
  ref_text    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL
);

-- On Supabase, put the image in a Storage bucket and keep its URL here instead of a
-- multi-hundred-kilobyte data URI.
CREATE TABLE IF NOT EXISTS faces (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  kind        text NOT NULL DEFAULT 'uploaded',
  data_uri    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          text PRIMARY KEY,
  studio      text NOT NULL,
  title       text NOT NULL DEFAULT '',
  detail      text NOT NULL DEFAULT '',
  face_id     text,
  agent_id    text,
  transcript  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_studio_created ON sessions (studio, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_agent ON sessions (agent_id);

-- One-time bookkeeping, so seeding the shipped agents and tools happens once and a
-- deleted builtin stays deleted instead of reappearing on the next read.
CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);


-- Everything above is single-tenant. Adding auth is one column and one policy per table:
--   ALTER TABLE agents ADD COLUMN user_id uuid REFERENCES auth.users (id);
--   ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY agents_own ON agents USING (user_id = auth.uid());
