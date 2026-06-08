// frontend/src/lib/funding/spend.test.ts
//
// Unit tests for the live funding-spend helpers (funding-rework, 2026-06-08):
// spend is summed from purchase line items by the authoritative
// `funding_account_id` FK, with null / dangling ids treated as uncategorized.

import { describe, expect, it } from "vitest";
import {
  computeFundingSpend,
  computeFundingSpendByAccount,
  computeUncategorizedSpend,
} from "./spend";
import type { FundingAccount, PurchaseItem } from "@/lib/types";

function acct(id: number): FundingAccount {
  return { id, name: `acct-${id}`, description: null, total_budget: 1000 };
}

function item(
  fundingAccountId: number | null,
  totalPrice: number,
): Pick<PurchaseItem, "funding_account_id" | "total_price"> {
  return { funding_account_id: fundingAccountId, total_price: totalPrice };
}

describe("computeFundingSpend", () => {
  it("sums only items linked to the account by id", () => {
    const items = [item(1, 10), item(2, 5), item(1, 7), item(null, 100)];
    expect(computeFundingSpend(acct(1), items)).toBe(17);
    expect(computeFundingSpend(acct(2), items)).toBe(5);
  });

  it("is zero when no items are linked", () => {
    expect(computeFundingSpend(acct(9), [item(1, 10)])).toBe(0);
  });

  it("treats a missing total_price as zero", () => {
    const items = [{ funding_account_id: 1, total_price: undefined as unknown as number }];
    expect(computeFundingSpend(acct(1), items)).toBe(0);
  });
});

describe("computeFundingSpendByAccount", () => {
  it("returns a per-account map with a 0 entry for accounts with no spend", () => {
    const accounts = [acct(1), acct(2), acct(3)];
    const items = [item(1, 10), item(1, 5), item(2, 20)];
    const map = computeFundingSpendByAccount(accounts, items);
    expect(map.get(1)).toBe(15);
    expect(map.get(2)).toBe(20);
    expect(map.get(3)).toBe(0);
  });

  it("ignores items whose id matches no listed account (dangling)", () => {
    const map = computeFundingSpendByAccount([acct(1)], [item(1, 10), item(42, 99)]);
    expect(map.get(1)).toBe(10);
    expect(map.has(42)).toBe(false);
  });
});

describe("computeUncategorizedSpend", () => {
  it("sums null-id and dangling-id items", () => {
    const accounts = [acct(1)];
    const items = [item(1, 10), item(null, 5), item(42, 7)];
    expect(computeUncategorizedSpend(accounts, items)).toBe(12);
  });

  it("is zero when every item resolves to a known account", () => {
    expect(computeUncategorizedSpend([acct(1), acct(2)], [item(1, 10), item(2, 5)])).toBe(0);
  });
});
