import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getDb, resolveDbPath } from "./index";

const MIGRATIONS_DIR = resolve(process.cwd(), "src/server/db/migrations");

/** Applies pending migrations. Safe to run on every boot. */
export function runMigrations() {
  const path = resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = getDb();
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
  console.log(`migrations applied to ${resolveDbPath()}`);
}
