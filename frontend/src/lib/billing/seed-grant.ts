// BeakerBot AI billing, eager seed of the one-time sign-up gift.
//
// The token gift is minted by getOrGrantBalance on an INSERT ... ON CONFLICT DO
// NOTHING keyed to the owner, so it is idempotent and race-safe. Historically it
// was minted LAZILY (only on the first metered AI call or the first ai-status
// read), which meant a brand-new account showed no balance in Settings or the
// BeakerBot chat header until the user took their first AI turn.
//
// seedStarterGrant mints the row EAGERLY at account provision instead, the moment
// the owner key first exists (the directory bind that records the account). It is
// a strict improvement, the same idempotent grant call, just earlier, so the
// balance is real and visible before the first turn.
//
// Best-effort and fail-open. Account provision must never fail because the
// billing database is unreachable or unset, so a missing DATABASE_URL is a clean
// no-op (the lazy mint will still fire later) and any error is swallowed after a
// server-side log. The owner key passed in is the peppered email hash, which is
// the same value ownerKeyForEmail produces.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { getOrGrantBalance } from "./ai-ledger";
import { getSql, type Sql } from "./ai-ledger-db";

/**
 * Mints the one-time sign-up gift for an owner at provision time, best-effort.
 *
 * The ownerKey is the peppered email hash recorded by the directory bind (the
 * same value ownerKeyForEmail returns). The grant is idempotent, so calling this
 * on every provision, on a re-bind, or alongside the existing lazy mint can never
 * double-grant. Returns the seeded balance, or null when the seed was skipped or
 * failed (no DATABASE_URL, or a transient billing-DB error), in which case the
 * lazy mint on first AI use or first ai-status read still covers the account.
 *
 * The sql seam defaults to the lazy Neon singleton, and is overridable so the
 * grant can be unit-tested with a mocked tagged-template (no live DATABASE_URL).
 */
export async function seedStarterGrant(
  ownerKey: string,
  sql?: Sql,
): Promise<number | null> {
  // No billing database configured means there is nothing to seed into. This is
  // the inert local and beta posture, the lazy path will mint later if the DB is
  // ever wired, so we simply skip rather than throw into the provision flow. A
  // caller that injects its own sql seam (tests) opts out of this guard.
  if (!sql && !process.env.DATABASE_URL) {
    return null;
  }
  try {
    return await getOrGrantBalance(ownerKey, sql ?? getSql());
  } catch (e) {
    // Provision must not fail on a billing hiccup. Log for debuggability and let
    // the caller continue, the gift will still mint lazily on first AI use.
    console.error(
      "[billing] could not eagerly seed the sign-up gift at provision:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
