/**
 * §6.4a-demo Methods page — category creation (v4 sec 6.4 redesign per
 * Grant 2026-05-21 feedback).
 *
 * Second beat of the split picker-then-demo flow. The prompt step
 * (`methods-category-prompt`, in MethodsCategoryPromptStep.tsx) wrote
 * the user's category label to localStorage; this step reads it on
 * cursorScript build and demos creating that category:
 *
 *   1. Cursor clicks the page-header "+ New Category" affordance.
 *   2. CreateCategoryModal mounts; cursor types the picked label into
 *      the category-name input.
 *   3. The methods page's CreateCategoryModal save handler fires
 *      `handleCategoryCreated`, which dispatches the
 *      `tour:methods-category-created` window event. The step's
 *      completion contract advances on that event.
 *
 * Step id stays `methods-category` for backward compatibility with
 * resume-state writes, sidecar artifact cleanup, etc. The file is
 * still named MethodsCategoryStep.tsx but the export is now
 * `methodsCategoryDemoStep` to reflect the picker / demo split. Other
 * call-sites (registry, step-machine ordering, tests) import the
 * named export.
 *
 * Artifact:
 *   { type: "category", id: "<pickedLabel>", cleanup_default: "keep" }
 *
 * The cleanup_default stays "keep" — categories are lightweight
 * metadata; the user picked the label themselves so they're more
 * likely to want it preserved than the original "My First Methods"
 * placeholder name was.
 *
 * Classification: BEAKERBOT DEMO (per Grant 2026-05-21 cursor
 * responsibility rule). Speech is "let's set up X" (BeakerBot-led);
 * the cursor performs the click and type.
 *
 * Fallback: if the picker step's localStorage write was dropped (e.g.
 * private-mode Safari, user back-stepped past the prompt without
 * picking), the demo falls back to "My First Methods" — the same
 * label the pre-redesign step used. This guarantees the demo never
 * wedges on a missing pick.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
  callbackAction,
} from "./lib/cursor-script";
import {
  manualAdvance,
  buildWalkthroughStep,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { TOUR_DOM_EVENTS } from "./lib/tour-events";
import { readMethodsCategoryPick } from "./MethodsCategoryPromptStep";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";
import { withCategoryModalOpen } from "./lib/on-enter-helpers";

const STEP_ID = "methods-category";

/** Hardcoded fallback if the picker hand-off was dropped. Matches the
 *  pre-redesign placeholder so existing screenshots / fixture data
 *  don't drift on a missing pick. */
export const METHODS_CATEGORY_FALLBACK = "My First Methods";

/** Read-then-watch pause between the cursor's type + submit beats
 *  (Methods fix manager 2026-05-22). 800ms is the same cadence the
 *  §6.10 `ai-helper-size-diff` demo uses. Gives the user time to
 *  register the typed label in the input before the cursor jumps to
 *  Create Empty. Exported so the pacing test can pin the duration. */
export const METHODS_CATEGORY_PAUSE_MS = 800;

/** Sleep helper for the callbackAction pause. */
async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== "undefined") {
      window.setTimeout(resolve, ms);
    } else {
      setTimeout(resolve, ms);
    }
  });
}

/** Resolve the picked label out of localStorage with the fallback
 *  applied. Exported for tests so they can assert the fallback path
 *  without poking localStorage internals. */
export function resolvePickedCategoryLabel(): string {
  const picked = readMethodsCategoryPick();
  if (picked && picked.trim()) return picked.trim();
  return METHODS_CATEGORY_FALLBACK;
}

export const methodsCategoryDemoStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: () => {
    const label = resolvePickedCategoryLabel();
    return `Great, let's set up ${label} as your first category. Watch.`;
  },
  pose: "pointing",
  // R2 chip E Fix 2: spotlight the modal's name input (where the cursor
  // action happens), not the page-header "+ New Category" button. The
  // previous-beat `methods-category-open` step already opened the modal
  // for the user; by the time this demo step runs, the modal is
  // mounted and the +New button is no longer the locus of action.
  targetSelector: targetSelector(TOUR_TARGETS.methodsCategoryNameInput),
  cursorScript: cursorScript(async () => {
    // Grant 2026-05-21 rethink: the user opens the modal themselves in
    // the previous `methods-category-open` step. The demo step's job
    // is JUST to type the picked label and click Create Empty.
    const label = resolvePickedCategoryLabel();
    const typeName = await safeTypeAction(
      targetSelector(TOUR_TARGETS.methodsCategoryNameInput),
      label,
    );
    const submit = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsCategoryCreateEmpty),
    );
    // Methods fix manager 2026-05-22: 800ms read-then-watch pause
    // between typing the category label and clicking Create Empty.
    // Without it the cursor blew through too fast for the user to see
    // the typed label before the modal closed.
    return compactScript([
      typeName,
      callbackAction(() => pause(METHODS_CATEGORY_PAUSE_MS)),
      submit,
    ]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  // The `tour:methods-category-created` event still fires as a
  // side-effect signal — onEnter listens to capture the artifact
  // label — but the step advances on the user's manual click.
  completion: manualAdvance("Got it, next"),
  // Methods fix manager 2026-05-22: full page-lock during the
  // BeakerBot demo. Cursor clicks pass through via the
  // `__beakerBotCursorClicking` flag; only stray user clicks are
  // blocked, preventing the user from accidentally clicking outside
  // the New Category modal and soft-walking themselves out of the
  // tour. Empty allowList = total lock (only the speech bubble's
  // Got-it / Skip / Back are interactive).
  pageLock: {
    allowList: [],
    pillLabel: "Hold on a moment, BeakerBot is filling in the category.",
  },
  // Capture the new category label out of the `tour:methods-category-created`
  // event detail so Phase 4 cleanup grid renders the right row. The
  // category is local-state only (no backend id), so the label itself
  // doubles as the artifact id — `Phase4CleanupStep.describeArtifact`
  // renders "Method folder: <label>" from this. cleanup_default "keep"
  // because the user picked the label themselves (per the methods-
  // category-prompt beat).
  // tour-modal-resilience bot 2026-06-03: this demo types into the New
  // Category modal's name input (`methods-category-name-input`) and
  // clicks Create Empty; the modal is opened by the prior
  // `methods-category-open` bridge step. The modal is local React state
  // (not a route), so a mid-tour refresh closes it and this beat's
  // cursor + spotlight fire into nothing. Compose the modal-reopen guard
  // AHEAD of the existing category-created listener (mirrors the
  // experiment-popup `withExperimentPopupOpen` composition). Both best-
  // effort; reopen is a no-op on the canonical (non-refresh) path.
  onEnter: withCategoryModalOpen(() => {
    if (typeof window === "undefined") return;
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<{ categoryName?: string }>).detail;
      const label = detail?.categoryName?.trim();
      const id = label && label.length > 0 ? label : resolvePickedCategoryLabel();
      pendingArtifactStore.add(STEP_ID, {
        type: "category",
        id,
        cleanup_default: "keep",
      });
      window.removeEventListener(
        TOUR_DOM_EVENTS.methodsCategoryCreated,
        handler,
      );
    };
    window.addEventListener(
      TOUR_DOM_EVENTS.methodsCategoryCreated,
      handler,
    );
  }),
  onExit: async () => {
    // Persist the captured category artifact to the sidecar so the
    // Phase 4 cleanup grid (P8) lists it under "Methods" with the
    // user-picked label.
    await flushPendingArtifacts(STEP_ID);
    // NOTE (experiment-flow fix manager, 2026-05-27): the
    // `clearMethodsCategoryPick()` call that used to live here moved to
    // `MethodsCreateStep`'s onExit. The §6.4d methods-create demo reads
    // the picked label to type into the Folder input; clearing here
    // wiped the value before that read ever happened, so the funny
    // markdown method landed in the "Methods" fallback folder instead
    // of the user's category. The clear still happens at end-of-flow,
    // just one step later.
  },
  expectedRoute: "/methods",
});

/**
 * Backward-compat alias. The registry + tests still import
 * `methodsCategoryStep`; we re-export the demo step under the
 * original name so a future grep for `methodsCategoryStep` still
 * lands on the right body.
 */
export const methodsCategoryStep = methodsCategoryDemoStep;
