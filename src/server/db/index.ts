import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

/**
 * SQLite hardening required by PRD §9.2:
 * WAL, busy_timeout 5000, foreign_keys ON. All writes go through transactions.
 */
export function openDatabase(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  // NORMAL is the right trade-off with WAL: durable against app crashes,
  // and Litestream handles replication to off-box storage.
  db.pragma("synchronous = NORMAL");
  return db;
}

export function resolveDbPath(): string {
  return resolve(process.env.DATABASE_PATH ?? "./data/ops.db");
}

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _raw: Database.Database | null = null;

/** Singleton connection for the Next.js server process. */
export function getDb() {
  if (!_db) {
    const path = resolveDbPath();
    mkdirSync(dirname(path), { recursive: true });
    _raw = openDatabase(path);
    _db = drizzle(_raw, { schema });
  }
  return _db;
}

export function getRawDb(): Database.Database {
  getDb();
  return _raw!;
}

export * as schema from "./schema";
