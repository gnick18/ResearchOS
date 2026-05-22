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
 *
 * No `expectedRoute` is declared, on purpose (conflict-fix 2026-05-21):
 * the cursor click on `wiki-nav-tab` IS the navigation. Setting
 * `expectedRoute: "/wiki"` would race the controller's `router.push`
 * against the cursor click, making the auto-nav land first and turning
 * the demo into either a no-op (no visible nav) or a redundant
 * post-nav click on whatever wiki-nav-tab the destination page already
 * has. Letting the cursor drive the navigation keeps the "I'll show
 * you where it is" speech honest: the user sees BeakerBot's cursor
 * click the tab in the AppShell navbar, and that click triggers the
 * route change through the navbar's existing next/link wiring.
 *
 * Cursor-cannot-span-navigation (§6.2 split rule) does NOT apply here
 * because the script is one action: the click. `runScript` resolves
 * once the click event dispatches; navigation begins on the microtask
 * AFTER the script's await chain completes, so the
 * `InProductWalkthroughOverlay` unmount on route change can't cancel
 * an in-flight action. The 3s auto-advance timer lives on the
 * TourController (app-shell-level provider), survives the route
 * change, and fires regardless of overlay remount state — leaving
 * the destination page enough breath to render before §6.17 cleanup
 * (or whichever step follows) takes over.
 */
import {
  cursorScript,
  safeGlideToElementAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

// Live-test R4 (2026-05-22): the prior cursor-click variant navigated
// to /wiki/features/search, whose layout has its own provider tree
// WITHOUT V4MountForUser, killing the v4 tour mid-walk and stranding
// §6.13 telegram / §6.14 purchases / §6.15 calendar / §6.16 lab tour
// for full-path users. Converted to a glide-only beat: cursor lands on
// the Wiki tab as a visual anchor, no click, no navigation. Speech
// rewritten to drop the "I'll show you where it is" navigation
// promise.
export const wikiPointerStep = buildWalkthroughStep({
  id: "wiki-pointer",
  speech:
    "If you ever get stuck, the Wiki tab up here has guides. Come back to it anytime.",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.wikiNavTab),
  cursorScript: cursorScript(async () => {
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.wikiNavTab),
    );
    return compactScript([glide]);
  }),
  completion: autoAdvanceAfter(3000),
});
