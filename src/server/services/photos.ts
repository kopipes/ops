/**
 * Photo storage (§8.3).
 *
 * - MIME is validated from MAGIC BYTES, never from the client's Content-Type.
 * - Files over 15 MB are rejected (§8.3). There is NO count limit (§8.1).
 * - `sharp` re-encodes to WebP and strips ALL metadata (EXIF/GPS) for privacy.
 * - Two derivatives are stored: a 1920px original-quality copy and a 400px thumb.
 * - Photos are written to `UPLOADS_DIR` (a separate volume in prod, §10.1) and
 *   served through an authenticated route — never as static files.
 */
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { photos } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import { ValidationError } from "./checklist-items";

type DB = BetterSQLite3Database<typeof schema>;

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // §8.3
export const MAX_DIMENSION = 1920; // §8.2
export const THUMB_DIMENSION = 400; // §8.3
export const WEBP_QUALITY = 82;

/** Magic-byte sniffing. Only these three are acceptable uploads. */
export function detectImageType(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function uploadsRoot(): string {
  return resolve(process.env.UPLOADS_DIR ?? "./uploads");
}

/** Month-partitioned path (§8.3): /uploads/{yyyy}/{mm}/{uuid}.webp */
function relativePaths(now: Date, id: string) {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return {
    dir: join(yyyy, mm),
    main: join(yyyy, mm, `${id}.webp`),
    thumb: join(yyyy, mm, `${id}_thumb.webp`),
  };
}

/** Guards against path traversal when serving a stored path. */
export function resolveStoredPath(relPath: string): string {
  const root = uploadsRoot();
  const full = resolve(root, relPath);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new ValidationError("Path foto tidak valid");
  }
  return full;
}

export interface UploadResult {
  photoId: string;
  width: number;
  height: number;
  sizeBytes: number;
  thumbPath: string;
}

export interface UploadInput {
  buffer: Buffer;
  filename: string;
  source: "camera" | "gallery";
  takenAt: number | null;
  projectId: string;
  projectDayId: string | null;
  /** Provisional owner: the uploading user until the report is submitted. */
  ownerType: "report" | "check_result" | "issue" | "issue_update";
  ownerId: string;
  /** §8.4 idempotency key; a repeated upload returns the original photo. */
  clientUploadId?: string | null;
}

/**
 * Stores a photo. Note the intentional absence of any quota/count check (§8.1).
 */
export async function storePhoto(
  db: DB,
  user: ActingUser,
  input: UploadInput,
): Promise<UploadResult> {
  if (input.buffer.length === 0) throw new ValidationError("File kosong");
  if (input.buffer.length > MAX_UPLOAD_BYTES) {
    throw new ValidationError("Ukuran file maksimal 15 MB");
  }

  // Idempotency: a retried upload returns the existing photo (§8.4).
  if (input.clientUploadId) {
    const existing = await db
      .select({
        id: photos.id,
        width: photos.width,
        height: photos.height,
        sizeBytes: photos.sizeBytes,
        thumbPath: photos.thumbPath,
      })
      .from(photos)
      .where(eq(photos.clientUploadId, input.clientUploadId))
      .get();
    if (existing) return { photoId: existing.id, ...existing };
  }

  const kind = detectImageType(input.buffer);
  if (!kind) {
    throw new ValidationError("File bukan gambar JPG, PNG, atau WebP yang valid");
  }

  const id = randomUUID();
  const now = new Date();
  const paths = relativePaths(now, id);
  const root = uploadsRoot();

  let mainBuf: Buffer;
  let thumbBuf: Buffer;
  let width: number;
  let height: number;

  try {
    // `rotate()` applies EXIF orientation then `withMetadata()` is deliberately
    // NOT called, which drops EXIF/GPS (§8.3 privacy requirement).
    const pipeline = sharp(input.buffer, { failOn: "error" }).rotate();

    const main = await pipeline
      .clone()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    mainBuf = main.data;
    width = main.info.width;
    height = main.info.height;

    const thumb = await pipeline
      .clone()
      .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: "inside" })
      .webp({ quality: 70 })
      .toBuffer();

    thumbBuf = thumb;
  } catch {
    throw new ValidationError("Gambar tidak bisa diproses. Coba foto lain.");
  }

  await mkdir(dirname(join(root, paths.main)), { recursive: true });
  await writeFile(join(root, paths.main), mainBuf);
  await writeFile(join(root, paths.thumb), thumbBuf);

  await db.insert(photos).values({
    id,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    projectId: input.projectId,
    projectDayId: input.projectDayId,
    path: paths.main.split(sep).join("/"),
    thumbPath: paths.thumb.split(sep).join("/"),
    mime: "image/webp",
    width,
    height,
    sizeBytes: mainBuf.length,
    source: input.source,
    clientUploadId: input.clientUploadId ?? null,
    takenAt: input.takenAt,
    uploadedBy: user.id,
    createdAt: Date.now(),
  });

  return {
    photoId: id,
    width,
    height,
    sizeBytes: mainBuf.length,
    thumbPath: paths.thumb.split(sep).join("/"),
  };
}

/** Reads a photo file for the authenticated serving route. */
export async function readPhotoFile(
  db: DB,
  photoId: string,
  variant: "main" | "thumb",
): Promise<{ buffer: Buffer; mime: string } | null> {
  const row = await db.select().from(photos).where(eq(photos.id, photoId)).get();
  if (!row || row.deletedAt) return null;

  const rel = variant === "thumb" ? row.thumbPath : row.path;
  try {
    const buffer = await readFile(resolveStoredPath(rel));
    return { buffer, mime: row.mime };
  } catch {
    return null;
  }
}

/** Photos still owned by the uploader (not yet attached to a report). */
export async function listUnattachedPhotos(db: DB, userId: string, projectId: string) {
  return db
    .select({ id: photos.id, thumbPath: photos.thumbPath })
    .from(photos)
    .where(eq(photos.uploadedBy, userId))
    .limit(200);
}
