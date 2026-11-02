/**
 * Disk usage check (PRD §10.1).
 *
 * Storage is the resource most likely to run out because photos are unlimited
 * (§8.1) and archival/purge is deferred (§10.2). This writes a daily usage line
 * so the trend is visible, and exits non-zero when an alert threshold is passed
 * so it can be wired to cron + an email relay.
 *
 * Usage: pnpm disk:check
 * Cron:  0 1 * * * /opt/ops/disk-check.sh >> /var/log/ops-disk.log 2>&1
 */
import { statfsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

const WARN_PCT = 70;
const CRITICAL_PCT = 85;

const uploadsDir = resolve(process.env.UPLOADS_DIR ?? "./uploads");
const dbPath = resolve(process.env.DATABASE_PATH ?? "./data/ops.db");

function dirBytes(dir: string): number {
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const p = join(dir, name);
    try {
      const st = statSync(p);
      total += st.isDirectory() ? dirBytes(p) : st.size;
    } catch {
      // File vanished between readdir and stat — ignore.
    }
  }
  return total;
}

function countPhotos(dbPath: string): number {
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare("select count(*) as c from photos where deleted_at is null")
      .get() as { c: number };
    db.close();
    return row.c;
  } catch {
    return 0;
  }
}

const gb = (b: number) => (b / 1024 ** 3).toFixed(2);

let fs;
try {
  fs = statfsSync(uploadsDir);
} catch {
  fs = statfsSync(process.cwd());
}

const totalBytes = Number(fs.blocks) * Number(fs.bsize);
const freeBytes = Number(fs.bavail) * Number(fs.bsize);
const usedPct = ((totalBytes - freeBytes) / totalBytes) * 100;

const photosBytes = dirBytes(uploadsDir);
const photos = countPhotos(dbPath);

const report = {
  at: new Date().toISOString(),
  diskUsedPct: Number(usedPct.toFixed(1)),
  diskTotalGb: Number(gb(totalBytes)),
  diskFreeGb: Number(gb(freeBytes)),
  uploadsGb: Number(gb(photosBytes)),
  photos,
  avgKbPerPhoto: photos > 0 ? Math.round(photosBytes / photos / 1024) : 0,
};

console.log(JSON.stringify(report));

if (usedPct >= CRITICAL_PCT) {
  console.error(`CRITICAL: disk ${usedPct.toFixed(1)}% used (threshold ${CRITICAL_PCT}%)`);
  process.exit(2);
}
if (usedPct >= WARN_PCT) {
  console.error(`WARNING: disk ${usedPct.toFixed(1)}% used (threshold ${WARN_PCT}%)`);
  process.exit(1);
}
