/**
 * §6.12 Wiki pointer — final universal walkthrough step.
 *
 * Brief: BeakerBot clicks the Wiki tab, landing page loads, cursor
 * scrolls once. Speech outro: "OK, back to your work."
 *
 * Auto-advance — wiki page renders and we move on. No artifact.
 *
 * Classification: NAVIGATION + BEAKERBOT DEMO (per Grant's design
 * correction 2026-05-21). Speech is "If you ever get stuck, the Wiki
 * tab has guides. I'll show you where it is. Then back to your work."
 * The "I'll show you where it is" is an explicit navigation-led
 * promise. Cursor performs the wiki-tab click as advertised: exactly
 * the case where the rule lets BeakerBot do the navigation while his
 * speech narrates ("I'll show you").
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
