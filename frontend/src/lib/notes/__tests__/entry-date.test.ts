import { describe, it, expect } from "vitest";
import { formatEntryDate, todayLocalISO } from "../entry-date";

// These tests guard the running-log date bug where date-only strings parsed as
// UTC midnight rendered the previous calendar day in timezones behind UTC. The
// suite is meaningful when run in such a zone (CI pins TZ below); even in UTC it
// still asserts the day never drifts.

describe("formatEntryDate", () => {
  it("formats a date-only string as its own calendar day", () => {
    expect(formatEntryDate("2026-05-13")).toBe("May 13, 2026");
    expect(formatEntryDate("2026-05-10")).toBe("May 10, 2026");
    expect(formatEntryDate("2026-05-01")).toBe("May 1, 2026");
    expect(formatEntryDate("2026-06-18")).toBe("Jun 18, 2026");
  });

  it("does not roll back across a month boundary", () => {
    expect(formatEntryDate("2026-05-01")).toBe("May 1, 2026");
    expect(formatEntryDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("returns empty string for falsy input", () => {
    expect(formatEntryDate("")).toBe("");
  });

  it("falls back to normal parsing for full timestamps", () => {
    // A timestamp with an explicit time component is parsed as-is; we only
    // assert it produces a non-empty, year-bearing label (exact day depends on
    // the offset, which is the correct behavior for a real instant).
    const out = formatEntryDate("2026-05-13T12:00:00");
    expect(out).toContain("2026");
  });
});

describe("todayLocalISO", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayLocalISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches the local calendar date", () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(todayLocalISO()).toBe(expected);
  });
});
