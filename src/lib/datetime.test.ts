import { describe, expect, it } from "vitest";
import {
  addDays,
  computeIsLate,
  dateRange,
  editDeadline,
  toLocalDate,
  toLocalTime,
  zonedToUtc,
} from "./datetime";

describe("zonedToUtc", () => {
  it("converts WIB (UTC+7) correctly", () => {
    expect(new Date(zonedToUtc("2026-11-02", "08:00", "Asia/Jakarta")).toISOString()).toBe(
      "2026-11-02T01:00:00.000Z",
    );
  });

  it("converts WITA (UTC+8) correctly", () => {
    expect(new Date(zonedToUtc("2026-11-02", "08:00", "Asia/Makassar")).toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
  });

  it("converts WIT (UTC+9) correctly", () => {
    expect(new Date(zonedToUtc("2026-11-02", "08:00", "Asia/Jayapura")).toISOString()).toBe(
      "2026-11-01T23:00:00.000Z",
    );
  });
});

describe("toLocalDate / toLocalTime", () => {
  it("uses the project timezone, not the server timezone", () => {
    // 2026-11-02T18:30Z is already 2026-11-03 01:30 in Jakarta.
    const instant = Date.UTC(2026, 10, 2, 18, 30);
    expect(toLocalDate(instant, "Asia/Jakarta")).toBe("2026-11-03");
    expect(toLocalTime(instant, "Asia/Jakarta")).toBe("01:30");
  });
});

describe("editDeadline (§13.1: H+1 12:00 local)", () => {
  it("is noon the following day in project time", () => {
    expect(new Date(editDeadline("2026-11-02", "Asia/Jakarta")).toISOString()).toBe(
      "2026-11-03T05:00:00.000Z",
    );
  });

  it("crosses a month boundary", () => {
    expect(new Date(editDeadline("2026-11-30", "Asia/Jakarta")).toISOString()).toBe(
      "2026-12-01T05:00:00.000Z",
    );
  });

  it("crosses a year boundary", () => {
    expect(new Date(editDeadline("2026-12-31", "Asia/Jakarta")).toISOString()).toBe(
      "2027-01-01T05:00:00.000Z",
    );
  });
});

describe("addDays / dateRange", () => {
  it("adds days across month/year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("produces an inclusive range", () => {
    expect(dateRange("2026-11-02", "2026-11-04")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
  });

  it("returns a single day when start equals end", () => {
    expect(dateRange("2026-11-02", "2026-11-02")).toEqual(["2026-11-02"]);
  });

  it("returns empty for a reversed range (no infinite loop)", () => {
    expect(dateRange("2026-11-04", "2026-11-02")).toEqual([]);
  });
});

describe("computeIsLate (§13.2)", () => {
  const DAY = "2026-11-02";
  const TZ = "Asia/Jakarta";
  const windowEnd = "11:00"; // 04:00Z

  it("submitting inside the window is not late", () => {
    const at = zonedToUtc(DAY, "10:59", TZ);
    expect(computeIsLate(at, DAY, windowEnd, TZ)).toBe(false);
  });

  it("submitting after the window is late", () => {
    const at = zonedToUtc(DAY, "11:01", TZ);
    expect(computeIsLate(at, DAY, windowEnd, TZ)).toBe(true);
  });

  it("submitting exactly at the window end is not late", () => {
    const at = zonedToUtc(DAY, "11:00", TZ);
    expect(computeIsLate(at, DAY, windowEnd, TZ)).toBe(false);
  });
});
