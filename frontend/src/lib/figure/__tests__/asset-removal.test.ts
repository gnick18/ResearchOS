import { describe, it, expect } from "vitest";

import {
  REMOVAL_RETENTION_DAYS,
  removalDaysLeft,
  type AssetRemoval,
} from "@/lib/figure/asset-library";
import { normalizeHandle } from "@/components/library/use-library-actor";

const DAY = 24 * 60 * 60 * 1000;

function removalExpiringIn(days: number, now: number): AssetRemoval {
  return {
    removedAt: new Date(now).toISOString(),
    removedBy: "@reviewer",
    reason: "test reason",
    autoExpiresAt: new Date(now + days * DAY).toISOString(),
  };
}

describe("normalizeHandle", () => {
  it("adds a single leading @ and trims", () => {
    expect(normalizeHandle("  grant ")).toBe("@grant");
    expect(normalizeHandle("@grant")).toBe("@grant");
  });
  it("does not double the @", () => {
    expect(normalizeHandle("@@x")).toBe("@@x"); // already starts with @, left as-is
    expect(normalizeHandle("x")).toBe("@x");
  });
  it("collapses inner whitespace and returns empty for blank", () => {
    expect(normalizeHandle("dr   nick")).toBe("@dr nick");
    expect(normalizeHandle("   ")).toBe("");
  });
});

describe("removalDaysLeft", () => {
  const now = Date.parse("2026-06-15T12:00:00.000Z");

  it("reports the full window right after removal", () => {
    expect(removalDaysLeft(removalExpiringIn(REMOVAL_RETENTION_DAYS, now), now)).toBe(
      REMOVAL_RETENTION_DAYS,
    );
  });
  it("counts down and never goes negative once expired", () => {
    expect(removalDaysLeft(removalExpiringIn(1, now), now)).toBe(1);
    expect(removalDaysLeft(removalExpiringIn(0, now), now)).toBe(0);
    expect(removalDaysLeft(removalExpiringIn(-5, now), now)).toBe(0);
  });
  it("rounds partial days up so 'N days left' is never misleadingly 0 while live", () => {
    expect(removalDaysLeft(removalExpiringIn(0.5, now), now)).toBe(1);
  });
});

describe("REMOVAL_RETENTION_DAYS", () => {
  it("is the 30-day window mirroring the app Trash", () => {
    expect(REMOVAL_RETENTION_DAYS).toBe(30);
  });
});
