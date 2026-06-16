// Onboarding tutor — run gate (pure, storage-injectable).
//
// Decides whether the guided first-run should mount. It runs ONCE per account,
// right after the account is created, when the flag is on. We persist a "done"
// marker so a refresh or a return visit does not replay it; the user can still
// re-run it on demand from the Help menu (a separate explicit trigger, not this
// gate). Storage is injected so the decision is unit-testable without a browser.
//
// The fresh-account condition itself (just signed up, no folder yet) is supplied
// by the caller from the app's own session state, so this module stays pure and
// does not reach into providers. No emojis, no em-dashes, no mid-sentence colons.

import { ONBOARDING_TUTOR_ENABLED } from "./config";

const DONE_KEY = "ros.onboardingTutor.done.v1";

export interface TourGateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TourGateStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface ShouldRunArgs {
  /** True once the user has a freshly created account (the moment to teach). The
   *  caller derives this from session state, so this module stays pure. */
  freshAccount: boolean;
  /** Inject for tests; defaults to localStorage. */
  storage?: TourGateStorage | null;
  /** Override the flag in tests. Defaults to the build flag. */
  enabled?: boolean;
}

/** Whether the tutor should mount now. Flag on, a fresh account, and not already
 *  run on this device. */
export function shouldRunOnboardingTutor({
  freshAccount,
  storage = defaultStorage(),
  enabled = ONBOARDING_TUTOR_ENABLED,
}: ShouldRunArgs): boolean {
  if (!enabled) return false;
  if (!freshAccount) return false;
  if (!storage) return true; // no storage (rare), better to teach than to skip
  return storage.getItem(DONE_KEY) !== "1";
}

/** Record that the tutor finished or was skipped, so it does not replay. The
 *  resumable run state lives separately in tour-progress (cleared alongside this
 *  by the caller on done/skip); this marker is the permanent "do not auto-show
 *  again" gate for a user who stays fresh. */
export function markOnboardingTutorDone(
  storage: TourGateStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(DONE_KEY, "1");
  } catch {
    // best effort; a private-mode storage failure just means it may replay
  }
}

/** Clear the done marker so the user can replay from the Help menu. (The caller
 *  also clears tour-progress so the replay starts clean at welcome.) */
export function resetOnboardingTutor(
  storage: TourGateStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(DONE_KEY, "0");
  } catch {
    // best effort
  }
}
