// Model A billing, the accrual roll-up bridge (step 3b).
//
// Connects the two foundation layers: it reads a payer's POOLED usage for a closed
// period (relay writes + stored bytes + hosted-asset bytes), runs it through the
// pricing core (periodCharge), and accrues the result onto the cloud ledger
// (accruePeriodCharge), idempotently per period. A monthly cron enumerates the
// active paid payers and calls this for the just-closed period.
//
// The pooled-usage reads are injectable so the bridge is unit-tested without a
// live collab DB; the default reader wires the real collab pool functions.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  getLabPoolWrites,
  getLabPoolUsage,
  getLabHostedBytes,
} from "@/lib/collab/server/db";
import { getModelAPlan, periodCharge, type ModelAPlanId } from "./pricing";
import { accruePeriodCharge, getCloudBalance } from "./ledger";
import type { Sql } from "./ledger-db";

/** The pooled-usage reads the roll-up needs, keyed by the resolved billing owner
 *  (the PI/payer for a lab or dept, the owner themselves for solo). Injectable so
 *  the bridge can be tested with fakes. */
export interface OwnerUsageReader {
  /** Relay write-ops in the period across the billing pool (PI + active members). */
  poolWrites(ownerKey: string, period: string): Promise<number>;
  /** Stored bytes across the billing pool right now (snapshot). */
  poolStorageBytes(ownerKey: string): Promise<number>;
  /** Hosted companion-site asset bytes for the lab. */
  hostedBytes(ownerKey: string): Promise<number>;
}

/** The production reader, wired to the real collab pool functions. */
export const defaultUsageReader: OwnerUsageReader = {
  poolWrites: getLabPoolWrites,
  poolStorageBytes: getLabPoolUsage,
  hostedBytes: getLabHostedBytes,
};

export interface AccrueOptions {
  /** Number of labs the base fee covers (lab/dept). Defaults to 1. */
  labCount?: number;
  /** Pooled-usage reader. Defaults to the real collab pool functions. */
  reader?: OwnerUsageReader;
  /** Neon seam, defaults to the lazy singleton inside the ledger. */
  sql?: Sql;
}

export interface AccrualResult {
  /** Whether anything was accrued (false for free or a zero charge). */
  accrued: boolean;
  /** The cents accrued this run (0 when nothing accrued, or on a period re-run). */
  chargedCents: number;
  /** The payer's balance after. */
  balanceCents: number;
}

/**
 * Accrue one payer's marked-up charge for one closed period onto the ledger.
 * Free payers accrue nothing (no base, no produce usage). Storage uses the current
 * snapshot of pooled bytes as the period approximation, since collab_doc_sizes is a
 * snapshot, not a history. Idempotent per (owner, period) via the ledger.
 */
export async function accrueOwnerForPeriod(
  ownerKey: string,
  planId: ModelAPlanId,
  period: string,
  opts: AccrueOptions = {},
): Promise<AccrualResult> {
  const plan = getModelAPlan(planId);
  if (plan.id === "free") {
    return { accrued: false, chargedCents: 0, balanceCents: 0 };
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
  if (charge.totalCents <= 0) {
    return { accrued: false, chargedCents: 0, balanceCents: await getCloudBalance(ownerKey, opts.sql) };
  }
  const res = await accruePeriodCharge(ownerKey, period, charge, opts.sql);
  return {
    accrued: res.accrued,
    chargedCents: res.accrued ? charge.totalCents : 0,
    balanceCents: res.balanceCents,
  };
}
