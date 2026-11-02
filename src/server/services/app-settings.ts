/**
 * Global application settings (§12 /admin/settings).
 *
 * Stored as key/value rows in `app_settings`. Per §8.1 there is deliberately NO
 * photo-limit key — photos are unlimited.
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { appSettings, auditLogs } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { canManageUsers, type ActingUser } from "@/server/permissions";
import { randomUUID } from "node:crypto";
import { ForbiddenError, ValidationError } from "./checklist-items";

type DB = BetterSQLite3Database<typeof schema>;

export interface GlobalSettings {
  defaultOpeningWindowStart: string;
  defaultOpeningWindowEnd: string;
  defaultClosingWindowStart: string;
  defaultClosingWindowEnd: string;
  defaultTimezone: string;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  defaultOpeningWindowStart: "06:00",
  defaultOpeningWindowEnd: "11:00",
  defaultClosingWindowStart: "17:00",
  defaultClosingWindowEnd: "23:59",
  defaultTimezone: "Asia/Jakarta",
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALLOWED_TIMEZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];

export async function getGlobalSettings(db: DB): Promise<GlobalSettings> {
  const rows = await db.select().from(appSettings);
  const map = new Map(rows.map((r) => [r.key, r.valueJson]));

  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GlobalSettings)[]) {
    const raw = map.get(key);
    if (raw !== undefined) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string") out[key] = parsed;
      } catch {
        // A corrupt value falls back to the default rather than breaking the app.
      }
    }
  }
  return out;
}

export async function saveGlobalSettings(
  db: DB,
  actor: ActingUser,
  input: GlobalSettings,
): Promise<void> {
  if (!canManageUsers(actor)) throw new ForbiddenError("Hanya Admin yang bisa mengubah setelan");

  for (const key of [
    "defaultOpeningWindowStart",
    "defaultOpeningWindowEnd",
    "defaultClosingWindowStart",
    "defaultClosingWindowEnd",
  ] as const) {
    if (!TIME_RE.test(input[key])) throw new ValidationError(`Format jam tidak valid: ${input[key]}`);
  }
  if (input.defaultOpeningWindowStart >= input.defaultOpeningWindowEnd) {
    throw new ValidationError("Window opening: jam mulai harus sebelum jam selesai");
  }
  if (input.defaultClosingWindowStart >= input.defaultClosingWindowEnd) {
    throw new ValidationError("Window closing: jam mulai harus sebelum jam selesai");
  }
  if (!ALLOWED_TIMEZONES.includes(input.defaultTimezone)) {
    throw new ValidationError("Timezone tidak didukung");
  }

  const now = Date.now();
  for (const [key, value] of Object.entries(input)) {
    await db
      .insert(appSettings)
      .values({ key, valueJson: JSON.stringify(value), updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: JSON.stringify(value), updatedAt: now } });
  }

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: actor.id,
    action: "settings.updated",
    entityType: "app_settings",
    entityId: "global",
    metaJson: JSON.stringify(input),
    ip: null,
    createdAt: now,
  });
}
