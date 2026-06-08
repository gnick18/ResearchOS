// frontend/src/lib/funding/spend.ts
//
// Live funding-account spend (funding-rework, 2026-06-08).
//
// The on-disk `FundingAccount.spent` / `remaining` fields are GONE. Spend is a
// DERIVED quantity, recomputed live from the purchase line items every time it
// is shown, so there is exactly one source of truth and no stale counter to
// keep in sync on every purchase write. Every reader (the funding nav item, the
// set-funding palette detail, the spending dashboard per-account rows, the
// admin funding summary) routes through the helpers here.
//
// Matching is by the AUTHORITATIVE foreign key `PurchaseItem.funding_account_id`
// (-> FundingAccount.id), NOT the denormalized `funding_string` label. Items
// whose `funding_account_id` is null (unfunded, or pre-migration records the
// backfill has not reached yet) count toward neither account's spend; surface
// them via `computeUncategorizedSpend` if an "uncategorized" bucket is needed.

import type { FundingAccount, PurchaseItem } from "@/lib/types";

/** The minimal item shape the spend rollups read. */
type SpendItem = Pick<PurchaseItem, "funding_account_id" | "total_price">;

/** The minimal account shape the spend rollups read. */
type SpendAccount = Pick<FundingAccount, "id">;

/**
 * Live spend for a single funding account: the sum of `total_price` over every
 * purchase item linked to it by `funding_account_id`. Pure + dependency-free.
 */
export function computeFundingSpend(
  account: SpendAccount,
  items: ReadonlyArray<SpendItem>,
): number {
  let sum = 0;
  for (const item of items) {
    if (item.funding_account_id === account.id) sum += item.total_price ?? 0;
  }
  return sum;
}

/**
 * Live spend for every account in one pass: a `Map<accountId, spent>`. Cheaper
 * than calling `computeFundingSpend` per account when several accounts are
 * rendered together (the dashboard, the palette account list). Accounts with no
 * matching items are present in the map with a `0` entry so callers can read a
 * stable number without a null check.
 */
export function computeFundingSpendByAccount(
  accounts: ReadonlyArray<SpendAccount>,
  items: ReadonlyArray<SpendItem>,
): Map<number, number> {
  const byId = new Map<number, number>();
  for (const account of accounts) byId.set(account.id, 0);
  for (const item of items) {
    const id = item.funding_account_id;
    if (id == null) continue;
    if (!byId.has(id)) continue; // a dangling id (deleted account) is ignored
    byId.set(id, (byId.get(id) ?? 0) + (item.total_price ?? 0));
  }
  return byId;
}

/**
 * Spend NOT attributed to any known account: items with a null
 * `funding_account_id`, plus items whose `funding_account_id` resolves to no
 * account in `accounts` (a grant that was deleted after the purchase). Drives
 * the dashboard's "uncategorized" row.
 */
export function computeUncategorizedSpend(
  accounts: ReadonlyArray<SpendAccount>,
  items: ReadonlyArray<SpendItem>,
): number {
  const known = new Set<number>();
  for (const account of accounts) known.add(account.id);
  let sum = 0;
  for (const item of items) {
    const id = item.funding_account_id;
    if (id == null || !known.has(id)) sum += item.total_price ?? 0;
  }
  return sum;
}
