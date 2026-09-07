import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

const DB_PATH = process.env.STUDIO_DB_PATH ?? path.join(process.cwd(), ".data", "studio.db");

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

  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new DatabaseSync(DB_PATH);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf8"));

  db = {
    all: <T,>(sql: string, params: unknown[] = []) => sqlite.prepare(sql).all(...bind(params)) as T[],
    get: <T,>(sql: string, params: unknown[] = []) => sqlite.prepare(sql).get(...bind(params)) as T | undefined,
    run: (sql: string, params: unknown[] = []) => { sqlite.prepare(sql).run(...bind(params)); },
  };
  return db;
}
