/**
 * §6.2 → §6.3 transition (Grant 2026-05-21 feedback; widget-framework
 * teardown v2, 2026-06-02).
 *
 * The previous flow jumped straight from typing into the project's
 * Overview field to BeakerBot announcing notifications, visually
 * jarring because the user was still parked inside the project page.
 * This step gives the route change a visible beat:
 *
 *   1. BeakerBot says he's heading back to the user's home surface and
 *      telegraphs notifications next.
 *   2. The cursor glides to the Home tab in the top navbar (no click;
 *      the AppShell nav is disabled during walkthrough mode anyway).
 *   3. expectedRoute "/" fires the TourController's router.push so the
 *      browser navigates while the cursor is at the Home tab. The
 *      tour-active guard keeps "/" from bouncing the user to a role
 *      surface mid-tour, so the next beat (notifications-intro) fires
 *      from "/" as before.
 *   4. Manual advance into `notifications-intro` once the user clicks
 *      Got it, next.
 *
 * Widget-framework teardown v2 (2026-06-02): the §6.2b Home widgets
 * cluster that used to follow this step was removed with the customizable
 * widget canvas. The handoff now telegraphs notifications directly (the
 * next beat is notifications-intro).
 *
 * Classification: BEAKERBOT DEMO (speech says "I'll head back home"; the
 * cursor performs the glide). No click action because:
 *   - the AppShell nav-item is a `<button disabled>` during walkthroughs
 *     (L23 gate), so dispatching a click would be a visual no-op anyway.
 *   - the TourController's expectedRoute effect does the actual nav via
 *     `router.push`, which bypasses the disabled gate by design.
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
import { homeOrLabOverviewNavSelector } from "./lib/targets";

// panel copy polish 2026-05-26: literal-reader bot flagged the prior
// "Let me take us back home" copy as confusing when the step fires
// while the user is already on Home (race + back-button cases). Gate
// the "back home" phrasing on the actual pathname so the speech only
// promises a navigation when one is actually about to happen.
function exitSpeech(): string {
  if (typeof window !== "undefined" && window.location?.pathname === "/") {
    return "Great. Next, let me show you how notifications keep you in the loop.";
  }
  return "Great. Let me head back so I can show you how notifications keep you in the loop.";
}

export const projectOverviewExitStep = buildWalkthroughStep({
  id: "project-overview-exit",
  speech: () => exitSpeech(),
  pose: "pointing",
  // PI Home migration (pi-walkthrough hardening, 2026-05-29): glide to /
  // spotlight the Home tab for members + solo accounts, OR the Lab
  // Overview tab for lab_head (PI) accounts whose Home tab is hidden.
  // The combined selector lets DOM presence decide (see
  // `homeOrLabOverviewNavSelector`), so the cursor never anchors to a
  // tab that the PI Home migration removed from the navbar.
  targetSelector: homeOrLabOverviewNavSelector(),
  cursorScript: cursorScript(async () => {
    const glide = await safeGlideToElementAction(
      homeOrLabOverviewNavSelector(),
    );
    return compactScript([glide]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  // expectedRoute still drives the actual navigation; the cursor glides
  // to the Home tab and the router.push fires while the user reads.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/",
});
