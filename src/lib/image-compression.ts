/**
 * Client-side photo compression (§8.2).
 *
 * Target: longest side <= 1920px, WebP q0.82 (JPEG q0.85 fallback), ~250-600 KB.
 * Implemented with canvas so there is no dependency, and it runs on the main
 * thread for simplicity — a handful of photos is not enough to need a worker.
 */
export const MAX_DIMENSION = 1920;
export const WEBP_QUALITY = 0.82;
export const JPEG_QUALITY = 0.85;
/** Files already smaller than this are not re-compressed (§8.2). */
export const SKIP_BELOW_BYTES = 400 * 1024;

export interface CompressedPhoto {
  blob: Blob;
  width: number;
  height: number;
  /** Milliseconds from EXIF DateTimeOriginal, if present and parseable. */
  takenAt: number | null;
}

/** Reads DateTimeOriginal from a JPEG's EXIF block (§8.2 — for display only). */
export async function readExifTakenAt(file: Blob): Promise<number | null> {
  try {
    const buf = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
    // Minimal EXIF scan: look for the ASCII "YYYY:MM:DD HH:MM:SS" pattern.
    const text = new TextDecoder("latin1").decode(buf);
    const m = text.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m;
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Gambar tidak bisa dibaca"));
      img.src = url;
    });
  } finally {
    // The caller draws synchronously before this is revoked in compressPhoto.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function dims(src: ImageBitmap | HTMLImageElement) {
  if ("naturalWidth" in src) {
    return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
  }
  return { w: src.width, h: src.height };
}

/** Compresses a photo for upload, preserving orientation. */
export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  const takenAt = await readExifTakenAt(file);

  // Already small enough — send as-is (§8.2).
  if (file.size <= SKIP_BELOW_BYTES && file.type !== "image/heic") {
    const src = await loadBitmap(file);
    const { w, h } = dims(src);
    if ("close" in src) src.close();
    return { blob: file, width: w, height: h, takenAt };
  }

  const src = await loadBitmap(file);
  const { w, h } = dims(src);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia");
    ctx.drawImage(src as CanvasImageSource, 0, 0, outW, outH);

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        "image/webp",
        WEBP_QUALITY,
      );
    });

    // Some browsers silently fall back to PNG; try JPEG explicitly then.
    let blob = encoded;
    if (!blob || blob.type !== "image/webp") {
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
      });
    }
    if (!blob) throw new Error("Gagal mengompresi foto");

    return { blob, width: outW, height: outH, takenAt };
  } finally {
    if ("close" in src) src.close();
  }
}
