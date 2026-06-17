// Model A cloud ledger logic tests (Step 3).
//
// No live DATABASE_URL. We inject a mock of the Neon tagged-template that keeps a
// tiny in-memory cloud_balance + cloud_usage_ledger and answers the query shapes
// the ledger uses, so we assert the LOGIC (accrue once per period, draw down on
// charge, idempotency) without a database. Same approach as ai-ledger.test.ts.

import { beforeEach, describe, expect, it } from "vitest";

import { __resetCloudSchemaCacheForTests, type Sql } from "../ledger-db";
import {
  accruePeriodCharge,
  accrualIdemKey,
  getCloudBalance,
  recordCharge,
} from "../ledger";
import { MODEL_A_PLANS, periodCharge } from "../pricing";

interface LedgerRow {
  id: number;
  owner_key: string;
  kind: string;
  cents_delta: number;
  period: string | null;
  idem_key: string | null;
}

function makeMockSql() {
  const balances = new Map<string, { accrued_cents: number }>();
  const ledger: LedgerRow[] = [];
  let nextId = 1;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");

    if (/CREATE TABLE|CREATE UNIQUE INDEX/i.test(text)) {
      return Promise.resolve([]);
    }

    // accrual ledger insert, idempotent on idem_key.
    if (/INSERT INTO cloud_usage_ledger/i.test(text) && /'accrual'/i.test(text)) {
      const owner = values[0] as string;
      const cents = values[1] as number;
      const period = values[2] as string;
      const idem = values[7] as string;
      if (ledger.some((r) => r.idem_key === idem)) return Promise.resolve([]);
      const id = nextId++;
      ledger.push({ id, owner_key: owner, kind: "accrual", cents_delta: cents, period, idem_key: idem });
      return Promise.resolve([{ id }]);
    }

    // charge ledger insert, idempotent on the stripe event id.
    if (/INSERT INTO cloud_usage_ledger/i.test(text) && /'charge'/i.test(text)) {
      const owner = values[0] as string;
      const cents = values[1] as number;
      const idem = values[2] as string;
      if (ledger.some((r) => r.idem_key === idem)) return Promise.resolve([]);
      const id = nextId++;
      ledger.push({ id, owner_key: owner, kind: "charge", cents_delta: cents, period: null, idem_key: idem });
      return Promise.resolve([{ id }]);
    }

    // charge balance upsert (distinguished by last_charged_at).
    if (/INSERT INTO cloud_balance/i.test(text) && /last_charged_at/i.test(text)) {
      const owner = values[0] as string;
      const amount = values[2] as number; // the abs cents subtracted in DO UPDATE
      const existing = balances.get(owner);
      if (existing) existing.accrued_cents -= amount;
      else balances.set(owner, { accrued_cents: values[1] as number });
      return Promise.resolve([{ accrued_cents: balances.get(owner)!.accrued_cents }]);
    }

    // accrual balance upsert.
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

const usage = { writes: 200_000, storageBytes: 4e9, hostedBytes: 0 };

describe("cloud ledger accrual", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("accrues a period charge onto the balance", async () => {
    const { sql, ledger } = makeMockSql();
    const charge = periodCharge(MODEL_A_PLANS.solo, usage);
    const bal = await accruePeriodCharge("payer-a", "2026-06", charge, sql);
    expect(bal.accrued).toBe(true);
    expect(bal.balanceCents).toBe(charge.totalCents);
    expect(ledger.filter((r) => r.kind === "accrual")).toHaveLength(1);
  });

  it("is idempotent per period (a re-run accrues once)", async () => {
    const { sql, ledger } = makeMockSql();
    const charge = periodCharge(MODEL_A_PLANS.solo, usage);
    await accruePeriodCharge("payer-a", "2026-06", charge, sql);
    const second = await accruePeriodCharge("payer-a", "2026-06", charge, sql);
    expect(second.accrued).toBe(false);
    expect(second.balanceCents).toBe(charge.totalCents);
    expect(ledger.filter((r) => r.kind === "accrual")).toHaveLength(1);
  });

  it("sums across distinct periods", async () => {
    const { sql } = makeMockSql();
    const c = periodCharge(MODEL_A_PLANS.solo, usage);
    await accruePeriodCharge("payer-a", "2026-06", c, sql);
    const bal = await accruePeriodCharge("payer-a", "2026-07", c, sql);
    expect(bal.balanceCents).toBe(c.totalCents * 2);
  });

  it("accrues per payer independently", async () => {
    const { sql } = makeMockSql();
    const c = periodCharge(MODEL_A_PLANS.lab, { ...usage, labCount: 2 });
    await accruePeriodCharge("payer-a", "2026-06", c, sql);
    const balB = await accruePeriodCharge("payer-b", "2026-06", c, sql);
    expect(balB.balanceCents).toBe(c.totalCents);
    expect(await getCloudBalance("payer-a", sql)).toBe(c.totalCents);
  });
});

describe("cloud ledger charge", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("draws the balance down by the charged amount", async () => {
    const { sql } = makeMockSql();
    const c = periodCharge(MODEL_A_PLANS.lab, { ...usage, labCount: 1 });
    await accruePeriodCharge("payer-a", "2026-06", c, sql);
    const after = await recordCharge("payer-a", c.totalCents, "evt_pay_1", sql);
    expect(after).toBe(0);
  });

  it("is idempotent on the stripe event id (a redelivery draws once)", async () => {
    const { sql, ledger } = makeMockSql();
    const c = periodCharge(MODEL_A_PLANS.lab, { ...usage, labCount: 1 });
    await accruePeriodCharge("payer-a", "2026-06", c, sql);
    await recordCharge("payer-a", 500, "evt_pay_1", sql);
    const after = await recordCharge("payer-a", 500, "evt_pay_1", sql);
    expect(after).toBe(c.totalCents - 500);
    expect(ledger.filter((r) => r.kind === "charge")).toHaveLength(1);
  });
});

describe("cloud ledger helpers", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("getCloudBalance is 0 for an unknown payer", async () => {
    const { sql } = makeMockSql();
    expect(await getCloudBalance("nobody", sql)).toBe(0);
  });

  it("accrualIdemKey is stable per owner+period", () => {
    expect(accrualIdemKey("o1", "2026-06")).toBe("accrue:o1:2026-06");
    expect(accrualIdemKey("o1", "2026-06")).toBe(accrualIdemKey("o1", "2026-06"));
    expect(accrualIdemKey("o1", "2026-07")).not.toBe(accrualIdemKey("o1", "2026-06"));
  });
});
