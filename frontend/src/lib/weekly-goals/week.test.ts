// Weekly goals widget (PI beta feedback, weekly-goals widget, 2026-05-29).
// Unit tests for the pure week-anchoring helpers.

import { describe, it, expect } from "vitest";
import { mondayOf, formatYmdLocal, weekLabel } from "./week";

describe("mondayOf", () => {
  it("returns the same day for a Monday", () => {
    // 2026-05-25 is a Monday.
    const d = new Date(2026, 4, 25, 14, 30); // May = month index 4
    expect(mondayOf(d)).toBe("2026-05-25");
  });

  it("rolls a mid-week day back to its Monday", () => {
    // 2026-05-28 is a Thursday.
    const d = new Date(2026, 4, 28, 9, 0);
    expect(mondayOf(d)).toBe("2026-05-25");
  });

  it("rolls a Sunday back to the PREVIOUS Monday (not the next)", () => {
    // 2026-05-31 is a Sunday — belongs to the week starting 2026-05-25.
    const d = new Date(2026, 4, 31, 23, 0);
    expect(mondayOf(d)).toBe("2026-05-25");
  });

  it("ignores the time component", () => {
    const morning = new Date(2026, 4, 27, 0, 1);
    const night = new Date(2026, 4, 27, 23, 59);
    expect(mondayOf(morning)).toBe(mondayOf(night));
  });
});

describe("formatYmdLocal", () => {
  it("zero-pads month and day", () => {
    expect(formatYmdLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("weekLabel", () => {
  it("renders a 'Week of <month> <day>' label", () => {
    // Locale-independent assertion: just check the prefix + that it isn't
    // the raw fallback string.
    const label = weekLabel("2026-05-25");
    expect(label.startsWith("Week of ")).toBe(true);
    expect(label).not.toBe("2026-05-25");
  });

  it("falls back to the raw value for an unparseable input", () => {
    expect(weekLabel("not-a-date")).toBe("not-a-date");
  });
});
