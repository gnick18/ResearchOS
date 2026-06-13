// Tests for the dept plan-builder rate model (deriveDeptRate).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { deriveDeptRate, DEPT_RATE, centsToUsd } from "../plan";

describe("deriveDeptRate", () => {
  it("rate = storage cost recovery + per-lab sustaining", () => {
    const r = deriveDeptRate({ labs: 5, storageTb: 2 });
    expect(r.storageCents).toBe(2 * DEPT_RATE.storagePerTbCents);
    expect(r.sustainCents).toBe(5 * DEPT_RATE.perLabSustainCents);
    expect(r.totalCents).toBe(r.storageCents + r.sustainCents);
  });

  it("scales with both inputs independently", () => {
    const a = deriveDeptRate({ labs: 1, storageTb: 1 });
    const moreLabs = deriveDeptRate({ labs: 3, storageTb: 1 });
    const moreStorage = deriveDeptRate({ labs: 1, storageTb: 4 });
    expect(moreLabs.sustainCents).toBe(3 * a.sustainCents);
    expect(moreStorage.storageCents).toBe(4 * a.storageCents);
    expect(moreLabs.storageCents).toBe(a.storageCents); // storage unchanged
  });

  it("clamps negatives + floors fractional labs to zero-safe values", () => {
    const r = deriveDeptRate({ labs: -2, storageTb: -5 });
    expect(r.totalCents).toBe(0);
    const f = deriveDeptRate({ labs: 2.9, storageTb: 0 });
    expect(f.sustainCents).toBe(2 * DEPT_RATE.perLabSustainCents); // floored to 2
  });

  it("formats cents to whole-dollar USD", () => {
    expect(centsToUsd(42000)).toBe("$420");
    expect(centsToUsd(0)).toBe("$0");
    expect(centsToUsd(123456)).toBe("$1,235");
  });
});
