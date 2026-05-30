/**
 * §6.2 Project route Overview (NAV sub-step).
 *
 * First of two §6.2 sub-steps. BeakerBot glides the cursor to the auto-created
 * Single Project widget tile (the one pinned to the project the user just made
 * in §6.1) on the dashboard, clicks it, and advances the moment
 * `tour:project-route-entered` fires (dispatched by `ProjectRoute.tsx` on
 * mount). The follow-up PROSE sub-step
 * (`project-overview-prose`) then types the placeholder hypothesis into
 * the Overview textarea with a fresh `InProductWalkthroughOverlay` mount
 * plus a fresh cursor ref.
 *
 * Split rationale (Grant 2026-05-21): a single cursor script that tried
 * to click the card AND type into the textarea on the next page never
 * actually typed. The route change unmounts the overlay, recreates the
 * cursor ref, and the cursor-script useEffect's `cancelled` cleanup
 * fires, cancelling the in-flight `runScript` promise before the type
 * action can execute. Cursor scripts can't span navigation. The §6.1
 * trigger / fill split established the precedent; §6.2 mirrors it.
 *
 * Classification: BEAKERBOT DEMO plus NAVIGATION. Speech is "I'm taking
 * us into your project", an explicit BeakerBot-led promise to navigate.
 * The cursor performs the project-card click as advertised.
 *
 * No artifact tracking on this sub-step. The project artifact lands in
 * §6.1's fill sub-step; this is pure navigation.
 *
 * Pose: `pointing` is the click-affordance pose (per the home
 * walkthrough's pattern). `pointing-up` would tilt at the wrong angle
 * for an inline project card.
 */
import { cursorScript, safeNavClickAction } from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";

export const projectOverviewNavStep = buildWalkthroughStep({
  id: "project-overview-nav",
  speech:
    "Every experiment, method, and task you create gets attached to a project. The project page is where all of that comes back together in one view. Let's open the one you just made.",
  pose: "pointing",
  // No targetSelector: the cursor click on the Single Project widget tile is
  // the visual cue. A spotlight on the tile would dim the rest of the
  // dashboard and steal focus from the click animation. The tile body is
  // anchored by its `data-tour-target="home-single-project-open-<owner>-<id>"`
  // attribute set in `SingleProjectWidget.tsx` (stamped only when pinned).
  cursorScript: cursorScript(async () => {
    // Top-level New Project rework (dashboard-newproject-tour bot,
    // 2026-05-29): the §6.1 create auto-pins the new project to a Single
    // Project widget on the dashboard, so the NAV beat clicks THAT tile
    // instead of the (now-deleted) hardcoded project card. The tile body's
    // onClick navigates straight to the project page.
    //
    // §6.2 NAV root cause (manager 2026-05-23, still applies): the
    // dashboard's `projects-with-progress` useQuery refetches around the
    // time the tour arrives here (the §6.1 create just landed + invalidated
    // it). The refetch re-renders the tile, swapping out its DOM node.
    // `safeClickAction` resolves the el at BUILD time; by playback that ref
    // is detached and `el.click()` fires on a node not in the tree, so
    // navigation never runs.
    //
    // Fix: `safeNavClickAction` glides to the tile visually at build-time
    // coords, but RE-RESOLVES the selector at PLAYBACK time inside a callback
    // action and calls `.click()` on the FRESH node, routing through React's
    // delegation so the tile's `router.push` lands as intended. The prefix
    // selector matches whichever single-project instance the §6.1 project
    // produced (the instance id carries the project's owner + id).
    return safeNavClickAction(
      "[data-tour-target^='home-single-project-open-']",
      2000,
    );
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  // The cursor's project-card click drives the actual route change;
  // the user sees the navigation land and then clicks Next.
  completion: manualAdvance("Got it, next"),
  // Auto-navigate to home so the project card anchor resolves on
  // refresh. The cursor click then pushes us into the project route.
  expectedRoute: "/",
});
