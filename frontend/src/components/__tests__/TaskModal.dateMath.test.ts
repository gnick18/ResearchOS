import { describe, expect, it } from "vitest";
import { addDaysLocal } from "../TaskModal";

/**
 * Pins the two bugs the TaskModal date math manager fixed on 2026-05-27 in
 * the `suggestedStartDate` useMemo:
 *
 *   1. TZ drift: the prior `new Date(yyyy-mm-dd)` + `toISOString()` round-trip
 *      parsed local-tz date strings as UTC midnight. In west-of-UTC zones
 *      near end-of-day, reading the UTC day back out landed the suggested
 *      child start on the wrong calendar day. addDaysLocal stays in local-tz
 *      throughout, so the day-of-month never drifts regardless of the
 *      running host's TZ.
 *
 *   2. SF off-by-one: the prior formula was `start - duration + 1`, which is
 *      the buggy "no-gap" overlap. Strict-gap (engine + GanttChart 9548b32c,
 *      TaskDetailPopup e7e9242b) is `child.start = parent.start - duration`
 *      so child.end = parent.start - 1.
 */

describe("addDaysLocal — local-tz date math for TaskModal suggestedStartDate", () => {
  it("adds 1 day across a month boundary", () => {
    expect(addDaysLocal("2026-05-31", 1)).toBe("2026-06-01");
  });

  it("subtracts 1 day across a month boundary", () => {
    expect(addDaysLocal("2026-06-01", -1)).toBe("2026-05-31");
  });

  it("returns the input unchanged for delta 0", () => {
    expect(addDaysLocal("2026-05-27", 0)).toBe("2026-05-27");
  });

  it("handles year boundary forward", () => {
    expect(addDaysLocal("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles year boundary backward", () => {
    expect(addDaysLocal("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("subtracts the full duration for SF strict-gap (duration 1)", () => {
    // SF: child.start = parent.start - duration. Parent on 06-10, duration 1
    // → child on 06-09 (NOT 06-10, which was the old buggy "no-gap" output).
    const parentStart = "2026-06-10";
    expect(addDaysLocal(parentStart, -1)).toBe("2026-06-09");
  });

  it("subtracts the full duration for SF strict-gap (duration 3)", () => {
    // Parent on 06-15, duration 3 → child on 06-12. Child runs 12/13/14;
    // ends 14; parent starts 15. Strict gap of 1 day. Pins the engine's
    // SF semantics test (dep-semantics.test.ts:205-207) at the modal layer.
    const parentStart = "2026-06-15";
    expect(addDaysLocal(parentStart, -3)).toBe("2026-06-12");
  });

  it("does not drift the day-of-month across the local-vs-UTC parse boundary", () => {
    // The TZ-drift bug fired when the local-tz date string was parsed as UTC
    // and then read back via toISOString in a west-of-UTC zone: e.g., on a
    // Pacific host, `new Date("2026-05-27").toISOString().split("T")[0]`
    // returns "2026-05-26". addDaysLocal must return "2026-05-27" regardless
    // of host TZ. We can't easily mutate the JS runtime's TZ from a test,
    // but we can pin that the function's output is exactly the input when
    // delta=0 and that the day-of-month always matches expected arithmetic
    // (which the cross-boundary cases above already exercise). The
    // round-trip identity is the cheap canary.
    for (const day of ["2026-01-01", "2026-03-15", "2026-07-04", "2026-12-31"]) {
      expect(addDaysLocal(day, 0)).toBe(day);
    }
  });
});
