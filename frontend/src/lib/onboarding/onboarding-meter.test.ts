import { describe, it, expect } from "vitest";
import {
  newMeter,
  spend,
  remaining,
  isExhausted,
  pctUsed,
  canAfford,
  DEFAULT_ONBOARDING_CAP,
} from "./onboarding-meter";

describe("onboarding-meter", () => {
  it("starts empty at the default cap", () => {
    const m = newMeter();
    expect(m.used).toBe(0);
    expect(m.cap).toBe(DEFAULT_ONBOARDING_CAP);
    expect(remaining(m)).toBe(DEFAULT_ONBOARDING_CAP);
    expect(isExhausted(m)).toBe(false);
  });

  it("spend accrues and clamps at the cap", () => {
    let m = newMeter(1000);
    m = spend(m, 400);
    expect(m.used).toBe(400);
    expect(remaining(m)).toBe(600);
    m = spend(m, 9999);
    expect(m.used).toBe(1000);
    expect(isExhausted(m)).toBe(true);
    expect(remaining(m)).toBe(0);
  });

  it("ignores negative spend", () => {
    let m = newMeter(1000);
    m = spend(m, -50);
    expect(m.used).toBe(0);
  });

  it("pctUsed maps to 0..100", () => {
    const m = spend(newMeter(1000), 250);
    expect(pctUsed(m)).toBe(25);
    expect(pctUsed(newMeter(0))).toBe(100);
  });

  it("canAfford gates a live step against the remaining budget", () => {
    const m = spend(newMeter(1000), 900);
    expect(canAfford(m, 50)).toBe(true);
    expect(canAfford(m, 200)).toBe(false);
  });
});
