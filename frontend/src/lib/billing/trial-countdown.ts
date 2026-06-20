// Pure logic for the lab-head trial countdown banner (Grant 2026-06-19).
//
// The banner reassures during the 90-day no-card trial ("no card needed") and
// escalates gently as it ends ("add a card to keep cloud features"). Kept pure +
// clockless (now passed in) so it is unit-testable; the component supplies the
// live trial status from /api/billing/model-a/status and the current time.

import type { LabTrialPhase } from "@/lib/billing/model-a/lab-trial";

/** Visual + copy tier, driven by how close the trial is to ending. */
export type TrialUrgency = "calm" | "soon" | "final";

export interface TrialCountdown {
  /** Whether to show the banner at all (only while genuinely trialing). */
  show: boolean;
  /** Whole days remaining, floored at 0. */
  daysLeft: number;
  urgency: TrialUrgency;
}

const MS_PER_DAY = 86_400_000;

/**
 * Decide the banner state from the trial phase + end date + now. Only shows
 * while `trialing`; an expired or never-started trial shows nothing (the
 * post-trial state is handled by the normal billing surfaces, not this banner).
 */
export function trialCountdown(
  phase: LabTrialPhase | null | undefined,
  trialEndsAt: string | null | undefined,
  nowMs: number,
): TrialCountdown {
  if (phase !== "trialing" || !trialEndsAt) {
    return { show: false, daysLeft: 0, urgency: "calm" };
  }
  const endMs = Date.parse(trialEndsAt);
  if (!Number.isFinite(endMs)) {
    return { show: false, daysLeft: 0, urgency: "calm" };
  }
  const daysLeft = Math.max(0, Math.ceil((endMs - nowMs) / MS_PER_DAY));
  const urgency: TrialUrgency = daysLeft <= 1 ? "final" : daysLeft <= 7 ? "soon" : "calm";
  return { show: true, daysLeft, urgency };
}

/** The dismiss-bucket key for an urgency tier, so dismissing the calm banner
 *  still lets it re-appear when it escalates to soon, then final. */
export function trialDismissKey(urgency: TrialUrgency): string {
  return `ros-trial-banner-dismissed:${urgency}`;
}

/** Banner copy for a tier. No card-required language up front (the whole point
 *  of the trial); the ask to add a card only appears as it ends. */
export function trialBannerCopy(daysLeft: number, urgency: TrialUrgency): {
  title: string;
  body: string;
} {
  const dayWord = daysLeft === 1 ? "day" : "days";
  if (urgency === "final") {
    return {
      title: "Last day of your free trial",
      body: "Add a card to keep cloud features (sharing, backup, the relay) running. Your local notebook stays free either way.",
    };
  }
  if (urgency === "soon") {
    return {
      title: `${daysLeft} ${dayWord} left in your free trial`,
      body: "Add a card before it ends to keep cloud features without interruption. No charge until you actually use them.",
    };
  }
  return {
    title: `You are on a free trial, ${daysLeft} ${dayWord} left`,
    body: "No card needed during the trial. Everything stays local, and cloud features are on us until it ends.",
  };
}
