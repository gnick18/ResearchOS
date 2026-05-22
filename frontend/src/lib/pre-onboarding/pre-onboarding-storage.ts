// frontend/src/lib/pre-onboarding/pre-onboarding-storage.ts
//
// Pre-onboarding seen-flag persistence. P0 of the pre-onboarding arc
// (see PRE_ONBOARDING_PROPOSAL.md §7.3 + §8).
//
// Pre-onboarding fires BEFORE the user picks a folder, so the seen-flag
// cannot live in the user's data folder (no folder exists yet at first
// touch). localStorage is the only durable surface available.
//
// Module-level helpers are SSR-safe (typeof window guards) so the gate
// predicate in providers.tsx can be evaluated during server render
// without exploding. A missing window short-circuits to "not seen" so
// the screen still fires on the client mount that follows.
//
// Key choice: `researchos:pre-onboarding-seen-v1`. Matches the existing
// colon-namespaced convention (researchos:demo-mode,
// researchos:wiki-capture-mode, researchos:v4-preview-active). The
// trailing `-v1` is a forward-compat hook: if a future redesign of the
// pre-onboarding flow forces every prior visitor to re-see it (rare),
// we bump the suffix rather than mutate existing keys.

export const PRE_ONBOARDING_SEEN_KEY = "researchos:pre-onboarding-seen-v1";

/**
 * Returns true iff the user has completed or skipped pre-onboarding in
 * this browser. SSR-safe: returns false when window/localStorage is
 * unavailable, so the gate fires on the first client paint that follows.
 */
export function hasSeenPreOnboarding(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (typeof window.localStorage === "undefined") return false;
    return window.localStorage.getItem(PRE_ONBOARDING_SEEN_KEY) === "1";
  } catch {
    // Sandboxed iframes / Safari private browsing throw on localStorage
    // access. Treating that as "not seen" is the safe default — worst
    // case the user sees the intro again on their next visit, which is
    // annoying but never destructive.
    return false;
  }
}

/**
 * Marks pre-onboarding as seen. Called when the user completes the
 * flow OR clicks Skip. Set to "1" rather than "true" to match the
 * narrow value space used by the existing researchos:* keys.
 */
export function markPreOnboardingSeen(): void {
  try {
    if (typeof window === "undefined") return;
    if (typeof window.localStorage === "undefined") return;
    window.localStorage.setItem(PRE_ONBOARDING_SEEN_KEY, "1");
  } catch {
    // See hasSeenPreOnboarding — swallow storage failures rather than
    // crash the gate. If the write fails the user will see the intro
    // again next visit; not dangerous.
  }
}

/**
 * Dev helper: clears the seen flag so pre-onboarding re-fires on the
 * next mount. Wired into the `?reset-pre-onboarding=1` URL flag in
 * PreOnboardingScreen so manual QA can replay the flow without
 * digging into devtools storage. Not exposed in the production UI.
 */
export function resetPreOnboardingSeen(): void {
  try {
    if (typeof window === "undefined") return;
    if (typeof window.localStorage === "undefined") return;
    window.localStorage.removeItem(PRE_ONBOARDING_SEEN_KEY);
  } catch {
    // Same fallback as the setter — silent on storage failures.
  }
}
