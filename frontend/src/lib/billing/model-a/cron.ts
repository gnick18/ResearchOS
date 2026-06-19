// Model A billing, the monthly accrual run (step 3 cron orchestration).
//
// Enumerates the active subscriptions, resolves each to its Model-A plan, and
// accrues its just-closed period usage onto the cloud ledger via the bridge. One
// failing owner never aborts the run (it is counted and skipped), so a monthly
// cadence is safe and a retry is idempotent (accrual is keyed per owner+period).
// Departments are not here: they bill on the org net-30 invoice track.
//
// The subscription list, usage reader, and sql are injectable so the run is
// unit-tested without a live DB.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { listActiveSubscriptions, type SubscriptionRecord } from "../db";
import { modelAPlanForSubscription } from "./resolve";
import {
  accrueOwnerForPeriod,
  type OwnerUsageReader,
} from "./accrual";
import { getLabTrialState } from "./ledger";
import { labTrialDecision } from "./lab-trial";
import type { LabTrialRow } from "./ledger";
import type { Sql } from "./ledger-db";

export interface AccrualRunSummary {
  period: string;
  /** Active subscriptions examined. */
  processed: number;
  /** Owners that accrued a non-zero charge this run. */
  accruedOwners: number;
  /** Total cents accrued this run (across owners; 0 for re-runs of a done period). */
  totalCents: number;
  /** Owners whose accrual threw and were skipped. */
  errors: number;
  /** Owners skipped because their lab trial ended with no card on file, so the
   *  lab is paused. We do NOT add new accrual for them (no silent uncharged
   *  bill); they resume the moment a card is added. */
  trialPaused: number;
}

export interface AccrualRunOptions {
  /** Active subscriptions to process. Defaults to listActiveSubscriptions(). */
  subs?: Array<{ ownerKey: string; planId: string }>;
  reader?: OwnerUsageReader;
  /** "Now" for the trial check. Defaults to the wall clock; injectable for tests. */
  now?: Date;
  /** Trial-state reader, keyed by owner. Defaults to getLabTrialState; injectable
   *  so the cron is unit-tested without a live DB. */
  trialState?: (ownerKey: string) => Promise<LabTrialRow>;
  sql?: Sql;
}

/** Minimal active SubscriptionRecord for the pure plan mapper. */
function activeRecord(ownerKey: string, planId: string): SubscriptionRecord {
  return {
    ownerKey,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeItemId: null,
    capBytes: 0,
    status: "active",
    labBilling: false,
    planId,
  };
}

/**
 * Roll up every active paid owner's usage for `period` onto the cloud ledger.
 * Solo/lab only (dept bills on the org track). Resilient and idempotent.
 */
export async function runAccrualForPeriod(
  period: string,
  opts: AccrualRunOptions = {},
): Promise<AccrualRunSummary> {
  const subs = opts.subs ?? (await listActiveSubscriptions());
  const now = opts.now ?? new Date();
  const readTrial = opts.trialState ?? ((k: string) => getLabTrialState(k, opts.sql));
  let accruedOwners = 0;
  let totalCents = 0;
  let errors = 0;
  let trialPaused = 0;

  for (const s of subs) {
    const planId = modelAPlanForSubscription(activeRecord(s.ownerKey, s.planId));
    if (planId === "free") continue;
    try {
      // Lab free-trial pause (Grant 2026-06-19). The single trial decision shared
      // with the charge run. A lab whose trial ended with no card on file is
      // paused: we add no new accrual, so a day-90 unpaid lab never silently runs
      // up an uncharged bill. A trialing lab still accrues (we record usage so the
      // first post-trial bill is honest) but the charge run holds the card. Any
      // owner with no trial set (trialEndsAt null) accrues exactly as before.
      const trial = await readTrial(s.ownerKey);
      if (!labTrialDecision(trial, now).shouldAccrue) {
        trialPaused += 1;
        continue;
      }
      const res = await accrueOwnerForPeriod(s.ownerKey, planId, period, {
        reader: opts.reader,
        sql: opts.sql,
      });
      if (res.accrued) {
        accruedOwners += 1;
        totalCents += res.chargedCents;
      }
    } catch {
      errors += 1;
    }
  }

  return { period, processed: subs.length, accruedOwners, totalCents, errors, trialPaused };
}
