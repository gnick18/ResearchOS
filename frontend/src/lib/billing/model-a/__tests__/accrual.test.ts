// Model A accrual roll-up bridge tests (step 3b).
//
// Injects a fake pooled-usage reader and a mock Neon template, so we assert the
// bridge orchestration (read usage -> price -> accrue, free skip, idempotency)
// without a live collab DB or Neon.

import { beforeEach, describe, expect, it } from "vitest";

import { __resetCloudSchemaCacheForTests, type Sql } from "../ledger-db";
import { accrueOwnerForPeriod, type OwnerUsageReader } from "../accrual";
import { MODEL_A_PLANS, periodCharge } from "../pricing";

function makeMockSql() {
  const balances = new Map<string, { accrued_cents: number }>();
  const ledger: Array<{ kind: string; idem_key: string | null }> = [];
  let nextId = 1;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (/CREATE TABLE|CREATE UNIQUE INDEX/i.test(text)) return Promise.resolve([]);
    if (/INSERT INTO cloud_usage_ledger/i.test(text) && /'accrual'/i.test(text)) {
      const idem = values[7] as string;
      if (ledger.some((r) => r.idem_key === idem)) return Promise.resolve([]);
      ledger.push({ kind: "accrual", idem_key: idem });
      return Promise.resolve([{ id: nextId++ }]);
    }
    if (/INSERT INTO cloud_balance/i.test(text)) {
      const owner = values[0] as string;
      const add = values[1] as number;
      const existing = balances.get(owner);
      if (existing) existing.accrued_cents += add;
      else balances.set(owner, { accrued_cents: add });
      return Promise.resolve([{ accrued_cents: balances.get(owner)!.accrued_cents }]);
    }
    if (/SELECT accrued_cents FROM cloud_balance/i.test(text)) {
      const owner = values[0] as string;
      const row = balances.get(owner);
      return Promise.resolve(row ? [{ accrued_cents: row.accrued_cents }] : []);
    }
    throw new Error(`unmocked query: ${text}`);
  }) as unknown as Sql;

  return { sql, balances, ledger };
}

function fakeReader(writes: number, storageBytes: number, hostedBytes: number): OwnerUsageReader {
  return {
    poolWrites: () => Promise.resolve(writes),
    poolStorageBytes: () => Promise.resolve(storageBytes),
    hostedBytes: () => Promise.resolve(hostedBytes),
  };
}

describe("accrueOwnerForPeriod", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("reads pooled usage, prices it, and accrues the Model-A charge", async () => {
    const { sql } = makeMockSql();
    const reader = fakeReader(200_000, 4e9, 0);
    const res = await accrueOwnerForPeriod("payer-a", "solo", "2026-06", { reader, sql });

    const expected = periodCharge(MODEL_A_PLANS.solo, {
      writes: 200_000,
      storageBytes: 4e9,
      hostedBytes: 0,
    });
    expect(res.accrued).toBe(true);
    expect(res.chargedCents).toBe(expected.totalCents);
    expect(res.balanceCents).toBe(expected.totalCents);
  });

  it("passes lab count through for per-lab base fees", async () => {
    const { sql } = makeMockSql();
    const reader = fakeReader(500_000, 10e9, 2e9);
    const res = await accrueOwnerForPeriod("lab-a", "lab", "2026-06", {
      reader,
      sql,
      labCount: 3,
    });
    const expected = periodCharge(MODEL_A_PLANS.lab, {
      writes: 500_000,
      storageBytes: 10e9,
      hostedBytes: 2e9,
      labCount: 3,
    });
    expect(res.chargedCents).toBe(expected.totalCents);
    expect(expected.baseCents).toBe(12000); // 3 labs x $40
  });

  it("free payers accrue nothing, even with usage", async () => {
    const { sql, ledger } = makeMockSql();
    const reader = fakeReader(5_000_000, 50e9, 0);
    const res = await accrueOwnerForPeriod("free-a", "free", "2026-06", { reader, sql });
    expect(res.accrued).toBe(false);
    expect(res.chargedCents).toBe(0);
    expect(ledger).toHaveLength(0);
  });

  it("is idempotent per period (re-run accrues once)", async () => {
    const { sql, ledger } = makeMockSql();
    const reader = fakeReader(200_000, 4e9, 0);
    const first = await accrueOwnerForPeriod("payer-a", "solo", "2026-06", { reader, sql });
    const second = await accrueOwnerForPeriod("payer-a", "solo", "2026-06", { reader, sql });
    expect(second.balanceCents).toBe(first.balanceCents);
    expect(ledger.filter((r) => r.kind === "accrual")).toHaveLength(1);
  });
});
