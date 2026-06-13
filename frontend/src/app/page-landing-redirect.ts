// One-shot landing-tab redirect decision for the dashboard ("/").
//
// Pure decision function so the redirect logic can be unit-tested
// without mounting HomePage (which needs the file-system provider,
// react-query, AppShell, the tour controller, etc.). page.tsx's
// redirect effect wires the live inputs in and acts on the returned
// directive.
//
// Widget-framework teardown v2 (2026-06-02): the customizable widget
// dashboard that "/" used to render is gone. "/" is now a pure router: it
// bounces to the surface that owns the account type. A lab_head lands on
// the curated /lab-overview; everyone else lands on /workbench. An explicit
// non-"/" default landing tab still wins over the role default. The
// deep-link handlers (?openTask= / ?openProject=) run on "/" before the
// bounce, and the `?from=` sentinel + tour-active guard are preserved.

/** Inputs to the landing-redirect decision, sampled at effect time. */
export interface LandingRedirectInput {
  /** Suppress the bounce: a deep-link (?openTask= / ?openProject=) is being
   *  handled or a task popup is open on "/". Keeps "/" from redirecting out
   *  from under the deep-link flow. Otherwise "/" ALWAYS bounces now (the
   *  canvas it used to render is gone, so there is no "stay here" state). */
  suppress: boolean;
  /** Active username ("" / falsy when signed out or pre-data-setup). */
  currentUser: string;
  /** Whether the active user is a lab head (PI). `undefined` while the role
   *  read is in flight (the decision short-circuits until it resolves). */
  isLabHead: boolean | null | undefined;
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
  /** A lab head's PI view mode (NAV-1/2/3). "lab" (default) lands a PI on
   *  /lab-overview; "my-work" lands them on their personal /workbench, the same
   *  as a member. Ignored for non-lab-heads. Absent is treated as "lab". */
  piViewMode?: "lab" | "my-work";
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
 *   0. Already redirected this session, or no user yet, or lab-head
 *      read still in flight → do nothing (don't mark the one-shot flag;
 *      a later pass will decide once inputs settle).
 *   0b. v4 walkthrough / preview active → do nothing AND do NOT mark the
 *      one-shot flag, so once the tour ends the normal landing redirect
 *      can still fire on the next clean landing.
 *   1. `?from=` sentinel → a surface bounced us to "/" deliberately
 *      (e.g. /lab-overview bouncing a non-PI). Stay on "/" so we don't
 *      bounce straight back into a loop; strip the sentinel; mark the
 *      one-shot flag.
 *   2. Explicit non-"/" default landing tab → replace with it (wins for
 *      every account type, including a PI who picked /workbench).
 *   3. Role default → lab_head bounces to /lab-overview, everyone else to
 *      /workbench. "/" no longer renders anything itself.
 *
 * Widget-framework teardown v2 (2026-06-02): "/" stopped rendering the
 * widget canvas, so there is no "stay on the dashboard" terminal state any
 * more. The account type now DRIVES the bounce (it used to only gate the
 * one-shot timing).
 */
export function decideLandingRedirect(
  input: LandingRedirectInput,
): LandingRedirectDecision {
  if (input.suppress) return { kind: "none", markOneShot: false };
  if (!input.currentUser) return { kind: "none", markOneShot: false };
  // Wait for the lab-head read to resolve before deciding so the
  // one-shot timing stays stable across the async settle (a later pass
  // decides once inputs settle).
  if (input.isLabHead === undefined) {
    return { kind: "none", markOneShot: false };
  }

  // Tour-active guard. The v4 walkthrough drives the browser to "/" and to
  // the create surfaces itself. Suppress the redirect entirely while the
  // tour runs and leave the one-shot flag UNSET so the normal landing
  // behavior resumes once the walkthrough ends.
  if (input.tourActive) return { kind: "none", markOneShot: false };

  if (input.defaultLandingTab && input.defaultLandingTab !== "/") {
    // An explicit landing tab wins, EXCEPT when it is the very surface
    // that just bounced us here (that would ping-pong). In that case fall
    // through to the role default below.
    if (
      !input.fromRedirect ||
      `/${input.fromRedirect}` !== input.defaultLandingTab
    ) {
      return {
        kind: "replace",
        to: input.defaultLandingTab,
        markOneShot: true,
      };
    }
  }

  // Role default. "/" renders nothing now, so always bounce somewhere. The
  // `?from=` sentinel only matters here as a loop guard: a non-PI bounced
  // off /lab-overview lands on /workbench (the role default already differs
  // from /lab-overview, so there is no ping-pong).
  const roleDefault = input.isLabHead
    ? input.piViewMode === "my-work"
      ? "/workbench"
      : "/lab-overview"
    : "/workbench";
  if (input.fromRedirect && `/${input.fromRedirect}` === roleDefault) {
    // Defensive: the bounce-source equals our role default. Stay on "/"
    // to break the loop (no current caller hits this, but it keeps the
    // router total).
    return { kind: "none", markOneShot: true };
  }
  return { kind: "replace", to: roleDefault, markOneShot: true };
}
