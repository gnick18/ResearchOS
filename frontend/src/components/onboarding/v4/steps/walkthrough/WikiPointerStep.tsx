/**
 * §6.12 Wiki pointer, final universal walkthrough cluster (2 beats).
 *
 * Wiki pointer redesign 2026-05-22 (Wiki pointer manager), collapsed to
 * 2 beats 2026-06-03 (HR / tour-simplification). The wiki is a `?` icon
 * in the top right of the AppShell topbar, not a labeled tab. The cluster
 * now has two awareness beats:
 *
 *   1. `wiki-pointer-intro`, speech only. "There's a wiki with detailed
 *      documentation of every page in the app." Manual advance.
 *   2. `wiki-pointer-icon-spotlight`, spotlight the `?` icon in the
 *      topbar. Speech tells the user where to look AND, as awareness,
 *      what clicking it does (jump to the matching help article, back
 *      arrow returns them where they left off). Manual advance, advance
 *      lands on the next applicable step (purchases / calendar / etc).
 *
 * 2026-06-03 (HR / tour-simplification): Grant hand-walked the cluster
 * and found the two cursor navigation demos overbuilt for a single icon.
 * `wiki-pointer-click-demo` (cursor clicked the `?` icon and navigated to
 * the matching wiki page) and `wiki-pointer-back-demo` (cursor clicked
 * "Back to app" to return) were cut; the click-and-return behavior now
 * reads as one awareness sentence on the icon-spotlight beat. With no
 * BeakerBot-driven wiki navigation left in the tour, the wiki-pointer nav
 * suppression flag (wiki-pointer-nav-flag.ts) is no longer set from this
 * file, though the module + TourBootstrap's guard stay for safety.
 *
 * Per the universal pacing rule (Grant 2026-05-22), both beats use
 * `manualAdvance("Got it, next")` so the user controls the cadence.
 */
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { appRouteToWikiRoute } from "@/lib/wiki/nav";

/**
 * §6.12 beat 1 - speech-only intro.
 *
 * No spotlight, no cursor. Sets up the cluster by telling the user the
 * wiki exists and what's in it. Pose `pointing-up` matches the prior
 * single-beat body's pose so BeakerBot keeps the same vibe across the
 * cluster.
 */
export const wikiPointerIntroStep = buildWalkthroughStep({
  id: "wiki-pointer-intro",
  speech:
    "We also have a built-in wiki with detailed documentation for every page in the app, covering everything from search behavior to Gantt dependencies.",
  pose: "pointing-up",
  completion: manualAdvance("Got it, next"),
});

/**
 * §6.12 beat 2 - spotlight the `?` icon in the top bar.
 *
 * Spotlight only, no cursor. The icon lives in AppShell next to
 * NotificationBadge / InboxBadge / Settings,
 * stamped with `data-tour-target="wiki-nav-tab"`. Speech tells the user
 * where to look and, as awareness (no demo), what clicking it does and
 * how the back arrow returns them where they left off.
 */
export const wikiPointerIconSpotlightStep = buildWalkthroughStep({
  id: "wiki-pointer-icon-spotlight",
  speech:
    "If you're ever confused on a page, just click the question-mark icon up in the top right. It jumps you straight to the matching help article, and the back arrow brings you right back where you left off.",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.wikiNavTab),
  completion: manualAdvance("Got it, next"),
});

// Helper retained in this module so tests / debug surfaces can import
// the function used to resolve the wiki target from the current path.
// Re-export keeps `appRouteToWikiRoute` import-tree-discoverable
// alongside the step bodies.
export { appRouteToWikiRoute };
