/**
 * Tests for `GanttDragDropStep`'s drop-target date computation.
 *
 * gantt drag-and-spotlight fix manager (2026-05-27): exercises the
 * weekend-skip math so the BeakerBot demo lands on the next working
 * day instead of dragging onto a muted weekend cell (or off-screen,
 * which is what the legacy "drag to whole timeline" path produced).
 */
import { describe, expect, it } from "vitest";

import {
  addDaysLocal,
  computeDragTargetDate,
} from "../GanttDragDropStep";

describe("addDaysLocal", () => {
  it("advances by one calendar day", () => {
    // 2026-05-27 (Wed) + 1 = 2026-05-28 (Thu)
    expect(addDaysLocal("2026-05-27", 1)).toBe("2026-05-28");
  });
  it("rolls month boundaries", () => {
    expect(addDaysLocal("2026-05-31", 1)).toBe("2026-06-01");
  });
  it("rolls year boundaries", () => {
    expect(addDaysLocal("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("returns input unchanged on malformed string", () => {
    expect(addDaysLocal("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("computeDragTargetDate", () => {
  it("Wed + 1 lands on Thu (same week, no skip)", () => {
    // 2026-05-27 = Wednesday
    expect(computeDragTargetDate("2026-05-27")).toBe("2026-05-28");
  });
  it("Thu + 1 lands on Fri (no skip)", () => {
    // 2026-05-28 = Thursday
    expect(computeDragTargetDate("2026-05-28")).toBe("2026-05-29");
  });
  it("Fri + 1 would be Sat, skips to Mon", () => {
    // 2026-05-29 = Friday; +1 = 2026-05-30 (Sat); skip to 2026-06-01 (Mon)
    expect(computeDragTargetDate("2026-05-29")).toBe("2026-06-01");
  });
  it("Sat + 1 would be Sun, skips to Mon", () => {
    // 2026-05-30 = Saturday; +1 = 2026-05-31 (Sun); skip to 2026-06-01 (Mon)
    expect(computeDragTargetDate("2026-05-30")).toBe("2026-06-01");
  });
  it("Sun + 1 lands on Mon (no skip needed)", () => {
    // 2026-05-31 = Sunday; +1 = 2026-06-01 (Mon)
    expect(computeDragTargetDate("2026-05-31")).toBe("2026-06-01");
  });
  it("Mon + 1 lands on Tue (no skip needed)", () => {
    // 2026-06-01 = Monday
    expect(computeDragTargetDate("2026-06-01")).toBe("2026-06-02");
  });
});
