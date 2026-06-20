// Validated core for the badge metrics adapter (badges phase 2). Node project.
//
// Covers the PURE leaf (metrics-pure.ts) only, so no folder / DOM / local-api is
// pulled in. The I/O loader (loadBadgeMetrics) is thin glue over these.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { describe, expect, it } from "vitest";

import {
  clampCount,
  computeBadgeMetricsFromCounts,
  earliestCreatedAt,
  tenureDaysSince,
} from "../metrics-pure";

describe("clampCount", () => {
  it("clamps NaN, negatives, and floats to a non-negative integer", () => {
    expect(clampCount(Number.NaN)).toBe(0);
    expect(clampCount(-5)).toBe(0);
    expect(clampCount(0)).toBe(0);
    expect(clampCount(3.9)).toBe(3);
    expect(clampCount(1000)).toBe(1000);
  });

  it("treats infinity as 0 rather than a runaway count", () => {
    expect(clampCount(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("computeBadgeMetricsFromCounts", () => {
  it("normalizes counts and defaults the not-yet-wired flags to false", () => {
    expect(computeBadgeMetricsFromCounts({ experiments: 247.6, tenureDays: 120 })).toEqual({
      experiments: 247,
      tenureDays: 120,
      hasExternalShare: false,
      isFounding: false,
      hasCompanionSite: false,
    });
  });

  it("passes through the optional flags when supplied", () => {
    expect(
      computeBadgeMetricsFromCounts({
        experiments: 5,
        tenureDays: 1,
        hasExternalShare: true,
        isFounding: true,
        hasCompanionSite: true,
      }),
    ).toEqual({
      experiments: 5,
      tenureDays: 1,
      hasExternalShare: true,
      isFounding: true,
      hasCompanionSite: true,
    });
  });
});

describe("tenureDaysSince", () => {
  const NOW = Date.parse("2026-06-19T00:00:00.000Z");

  it("returns whole days since the timestamp", () => {
    expect(tenureDaysSince("2026-06-09T00:00:00.000Z", NOW)).toBe(10);
  });

  it("returns 0 for a missing, unparseable, or future timestamp", () => {
    expect(tenureDaysSince(null, NOW)).toBe(0);
    expect(tenureDaysSince(undefined, NOW)).toBe(0);
    expect(tenureDaysSince("not a date", NOW)).toBe(0);
    expect(tenureDaysSince("2026-07-01T00:00:00.000Z", NOW)).toBe(0);
  });
});

describe("earliestCreatedAt", () => {
  it("returns the earliest valid created_at across members", () => {
    const md = {
      kritika: { created_at: "2026-03-01T00:00:00.000Z" },
      grant: { created_at: "2026-01-15T00:00:00.000Z" },
      emile: { created_at: "2026-05-20T00:00:00.000Z" },
    };
    expect(earliestCreatedAt(md)).toBe("2026-01-15T00:00:00.000Z");
  });

  it("skips entries with a missing or unparseable created_at", () => {
    const md = {
      a: {},
      b: { created_at: "garbage" },
      c: { created_at: "2026-02-02T00:00:00.000Z" },
    };
    expect(earliestCreatedAt(md)).toBe("2026-02-02T00:00:00.000Z");
  });

  it("returns null when no member has a usable date", () => {
    expect(earliestCreatedAt({ a: {}, b: { created_at: "nope" } })).toBeNull();
  });
});
