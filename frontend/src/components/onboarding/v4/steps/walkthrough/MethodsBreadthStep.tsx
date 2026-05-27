/**
 * §6.4b Methods page, PCR builder show-off.
 *
 * Sits in the methods cluster as the introductory beat to the
 * purpose-built interactive editors (PCR + LC Gradient). Cursor opens
 * the PCR builder so the user can see it; the user pokes the gradient
 * steps themselves to feel out how editable they are.
 *
 * History:
 *  - 2026-05-21: rebuilt as a single-tile show-off (LC Gradient lived
 *    on a separate follow-up step).
 *  - 2026-05-26 (methods-cluster sub-bot): LC follow-up dropped; PCR
 *    carried the whole interactive-builder narrative.
 *  - 2026-05-27 (script rewrite): LC Gradient demo reintroduced as
 *    `methods-lc-demo`; this step shrunk to PCR-only intro + handoff.
 *  - 2026-05-27 (scroll-and-demo fix manager): added scroll-into-view
 *    + scripted edit-cycle/add-step/type/save actions.
 *  - 2026-05-27 (Grant hand-walk fix): scripted edits scrolled BACK to
 *    the top of the modal because `safeClickAction` re-runs viewport
 *    fitting on each click target, undoing the scroll-down. Dropped
 *    the scripted edits entirely. Cursor now just clicks the PCR tile
 *    + scrolls the builder into view. The user plays with the gradient
 *    steps themselves. Speech updated to invite the user to try
 *    adjusting a gradient step.
 *
 * Cursor responsibility: BEAKERBOT_DEMO (opens the builder + scrolls
 * to it). Beyond that, the user explores.
 *
 * Completion: manualAdvance("Got it, next").
 */
import {
  cursorScript,
  safeClickAction,
  callbackAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/**
 * The tiles the breadth-step demo visits. PCR-only: the LC Gradient
 * demo lives on its own follow-up step (`methods-lc-demo`).
 *
 * Exported so tests can regression-guard against re-introducing the
 * old wide-hover sweep across multiple tiles.
 */
export const METHODS_BREADTH_TILE_TARGETS = ["method-type-pcr"] as const;

/** Read-then-watch pause between the cursor's visible actions. Matches
 *  the 800ms canonical cadence used by other methods-cluster steps. */
export const METHODS_PCR_DEMO_PAUSE_MS = 800;

/** Sleep helper used inside the demo's callback pauses. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const methodsBreadthStep = buildWalkthroughStep({
  id: "methods-type-tour",
  speech: (
    <>
      <p className="mb-2">
        For a handful of common techniques, ResearchOS gives you a
        purpose-built editor instead of plain text. PCR gets a thermal
        cycle builder. LC Gradient draws a live chart as you edit. There
        are others in the catalog, but I&apos;ll show you these two so
        you get the feel.
      </p>
      <p>
        Opening the PCR builder now. Scroll down inside the modal to
        see the thermal gradient and try adjusting one of the steps.
        Click &quot;Got it, next&quot; to see the LC Gradient editor.
      </p>
    </>
  ),
  pose: "pointing",
  // No targetSelector. Hand-walk fix 2026-05-27 (third pass): the
  // spotlight was anchored on the PCR tile at the top of the modal,
  // which made TourSpotlight's keep-in-view logic auto-scroll the
  // modal back up whenever the user tried to scroll down to see the
  // builder. Dropping the spotlight unblocks user scroll. The PCR
  // tile is highlighted in purple post-click anyway, so the visual
  // cue is preserved.
  cursorScript: cursorScript(async () => {
    // 1) Wait for the picker (already visible from the open-picker beat
    // immediately preceding this step). Click PCR -> the
    // InteractiveGradientEditor mounts inside the same modal.
    await waitForElement(targetSelector(TOUR_TARGETS.methodsTypePicker), 3000);
    const clickPcr = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsTypePcrTile),
      2000,
    );

    // 2) Pause so the user sees the editor mount, then hand control
    // back to the user.
    const pauseAfterTileClick = callbackAction(() =>
      pause(METHODS_PCR_DEMO_PAUSE_MS),
    );

    // No scripted scroll. Hand-walk fix 2026-05-27 follow-up: the
    // prior multi-shot `ensureViewportAnchor` loop never settled
    // because the CreateMethodModal's inner overflow container has
    // post-mount layout shifts that keep resetting the scroll
    // position. While the loop was running the InputLockOverlay also
    // blocked the user's own wheel scroll, soft-locking the page. The
    // speech now invites the user to scroll down themselves, which
    // works fine once the cursor script ends and the lock unmounts.

    return compactScript([clickPcr, pauseAfterTileClick]);
  }),
  // Manual advance: the user pokes at the PCR builder for as long as
  // they want, then clicks Got it, next to advance to methods-lc-demo.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
  // Allow-list lock so the user can play inside the CreateMethodModal
  // (per the speech "Try adjusting one of the gradient steps") without
  // accidentally clicking out of the tour.
  pageLock: {
    allowList: [TOUR_TARGETS.methodsCreateForm],
    pillLabel: "Play with PCR. Hit Got it, next when you're ready.",
  },
  // No viewportAnchor: the modal is already in view (it's a portal
  // covering most of the screen); anchoring re-snaps the scroll up
  // and fights the user's wheel.
});
