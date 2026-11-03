/**
 * Date & timezone helpers.
 *
 * PRD §16.7: an "event day" is always computed in the PROJECT's timezone,
 * never the server's. Everything here is pure so it can be unit-tested
 * without a database or a specific machine timezone.
 */

/** Returns the UTC offset (ms) that `timeZone` has at the given instant. */
function offsetMsAt(instant: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - instant;
}

/** YYYY-MM-DD for an instant, in the given timezone. */
export function toLocalDate(instant: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date(instant));
}

/** HH:mm for an instant, in the given timezone. */
export function toLocalTime(instant: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return dtf.format(new Date(instant));
}

/** Actual server submission/edit timestamp, shown in the project's timezone. */
export function formatReportTimestamp(instant: number | null, timeZone: string): string {
  if (instant === null) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZoneName: "short",
  }).format(new Date(instant));
}

/**
 * Converts a wall-clock date + time in `timeZone` to a UTC instant (ms).
 * Handles DST by resolving the offset at the target instant.
 */
export function zonedToUtc(
  date: string, // YYYY-MM-DD
  time: string, // HH:mm
  timeZone: string,
): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two-pass: guess with the offset at the naive instant, then correct.
  const first = naive - offsetMsAt(naive, timeZone);
  const second = naive - offsetMsAt(first, timeZone);
  return second;
}

/**
 * PRD §13.1: a submitted report may be edited until H+1 12:00 in the
 * project's timezone (or until the day is reviewed, whichever comes first).
 */
export function editDeadline(dayDate: string, timeZone: string): number {
  const [y, m, d] = dayDate.split("-").map(Number);
  // Use UTC arithmetic for the calendar increment, then resolve in the zone.
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDate = next.toISOString().slice(0, 10);
  return zonedToUtc(nextDate, "12:00", timeZone);
}

/** Adds days to a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Inclusive list of dates from start to end. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // Guard against a reversed/insane range so a bad input cannot hang the server.
  let guard = 0;
  while (cur <= end && guard++ < 4000) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * PRD §13.2: `is_late` is computed once, at submit, against the window in force.
 * A window is late when the submit instant is after the window's end time on
 * that event day, in project time.
 */
export function computeIsLate(
  submittedAt: number,
  dayDate: string,
  windowEnd: string, // HH:mm
  timeZone: string,
): boolean {
  return submittedAt > zonedToUtc(dayDate, windowEnd, timeZone);
}
