// Model A dispute + refund ledger logic tests (Grant 2026-06-19).
//
// No live DATABASE_URL. A mock Neon tagged-template keeps a tiny in-memory
// cloud_balance + cloud_usage_ledger and answers the query shapes the new
// creditBalance / getOwnerByCustomerId / setDisputed functions use, plus the
// existing accrue path used to set up a balance. We assert the LOGIC:
//   - a refund credits the balance back by the refund amount, idempotent on the id;
//   - a PARTIAL refund credits the refund amount, not the full charge;
//   - a dispute flags disputed_at and (via getLabTrialState) pauses accrual;
//   - a won dispute clears disputed_at (un-pause); a lost one leaves it set.
// Same in-memory approach as ledger.test.ts.

import { beforeEach, describe, expect, it } from "vitest";

import { __resetCloudSchemaCacheForTests, type Sql } from "../ledger-db";
import {
  accruePeriodCharge,
  creditBalance,
  getCloudBalance,
  getLabTrialState,
  getOwnerByCustomerId,
  setCloudPaymentMethod,
  setDisputed,
} from "../ledger";
import { labTrialDecision } from "../lab-trial";
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
  stripe_customer_id?: string | null;
  stripe_payment_method_id?: string | null;
  disputed_at?: string | null;
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

    // setDisputed: clear. The clear path's SQL sets disputed_at = NULL and carries
    // no now(); the set path uses now()/COALESCE. Distinguish on the SET clause.
    if (/INSERT INTO cloud_balance/i.test(text) && /disputed_at/i.test(text) && /SET disputed_at = NULL/i.test(text)) {
      const owner = values[0] as string;
      const existing = balances.get(owner) ?? { accrued_cents: 0 };
      existing.disputed_at = null;
      balances.set(owner, existing);
      return Promise.resolve([]);
    }

    // setDisputed: set (disputed_at now(), COALESCE preserves the first stamp).
    if (/INSERT INTO cloud_balance/i.test(text) && /disputed_at/i.test(text) && /now\(\)/i.test(text)) {
      const owner = values[0] as string;
      const existing = balances.get(owner) ?? { accrued_cents: 0 };
      existing.disputed_at = existing.disputed_at ?? new Date().toISOString();
      balances.set(owner, existing);
      return Promise.resolve([]);
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

    // getOwnerByCustomerId read.
    if (/SELECT owner_key FROM cloud_balance\s+WHERE stripe_customer_id =/i.test(text)) {
      const customer = values[0] as string;
      for (const [owner, r] of balances.entries()) {
        if (r.stripe_customer_id === customer) return Promise.resolve([{ owner_key: owner }]);
      }
      return Promise.resolve([]);
    }

    // getLabTrialState read (now includes disputed_at).
    if (/SELECT trial_ends_at, stripe_customer_id, stripe_payment_method_id, disputed_at/i.test(text)) {
      const owner = values[0] as string;
      const row = balances.get(owner);
      return Promise.resolve(
        row
          ? [{
              trial_ends_at: null,
              stripe_customer_id: row.stripe_customer_id ?? null,
              stripe_payment_method_id: row.stripe_payment_method_id ?? null,
              disputed_at: row.disputed_at ?? null,
            }]
          : [],
      );
    }

    // credit ledger insert, idempotent on idem_key.
    if (/INSERT INTO cloud_usage_ledger/i.test(text) && /'credit'/i.test(text)) {
      const owner = values[0] as string;
      const cents = values[1] as number;
      const reason = values[2] as string;
      const idem = values[3] as string;
      if (ledger.some((r) => r.idem_key === idem)) return Promise.resolve([]);
      const id = nextId++;
      ledger.push({ id, owner_key: owner, kind: "credit", cents_delta: cents, period: reason, idem_key: idem });
      return Promise.resolve([{ id }]);
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

    // accrual / credit balance upsert (the bare cents add, no last_charged_at, no card).
    if (/INSERT INTO cloud_balance/i.test(text) && /accrued_cents = cloud_balance.accrued_cents \+/i.test(text)) {
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

describe("refund credits the balance", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("credits the balance back by the refund amount", async () => {
    const { sql } = makeMockSql();
    const c = periodCharge(MODEL_A_PLANS.solo, usage);
    await accruePeriodCharge("payer-a", "2026-06", c, sql);
    const before = await getCloudBalance("payer-a", sql);
    const after = await creditBalance("payer-a", 500, "refund ch_1", "refund:ch_1", sql);
    expect(after).toBe(before + 500);
  });

  it("is idempotent on the refund idem key (a redelivery credits once)", async () => {
    const { sql, ledger } = makeMockSql();
    const c = periodCharge(MODEL_A_PLANS.solo, usage);
    await accruePeriodCharge("payer-a", "2026-06", c, sql);
    const first = await creditBalance("payer-a", 500, "refund ch_1", "refund:ch_1", sql);
    const second = await creditBalance("payer-a", 500, "refund ch_1", "refund:ch_1", sql);
    expect(second).toBe(first);
    expect(ledger.filter((r) => r.kind === "credit")).toHaveLength(1);
  });

  it("credits the PARTIAL refund amount, not the full charge", async () => {
    const { sql } = makeMockSql();
    const c = periodCharge(MODEL_A_PLANS.solo, usage);
    await accruePeriodCharge("payer-a", "2026-06", c, sql);
    const before = await getCloudBalance("payer-a", sql);
    // A partial refund of 137 cents on a larger charge: credit 137, not the charge.
    const after = await creditBalance("payer-a", 137, "refund ch_2", "refund:ch_2", sql);
    expect(after).toBe(before + 137);
  });

  it("uses the absolute value so a negative cents argument still credits up", async () => {
    const { sql } = makeMockSql();
    const after = await creditBalance("payer-z", -250, "refund ch_x", "refund:ch_x", sql);
    expect(after).toBe(250);
  });
});

describe("getOwnerByCustomerId maps a Stripe customer to an owner", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("returns the owner whose card carries that customer id", async () => {
    const { sql } = makeMockSql();
    await setCloudPaymentMethod("payer-a", "cus_abc", "pm_1", sql);
    expect(await getOwnerByCustomerId("cus_abc", sql)).toBe("payer-a");
  });

  it("returns null for an unknown customer", async () => {
    const { sql } = makeMockSql();
    expect(await getOwnerByCustomerId("cus_nope", sql)).toBeNull();
  });
});

describe("dispute pauses accrual; won un-pauses; lost stays", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("dispute.created sets disputed and pauses the shared accrual decision", async () => {
    const { sql } = makeMockSql();
    await setCloudPaymentMethod("payer-a", "cus_abc", "pm_1", sql);
    // Before the dispute: accrual is allowed.
    let state = await getLabTrialState("payer-a", sql);
    expect(state.disputed).toBe(false);
    expect(labTrialDecision(state).shouldAccrue).toBe(true);

    await setDisputed("payer-a", true, sql);
    state = await getLabTrialState("payer-a", sql);
    expect(state.disputed).toBe(true);
    // The single shared decision now pauses both accrue and charge.
    expect(labTrialDecision(state).shouldAccrue).toBe(false);
    expect(labTrialDecision(state).shouldCharge).toBe(false);
  });

  it("a won dispute clears disputed and resumes accrual", async () => {
    const { sql } = makeMockSql();
    await setCloudPaymentMethod("payer-a", "cus_abc", "pm_1", sql);
    await setDisputed("payer-a", true, sql);
    await setDisputed("payer-a", false, sql); // won -> clear
    const state = await getLabTrialState("payer-a", sql);
    expect(state.disputed).toBe(false);
    expect(labTrialDecision(state).shouldAccrue).toBe(true);
  });

  it("a lost dispute leaves the flag set (we do not un-pause)", async () => {
    const { sql } = makeMockSql();
    await setCloudPaymentMethod("payer-a", "cus_abc", "pm_1", sql);
    await setDisputed("payer-a", true, sql);
    // A lost dispute never calls setDisputed(false), so the flag persists.
    const state = await getLabTrialState("payer-a", sql);
    expect(state.disputed).toBe(true);
    expect(labTrialDecision(state).shouldAccrue).toBe(false);
  });

  it("setDisputed(true) is idempotent (a redelivery keeps it paused, one stamp)", async () => {
    const { sql, balances } = makeMockSql();
    await setCloudPaymentMethod("payer-a", "cus_abc", "pm_1", sql);
    await setDisputed("payer-a", true, sql);
    const stamped = balances.get("payer-a")!.disputed_at;
    await setDisputed("payer-a", true, sql);
    expect(balances.get("payer-a")!.disputed_at).toBe(stamped);
  });
});
