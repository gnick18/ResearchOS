// Tests for the dept plan-builder rate model (deriveDeptRate).
//
// The rate now wraps computeCostRecovery (the shared /pricing model), so these
// pin that it agrees with that model and that the sustaining contribution scales
// with active labs (adaptable to department size), not a flat per-entity fee.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { deriveDeptRate, DEPT_RATE, centsToUsd } from "../plan";
import { FREE_GB_PER_LAB, SUSTAIN_PER_LAB } from "@/lib/pricing/assumptions";
import { computeCostRecovery } from "@/lib/pricing/cost-math";

describe("dept rate derives from the shared cost-recovery model", () => {
  it("per-lab sustaining is SUSTAIN_PER_LAB dollars in cents", () => {
    expect(DEPT_RATE.perLabSustainCents).toBe(SUSTAIN_PER_LAB * 100);
  });

  it("matches computeCostRecovery with one free pool per active lab", () => {
    const activeLabs = 5;
    const storageGB = 800;
    const ref = computeCostRecovery({
      storageGB,
      freeGB: activeLabs * FREE_GB_PER_LAB,
      activeLabs,
    });
    const r = deriveDeptRate({ activeLabs, storageGB });
    expect(r.recoveryCents).toBe(Math.round(ref.recovery * 100));
    expect(r.sustainCents).toBe(Math.round(ref.sustain * 100));
    expect(r.totalCents).toBe(Math.round(ref.rate * 100));
  });
});

describe("deriveDeptRate", () => {
  it("sustaining scales with active labs (size-adaptable, not flat)", () => {
    const small = deriveDeptRate({ activeLabs: 2, storageGB: 100 });
    const big = deriveDeptRate({ activeLabs: 10, storageGB: 100 });
    expect(big.sustainCents).toBe(5 * small.sustainCents);
  });

  it("more storage raises only the recovery side", () => {
    const a = deriveDeptRate({ activeLabs: 3, storageGB: 200 });
    const b = deriveDeptRate({ activeLabs: 3, storageGB: 2000 });
    expect(b.recoveryCents).toBeGreaterThan(a.recoveryCents);
    expect(b.sustainCents).toBe(a.sustainCents);
  });

  it("storage within the free pool bills no recovery", () => {
    const r = deriveDeptRate({ activeLabs: 4, storageGB: FREE_GB_PER_LAB * 4 - 1 });
    expect(r.recoveryCents).toBe(0);
    expect(r.sustainCents).toBe(4 * DEPT_RATE.perLabSustainCents);
  });

  it("clamps negatives + floors fractional labs to zero-safe values", () => {
    const r = deriveDeptRate({ activeLabs: -2, storageGB: -5 });
    expect(r.totalCents).toBe(0);
    const f = deriveDeptRate({ activeLabs: 2.9, storageGB: 0 });
    expect(f.sustainCents).toBe(2 * DEPT_RATE.perLabSustainCents); // floored to 2
  });

  it("international adds a processing fee on top, domestic has none", () => {
    const dom = deriveDeptRate({ activeLabs: 5, storageGB: 800 });
    const intl = deriveDeptRate({ activeLabs: 5, storageGB: 800, international: true });
    expect(dom.intlFeeCents).toBe(0);
    expect(intl.intlFeeCents).toBeGreaterThan(0);
    expect(intl.recoveryCents).toBe(dom.recoveryCents);
    expect(intl.sustainCents).toBe(dom.sustainCents);
    expect(intl.totalCents).toBeGreaterThan(dom.totalCents);
    expect(Math.abs(intl.totalCents - (dom.totalCents + intl.intlFeeCents))).toBeLessThanOrEqual(1);
  });

  it("formats cents to whole-dollar USD", () => {
    expect(centsToUsd(42000)).toBe("$420");
    expect(centsToUsd(0)).toBe("$0");
    expect(centsToUsd(123456)).toBe("$1,235");
  });
});
