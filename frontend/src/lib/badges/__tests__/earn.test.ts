// Validated core for the badge earn logic (badges v1). Node project.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { describe, expect, it } from "vitest";

import { computeEarnedBadges, type BadgeMetrics } from "../earn";

/** A metrics snapshot with nothing earned, to override field by field. */
const EMPTY: BadgeMetrics = {
  experiments: 0,
  isFounding: false,
  tenureDays: 0,
  hasExternalShare: false,
  hasCompanionSite: false,
};

describe("computeEarnedBadges", () => {
  it("earns nothing for an empty snapshot", () => {
    expect(computeEarnedBadges(EMPTY)).toEqual([]);
  });

  it("earns founding-lab when founding, and locks it otherwise", () => {
    expect(computeEarnedBadges({ ...EMPTY, isFounding: true })).toContain(
      "founding-lab",
    );
    expect(computeEarnedBadges({ ...EMPTY, isFounding: false })).not.toContain(
      "founding-lab",
    );
  });

  it("locks the 100-experiment badge at 99", () => {
    expect(computeEarnedBadges({ ...EMPTY, experiments: 99 })).not.toContain(
      "experiments-100",
    );
  });

  it("earns the 100-experiment badge at exactly 100", () => {
    const earned = computeEarnedBadges({ ...EMPTY, experiments: 100 });
    expect(earned).toContain("experiments-100");
    expect(earned).not.toContain("experiments-1000");
  });

  it("earns both count badges at 1000", () => {
    const earned = computeEarnedBadges({ ...EMPTY, experiments: 1000 });
    expect(earned).toContain("experiments-100");
    expect(earned).toContain("experiments-1000");
  });

  it("earns first-share only when the external-share flag is set", () => {
    expect(
      computeEarnedBadges({ ...EMPTY, hasExternalShare: true }),
    ).toContain("first-share");
    expect(computeEarnedBadges(EMPTY)).not.toContain("first-share");
  });

  it("earns companion-site only when the companion-site flag is set", () => {
    expect(
      computeEarnedBadges({ ...EMPTY, hasCompanionSite: true }),
    ).toContain("companion-site");
    expect(computeEarnedBadges(EMPTY)).not.toContain("companion-site");
  });

  it("locks one-year at 364 days and earns it at exactly 365", () => {
    expect(computeEarnedBadges({ ...EMPTY, tenureDays: 364 })).not.toContain(
      "one-year",
    );
    expect(computeEarnedBadges({ ...EMPTY, tenureDays: 365 })).toContain(
      "one-year",
    );
  });

  it("returns earned ids in catalog order", () => {
    const earned = computeEarnedBadges({
      experiments: 1000,
      isFounding: true,
      tenureDays: 365,
      hasExternalShare: true,
      hasCompanionSite: true,
    });
    expect(earned).toEqual([
      "founding-lab",
      "experiments-100",
      "experiments-1000",
      "first-share",
      "companion-site",
      "one-year",
    ]);
  });

  it("locks course-complete with no award, even with all metrics maxed", () => {
    const earned = computeEarnedBadges({
      experiments: 1000,
      isFounding: true,
      tenureDays: 365,
      hasExternalShare: true,
      hasCompanionSite: true,
    });
    expect(earned).not.toContain("course-complete");
  });

  it("earns an awarded badge only when granted, ignoring unknown grants", () => {
    expect(computeEarnedBadges(EMPTY, ["course-complete"])).toContain(
      "course-complete",
    );
    expect(computeEarnedBadges(EMPTY, ["not-a-badge"])).not.toContain(
      "course-complete",
    );
    expect(computeEarnedBadges(EMPTY)).not.toContain("course-complete");
  });

  it("does not let an award unlock a metric badge", () => {
    // Granting a metric badge's id must not bypass its metric criterion.
    expect(computeEarnedBadges(EMPTY, ["experiments-100"])).not.toContain(
      "experiments-100",
    );
  });
});
