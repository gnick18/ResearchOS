/**
 * §6.2 → §6.3 transition (Grant 2026-05-21 feedback; widget-framework
 * teardown v2, 2026-06-02; tour-teardown audit 2026-06-03).
 *
 * The previous flow jumped straight from typing into the project's
 * Overview field to BeakerBot announcing notifications, visually
 * jarring because the user was still parked inside the project page.
 * This step gives the route change a visible beat:
 *
 *   1. BeakerBot says he's heading back out of the project page and
 *      telegraphs notifications next.
 *   2. The cursor glides to the notification bell in the top navbar.
 *   3. expectedRoute "/workbench" fires the TourController's router.push
 *      so the browser navigates while the cursor is at the bell. The
 *      next beat (notifications-intro) then frames the bell + inbox from
 *      /workbench.
 *   4. Manual advance into `notifications-intro` once the user clicks
 *      Got it, next.
 *
 * Tour-teardown audit (2026-06-03): the prior version glided to
 * `homeOrLabOverviewNavSelector()` and set `expectedRoute: "/"`. Both
 * broke in the widget-framework teardown:
 *   - The member/solo Home nav tab was removed (only lab_head gets a
 *     "Lab Overview" tab), so the glide target resolved to nothing for
 *     most users and the cursor stranded mid-screen.
 *   - "/" became a pure role redirect that is SUPPRESSED while the tour
 *     is active (see page-landing-redirect.ts `tourActive` guard), so
 *     pushing to "/" parked the user on a blank spinner page.
 * The fix repoints the glide to the notification bell (rendered in the
 * top nav on EVERY page, every account type) and lands the user on
 * /workbench (a real page for members, solo, and PIs). The notifications
 * cluster (bell -> silence -> delete) declares no route of its own, so it
 * fires cleanly from /workbench; the following workbench-create-experiment
 * cluster is already rooted there too, so the handoff stays on one page.
 *
 * Classification: BEAKERBOT DEMO (speech says "let me head back out"; the
 * cursor performs the glide to the bell). No click action because:
 *   - the notification bell opening belongs to the user in the next beat
 *     (notifications-bell), so this step only directs the eye.
 *   - the TourController's expectedRoute effect does the actual nav via
 *     `router.push`.
 *
 * Pose: pointing (BeakerBot is directing the user's eye to the navbar).
 */
import {
  compactScript,
  cursorScript,
  safeGlideToElementAction,
} from "./lib/cursor-script";
import {
  manualAdvance,
  buildWalkthroughStep,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

const bellSelector = targetSelector(TOUR_TARGETS.notificationsBell);

// panel copy polish 2026-05-26 / teardown audit 2026-06-03: the prior
// "back home" phrasing promised a Home surface that members no longer
// have. The copy now telegraphs notifications directly and gates the
// "let me head back out" framing on whether the user is still inside a
// project page (the common case for this step).
function exitSpeech(): string {
  const onProject =
    typeof window !== "undefined" &&
    (window.location?.pathname ?? "").startsWith("/workbench/projects/");
  if (onProject) {
    return "Great. Let me head back out so I can show you how notifications keep you in the loop.";
  }
  return "Great. Next, let me show you how notifications keep you in the loop.";
}

export const projectOverviewExitStep = buildWalkthroughStep({
  id: "project-overview-exit",
  speech: () => exitSpeech(),
  pose: "pointing",
  // Tour-teardown audit (2026-06-03): glide to the notification bell,
  // which AppShell renders in the top-right cluster on every page for
  // every account type. Replaces the removed Home / Lab Overview nav-tab
  // glide that resolved to nothing for members + solo accounts.
  targetSelector: bellSelector,
  cursorScript: cursorScript(async () => {
    const glide = await safeGlideToElementAction(bellSelector);
    return compactScript([glide]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the
  // user to click before advancing. expectedRoute drives the actual
  // navigation; the cursor glides to the bell and the router.push fires
  // while the user reads.
  completion: manualAdvance("Got it, next"),
  // Tour-teardown audit (2026-06-03): land on /workbench (a real page for
  // every account type) instead of "/" (a pure redirect that the tour
  // guard suppresses, leaving a blank spinner).
  expectedRoute: "/workbench",
});
