/**
 * §6.4b Methods page, PCR builder show-off (v4 sec 6.4b upgrade
 * sub-bot, 2026-05-21; LC removal + edit-cycle pump-up methods-cluster
 * sub-bot 2026-05-26).
 *
 * Sits AFTER the file-vs-markdown explainer (`methods-file-vs-markdown`)
 * and BEFORE the funny markdown method demo (`methods-create`). The
 * file-vs-markdown step has already set the user's mental model around
 * the common-case methods (file attach + markdown editor); this step's
 * job is to show off ONE interactive builder so the user knows the
 * builders exist and that they're worth poking at for the specific
 * common method types that have them.
 *
 * Grant 2026-05-26 live-test feedback on the prior LC follow-up: "I
 * think we can remove this from the method, if we flesh out the PCR
 * show off that is good enough". The LC Gradient deep-demo
 * (`methods-lc-demo`, MethodsLcDemoStep.tsx) was deleted entirely; this
 * step now carries the interactive-builder narrative on its own. Grant
 * also asked for "2 edits to the gradient to show them that its
 * editable, then have them play around" so the cursor script now:
 *
 *   1. Clicks the PCR tile (the editor mounts inside the same modal).
 *   2. Clicks "Edit Cycle" to flip into edit mode (the toolbar expands).
 *   3. Edits the denaturation temperature input (95 -> 94, visually
 *      obvious change to a clearly numeric field).
 *   4. Edits the annealing time input (30 -> 45, again numeric +
 *      obvious).
 *   5. Hands off to free-play via manualAdvance + the page-lock pill.
 *
 * Builder pattern (per prior investigation): CreateMethodModal is a
 * modal-in-place pattern, NOT a route nav. The picker
 * (`MethodTypeCategoryPicker`) renders ALWAYS at the top of the modal
 * regardless of `uploadType`; the per-type editor renders below it.
 * Clicking another tile swaps the editor in the same DOM subtree
 * without navigating. The modal stays mounted across the methods
 * cluster, and `methodsCreateStep` picks up with the same modal still
 * open and just switches back to Markdown.
 *
 * Cursor responsibility: BEAKERBOT DEMO. Speech narrates the live
 * edits, the cursor performs them.
 *
 * Completion: manualAdvance("Got it, next") so the user has time to
 * poke at the PCR builder after the cursor's edits land.
 *
 * No artifact (the modal stays open; the eventual methodsCreateStep
 * saves a Markdown method, this builder pivot persists nothing).
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  callbackAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/**
 * The tiles the breadth-step demo visits. PCR-only after Grant's
 * 2026-05-26 LC removal (methods-cluster sub-bot): the prior LC
 * Gradient follow-up step is gone, and PCR carries the interactive-
 * builder narrative on its own.
 *
 * Kept as an exported const so the v4 sec 6.4b upgrade tests can
 * assert the demo visits exactly this tile and no others (regression
 * guard against re-introducing the wide hover sweep).
 */
export const METHODS_BREADTH_TILE_TARGETS = ["method-type-pcr"] as const;

/**
 * Read-then-watch pause between the cursor's visible actions. Matches
 * the 800ms canonical cadence used by methods-category / methods-create
 * so the live-edit beats feel paced like the rest of the cluster.
 */
export const METHODS_PCR_DEMO_PAUSE_MS = 800;

/** Demo values the cursor types into the StepEditPopup. The defaults
 *  the popup seeds with ("New Step" / 60 / 30 sec) get replaced with
 *  values that read as a recognisable PCR denaturation step. Exported
 *  for the test so the assertion can reference the exact strings. */
export const METHODS_PCR_DEMO_TEMP = "94";
export const METHODS_PCR_DEMO_DURATION = "45 sec";

/** Small helper used in the demo's callback steps. Clears the value of
 *  an input via the React-safe setter (setNativeInputValue lives inside
 *  BeakerBotCursor.tsx but the same approach works inline). Without
 *  this, the cursor's `type` action APPENDS to the input's current
 *  value, which would yield "6094" instead of "94". The setter pattern
 *  fires onChange so React's state stays in sync. */
function clearInputValue(target: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLInputElement>(target);
  if (!el) return;
  const proto =
    el instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) {
    el.value = "";
  } else {
    setter.call(el, "");
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Sleep helper used inside the demo's callback pauses. Matches the
 *  pattern from MethodsCategoryStep / MethodsCreateStep. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const methodsBreadthStep = buildWalkthroughStep({
  id: "methods-type-tour",
  speech: (
    <>
      <p className="mb-2">
        For specific common method types we have interactive builders
        that draw live charts and let you tweak parameters. PCR is the
        thermal cycle one. Let me open it and make a couple of live
        edits so you can see how the gradient is editable.
      </p>
      <p>
        Once I&apos;m done, the builder is all yours. Poke at the
        steps, try the eraser, add another cycle if you want. Hit Got
        it, next when you&apos;re ready to move on. The wiki has the
        full reference whenever you want details.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsTypePcrTile),
  cursorScript: cursorScript(async () => {
    // Wait for the picker (already visible from the open-picker beat
    // immediately preceding this step). 1) Click PCR tile -> the
    // InteractiveGradientEditor mounts inside the same modal.
    await waitForElement(targetSelector(TOUR_TARGETS.methodsTypePicker), 3000);
    const clickPcr = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsTypePcrTile),
      2000,
    );

    // 2) Pause so the user sees the editor mount before the next move.
    const pauseAfterTileClick = callbackAction(() =>
      pause(METHODS_PCR_DEMO_PAUSE_MS),
    );

    // 3) Click "Edit Cycle" -> toolbar expands, the Add Step / Add
    // Cycle / Eraser buttons mount.
    const clickEditCycle = await safeClickAction(
      targetSelector(TOUR_TARGETS.pcrEditToggle),
      2000,
    );

    const pauseAfterEditCycle = callbackAction(() =>
      pause(METHODS_PCR_DEMO_PAUSE_MS),
    );

    // 4) Click "+ Add Step" -> StepEditPopup mounts with defaults
    // (name "New Step", temperature 60, duration "30 sec"). The popup
    // is autoFocus'd on the name input.
    const clickAddStep = await safeClickAction(
      targetSelector(TOUR_TARGETS.pcrAddStep),
      2000,
    );

    // 5) Clear the temperature input and type the demo value. typeInto
    // APPENDS so we need a callback clear before the type action.
    const clearTemp = callbackAction(() => {
      clearInputValue(targetSelector(TOUR_TARGETS.pcrStepTempInput));
      return pause(150);
    });
    const typeTemp = await safeTypeAction(
      targetSelector(TOUR_TARGETS.pcrStepTempInput),
      METHODS_PCR_DEMO_TEMP,
      undefined,
      2000,
    );

    const pauseBetweenEdits = callbackAction(() =>
      pause(METHODS_PCR_DEMO_PAUSE_MS),
    );

    // 6) Clear the duration input and type the demo value. Same
    // clear-then-type pattern. Duration is a text input so the type
    // cadence reads naturally.
    const clearDuration = callbackAction(() => {
      clearInputValue(targetSelector(TOUR_TARGETS.pcrStepDurationInput));
      return pause(150);
    });
    const typeDuration = await safeTypeAction(
      targetSelector(TOUR_TARGETS.pcrStepDurationInput),
      METHODS_PCR_DEMO_DURATION,
      undefined,
      2000,
    );

    const pauseBeforeSave = callbackAction(() =>
      pause(METHODS_PCR_DEMO_PAUSE_MS),
    );

    // 7) Click Save -> popup closes, the new step lands in the
    // gradient flow with the edited temp + duration.
    const clickSave = await safeClickAction(
      targetSelector(TOUR_TARGETS.pcrStepSave),
      2000,
    );

    return compactScript([
      clickPcr,
      pauseAfterTileClick,
      clickEditCycle,
      pauseAfterEditCycle,
      clickAddStep,
      clearTemp,
      typeTemp,
      pauseBetweenEdits,
      clearDuration,
      typeDuration,
      pauseBeforeSave,
      clickSave,
    ]);
  }),
  // Grant 2026-05-21 rework: manual advance so the user has time to
  // poke at the PCR builder + read the speech bubble. The prior
  // 4-sub-step click-around drama moved too fast to follow.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
  // Methods fix manager 2026-05-22: allow-list lock so the user can
  // poke around the PCR builder (per the speech bubble's "click
  // around to get a feel for it") but can't accidentally click outside
  // the CreateMethodModal / category builder and soft-walk themselves
  // out of the tour. The methodsCreateForm anchor covers the whole
  // modal subtree, including the picker tiles + the just-mounted
  // InteractiveGradientEditor.
  pageLock: {
    allowList: [TOUR_TARGETS.methodsCreateForm],
    pillLabel: "Play with PCR. Hit Got it, next when you're ready.",
  },
  // §6.4b viewport anchor (input-lock + viewport-anchor sub-bot 2026-05-21):
  // the cursor only clicks the small PCR tile, but the user should see
  // the whole CreateMethodModal surface so the tile click context is
  // visible. Using the modal wrapper (methodsCreateForm) rather than a
  // narrower per-builder wrapper because this step is the picker entry —
  // the PCR builder hasn't mounted yet.
  viewportAnchor: targetSelector(TOUR_TARGETS.methodsCreateForm),
});
