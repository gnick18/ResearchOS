// Tests for the retention registry pure helpers (LAB_ARCHIVE_CONTINUITY.md 1a).

import { describe, it, expect } from "vitest";
import {
  disposalEligibleDate,
  retentionTargetLabel,
  targetHoldsBytes,
  DEFAULT_RETENTION_YEARS,
} from "../retention";

describe("disposalEligibleDate", () => {
  it("adds the retention period in years", () => {
    expect(disposalEligibleDate("2026-06-10T00:00:00Z", 7)).toBe("2033-06-10");
    expect(disposalEligibleDate("2026-06-10", DEFAULT_RETENTION_YEARS)).toBe(
      "2033-06-10",
    );
  });

  it("handles zero / negative years and bad dates", () => {
    expect(disposalEligibleDate("2026-06-10T00:00:00Z", 0)).toBe("2026-06-10");
    expect(disposalEligibleDate("2026-06-10T00:00:00Z", -5)).toBe("2026-06-10");
    expect(disposalEligibleDate("not-a-date", 7)).toBe("");
  });
});

describe("retention targets", () => {
  it("labels each target and flags which hold bytes", () => {
    expect(retentionTargetLabel("r2")).toContain("R2");
    expect(retentionTargetLabel("hard_drive")).toContain("hard drive");
    expect(retentionTargetLabel("institutional_drive")).toContain("Institutional");
    // Only R2 holds the actual bytes; the rest are attestations.
    expect(targetHoldsBytes("r2")).toBe(true);
    expect(targetHoldsBytes("hard_drive")).toBe(false);
    expect(targetHoldsBytes("institutional_drive")).toBe(false);
  });
});
