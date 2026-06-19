// Model A accrual cron orchestration tests (engine step 3).
//
// Injects the subscription list, a fake usage reader, and a mock Neon template so
// we assert the run logic (free skipped, paid accrued, totals, error resilience)
// without a live DB.

import { beforeEach, describe, expect, it } from "vitest";

import { __resetCloudSchemaCacheForTests, type Sql } from "../ledger-db";
import { runAccrualForPeriod } from "../cron";
import { type OwnerUsageReader } from "../accrual";
import { MODEL_A_PLANS, periodCharge } from "../pricing";
import { priorPeriod, previousWritePeriod } from "../../period";

function makeMockSql() {
  const balances = new Map<string, { accrued_cents: number }>();
  const seen = new Set<string>();
  let nextId = 1;
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (/CREATE TABLE|ALTER TABLE|CREATE UNIQUE INDEX/i.test(text)) return Promise.resolve([]);
    if (/INSERT INTO cloud_usage_ledger/i.test(text) && /'accrual'/i.test(text)) {
      const idem = values[7] as string;
      if (seen.has(idem)) return Promise.resolve([]);
      seen.add(idem);
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
  return { sql, balances };
}

function fakeReader(writes: number, storageBytes: number, hostedBytes: number): OwnerUsageReader {
  return {
    poolWrites: () => Promise.resolve(writes),
    poolStorageBytes: () => Promise.resolve(storageBytes),
    hostedBytes: () => Promise.resolve(hostedBytes),
  };
}

// Default trial-state reader for the non-trial cases: every owner has no trial,
// so the cron behaves exactly as before the trial gate. Specific tests override it.
const noTrial = () => Promise.resolve({ trialEndsAt: null, hasCard: false });

describe("runAccrualForPeriod", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("accrues paid owners, skips free, and totals correctly", async () => {
    const { sql } = makeMockSql();
    const reader = fakeReader(200_000, 4e9, 0);
    const subs = [
      { ownerKey: "solo-a", planId: "plus" }, // legacy paid individual -> solo
      { ownerKey: "lab-a", planId: "lab_pro" }, // legacy paid lab -> lab
      { ownerKey: "free-a", planId: "free" }, // skipped
    ];
    const summary = await runAccrualForPeriod("2026-06", { subs, reader, sql, trialState: noTrial });

    const soloCents = periodCharge(MODEL_A_PLANS.solo, { writes: 200_000, storageBytes: 4e9, hostedBytes: 0 }).totalCents;
    const labCents = periodCharge(MODEL_A_PLANS.lab, { writes: 200_000, storageBytes: 4e9, hostedBytes: 0 }).totalCents;

    expect(summary.processed).toBe(3);
    expect(summary.accruedOwners).toBe(2);
    expect(summary.totalCents).toBe(soloCents + labCents);
    expect(summary.errors).toBe(0);
  });

  it("counts an owner whose accrual throws without aborting the run", async () => {
    const { sql } = makeMockSql();
    const throwingReader: OwnerUsageReader = {
      poolWrites: (owner) => (owner === "bad" ? Promise.reject(new Error("boom")) : Promise.resolve(100_000)),
      poolStorageBytes: () => Promise.resolve(1e9),
      hostedBytes: () => Promise.resolve(0),
    };
    const subs = [
      { ownerKey: "good", planId: "plus" },
      { ownerKey: "bad", planId: "plus" },
    ];
    const summary = await runAccrualForPeriod("2026-06", { subs, reader: throwingReader, sql, trialState: noTrial });
    expect(summary.accruedOwners).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it("pauses accrual for a lab whose trial ended with no card on file", async () => {
    const { sql } = makeMockSql();
    const reader = fakeReader(200_000, 4e9, 0);
    const now = new Date("2026-10-01T00:00:00.000Z");
    const subs = [
      { ownerKey: "trialing-lab", planId: "lab_pro" }, // trial open -> still accrues
      { ownerKey: "paused-lab", planId: "lab_pro" }, // trial over, no card -> paused
      { ownerKey: "paid-lab", planId: "lab_pro" }, // trial over, has card -> accrues
    ];
    const trialState = (k: string) => {
      if (k === "trialing-lab")
        return Promise.resolve({ trialEndsAt: "2026-12-01T00:00:00.000Z", hasCard: false });
      if (k === "paused-lab")
        return Promise.resolve({ trialEndsAt: "2026-09-01T00:00:00.000Z", hasCard: false });
      return Promise.resolve({ trialEndsAt: "2026-09-01T00:00:00.000Z", hasCard: true });
    };

    const summary = await runAccrualForPeriod("2026-09", { subs, reader, sql, now, trialState });

    expect(summary.processed).toBe(3);
    expect(summary.trialPaused).toBe(1); // only paused-lab is held
    expect(summary.accruedOwners).toBe(2); // trialing-lab + paid-lab still accrue
  });

  it("is idempotent across re-runs of the same period", async () => {
    const { sql } = makeMockSql();
    const reader = fakeReader(200_000, 4e9, 0);
    const subs = [{ ownerKey: "solo-a", planId: "plus" }];
    const first = await runAccrualForPeriod("2026-06", { subs, reader, sql, trialState: noTrial });
    const second = await runAccrualForPeriod("2026-06", { subs, reader, sql, trialState: noTrial });
    expect(first.accruedOwners).toBe(1);
    // Second run inserts no new ledger row, so nothing fresh is accrued.
    expect(second.accruedOwners).toBe(0);
  });
});

describe("period helpers", () => {
  it("priorPeriod handles month and year rollover", () => {
    expect(priorPeriod("2026-06")).toBe("2026-05");
    expect(priorPeriod("2026-01")).toBe("2025-12");
    expect(priorPeriod("2026-10")).toBe("2026-09");
  });

  it("previousWritePeriod is the month before now", () => {
    expect(previousWritePeriod(new Date(Date.UTC(2026, 0, 15)))).toBe("2025-12");
    expect(previousWritePeriod(new Date(Date.UTC(2026, 6, 1)))).toBe("2026-06");
  });
});
