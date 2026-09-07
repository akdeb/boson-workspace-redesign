import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLITE_SCHEMA } from "@/lib/db/schema";

/**
 * ── The one file that knows what database this is ────────────────────────────────────
 *
 * Everything above this line (lib/db/repository.ts, the route handlers) speaks plain
 * parameterised SQL with `?` placeholders. This module is the port that runs it.
 *
 * Right now that is a SQLite file under `.data/`, using Node's built-in `node:sqlite` —
 * no dependency to install, no service to run, and it survives a restart, which is what
 * "temporary" storage actually has to do.
 *
 * ## Moving to Supabase
 *
 * 1. Run `lib/db/schema.postgres.sql` in the Supabase SQL editor.
 * 2. Replace the body of `getDb()` below with a Postgres client (`postgres`, `pg`, or
 *    `@supabase/supabase-js`'s `rpc`), keeping the same `Db` interface.
 * 3. Postgres numbers its placeholders, so translate `?` to `$1, $2, …` on the way in —
 *    `toPositional()` below already does it, it is just unused while we are on SQLite.
 *
 * Nothing in `repository.ts` or in any route handler changes.
 */

export type Row = Record<string, unknown>;

export interface Db {
  all<T = Row>(sql: string, params?: unknown[]): T[];
  get<T = Row>(sql: string, params?: unknown[]): T | undefined;
  run(sql: string, params?: unknown[]): void;
}

/** `select … where id = ?` → `select … where id = $1`. For the Postgres swap. */
export function toPositional(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/**
 * Where the database file lives.
 *
 * `.data` beside the code is right for a local dev server and impossible on a serverless
 * host: on AWS Lambda (and so Vercel) the bundle is unpacked read-only at `/var/task`, and
 * the only writable directory is `/tmp`. Falling back there keeps the app working, but
 * `/tmp` is per-instance and wiped on a cold start — so on a real deployment this is a
 * scratch pad, not storage. Point `STUDIO_DB_PATH` somewhere durable, or move to the
 * Postgres schema in `schema.postgres.sql`.
 */
function resolveDbPath() {
  const configured = process.env.STUDIO_DB_PATH?.trim();
  if (configured) return configured;

  const local = path.join(process.cwd(), ".data", "studio.db");
  try {
    mkdirSync(path.dirname(local), { recursive: true });
    return local;
  } catch {
    const fallback = path.join(tmpdir(), "boson-studio", "studio.db");
    console.warn(
      `Studio database: ${path.dirname(local)} is not writable, using ${fallback}. `
      + "This is ephemeral — set STUDIO_DB_PATH or move to Postgres for anything durable.",
    );
    return fallback;
  }
}

let db: Db | null = null;

/**
 * SQLite binds only null, number, bigint, string and buffers. Booleans are stored as 0/1
 * (which is what the schema declares), and everything nested arrives pre-JSON-encoded
 * from the repository — so this only has to flatten the boolean case.
 */
function bind(params: unknown[]) {
  return params.map(value => (typeof value === "boolean" ? (value ? 1 : 0) : value)) as never[];
}

export function getDb(): Db {
  if (db) return db;

  const dbPath = resolveDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(SQLITE_SCHEMA);

  db = {
    all: <T,>(sql: string, params: unknown[] = []) => sqlite.prepare(sql).all(...bind(params)) as T[],
    get: <T,>(sql: string, params: unknown[] = []) => sqlite.prepare(sql).get(...bind(params)) as T | undefined,
    run: (sql: string, params: unknown[] = []) => { sqlite.prepare(sql).run(...bind(params)); },
  };
  return db;
}
