// Model A off-session charge run tests (engine step 4).
//
// Injects a fake charger and a mock Neon template so we assert the run logic
// (charge over-threshold owners, draw the balance down on success, resilience to
// declines/throws) without hitting Stripe or a live DB.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetCloudSchemaCacheForTests, type Sql } from "../ledger-db";
import { runChargeRun, type OffSessionCharger } from "../charge";
import { getCloudBalance, type ChargeableOwner } from "../ledger";

function makeMockSql() {
  const balances = new Map<string, { accrued_cents: number }>();
  const seenIdem = new Set<string>();
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (/CREATE TABLE|CREATE UNIQUE INDEX/i.test(text)) return Promise.resolve([]);
    // charge ledger insert, idempotent on the charge id.
    if (/INSERT INTO cloud_usage_ledger/i.test(text) && /'charge'/i.test(text)) {
      const idem = values[2] as string;
      if (seenIdem.has(idem)) return Promise.resolve([]);
      seenIdem.add(idem);
      return Promise.resolve([{ id: seenIdem.size }]);
    }
    // charge balance upsert (has last_charged_at).
    if (/INSERT INTO cloud_balance/i.test(text) && /last_charged_at/i.test(text)) {
      const owner = values[0] as string;
      const amount = values[2] as number;
      const existing = balances.get(owner);
      if (existing) existing.accrued_cents -= amount;
      else balances.set(owner, { accrued_cents: values[1] as number });
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

function owner(ownerKey: string, accruedCents: number): ChargeableOwner {
  return { ownerKey, accruedCents, customerId: `cus_${ownerKey}`, paymentMethodId: `pm_${ownerKey}` };
}

describe("runChargeRun", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("charges each owner and draws their balance to zero on success", async () => {
    const { sql, balances } = makeMockSql();
    balances.set("a", { accrued_cents: 800 });
    balances.set("b", { accrued_cents: 1200 });
    const charger: OffSessionCharger = vi.fn(async ({ ownerKey }) => ({ ok: true, chargeId: `pi_${ownerKey}` }));

    const summary = await runChargeRun(charger, { owners: [owner("a", 800), owner("b", 1200)], sql });

    expect(summary).toEqual({ attempted: 2, succeeded: 2, failed: 2 - 2, totalChargedCents: 2000 });
    expect(charger).toHaveBeenCalledTimes(2);
    expect(await getCloudBalance("a", sql)).toBe(0);
    expect(await getCloudBalance("b", sql)).toBe(0);
  });

  it("a decline leaves that balance accrued and is counted as failed", async () => {
    const { sql, balances } = makeMockSql();
    balances.set("a", { accrued_cents: 800 });
    balances.set("b", { accrued_cents: 1200 });
    const charger: OffSessionCharger = async ({ ownerKey }) =>
      ownerKey === "b" ? { ok: false, error: "card_declined" } : { ok: true, chargeId: `pi_${ownerKey}` };

    const summary = await runChargeRun(charger, { owners: [owner("a", 800), owner("b", 1200)], sql });

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.totalChargedCents).toBe(800);
    expect(await getCloudBalance("a", sql)).toBe(0);
    expect(await getCloudBalance("b", sql)).toBe(1200); // untouched, retried next run
  });

  it("a charger that throws is counted, not fatal to the run", async () => {
    const { sql, balances } = makeMockSql();
    balances.set("a", { accrued_cents: 800 });
    balances.set("b", { accrued_cents: 900 });
    const charger: OffSessionCharger = async ({ ownerKey }) => {
      if (ownerKey === "a") throw new Error("network");
      return { ok: true, chargeId: `pi_${ownerKey}` };
    };

    const summary = await runChargeRun(charger, { owners: [owner("a", 800), owner("b", 900)], sql });
    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(await getCloudBalance("b", sql)).toBe(0);
  });

  it("recording is idempotent if the same charge id is seen twice", async () => {
    const { sql, balances } = makeMockSql();
    balances.set("a", { accrued_cents: 800 });
    const charger: OffSessionCharger = async () => ({ ok: true, chargeId: "pi_fixed" });

    await runChargeRun(charger, { owners: [owner("a", 800)], sql });
    // Same charge id again (e.g. webhook replays it) must not double-draw.
    await runChargeRun(charger, { owners: [owner("a", 0)], sql });
    expect(await getCloudBalance("a", sql)).toBe(0);
  });
});
