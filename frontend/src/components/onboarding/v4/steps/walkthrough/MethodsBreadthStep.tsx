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
  ensureViewportAnchor,
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
        Opening the PCR builder now. Try adjusting one of the gradient
        steps to see how it feels, then click &quot;Got it, next&quot;
        to see the LC Gradient editor.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsTypePcrTile),
  cursorScript: cursorScript(async () => {
    // 1) Wait for the picker (already visible from the open-picker beat
    // immediately preceding this step). Click PCR -> the
    // InteractiveGradientEditor mounts inside the same modal.
    await waitForElement(targetSelector(TOUR_TARGETS.methodsTypePicker), 3000);
    const clickPcr = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsTypePcrTile),
      2000,
    );

    // 2) Pause so the user sees the editor mount before the scroll
    // moves the viewport.
    const pauseAfterTileClick = callbackAction(() =>
      pause(METHODS_PCR_DEMO_PAUSE_MS),
    );

    // 3) Scroll the modal's inner overflow-y-auto container so the PCR
    // builder (Thermal Gradient header + InteractiveGradientEditor +
    // Reaction Recipe) is visible. The CreateMethodModal body is taller
    // than the typical viewport, so the builder mounts below the fold.
    //
    // We loop the scroll a few times with short pauses to outlast any
    // post-mount layout shifts inside the LC/PCR editor that could
    // reset the scroll position (e.g., focus management, recharts
    // mounting). Programmatic scrollIntoView is not a wheel event, so
    // the InputLockOverlay's wheel block doesn't gate it.
    const scrollBuilderIntoView = callbackAction(async () => {
      await waitForElement(
        targetSelector(TOUR_TARGETS.pcrEditorWrapper),
        2000,
      );
      for (let i = 0; i < 3; i += 1) {
        await ensureViewportAnchor(
          targetSelector(TOUR_TARGETS.pcrEditorWrapper),
          2000,
        );
        await pause(250);
      }
    });

    return compactScript([
      clickPcr,
      pauseAfterTileClick,
      scrollBuilderIntoView,
    ]);
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
  // Viewport anchor for step entry. The post-click scroll callback
  // handles bringing the builder into view once PCR is selected.
  viewportAnchor: targetSelector(TOUR_TARGETS.methodsCreateForm),
});
