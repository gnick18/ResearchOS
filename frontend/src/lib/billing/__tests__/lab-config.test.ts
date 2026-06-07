// Metered-storage billing, pure lab-billing helper tests (chunk 3).

import { describe, expect, it } from "vitest";

import {
  FREE_ALLOWANCE_BYTES,
  labBillableBytes,
  labFreePoolBytes,
  labMonthlyChargeCents,
  labRawChargeCents,
  labReportableGb,
} from "../config";

const GB = 1024 ** 3;

describe("labFreePoolBytes", () => {
  it("pools 1 GB per sponsored owner (PI counted)", () => {
    expect(labFreePoolBytes(1)).toBe(1 * GB); // a lone PI
    expect(labFreePoolBytes(4)).toBe(4 * GB); // PI + 3 members
  });
  it("never drops below one tier, even for a degenerate count", () => {
    expect(labFreePoolBytes(0)).toBe(FREE_ALLOWANCE_BYTES);
  });
});

describe("labBillableBytes", () => {
  it("subtracts the pooled free tier from the aggregate", () => {
    // PI + 2 members = 3 GB pool. 10 GB aggregate => 7 GB billable.
    expect(labBillableBytes(10 * GB, 3)).toBe(7 * GB);
  });
  it("is zero when the lab sits inside its pooled free tier", () => {
    expect(labBillableBytes(3 * GB, 4)).toBe(0);
  });
});

describe("labRawChargeCents", () => {
  it("charges $0.30 per GB-month above the pool", () => {
    // pool = 3 GB, aggregate 13 GB => 10 GB billable => $3.00.
    expect(labRawChargeCents(13 * GB, 3)).toBe(300);
  });
});

describe("labMonthlyChargeCents", () => {
  it("waives a sub-minimum aggregate charge to zero", () => {
    // pool 3 GB, aggregate 4 GB => 1 GB => $0.30, under the ~$2 minimum.
    expect(labRawChargeCents(4 * GB, 3)).toBe(30);
    expect(labMonthlyChargeCents(4 * GB, 3)).toBe(0);
  });
  it("bills once the aggregate clears the minimum", () => {
    expect(labMonthlyChargeCents(13 * GB, 3)).toBe(300);
  });
});

describe("labReportableGb", () => {
  it("reports zero when waived, the billable GB otherwise", () => {
    expect(labReportableGb(4 * GB, 3)).toBe(0);
    expect(labReportableGb(13 * GB, 3)).toBe(10);
  });
  it("a small or light lab pays nothing", () => {
    // 5 members + PI = 6 GB pool, only 2 GB stored.
    expect(labReportableGb(2 * GB, 6)).toBe(0);
  });
});
