/**
 * Login rate limiting (PRD §9.3: 5 failures / 15 min per email+IP).
 *
 * In-memory by design: the app runs as a single Next.js server process on one
 * VPS (§10). If it ever scales to multiple instances this must move to the DB
 * or Redis — noted here so the assumption is not silently broken.
 */
export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;

interface Entry {
  count: number;
  firstAt: number;
}

const attempts = new Map<string, Entry>();

const keyFor = (email: string, ip: string) => `${email.toLowerCase()}|${ip}`;

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the window resets; 0 when allowed. */
  retryAfterMs: number;
  remaining: number;
}

export function checkLoginRateLimit(email: string, ip: string, now = Date.now()): RateLimitResult {
  const key = keyFor(email, ip);
  const entry = attempts.get(key);

  if (!entry || now - entry.firstAt > WINDOW_MS) {
    return { allowed: true, retryAfterMs: 0, remaining: MAX_ATTEMPTS };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterMs: entry.firstAt + WINDOW_MS - now,
      remaining: 0,
    };
  }
  return { allowed: true, retryAfterMs: 0, remaining: MAX_ATTEMPTS - entry.count };
}

export function recordFailedLogin(email: string, ip: string, now = Date.now()): void {
  const key = keyFor(email, ip);
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

/** Called after a successful login so a correct password clears the counter. */
export function clearLoginAttempts(email: string, ip: string): void {
  attempts.delete(keyFor(email, ip));
}

/** Test hook. */
export function _resetRateLimits(): void {
  attempts.clear();
}
