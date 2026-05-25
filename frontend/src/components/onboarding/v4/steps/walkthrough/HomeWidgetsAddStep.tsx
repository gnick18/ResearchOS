/**
 * §6.2b Home widgets walkthrough, STEP 3: add a widget.
 *
 * Third of five §6.2b sub-steps. Teaches the +Add widget affordance:
 * the cursor clicks the button, the catalog popup opens, BeakerBot
 * lets the user see what's there, then the cursor picks one catalog
 * entry and the new tile lands on the canvas.
 *
 * Cursor + spotlight:
 *   - spotlight on `home-widget-add-button` (the +Add widget button in
 *     the canvas toolbar).
 *   - cursor clicks the button. SnapshotCanvas's `setShowPalette(true)`
 *     mounts the catalog popup, which carries
 *     `data-tour-target="home-widget-catalog"`. Note: clicking +Add
 *     while not in edit mode auto-enters edit mode FIRST (the canvas
 *     toolbar's onClick handles this, see SnapshotCanvas.tsx). Edit
 *     mode then unlocks drag handles for Step 4.
 *   - beat for the user to see the catalog.
 *   - cursor clicks a specific catalog entry to add the tile. We pick
 *     `lab-activity-by-type` because it's home-visible, member-visible,
 *     NOT in the Chip A pre-seed set (so the toggle adds rather than
 *     removes), and the tile is small enough to land without rearranging
 *     the canvas dramatically.
 *
 * Classification: BEAKERBOT DEMO. Speech says "I'll open the catalog
 * so you can see what's there", an explicit BeakerBot-led promise; the
 * cursor performs the click as advertised. The pick-one click is also
 * cursor-driven; the universal pacing rule (Grant 2026-05-22) means we
 * still wait on a manual "Got it, next" advance after the tile lands
 * so the user controls the actual step transition.
 *
 * §6.2b R1 gating (2026-05-25, fresh-eyes fix): the "Got it, next"
 * button is gated on a `HOME_WIDGETS_ADD_DEMO_DONE_EVENT` window event
 * fired at the end of the cursor script. Without the gate, the button
 * is clickable while BeakerBot is mid-demo and the user cannot tell
 * whether to wait or advance. With the gate, the button reads as
 * disabled (with a "BeakerBot is demonstrating..." aria-label) until
 * the demo finishes, then enables. Mirrors the
 * `gantt-share-profile-switch` pattern (`disabledUntilEvent` +
 * `disabledAriaLabel`), the same one Grant locked in for "wait for the
 * write" demos at R2.
 *
 * Persistence (per the locked design): the added widget STAYS in the
 * user's layout. Step 5 copy already says "you can come back any time,
 * swap widgets in and out", which is the permission slip to remove
 * what BeakerBot added if they don't want it. Mirrors how §6.1 leaves
 * the demo project in place (option A in the proposal §6).
 *
 * Why deferred-click on the catalog item:
 *
 *   The catalog popup mounts AFTER the +Add click. At cursor-script
 *   build time, the catalog item nodes don't exist in the DOM, so
 *   `safeClickAction` would resolve null and the pick never fires.
 *   `deferredClickAction` re-queries the selector at PLAYBACK time so
 *   it runs after the catalog mount, and (post §6.2b R1) sets
 *   `__beakerBotCursorClicking` around the native `.click()` plus
 *   scrolls the item into view (the catalog can be tall enough that
 *   `lab-activity-by-type` sits below the viewport fold at 1440x900).
 */
import {
  callbackAction,
  compactScript,
  cursorScript,
  deferredClickAction,
  pause,
  safeClickAction,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/**
 * The catalog entry the demo picks. `lab-activity-by-type` is a small
 * 3-column tile (today's activity split into tasks / notes / purchases)
 * that's home-visible + member-visible and NOT in the Chip A pre-seed
 * default, so clicking the entry ADDS the tile rather than toggling it
 * off. Kept as an exported constant so the test asserts the demo's
 * pick deterministically: a future widget rename surfaces via test
 * failure rather than a silent miss.
 */
export const HOME_WIDGETS_ADD_DEMO_PICK_ID = "lab-activity-by-type";

/**
 * Per-item catalog selector. Builds the `home-widget-catalog-item-<id>`
 * value the SnapshotCanvas stamps on each catalog button. The catalog
 * stays mounted across the pick-and-settle so this selector still
 * resolves at playback (deferred-click re-queries at runtime).
 */
export const HOME_WIDGETS_ADD_CATALOG_ITEM_SELECTOR = `[data-tour-target="home-widget-catalog-item-${HOME_WIDGETS_ADD_DEMO_PICK_ID}"]`;

/**
 * Window CustomEvent name used to gate this step's "Got it, next"
 * button. Fired by the trailing callback in the cursor script after
 * the catalog pick lands. The TourController's `disabledUntilEvent`
 * machinery (see TourController.tsx) subscribes to this name at step
 * entry, unsubscribes on exit, and re-enables the button when the
 * event fires.
 *
 * Exported so the registry test can assert the wiring shape and so
 * the TourController's listener can pattern-match if needed.
 */
export const HOME_WIDGETS_ADD_DEMO_DONE_EVENT =
  "tour:home-widgets-add-demo-done";

export const homeWidgetsAddStep = buildWalkthroughStep({
  id: "home-widgets-add",
  speech:
    "Add as many or as few widgets as you want. Some labs run lean with a couple tiles, others pack in everything they track. I'll open the catalog and add one so you can see how it lands on the canvas.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.homeWidgetAddButton),
  cursorScript: cursorScript(async () => {
    // Click the +Add widget button. SnapshotCanvas auto-enters edit
    // mode if needed and mounts the catalog popup synchronously on
    // the next React commit.
    const clickAdd = await safeClickAction(
      targetSelector(TOUR_TARGETS.homeWidgetAddButton),
      2000,
    );
    // Beat for the user to read the speech bubble and see the catalog
    // open. 1500ms is enough to register the popup and the first few
    // entries without dragging the step.
    const beat = pause(1500);
    // Pick one entry. Re-resolve at playback because the catalog item
    // doesn't exist at script-build time (the popup hasn't mounted yet).
    // The toggle ADDS the widget because `lab-activity-by-type` is not
    // in the Chip A pre-seed set.
    const clickPick = deferredClickAction(
      HOME_WIDGETS_ADD_CATALOG_ITEM_SELECTOR,
      3000,
    );
    // Trailing callback: fire the demo-done event so the gated "Got
    // it, next" button flips from disabled to enabled. Sits after the
    // pick so the button only enables once the tile has landed. A
    // short pause after the pick gives the tile a moment to render
    // before the button enables, so the user sees the result before
    // they get an enabled advance affordance.
    const settle = pause(500);
    const fireDone = callbackAction(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(HOME_WIDGETS_ADD_DEMO_DONE_EVENT));
      }
    });
    return compactScript([clickAdd, beat, clickPick, settle, fireDone]);
  }),
  // Manual advance gated on the demo-done event (§6.2b R1 fresh-eyes
  // fix). The button renders disabled with "BeakerBot is
  // demonstrating..." aria-label while the cursor is mid-play, then
  // enables when the trailing callback dispatches the event. Mirrors
  // the gantt-share-profile-switch pattern Grant locked in at R2.
  completion: manualAdvance("Got it, next", {
    disabledUntilEvent: HOME_WIDGETS_ADD_DEMO_DONE_EVENT,
    disabledAriaLabel: "BeakerBot is demonstrating, hold on a moment...",
  }),
  expectedRoute: "/",
});
