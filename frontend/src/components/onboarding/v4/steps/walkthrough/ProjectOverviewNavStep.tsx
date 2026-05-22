/**
 * §6.2 Project route Overview (NAV sub-step).
 *
 * First of two §6.2 sub-steps. BeakerBot glides the cursor to the freshly
 * created project card on the home page, clicks it, and advances the
 * moment `tour:project-route-entered` fires (dispatched by
 * `ProjectRoute.tsx` on mount). The follow-up PROSE sub-step
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
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";

export const projectOverviewNavStep = buildWalkthroughStep({
  id: "project-overview-nav",
  speech: "I'm taking us into your project.",
  pose: "pointing",
  // No targetSelector: the cursor click on the project card is the
  // visual cue. A spotlight on the card would dim the rest of the home
  // page and steal focus from the click animation. The card is anchored
  // by its `data-tour-target="home-project-card-<id>"` attribute set in
  // `app/page.tsx`.
  cursorScript: cursorScript(async () => {
    // Click the most recently created project card. The `^=` attribute
    // selector matches any home-project-card-* (fine on a fresh tour
    // because §6.1 has just created the user's first project). If the
    // card never mounts (e.g. the project create failed), the safe
    // helper returns null and `compactScript` filters it out so the
    // step gracefully no-ops.
    const cardClick = await safeClickAction(
      "[data-tour-target^='home-project-card-']",
      2000,
    );
    return compactScript([cardClick]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  // The cursor's project-card click drives the actual route change;
  // the user sees the navigation land and then clicks Next.
  completion: manualAdvance("Got it, next"),
  // Auto-navigate to home so the project card anchor resolves on
  // refresh. The cursor click then pushes us into the project route.
  expectedRoute: "/",
});
