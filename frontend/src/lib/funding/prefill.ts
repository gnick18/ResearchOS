// frontend/src/lib/funding/prefill.ts
//
// Funding-string prefill helper (funding-niceties bot, 2026-05-28).
//
// When a user adds a purchase under a project that has a stored PRIMARY grant
// link (Project.funding_account_id), the new purchase's `funding_string`
// should DEFAULT to that grant's name so the common case (charge to the
// project's grant) is one less field to fill. This is purely a default: it
// never overrides a value the user already typed, and the user can always
// change or clear it. Nothing is persisted by this helper.
//
// Pure + dependency-free so the same rule can be unit-tested and reused
// wherever a purchase is created (the inline PurchaseEditor new-row, a future
// quick-add modal, etc.). It maps a primary `funding_account_id` to the
// account NAME, because `funding_string` matches a FundingAccount by name
// (see charged-grants.ts), not by id.

import type { FundingAccount } from "@/lib/types";

/**
 * Resolve the default funding string for a new purchase under a project.
 *
 * Returns the primary funding account's `name` when the project has a
 * `funding_account_id` that resolves to a known account, otherwise `null`
 * (no default). The name is what the purchase `funding_string` <select> /
 * input expects, so callers can drop the result straight into the field.
 *
 * `null` / `undefined` `fundingAccountId` (the unlinked default) yields
 * `null`. An id that resolves to no account also yields `null` (the account
 * may have been deleted after the link was set).
 */
export function defaultFundingStringForProject(
  fundingAccountId: number | null | undefined,
  fundingAccounts: ReadonlyArray<FundingAccount>,
): string | null {
  if (fundingAccountId == null) return null;
  const match = fundingAccounts.find((acc) => acc.id === fundingAccountId);
  return match ? match.name : null;
}

/**
 * Decide the funding string to show in a new-purchase form, given the
 * project's primary default and whatever the user has already entered.
 *
 * Non-destructive contract:
 *   - If the user has already typed a non-empty value, keep it untouched.
 *   - Otherwise, fall back to the project default (which may itself be null).
 *
 * `currentValue` is the form field's present value (empty string when
 * untouched). The return value is what the field should display: the existing
 * user value, the default, or an empty string when neither applies.
 */
export function resolveFundingStringDefault(
  currentValue: string | null | undefined,
  projectDefault: string | null | undefined,
): string {
  const typed = (currentValue ?? "").trim();
  if (typed.length > 0) return currentValue ?? "";
  return projectDefault ?? "";
}

/**
 * Resolve a free-form funding label to the AUTHORITATIVE FundingAccount.id
 * (funding-rework, 2026-06-08). Purchase writers persist the id, not the name,
 * so spend rollups and charged-grants resolve by FK. The label is matched by
 * exact (trimmed) `name`, mirroring the legacy `funding_string` -> name rule and
 * the auto-migration backfill. Returns `null` for a blank label or one that
 * matches no known account (e.g. a brand-new label whose account row failed to
 * create); callers keep the label in `funding_string` either way so nothing is
 * lost.
 */
export function resolveFundingAccountId(
  fundingString: string | null | undefined,
  fundingAccounts: ReadonlyArray<Pick<FundingAccount, "id" | "name">>,
): number | null {
  const trimmed = (fundingString ?? "").trim();
  if (trimmed.length === 0) return null;
  const match = fundingAccounts.find((acc) => acc.name === trimmed);
  return match ? match.id : null;
}
