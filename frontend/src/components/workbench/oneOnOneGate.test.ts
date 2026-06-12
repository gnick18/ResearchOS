import { describe, expect, it } from "vitest";
import { shouldShowOneOnOneTab } from "./oneOnOneGate";

// Check-ins revamp Phase 1 (checkins-revamp bot, 2026-06-11). Decision D1: the
// Check-ins tab is ALWAYS shown for every account, with the empty state living
// in the panel, so creating your first space is always reachable.
describe("shouldShowOneOnOneTab", () => {
  it("always shows, regardless of account type or space count", () => {
    expect(shouldShowOneOnOneTab("lab_head", 0)).toBe(true);
    expect(shouldShowOneOnOneTab("lab_head", 3)).toBe(true);
    expect(shouldShowOneOnOneTab("member", 0)).toBe(true);
    expect(shouldShowOneOnOneTab("member", 1)).toBe(true);
    expect(shouldShowOneOnOneTab("lab", 2)).toBe(true);
    expect(shouldShowOneOnOneTab("solo", 0)).toBe(true);
    expect(shouldShowOneOnOneTab(null, 0)).toBe(true);
    expect(shouldShowOneOnOneTab(undefined, 0)).toBe(true);
  });
});
