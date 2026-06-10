// currentWritePeriod: the YYYY-MM (UTC) month bucket the activity tally keys by.
// Both the report endpoint and the owner-state check call it, so they must agree
// on the bucket and roll over together at a UTC month boundary.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it } from "vitest";

import { currentWritePeriod } from "../period";

describe("currentWritePeriod", () => {
  it("formats YYYY-MM in UTC with a zero-padded month", () => {
    expect(currentWritePeriod(new Date("2026-06-09T12:00:00Z"))).toBe("2026-06");
    expect(currentWritePeriod(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    expect(currentWritePeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  it("uses UTC, so a late-UTC instant does not slip to the next month", () => {
    // 2026-06-30T23:30Z is still June in UTC regardless of local zone.
    expect(currentWritePeriod(new Date("2026-06-30T23:30:00Z"))).toBe("2026-06");
  });
});
