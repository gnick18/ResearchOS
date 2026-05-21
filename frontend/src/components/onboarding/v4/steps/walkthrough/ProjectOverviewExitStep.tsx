/**
 * §6.2 → §6.3 transition (Grant 2026-05-21 feedback).
 *
 * The previous flow jumped straight from typing into the project's
 * Overview field to BeakerBot announcing notifications — visually
 * jarring because the user was still parked inside the project page.
 * This step gives the route change a visible beat:
 *
 *   1. BeakerBot says he's heading back home.
 *   2. The cursor glides to the Home tab in the top navbar (no click;
 *      the AppShell nav is disabled during walkthrough mode anyway).
 *   3. expectedRoute "/" fires the TourController's router.push so the
 *      browser actually navigates while the cursor is at the Home tab.
 *   4. Auto-advance into §6.3 notifications-bell once the cursor settles.
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
  autoAdvanceAfter,
  buildWalkthroughStep,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const projectOverviewExitStep = buildWalkthroughStep({
  id: "project-overview-exit",
  speech: "Nice. Now let me head back to the home page to show you notifications.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.homeNavTab),
  cursorScript: cursorScript(async () => {
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.homeNavTab),
    );
    return compactScript([glide]);
  }),
  // expectedRoute drives the actual navigation. The cursor's job is to
  // give the user a visual anchor for "this is where I went"; the
  // router.push effect in TourController handles the browser nav. We
  // pad ~1500ms after the glide so the user sees the cursor land on
  // the Home tab before the page transition kicks in.
  completion: autoAdvanceAfter(1500),
  expectedRoute: "/",
});
