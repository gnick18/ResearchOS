/**
 * §6.4a Methods page — category creation. First of three method sub-steps
 * (§6.4a category, §6.4b/c type breadth + compound, §6.4d funny markdown
 * method).
 *
 * Cursor demos the folder-tree affordance to create a first category.
 * Types a placeholder category name. Saves.
 *
 * Manual advance once the cursor finishes typing — the create-category
 * surface doesn't fire a public API event for category creation, so
 * waiting on a real event would require additional plumbing out of
 * P5's scope. The cursor script does the type-and-save sequence
 * end-to-end; the user just confirms.
 *
 * Artifact:
 *   { type: "category", id: "<categoryName>", cleanup_default: "keep" }
 *
 * Category cleanup lives in the Phase 4 grid (P8). The cleanup_default
 * here is "keep" — categories are lightweight metadata; the user
 * picked the name + may want to keep it.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

const CATEGORY_NAME = "My First Methods";

export const methodsCategoryStep = buildWalkthroughStep({
  id: "methods-category",
  speech:
    "Methods page. First, a category to file things under. I'll set one up now.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsAddCategory),
  cursorScript: cursorScript(async () => {
    const openAffordance = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsAddCategory),
    );
    const typeName = await safeTypeAction(
      targetSelector(TOUR_TARGETS.methodsCategoryNameInput),
      CATEGORY_NAME,
    );
    return compactScript([openAffordance, typeName]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
});
