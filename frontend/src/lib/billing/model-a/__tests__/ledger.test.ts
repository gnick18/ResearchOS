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
  setCloudPaymentMethod,
  getCloudPaymentMethod,
  listChargeableOwners,
  setMonthlyCap,
  getMonthlyCap,
} from "../ledger";
import { ACCRUAL_CHARGE_THRESHOLD_CENTS } from "../pricing";
import { MODEL_A_PLANS, periodCharge } from "../pricing";

interface LedgerRow {
  id: number;
  owner_key: string;
  kind: string;
  cents_delta: number;
  period: string | null;
  idem_key: string | null;
}

interface BalanceRow {
  accrued_cents: number;
  stripe_customer_id?: string;
  stripe_payment_method_id?: string;
  monthly_cap_cents?: number | null;
}

function makeMockSql() {
  const balances = new Map<string, BalanceRow>();
  const ledger: LedgerRow[] = [];
  let nextId = 1;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");

    if (/CREATE TABLE|ALTER TABLE|CREATE UNIQUE INDEX/i.test(text)) {
      return Promise.resolve([]);
    }

    // setMonthlyCap: balance upsert carrying the cap.
    if (/INSERT INTO cloud_balance/i.test(text) && /monthly_cap_cents/i.test(text)) {
      const owner = values[0] as string;
      const existing = balances.get(owner) ?? { accrued_cents: 0 };
      existing.monthly_cap_cents = values[1] as number | null;
      balances.set(owner, existing);
      return Promise.resolve([]);
    }

    // getMonthlyCap read.
    if (/SELECT monthly_cap_cents FROM cloud_balance/i.test(text)) {
      const owner = values[0] as string;
      const row = balances.get(owner);
      return Promise.resolve(row ? [{ monthly_cap_cents: row.monthly_cap_cents ?? null }] : []);
    }

    // setCloudPaymentMethod: balance upsert carrying the card on file.
    if (/INSERT INTO cloud_balance/i.test(text) && /stripe_payment_method_id/i.test(text)) {
      const owner = values[0] as string;
      const existing = balances.get(owner) ?? { accrued_cents: 0 };
      existing.stripe_customer_id = values[1] as string;
      existing.stripe_payment_method_id = values[2] as string;
      balances.set(owner, existing);
      return Promise.resolve([]);
    }

    // getCloudPaymentMethod read.
    if (/SELECT stripe_customer_id, stripe_payment_method_id\s+FROM cloud_balance/i.test(text)) {
      const owner = values[0] as string;
      const row = balances.get(owner);
      return Promise.resolve(
        row
          ? [{
              stripe_customer_id: row.stripe_customer_id ?? null,
              stripe_payment_method_id: row.stripe_payment_method_id ?? null,
            }]
          : [],
      );
    }

    // listChargeableOwners.
    if (/FROM cloud_balance\s+WHERE accrued_cents >=/i.test(text)) {
      const threshold = values[0] as number;
      const out = [...balances.entries()]
        .filter(([, r]) => r.accrued_cents >= threshold && r.stripe_customer_id && r.stripe_payment_method_id)
        .map(([owner_key, r]) => ({
          owner_key,
          accrued_cents: r.accrued_cents,
          stripe_customer_id: r.stripe_customer_id,
          stripe_payment_method_id: r.stripe_payment_method_id,
        }));
      return Promise.resolve(out);
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

describe("cloud ledger card on file", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("saves and reads the card on file", async () => {
    const { sql } = makeMockSql();
    expect(await getCloudPaymentMethod("payer-a", sql)).toBeNull();
    await setCloudPaymentMethod("payer-a", "cus_1", "pm_1", sql);
    expect(await getCloudPaymentMethod("payer-a", sql)).toEqual({
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
  });

  it("setting the card preserves an existing accrued balance", async () => {
    const { sql } = makeMockSql();
    const c = periodCharge(MODEL_A_PLANS.solo, usage);
    await accruePeriodCharge("payer-a", "2026-06", c, sql);
    await setCloudPaymentMethod("payer-a", "cus_1", "pm_1", sql);
    expect(await getCloudBalance("payer-a", sql)).toBe(c.totalCents);
  });

  it("listChargeableOwners returns only owners over the threshold with a card", async () => {
    const { sql } = makeMockSql();
    const big = periodCharge(MODEL_A_PLANS.lab, { writes: 1_000_000, storageBytes: 50e9, hostedBytes: 0, labCount: 1 });
    expect(big.totalCents).toBeGreaterThanOrEqual(ACCRUAL_CHARGE_THRESHOLD_CENTS);

    // Over threshold + card on file -> chargeable.
    await accruePeriodCharge("rich", "2026-06", big, sql);
    await setCloudPaymentMethod("rich", "cus_r", "pm_r", sql);
    // Over threshold but NO card -> excluded.
    await accruePeriodCharge("nocard", "2026-06", big, sql);
    // Card but under threshold -> excluded.
    await setCloudPaymentMethod("small", "cus_s", "pm_s", sql);

    const chargeable = await listChargeableOwners(ACCRUAL_CHARGE_THRESHOLD_CENTS, sql);
    expect(chargeable.map((c) => c.ownerKey)).toEqual(["rich"]);
    expect(chargeable[0]).toMatchObject({ customerId: "cus_r", paymentMethodId: "pm_r" });
  });
});

describe("cloud ledger monthly cap", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("defaults to null (no cap)", async () => {
    const { sql } = makeMockSql();
    expect(await getMonthlyCap("payer-a", sql)).toBeNull();
  });

  it("sets and reads a cap, and can clear it back to null", async () => {
    const { sql } = makeMockSql();
    await setMonthlyCap("payer-a", 2000, sql);
    expect(await getMonthlyCap("payer-a", sql)).toBe(2000);
    await setMonthlyCap("payer-a", null, sql);
    expect(await getMonthlyCap("payer-a", sql)).toBeNull();
  });
});
