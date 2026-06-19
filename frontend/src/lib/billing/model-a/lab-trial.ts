// Model A billing, the lab free-trial decision core (Grant 2026-06-19).
//
// A new lab head starts with NO card and a 90-day free trial (LAB_TRIAL_DAYS).
// This module is the SINGLE source of truth for what the trial means at any
// moment, kept pure (a stored trial-end timestamp plus a "card on file?" boolean
// in, a decision out) so both the charge run and the accrual cron read the same
// answer and can never drift. Nothing here touches Stripe or the database.
//
// The decision answers two independent questions the engine asks at two points:
//   shouldCharge  -- may the charge run run the card on file this owner?
//   shouldAccrue  -- may the accrual cron add this period's usage to the ledger?
//
// The four phases:
//   none            -- not a trialing lab (no trial-end set). Engine behaves as
//                      before: accrue, charge at the threshold. (Solo, dept, and
//                      any owner predating the trial all land here.)
//   trialing        -- now < trial_ends_at. We still RECORD usage (so the bill is
//                      honest the day the trial ends) but NEVER run the card, so
//                      there is no charge for the whole term regardless of usage.
//   ended_with_card -- now >= trial_ends_at and a card is on file. Normal Model-A
//                      charging resumes (accrue + charge at the threshold).
//   ended_no_card   -- now >= trial_ends_at and NO card. The lab PAUSES: we stop
//                      adding new accrual (so we never silently run up an
//                      uncharged bill) and the UI prompts for a card. The local
//                      app keeps working and adding a card lifts the pause, so the
//                      gate always has an escape (no soft-lock).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export type LabTrialPhase =
  | "none"
  | "trialing"
  | "ended_with_card"
  | "ended_no_card";

export interface LabTrialState {
  /** ISO timestamp the trial ends, or null if this owner is not on a trial. */
  trialEndsAt: string | null;
  /** Whether a card is on file for this owner (drives the day-90 fork). */
  hasCard: boolean;
}

export interface LabTrialDecision {
  phase: LabTrialPhase;
  /** May the charge run run this owner's card this run? */
  shouldCharge: boolean;
  /** May the accrual cron add this period's usage to this owner's ledger? */
  shouldAccrue: boolean;
}

/** Parse a stored trial-end value to epoch millis, or null if absent/unparseable.
 *  A bad value reads as "no trial" so it can never accidentally suppress a real
 *  charge or pause a healthy lab. */
function trialEndMs(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const t = Date.parse(trialEndsAt);
  return Number.isNaN(t) ? null : t;
}

/**
 * The trial phase for an owner at `now`. Pure. The single definition the charge
 * run and the accrual cron both call, so they agree by construction.
 */
export function labTrialPhase(
  state: LabTrialState,
  now: Date = new Date(),
): LabTrialPhase {
  const endMs = trialEndMs(state.trialEndsAt);
  if (endMs == null) return "none";
  if (now.getTime() < endMs) return "trialing";
  return state.hasCard ? "ended_with_card" : "ended_no_card";
}

/**
 * The full charge/accrue decision for an owner at `now`. Pure.
 *
 *   none            -> accrue yes, charge yes (unchanged engine behavior)
 *   trialing        -> accrue yes, charge NO  (record usage, never run the card)
 *   ended_with_card -> accrue yes, charge yes (normal charging resumes)
 *   ended_no_card   -> accrue NO,  charge NO  (paused; stop silent accrual)
 */
export function labTrialDecision(
  state: LabTrialState,
  now: Date = new Date(),
): LabTrialDecision {
  const phase = labTrialPhase(state, now);
  switch (phase) {
    case "trialing":
      return { phase, shouldCharge: false, shouldAccrue: true };
    case "ended_no_card":
      return { phase, shouldCharge: false, shouldAccrue: false };
    case "ended_with_card":
    case "none":
    default:
      return { phase, shouldCharge: true, shouldAccrue: true };
  }
}

/** Whether the lab is currently paused for an unpaid, expired trial (the only
 *  state that blocks new accrual and shows the "add a card" prompt). */
export function isTrialPaused(
  state: LabTrialState,
  now: Date = new Date(),
): boolean {
  return labTrialPhase(state, now) === "ended_no_card";
}

/** The ISO trial-end timestamp for a signup at `signupAt`, `days` out. Used by the
 *  trial-start path to stamp cloud_balance.trial_ends_at. */
export function trialEndsAtFrom(signupAt: Date, days: number): string {
  const end = new Date(signupAt.getTime());
  end.setUTCDate(end.getUTCDate() + Math.max(0, Math.floor(days)));
  return end.toISOString();
}
