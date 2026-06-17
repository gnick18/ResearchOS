// Model A billing, the monthly $-cap enforcement (engine step, bill-shock guard).
//
// Model A has NO hard storage byte cap (storage is a-la-carte). The guard is a
// SETTABLE MONTHLY $ CAP on the period's projected charge: when this period's
// base + metered usage would exceed the payer's cap, cloud sync pauses (the local
// app never stops, no data is lost) until the next period or the cap is raised.
// A null cap means no per-owner limit (the global cost breaker still applies).
//
// The current period is still open, so the charge is not in the ledger yet; we
// project it live from the current pooled usage via periodCharge. The usage reader
// and sql are injectable for unit tests.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { getModelAPlan, periodCharge, type ModelAPlanId } from "./pricing";
import { defaultUsageReader, type OwnerUsageReader } from "./accrual";
import { getMonthlyCap } from "./ledger";
import type { Sql } from "./ledger-db";

/** Whether a period's projected charge is over the cap. A null cap never trips. */
export function isOverCap(projectedCents: number, capCents: number | null): boolean {
  return capCents != null && projectedCents > capCents;
}

export interface CapState {
  /** Whether cloud sync should pause this period (cap exceeded). */
  over: boolean;
  reason: "cap" | null;
  /** This period's projected charge (base + metered usage) in cents. */
  projectedCents: number;
  /** The cap in effect, or null if none. */
  capCents: number | null;
}

export interface CapStateOptions {
  /** Plan, if already resolved (else pass it from resolveModelAPlanId upstream). */
  planId?: ModelAPlanId;
  /** Cap, if already read (else getMonthlyCap is used). */
  capCents?: number | null;
  labCount?: number;
  reader?: OwnerUsageReader;
  sql?: Sql;
}

/**
 * The Model-A cap state for a billing owner this period. Free owners and owners
 * with no cap are never over. Otherwise it projects this period's charge from the
 * current pooled usage and compares it to the cap.
 */
export async function modelACapState(
  ownerKey: string,
  period: string,
  opts: CapStateOptions = {},
): Promise<CapState> {
  const plan = getModelAPlan(opts.planId);
  const capCents =
    opts.capCents !== undefined ? opts.capCents : await getMonthlyCap(ownerKey, opts.sql);

  if (plan.id === "free" || capCents == null) {
    return { over: false, reason: null, projectedCents: 0, capCents };
  }

  const reader = opts.reader ?? defaultUsageReader;
  const [writes, storageBytes, hostedBytes] = await Promise.all([
    reader.poolWrites(ownerKey, period),
    reader.poolStorageBytes(ownerKey),
    reader.hostedBytes(ownerKey),
  ]);
  const charge = periodCharge(plan, {
    writes,
    storageBytes,
    hostedBytes,
    labCount: opts.labCount,
  });
  const over = isOverCap(charge.totalCents, capCents);
  return { over, reason: over ? "cap" : null, projectedCents: charge.totalCents, capCents };
}
