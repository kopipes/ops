"use client";

/**
 * Local draft storage (§4.3 no.8).
 *
 * Drafts live in IndexedDB so a closed app or lost signal never loses work.
 * IndexedDB is used (not localStorage) because drafts include photo blobs.
 *
 * Every write is best-effort: if IndexedDB is unavailable (private mode, quota)
 * the form still works in memory — drafts are a convenience, not a requirement.
 */

const DB_NAME = "ops-drafts";
const DB_VERSION = 1;
const STORE = "drafts";

export interface DraftCheckResult {
  projectChecklistItemId: string;
  result: "ok" | "not_ok" | "na";
  note: string;
  photoIds: string[];
}

export interface ReportDraft {
  key: string;
  projectId: string;
  projectDayId: string;
  phase: "opening" | "monitoring" | "closing";
  notes: string;
  phaseNote?: string;
  observedAt: number;
  results: DraftCheckResult[];
  photoIds: string[];
  handoverNote?: string;
  clientSubmissionId: string;
  updatedAt: number;
}

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
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

export async function saveDraft(draft: ReportDraft): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function loadDraft(key: string): Promise<ReportDraft | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<ReportDraft | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as ReportDraft) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function clearDraft(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export const draftKey = (projectDayId: string, phase: string) => `${projectDayId}:${phase}`;

/** UUID for the idempotency key; falls back when crypto.randomUUID is absent. */
export function newSubmissionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
