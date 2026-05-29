// One-shot landing-tab redirect decision for the dashboard ("/").
//
// Pure decision function so the redirect logic can be unit-tested
// without mounting HomePage (which needs the file-system provider,
// react-query, AppShell, the tour controller, etc.). page.tsx's
// redirect effect wires the live inputs in and acts on the returned
// directive.
//
// Dashboard unification (dashboard-unification build, 2026-05-29): Home
// and Lab Overview collapsed into ONE dashboard at "/". Everyone lands at
// "/", so the old lab_head -> /lab-overview landing special-case (and the
// `showHomeForLabHead` opt-back-in it depended on) are gone. The decision
// now only honors an explicit non-"/" default landing tab, a `?from=`
// bounce sentinel, and the tour-active guard.

import type { AccountType } from "@/lib/settings/user-settings";

/** Inputs to the landing-redirect decision, sampled at effect time. */
export interface LandingRedirectInput {
  /** True once the one-shot redirect has already fired this session. */
  didLandingRedirect: boolean;
  /** Active username ("" / falsy when signed out or pre-data-setup). */
  currentUser: string;
  /** `undefined` while the account-type settings read is in flight. */
  accountType: AccountType | null | undefined;
  /** The user's configured default landing tab (store value). */
  defaultLandingTab: string | null | undefined;
  /** `?from=` sentinel value (set when another surface bounced us to
   *  "/"); null when absent. */
  fromRedirect: string | null;
  /** True while the v4 onboarding walkthrough / preview is active. The
   *  redirect MUST NOT fire while this is set: the walkthrough's dashboard
   *  phase pushes the browser to "/" and the landing bounce would kick the
   *  user off "/" mid-tour, breaking the walkthrough. */
  tourActive: boolean;
}

/** What the redirect effect should do with the sampled inputs. */
export type LandingRedirectDecision =
  /** Do nothing this pass (still in flight, no redirect needed, or a
   *  guard suppressed it). `markOneShot` says whether to set the
   *  one-shot flag so a later manual visit to "/" stays put. */
  | { kind: "none"; markOneShot: boolean }
  /** Replace the URL with `to` and mark the one-shot flag. */
  | { kind: "replace"; to: string; markOneShot: true };

/**
 * Decide whether the dashboard should bounce the user to another tab on
 * first load. Returns a directive the effect acts on.
 *
 * Order of precedence:
 *
 *   0. Already redirected this session, or no user yet, or account-type
 *      read still in flight → do nothing (don't mark the one-shot flag;
 *      a later pass will decide once inputs settle).
 *   0b. v4 walkthrough / preview active → do nothing AND do NOT mark the
 *      one-shot flag, so once the tour ends the normal landing redirect
 *      can still fire on the next clean landing.
 *   1. `?from=` sentinel → honor the bounce-source's choice (stay on the
 *      dashboard, strip the sentinel), mark the one-shot flag.
 *   2. Explicit non-"/" default landing tab → replace with it (wins for
 *      every account type, including a PI who picked /workbench).
 *   3. default landing tab is "/" or no explicit tab → stay on the
 *      dashboard, mark the one-shot flag.
 *
 * Dashboard unification (dashboard-unification build, 2026-05-29): the
 * old lab_head -> /lab-overview landing special-case is removed — everyone
 * lands on the one dashboard at "/". The `accountType` input is retained
 * (the effect still waits for the read to settle, keeping the one-shot
 * timing stable) but no longer drives a bounce.
 */
export function decideLandingRedirect(
  input: LandingRedirectInput,
): LandingRedirectDecision {
  if (input.didLandingRedirect) return { kind: "none", markOneShot: false };
  if (!input.currentUser) return { kind: "none", markOneShot: false };
  // Wait for the account-type read to resolve before deciding so the
  // one-shot timing stays stable across the async settle (a later pass
  // decides once inputs settle).
  if (input.accountType === undefined) {
    return { kind: "none", markOneShot: false };
  }

  // Tour-active guard. The v4 walkthrough's dashboard phase navigates to
  // "/" via the controller's router.push. Suppress the redirect entirely
  // while the tour runs and leave the one-shot flag UNSET so the normal
  // landing behavior resumes once the walkthrough ends.
  if (input.tourActive) return { kind: "none", markOneShot: false };

  if (input.fromRedirect) {
    // The bounce-source already chose the dashboard as the destination.
    return { kind: "none", markOneShot: true };
  }

  if (input.defaultLandingTab && input.defaultLandingTab !== "/") {
    return { kind: "replace", to: input.defaultLandingTab, markOneShot: true };
  }

  // Either defaultLandingTab === "/" or no explicit tab: stay.
  return { kind: "none", markOneShot: true };
}
