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
} from "./lib/cursor-script";
import {
  advanceOnEvent,
  buildWalkthroughStep,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchMethodsCategoryCreated } from "./lib/tour-events";
import {
  clearMethodsCategoryPick,
  readMethodsCategoryPick,
} from "./MethodsCategoryPromptStep";

/** Hardcoded fallback if the picker hand-off was dropped. Matches the
 *  pre-redesign placeholder so existing screenshots / fixture data
 *  don't drift on a missing pick. */
export const METHODS_CATEGORY_FALLBACK = "My First Methods";

/** Resolve the picked label out of localStorage with the fallback
 *  applied. Exported for tests so they can assert the fallback path
 *  without poking localStorage internals. */
export function resolvePickedCategoryLabel(): string {
  const picked = readMethodsCategoryPick();
  if (picked && picked.trim()) return picked.trim();
  return METHODS_CATEGORY_FALLBACK;
}

export const methodsCategoryDemoStep = buildWalkthroughStep({
  id: "methods-category",
  speech: () => {
    const label = resolvePickedCategoryLabel();
    return `Great, let's set up ${label} as your first category. Watch.`;
  },
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsNewCategoryButton),
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
    return compactScript([typeName, submit]);
  }),
  // Event-driven: methods page dispatches
  // `tour:methods-category-created` from its category-create success
  // handler. The watcher fires once and the controller advances.
  completion: advanceOnEvent(watchMethodsCategoryCreated),
  onExit: () => {
    // Clear the pick after the demo consumes it so a re-run of the
    // tour starts fresh. Idempotent: safe to call when no pick was
    // ever written.
    clearMethodsCategoryPick();
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
