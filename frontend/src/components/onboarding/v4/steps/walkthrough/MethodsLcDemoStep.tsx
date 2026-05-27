/**
 * §6.4b LC Gradient editor demo (Wave 2A skeleton, 2026-05-27; scroll-
 * and-demo fix manager 2026-05-27).
 *
 * Re-introduced by Grant's 2026-05-27 tour script rewrite. Sits between
 * `methods-type-tour` (PCR builder demo) and `methods-create` (standard
 * markdown method). Cursor opens the LC Gradient editor and scrolls the
 * live chart into view; the user pokes at it and clicks "Got it, next"
 * when ready.
 *
 * Wave 1 shipped the skeleton (correct id + voice + spotlight + manual
 * completion). Wave 2 fix-pass (2026-05-27 scroll-and-demo fix manager)
 * filled in the cursor script: click LC Gradient tile + scroll the
 * inner modal container so the chart is visible. No interactive edits
 * per Grant's brief — the chart updates as the user pokes the table
 * values, which is the point of the editor.
 *
 * Voice classification per the new script: BEAKERBOT_DEMO
 * Spotlight: LC Gradient tile (`methodsTypeLcGradientTile`) so the
 *   spotlight ring lands on the affordance the cursor is about to
 *   click. The viewportAnchor + post-click scroll callback handle
 *   bringing the chart into view.
 * Completion: manual ("Got it, next")
 * ExpectedRoute: methods catalog / LC editor — unset because the LC
 *   editor opens inside the CreateMethodModal that's already mounted
 *   when this step fires.
 *
 * methods-tour scroll-and-demo fix manager
 */
import {
  cursorScript,
  safeClickAction,
  callbackAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/** Read-then-watch pause between the cursor's visible actions, matched
 *  to the breadth step's cadence so the cluster reads consistently. */
const METHODS_LC_DEMO_PAUSE_MS = 800;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const methodsLcDemoStep = buildWalkthroughStep({
  id: "methods-lc-demo",
  speech:
    "And here is the LC Gradient editor. Scroll down inside the modal to see the live chart that updates as you change values in the table. Click \"Got it, next\" when you're ready to move on.",
  pose: "pointing",
  // No targetSelector. Hand-walk fix 2026-05-27 (third pass): same
  // root cause as methods-type-tour. The spotlight on the LC tile at
  // the top of the modal made TourSpotlight's keep-in-view logic
  // auto-scroll the modal back up whenever the user tried to scroll
  // down to see the chart. Dropping the spotlight unblocks scroll.
  cursorScript: cursorScript(async () => {
    // 1) Click the LC Gradient tile. The picker is already mounted
    // from the prior methods-type-tour beat (the CreateMethodModal
    // stays open across the methods cluster), so the LC editor mounts
    // in-place inside the modal's `flex-1 overflow-y-auto` body.
    const clickLc = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsTypeLcGradientTile),
      2000,
    );

    // 2) Pause so the user sees the editor mount, then hand control
    // back to the user.
    const pauseAfterTileClick = callbackAction(() =>
      pause(METHODS_LC_DEMO_PAUSE_MS),
    );

    // No scripted scroll. Hand-walk fix 2026-05-27 follow-up: the
    // prior multi-shot `ensureViewportAnchor` loop never settled
    // because the LC editor's recharts mount + focus management keep
    // resetting the modal's inner scroll position. While the loop was
    // running the InputLockOverlay also blocked the user's own wheel
    // scroll, soft-locking the page. The speech now invites the user
    // to scroll down themselves, which works fine once the cursor
    // script ends and the lock unmounts.

    return compactScript([clickLc, pauseAfterTileClick]);
  }),
  // Universal pacing rule (Grant 2026-05-22): BeakerBot-led demo steps
  // wait for the user. The chart is now visible; the user pokes the
  // gradient table values if they want, then clicks Got it, next.
  completion: manualAdvance("Got it, next"),
  // Allow-list lock so the user can play with the LC editor (per
  // speech "click around") without accidentally walking off the tour.
  // methodsCreateForm covers the whole CreateMethodModal subtree
  // including the now-mounted LC editor.
  pageLock: {
    allowList: [TOUR_TARGETS.methodsCreateForm],
    pillLabel: "Play with the LC Gradient. Hit Got it, next when you're ready.",
  },
  // No viewportAnchor: the modal is already in view (it's a portal
  // covering most of the screen); anchoring re-snaps the scroll up
  // and fights the user's wheel.
});
