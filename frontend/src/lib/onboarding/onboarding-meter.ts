// Onboarding token meter (pure).
//
// The guided first-run is funded by a CAPPED slice of the new-account token gift
// (Grant 2026-06-14, ~10 percent of the ~1.6M-token gift). This module tracks
// the onboarding bucket and the cap. When the bucket is spent the tutor finishes
// on deterministic rails (canned narration, no more live LLM), so a curious user
// can never drain their real working allowance and onboarding never soft-locks.
//
// Pure, no clock, no IO. The live layer accrues real usage into spend(); the
// reel director sheds DEEP demos to montage as remaining() shrinks. No emojis,
// no em-dashes, no mid-sentence colons.

export interface OnboardingMeter {
  used: number;
  cap: number;
}

// ~10 percent of the ~1.6M-token gift. Generous for a chatty, example-rich run.
export const DEFAULT_ONBOARDING_CAP = 150_000;

export function newMeter(cap: number = DEFAULT_ONBOARDING_CAP): OnboardingMeter {
  return { used: 0, cap: Math.max(0, cap) };
}

/** Accrue token usage. Negative deltas are ignored, used never exceeds the cap. */
export function spend(meter: OnboardingMeter, tokens: number): OnboardingMeter {
  const used = Math.min(meter.cap, meter.used + Math.max(0, tokens));
  return { ...meter, used };
}

export function remaining(meter: OnboardingMeter): number {
  return Math.max(0, meter.cap - meter.used);
}

export function isExhausted(meter: OnboardingMeter): boolean {
  return meter.used >= meter.cap;
}

/** 0..100 for the visible meter bar. */
export function pctUsed(meter: OnboardingMeter): number {
  if (meter.cap <= 0) return 100;
  return Math.min(100, (meter.used / meter.cap) * 100);
}

/** Whether a planned step that needs about `cost` live tokens can still run on
 *  the live model, or must fall back to deterministic rails. */
export function canAfford(meter: OnboardingMeter, cost: number): boolean {
  return remaining(meter) >= Math.max(0, cost);
}
