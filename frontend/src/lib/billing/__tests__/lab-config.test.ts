// Billing config pure-helper tests (ops cost).

import { describe, expect, it } from "vitest";

import { estimatedOpsCostCents } from "../config";

describe("estimatedOpsCostCents", () => {
  it("is zero for no writes", () => {
    expect(estimatedOpsCostCents(0)).toBe(0);
  });
  it("prices a million writes at the rows+requests rate ($1.15)", () => {
    // 1.00/M rows + 0.15/M requests = $1.15 per million writes.
    expect(estimatedOpsCostCents(1_000_000)).toBe(115);
  });
  it("scales linearly and surfaces a chatty owner", () => {
    // 20M writes/month (a very heavy editor) ~ $23, far above their ~$0 storage.
    expect(estimatedOpsCostCents(20_000_000)).toBe(2300);
  });
});
