// One-shot landing-tab redirect decision for the Home page ("/").
//
// Pure decision function so the redirect logic can be unit-tested
// without mounting HomePage (which needs the file-system provider,
// react-query, AppShell, the tour controller, etc.). page.tsx's
// redirect effect wires the live inputs in and acts on the returned
// directive.
//
// The PI Home migration (2026-05-29) hides the Home top-nav tab for
// lab_head accounts and bounces their first landing on "/" to
// /lab-overview. pi-walkthrough hardening (2026-05-29) adds a
// tour-active guard so the bounce does NOT fire while the v4 onboarding
// walkthrough is on its Home / project-overview phase — without the
// guard a PI gets kicked off "/" mid-tour and the walkthrough breaks.

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
  /** lab_head opt-back-in: when true a PI keeps Home + its landing. */
  showHomeForLabHead: boolean;
  /** `?from=` sentinel value (set when another surface bounced us to
   *  "/"); null when absent. */
  fromRedirect: string | null;
  /** True while the v4 onboarding walkthrough / preview is active. The
   *  redirect MUST NOT fire while this is set: the walkthrough's Home
   *  phase pushes the browser to "/" and the landing bounce would kick
   *  a PI straight back to /lab-overview, breaking the tour. */
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
 * Decide whether the Home page should bounce the user to another tab on
 * first load. Returns a directive the effect acts on.
 *
 * Order of precedence (unchanged from the pre-guard logic except for
 * the leading tour-active short-circuit):
 *
 *   0. Already redirected this session, or no user yet, or account-type
 *      read still in flight → do nothing (don't mark the one-shot flag;
 *      a later pass will decide once inputs settle).
 *   0b. v4 walkthrough / preview active → do nothing AND do NOT mark the
 *      one-shot flag, so once the tour ends the normal landing redirect
 *      can still fire on the next clean landing.
 *   1. `?from=` sentinel → honor the bounce-source's choice (stay on
 *      Home, strip the sentinel), mark the one-shot flag.
 *   2. Explicit non-Home default landing tab → replace with it (wins for
 *      every account type, including a PI who picked /workbench).
 *   3. lab_head with Home hidden (no explicit override) → /lab-overview.
 *   4. default landing tab is "/" → stay on Home, mark the one-shot flag.
 *   5. otherwise → stay, mark the one-shot flag.
 */
export function decideLandingRedirect(
  input: LandingRedirectInput,
): LandingRedirectDecision {
  if (input.didLandingRedirect) return { kind: "none", markOneShot: false };
  if (!input.currentUser) return { kind: "none", markOneShot: false };
  // Wait for the account-type read to resolve before deciding (so a PI
  // isn't briefly parked on Home, and a member isn't mis-bounced).
  if (input.accountType === undefined) {
    return { kind: "none", markOneShot: false };
  }

  // Tour-active guard (pi-walkthrough hardening, 2026-05-29). The v4
  // walkthrough's universal Home phase navigates to "/" via the
  // controller's router.push. If the one-shot landing bounce fired here
  // it would replace("/lab-overview") and yank a PI out of the Home
  // phase. Suppress the redirect entirely while the tour runs and leave
  // the one-shot flag UNSET so the normal landing behavior resumes once
  // the walkthrough ends.
  if (input.tourActive) return { kind: "none", markOneShot: false };

  if (input.fromRedirect) {
    // The bounce-source already chose Home as the destination; honor it.
    return { kind: "none", markOneShot: true };
  }

  if (input.defaultLandingTab && input.defaultLandingTab !== "/") {
    return { kind: "replace", to: input.defaultLandingTab, markOneShot: true };
  }

  if (input.accountType === "lab_head" && !input.showHomeForLabHead) {
    return { kind: "replace", to: "/lab-overview", markOneShot: true };
  }

  // Either defaultLandingTab === "/" or no explicit tab: stay on Home.
  return { kind: "none", markOneShot: true };
}
