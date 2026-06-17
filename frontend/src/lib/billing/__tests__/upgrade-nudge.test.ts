import { describe, expect, it } from "vitest";

import {
  shouldShowNudge,
  NUDGE_COOLDOWN_DAYS,
} from "../upgrade-nudge";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

describe("shouldShowNudge (gentle upgrade nudge cooldown)", () => {
  it("shows when there is no prior record", () => {
    expect(shouldShowNudge(NOW, null)).toBe(true);
  });

  it("does not show inside the cooldown window", () => {
    const justShown = { lastShownMs: NOW - 1 * DAY };
    expect(shouldShowNudge(NOW, justShown)).toBe(false);
    const almost = { lastShownMs: NOW - (NUDGE_COOLDOWN_DAYS - 1) * DAY };
    expect(shouldShowNudge(NOW, almost)).toBe(false);
  });

  it("shows again once the cooldown has elapsed", () => {
    const exactly = { lastShownMs: NOW - NUDGE_COOLDOWN_DAYS * DAY };
    expect(shouldShowNudge(NOW, exactly)).toBe(true);
    const wellPast = { lastShownMs: NOW - 60 * DAY };
    expect(shouldShowNudge(NOW, wellPast)).toBe(true);
  });

  it("honors a custom cooldown", () => {
    const rec = { lastShownMs: NOW - 5 * DAY };
    expect(shouldShowNudge(NOW, rec, 3)).toBe(true);
    expect(shouldShowNudge(NOW, rec, 10)).toBe(false);
  });

  it("the default cooldown is a few weeks (rare, not nagging)", () => {
    expect(NUDGE_COOLDOWN_DAYS).toBe(21);
  });
});
