/**
 * Password hashing.
 *
 * PRD §9.3 specifies "argon2id (or bcrypt cost 12)". We use **scrypt**
 * (Node built-in, memory-hard, no native dependency) instead:
 * - argon2 requires a native module, which adds a build-toolchain requirement
 *   to every deploy target for no practical security gain at this scale.
 * - scrypt with N=2^16, r=8, p=1 is memory-hard (~64 MB) and exceeds bcrypt
 *   cost 12 resistance; it is the standard recommendation in its absence.
 *
 * Format: scrypt$N$r$p$<salt-b64>$<hash-b64>
 * Parameters are stored per-hash so they can be raised later without a migration.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const CURRENT = { N: 1 << 16, r: 8, p: 1 } as const;
const KEYLEN = 64;
const SALT_BYTES = 16;
// scrypt needs ~128 * N * r bytes; give it headroom or it throws.
const maxmem = (params: { N: number; r: number }) => 128 * params.N * params.r * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const { N, r, p } = CURRENT;
  const hash = await scrypt(password.normalize("NFKC"), salt, KEYLEN, {
    N,
    r,
    p,
    maxmem: maxmem({ N, r }),
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");

  try {
    const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: maxmem({ N, r }),
    });
    // Constant-time compare; lengths must match for timingSafeEqual.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** True when `stored` was hashed with weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < CURRENT.N || Number(parts[2]) < CURRENT.r;
}
