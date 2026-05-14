/**
 * Helper for component authors who want to mark a DOM element as a
 * potential onboarding-tip target. Two equivalent forms:
 *
 *   1. Inline:
 *        <button data-onboarding-target="duplicate-upload" ... />
 *
 *   2. Spread via this helper for type-safety against the catalog:
 *        <button {...onboardingTarget("duplicate-upload")} ... />
 *
 * The orchestrator looks the element up via
 * `document.querySelector('[data-onboarding-target="<id>"]')` at fire
 * time. If the element isn't present (route doesn't render it,
 * conditional UI, etc.), the schedule drops. Refs are not threaded —
 * this is intentional, see proposal §"Implementation sketch".
 */

import type { OnboardingTip } from "./tips";

export type OnboardingTargetId = OnboardingTip["id"];

/** Spread onto any element to register it as a tip target. */
export function onboardingTarget(id: OnboardingTargetId): {
  "data-onboarding-target": OnboardingTargetId;
} {
  return { "data-onboarding-target": id };
}

/** Look up the first DOM element bound to a target id, or null if none
 *  is currently rendered. Used by the orchestrator to compute the
 *  pointer-line anchor. */
export function findOnboardingTarget(
  id: OnboardingTargetId,
): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(
    `[data-onboarding-target="${CSS.escape(id)}"]`,
  );
}
