/**
 * §6.12 Wiki pointer — final universal walkthrough step.
 *
 * Brief: BeakerBot clicks the Wiki tab, landing page loads, cursor
 * scrolls once. Speech outro: "OK, back to your work."
 *
 * Auto-advance — wiki page renders and we move on. No artifact.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const wikiPointerStep = buildWalkthroughStep({
  id: "wiki-pointer",
  speech:
    "If you ever get stuck, the Wiki tab has guides. I'll show you where it is. Then back to your work.",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.wikiNavTab),
  cursorScript: cursorScript(async () => {
    const click = await safeClickAction(targetSelector(TOUR_TARGETS.wikiNavTab));
    return compactScript([click]);
  }),
  completion: autoAdvanceAfter(3000),
  expectedRoute: "/wiki",
});
