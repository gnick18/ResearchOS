// Tests for the institution plan-builder rate model (deriveInstitutionRate).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { deriveInstitutionRate, INSTITUTION_RATE, centsToUsd } from "../plan";

describe("deriveInstitutionRate", () => {
  it("rate = storage cost recovery + per-dept sustaining", () => {
    const r = deriveInstitutionRate({ depts: 4, storageTb: 3 });
    expect(r.storageCents).toBe(3 * INSTITUTION_RATE.storagePerTbCents);
    expect(r.sustainCents).toBe(4 * INSTITUTION_RATE.perDeptSustainCents);
    expect(r.totalCents).toBe(r.storageCents + r.sustainCents);
  });

  it("scales with both inputs independently", () => {
    const a = deriveInstitutionRate({ depts: 1, storageTb: 1 });
    const moreDepts = deriveInstitutionRate({ depts: 3, storageTb: 1 });
    const moreStorage = deriveInstitutionRate({ depts: 1, storageTb: 4 });
    expect(moreDepts.sustainCents).toBe(3 * a.sustainCents);
    expect(moreStorage.storageCents).toBe(4 * a.storageCents);
    expect(moreDepts.storageCents).toBe(a.storageCents); // storage unchanged
  });

  it("clamps negatives + floors fractional depts to zero-safe values", () => {
    const r = deriveInstitutionRate({ depts: -2, storageTb: -5 });
    expect(r.totalCents).toBe(0);
    const f = deriveInstitutionRate({ depts: 2.9, storageTb: 0 });
    expect(f.sustainCents).toBe(2 * INSTITUTION_RATE.perDeptSustainCents); // floored to 2
  });

  it("formats cents to whole-dollar USD", () => {
    expect(centsToUsd(42000)).toBe("$420");
    expect(centsToUsd(0)).toBe("$0");
    expect(centsToUsd(123456)).toBe("$1,235");
  });
});
