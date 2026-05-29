/**
 * §6.2 → §6.2b transition (Grant 2026-05-21 feedback, copy refreshed
 * 2026-05-25 by the home widgets §6.2b step bodies manager).
 *
 * The previous flow jumped straight from typing into the project's
 * Overview field to BeakerBot announcing notifications, visually
 * jarring because the user was still parked inside the project page.
 * This step gives the route change a visible beat:
 *
 *   1. BeakerBot says he's heading back home (and telegraphs widgets
 *      next, not notifications, per the §6.2b insertion 2026-05-25).
 *   2. The cursor glides to the Home tab in the top navbar (no click;
 *      the AppShell nav is disabled during walkthrough mode anyway).
 *   3. expectedRoute "/" fires the TourController's router.push so the
 *      browser actually navigates while the cursor is at the Home tab.
 *   4. Manual advance into §6.2b `home-widgets-canvas-intro` once the
 *      user clicks Got it, next.
 *
 * Copy refresh (home widgets §6.2b step bodies manager, 2026-05-25):
 * the prior copy promised notifications next ("show you notifications");
 * §6.2b now sits between this step and §6.3, so the handoff sentence
 * telegraphs the widget canvas instead. The new §6.2b-exit step is
 * the one that telegraphs notifications and hands off to §6.3.
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
    return "Great. Let me show you how your dashboard works.";
  }
  return "Great. Let me take us back to your dashboard so we can look at it.";
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
