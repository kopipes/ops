/**
 * Durable photo upload queue (§8.4).
 *
 * Problem this solves: on a bad venue connection an upload fails, the crew
 * switches apps or reloads, and the photo is lost with no feedback.
 *
 * Design:
 * - Jobs are persisted in IndexedDB (blobs included) BEFORE the first attempt.
 * - A job is retried with exponential backoff, and survives a reload.
 * - Idempotent: each job carries a stable `clientUploadId`; the server stores it,
 *   so a retry after a partially-successful request does not create a duplicate.
 * - Concurrency is capped so a 40-photo burst does not saturate the uplink.
 */
import { compressPhoto } from "./image-compression";

const DB_NAME = "ops-uploads";
const DB_VERSION = 1;
const STORE = "jobs";

export type JobStatus = "pending" | "uploading" | "done" | "failed";

export interface UploadJob {
  id: string;
  clientUploadId: string;
  /** Checklist item the photo belongs to, or null for general photos. */
  itemId: string | null;
  projectId: string;
  projectDayId: string;
  source: "camera" | "gallery";
  filename: string;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number;
  photoId: string | null;
  /** File/blob is stored as-is; compression happens on each attempt (cheap). */
  blob: Blob;
  createdAt: number;
  updatedAt: number;
}

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 2000;
const CONCURRENCY = 2;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export const backoffMs = (attempts: number) =>
  Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), 60_000);

export async function enqueue(job: Omit<UploadJob, "id" | "status" | "attempts" | "lastError" | "nextAttemptAt" | "photoId" | "createdAt" | "updatedAt">): Promise<string> {
  const now = Date.now();
  const id = job.clientUploadId;
  const full: UploadJob = {
    ...job,
    id,
    status: "pending",
    attempts: 0,
    lastError: null,
    nextAttemptAt: now,
    photoId: null,
    createdAt: now,
    updatedAt: now,
  };
  await withStore("readwrite", (s) => s.put(full));
  return id;
}

export async function listJobs(): Promise<UploadJob[]> {
  const all = await withStore<UploadJob[]>("readonly", (s) => s.getAll() as IDBRequest<UploadJob[]>);
  return (all ?? []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function pendingCount(): Promise<number> {
  const jobs = await listJobs();
  return jobs.filter((j) => j.status === "pending" || j.status === "uploading").length;
}

export async function updateJob(id: string, patch: Partial<UploadJob>): Promise<void> {
  const existing = await withStore<UploadJob>("readonly", (s) => s.get(id) as IDBRequest<UploadJob>);
  if (!existing) return;
  await withStore("readwrite", (s) => s.put({ ...existing, ...patch, updatedAt: Date.now() }));
}

export async function removeJob(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

export async function clearCompleted(): Promise<void> {
  const jobs = await listJobs();
  for (const j of jobs) {
    if (j.status === "done" || j.status === "failed") await removeJob(j.id);
  }
}

/**
 * Processes the queue until nothing is pending. Safe to call repeatedly;
 * a second call while running is a no-op.
 */
let running = false;

export async function processQueue(
  onProgress?: (jobs: UploadJob[]) => void,
): Promise<{ uploaded: number; failed: number }> {
  if (running) return { uploaded: 0, failed: 0 };
  running = true;

  let uploaded = 0;
  let failed = 0;

  try {
    for (;;) {
      const jobs = await listJobs();
      const now = Date.now();
      const ready = jobs.filter(
        (j) => j.status !== "done" && j.attempts < MAX_ATTEMPTS && j.nextAttemptAt <= now,
      );
      if (ready.length === 0) break;

      // Bounded concurrency.
      const batch = ready.slice(0, CONCURRENCY);
      const results = await Promise.all(batch.map((job) => attempt(job)));
      uploaded += results.filter((r) => r === "done").length;
      failed += results.filter((r) => r === "failed").length;
      onProgress?.(await listJobs());
    }
  } finally {
    running = false;
  }

  return { uploaded, failed };
}

async function attempt(job: UploadJob): Promise<"done" | "retry" | "failed"> {
  await updateJob(job.id, { status: "uploading" });

  try {
    const compressed = await compressPhoto(new File([job.blob], job.filename));
    const fd = new FormData();
    fd.set("projectId", job.projectId);
    fd.set("projectDayId", job.projectDayId);
    fd.set("file", new File([compressed.blob], "photo.webp", { type: compressed.blob.type }));
    fd.set("source", job.source);
    fd.set("clientUploadId", job.clientUploadId);
    if (compressed.takenAt) fd.set("takenAt", String(compressed.takenAt));

    const res = await fetch("/api/photos", { method: "POST", body: fd });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      // A 4xx will not succeed on retry (bad file, no permission).
      if (res.status >= 400 && res.status < 500) {
        await updateJob(job.id, { status: "failed", lastError: body.error ?? `HTTP ${res.status}` });
        return "failed";
      }
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const { photoId } = (await res.json()) as { photoId: string };
    await updateJob(job.id, { status: "done", photoId, attempts: job.attempts + 1, lastError: null });
    return "done";
  } catch (err) {
    const attempts = job.attempts + 1;
    const lastError = err instanceof Error ? err.message : "Upload gagal";
    if (attempts >= MAX_ATTEMPTS) {
      await updateJob(job.id, { status: "failed", attempts, lastError });
      return "failed";
    }
    await updateJob(job.id, {
      status: "pending",
      attempts,
      lastError,
      nextAttemptAt: Date.now() + backoffMs(attempts),
    });
    return "retry";
  }
}

/** Resumes work left over from a previous session (§8.4). */
export async function resumeQueue(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!navigator.onLine) return;
  void processQueue();
}
