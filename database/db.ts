/**
 * Database connection + migration runner (spec §9).
 *
 * Uses Node's built-in `node:sqlite` (Node >= 22.5) so there is no native
 * module to compile and no npm dependency for the core data store.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

export type Db = DatabaseSync;

const SCHEMA_PATH = new URL("./schema.sql", import.meta.url).pathname;

/** Default on-disk location: ~/.pi/agent/pi-studio/studio.db */
export function defaultDbPath(): string {
  const dir = resolve(homedir(), ".pi", "agent", "pi-studio");
  mkdirSync(dir, { recursive: true });
  return resolve(dir, "studio.db");
}

/** Open (creating if needed) the database at `path`, or in-memory for ":memory:". */
export function openDb(path: string = defaultDbPath()): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  return new DatabaseSync(path);
}

/** Apply the schema idempotently. Version 1 = current schema.sql. */
export function migrate(db: Db): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const applied = db.prepare("SELECT version FROM schema_migrations").all() as {
    version: number;
  }[];
  const current = applied.length === 0 ? 0 : Math.max(...applied.map((r) => r.version));

  if (current < 1) {
    const sql = readFileSync(SCHEMA_PATH, "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
      1,
      Date.now(),
    );
  }
}

/** Open + migrate in one step. */
export function createDb(path: string = defaultDbPath()): Db {
  const db = openDb(path);
  migrate(db);
  return db;
}
