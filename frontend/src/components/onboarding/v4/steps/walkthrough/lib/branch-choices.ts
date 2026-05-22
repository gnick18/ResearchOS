/**
 * In-memory cache of the most recent `branchOn` choice per step id
 * (Hybrid fix manager R1, 2026-05-22).
 *
 * Why this exists:
 *   §6.7 HE-2 (`hybrid-markdown-familiarity`) is a `branchOn` step. A
 *   user who declines the overview routes from HE-2 directly to HE-4,
 *   skipping HE-3. But the step-machine's `getPreviousStep` walks the
 *   linear TOUR_STEP_ORDER backwards, so back-stepping from HE-4 lands
 *   the user on HE-3 — the overview they JUST declined. We gate HE-3
 *   on the most recent recorded branch choice so back-stepping treats
 *   it as skipped when the user's pick was anything other than
 *   "Sure, show me an overview".
 *
 * Scope:
 *   - Module-level mutable cache (one tour active per browser tab).
 *   - Choices are NOT persisted to the sidecar — matches the
 *     branchOn contract per Grant's 2026-05-22 design note.
 *   - The cache resets when a tour ends (the TourController's EXIT
 *     dispatch fires after the cleanup grid finishes; consumers can
 *     call `resetBranchChoices()` from there if needed).
 *
 * Read contract:
 *   - `lastBranchChoice(stepId)` returns the most recent target
 *     `nextStep` clicked for that step, or `null` if nothing was
 *     recorded (initial state OR cleared after exit).
 *
 * Write contract:
 *   - `recordBranchChoice(stepId, nextStep)` overwrites the recording
 *     for that step id. Passing `null` clears it.
 *   - Called from the TourController's `branchTo` action right before
 *     the SET_STEP dispatch fires. The step body's `onExit` may also
 *     call this with `null` to clear stale state on no-pick exits
 *     (skip / back).
 */
import type { TourStepId } from "@/components/onboarding/v4/step-types";

/** Module-level cache. Single global is fine — only one tour is active
 *  per browser tab at any time. */
const choices = new Map<TourStepId, TourStepId | null>();

/** Read the last recorded branch choice for `stepId`. Returns `null`
 *  when nothing was recorded yet (or it was cleared). */
export function lastBranchChoice(stepId: TourStepId): TourStepId | null {
  return choices.get(stepId) ?? null;
}

/** Record (or clear when `nextStep` is `null`) the most recent
 *  branch choice for `stepId`. Overwrites any previous recording. */
export function recordBranchChoice(
  stepId: TourStepId,
  nextStep: TourStepId | null,
): void {
  choices.set(stepId, nextStep);
}

/** Drop every recorded branch choice. Called by the TourController on
 *  tour exit so a re-run starts with a clean cache. */
export function resetBranchChoices(): void {
  choices.clear();
}
