// Tests for the institution plan-builder rate model (deriveInstitutionRate).
//
// The rate wraps the SAME computeCostRecovery as departments and /pricing, with
// the sustaining contribution scaling with the TOTAL active labs across all
// member departments. So a big department (more labs) contributes more than a
// small one, and there is no flat per-department fee.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { deriveInstitutionRate, INSTITUTION_RATE, centsToUsd } from "../plan";
import { deriveDeptRate } from "@/lib/dept/plan";
import { FREE_GB_PER_LAB, SUSTAIN_PER_LAB } from "@/lib/pricing/assumptions";
import { computeCostRecovery } from "@/lib/pricing/cost-math";

describe("institution rate derives from the shared cost-recovery model", () => {
  it("per-lab sustaining is SUSTAIN_PER_LAB dollars in cents", () => {
    expect(INSTITUTION_RATE.perLabSustainCents).toBe(SUSTAIN_PER_LAB * 100);
  });

  it("matches computeCostRecovery over total labs across departments", () => {
    const activeLabs = 48; // e.g. 6 depts x 8 labs
    const storageGB = 5000;
    const ref = computeCostRecovery({
      storageGB,
      freeGB: activeLabs * FREE_GB_PER_LAB,
      activeLabs,
    });
    const r = deriveInstitutionRate({ activeLabs, storageGB });
    expect(r.recoveryCents).toBe(Math.round(ref.recovery * 100));
    expect(r.sustainCents).toBe(Math.round(ref.sustain * 100));
    expect(r.totalCents).toBe(Math.round(ref.rate * 100));
  });

  it("is the same model as a department with the same labs + storage", () => {
    const inputs = { activeLabs: 12, storageGB: 1500 };
    expect(deriveInstitutionRate(inputs)).toEqual(deriveDeptRate(inputs));
  });
});

describe("deriveInstitutionRate", () => {
  it("sustaining scales with total labs (so it adapts to department size)", () => {
    const small = deriveInstitutionRate({ activeLabs: 10, storageGB: 100 });
    const big = deriveInstitutionRate({ activeLabs: 30, storageGB: 100 });
    expect(big.sustainCents).toBe(3 * small.sustainCents);
  });

  it("clamps negatives + floors fractional labs", () => {
    const r = deriveInstitutionRate({ activeLabs: -2, storageGB: -5 });
    expect(r.totalCents).toBe(0);
    const f = deriveInstitutionRate({ activeLabs: 2.9, storageGB: 0 });
    expect(f.sustainCents).toBe(2 * INSTITUTION_RATE.perLabSustainCents); // floored to 2
  });

  it("international adds a processing fee on top, domestic has none", () => {
    const dom = deriveInstitutionRate({ activeLabs: 40, storageGB: 4000 });
    const intl = deriveInstitutionRate({ activeLabs: 40, storageGB: 4000, international: true });
    expect(dom.intlFeeCents).toBe(0);
    expect(intl.intlFeeCents).toBeGreaterThan(0);
    expect(intl.totalCents).toBeGreaterThan(dom.totalCents);
  });

  it("formats cents to whole-dollar USD", () => {
    expect(centsToUsd(42000)).toBe("$420");
    expect(centsToUsd(0)).toBe("$0");
    expect(centsToUsd(123456)).toBe("$1,235");
  });
});
