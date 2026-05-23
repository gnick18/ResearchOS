/**
 * §6.12 Wiki pointer — final universal walkthrough cluster (4 beats).
 *
 * Wiki pointer multi-beat redesign 2026-05-22 (Wiki pointer manager):
 * R7-D flagged the prior single `wiki-pointer` beat as misleading -
 * BeakerBot's speech said "the Wiki tab has guides" but the wiki is a
 * `?` icon in the top right of the AppShell topbar, not a labeled tab.
 * The replacement is a 4-beat arc that actually walks the user through
 * what the icon does:
 *
 *   1. `wiki-pointer-intro` — speech only. "There's a wiki page with
 *      detailed documentation of every page in the app." Manual advance.
 *   2. `wiki-pointer-icon-spotlight` — spotlight the `?` icon in the
 *      topbar. Speech tells the user where to look if they're curious or
 *      confused. Manual advance.
 *   3. `wiki-pointer-click-demo` — cursor clicks the `?` icon and the
 *      app navigates to the wiki page corresponding to the current route
 *      (`/wiki/features/home` from `/`, `/wiki/features/gantt` from
 *      `/gantt`, etc - see `appRouteToWikiRoute`). Manual advance.
 *   4. `wiki-pointer-back-demo` — on the wiki page, cursor clicks the
 *      "Back to app" button on the slim WikiTopBar to route back to
 *      wherever the user started. Manual advance, advance lands on the
 *      next applicable step (telegram / purchases / calendar / etc).
 *
 * Cross-tour-route concern (resolved): the wiki layout (see
 * `/wiki/layout.tsx`) has its own provider tree without AppShell. The
 * §6.12 R4 inline glide-only rework was made specifically because the
 * earlier click-through navigation killed the v4 tour mid-walk -
 * `providers.tsx`'s `isWikiRoute` early-return dropped V4MountForUser
 * for the wiki tree, so the controller unmounted and stranded every
 * downstream conditional + lab beat. The fix lives alongside this
 * redesign: `providers.tsx` now re-mounts V4MountForUser + the
 * OnboardingProvider inside the `isWikiRoute` branch when a real
 * signed-in user is present, so the tour controller survives the round
 * trip to `/wiki/*` and back. Click-demo + back-demo therefore run
 * real navigations the same way `project-overview-nav` does, with
 * `expectedRoute` declared so a refresh mid-cluster lands the user on
 * the right page on resume.
 *
 * Per the universal pacing rule (Grant 2026-05-22), every beat in this
 * cluster uses `manualAdvance("Got it, next")` so the user controls the
 * cadence and never feels the speech bubble auto-advance under them.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
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
    "Quick aside before we move on. There's a wiki with detailed documentation of every page in the app. Search behavior, list semantics, Gantt dependencies, it's all spelled out there.",
  pose: "pointing-up",
  completion: manualAdvance("Got it, next"),
});

/**
 * §6.12 beat 2 - spotlight the `?` icon in the top bar.
 *
 * Spotlight only, no cursor click yet. The icon lives in AppShell next
 * to NotificationBadge / InboxBadge / TelegramStatusBadge / Settings,
 * stamped with `data-tour-target="wiki-nav-tab"`. Speech tells the user
 * what the icon does so the next beat's cursor click reads as
 * confirming the affordance, not introducing it.
 */
export const wikiPointerIconSpotlightStep = buildWalkthroughStep({
  id: "wiki-pointer-icon-spotlight",
  speech:
    "If you're on any page and curious or confused, click the question-mark icon up in the top right.",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.wikiNavTab),
  completion: manualAdvance("Got it, next"),
});

/**
 * §6.12 beat 3 - cursor click on the `?` icon triggers real navigation.
 *
 * The `?` icon is a `<Link>` whose href is computed by
 * `appRouteToWikiRoute(pathname)` plus a `?return=<currentPath>` query
 * param so the wiki's "Back to app" button can drop the user back where
 * they started. Clicking it dispatches a real navigation event, so the
 * tour controller's `InProductWalkthroughOverlay` will unmount on route
 * change and remount on the new page. That's fine: `V4MountForUser`
 * lives ABOVE the overlay in the tree (mounted in `providers.tsx` with
 * the wiki-route carve-out so it persists across `/wiki/*` visits), so
 * the controller's `currentStep` survives and the next beat
 * (`wiki-pointer-back-demo`) picks up on the wiki page.
 *
 * No `expectedRoute` here on purpose. The user's current page IS the
 * expected route at step entry; the cursor click itself is what
 * navigates. Setting `expectedRoute: "/wiki/..."` would race the
 * controller's `router.push` against the cursor click, exactly the
 * conflict the prior R4 doc on this file warned about.
 *
 * Speech narrates the click ("watch") so the user reads BeakerBot's
 * cursor as the agent of the navigation. Pose `pointing` is the
 * click-affordance pose; `pointing-up` would tilt at the wrong angle
 * for a topbar icon.
 */
export const wikiPointerClickDemoStep = buildWalkthroughStep({
  id: "wiki-pointer-click-demo",
  speech:
    "Watch. Clicking the question mark takes you to the wiki page about whatever you were just looking at.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.wikiNavTab),
  cursorScript: cursorScript(async () => {
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.wikiNavTab),
    );
    return compactScript([click]);
  }),
  completion: manualAdvance("Got it, next"),
});

/**
 * §6.12 beat 4 - on the wiki page, cursor clicks "Back to app".
 *
 * Mirrors the click-demo beat in reverse. We DECLARE the expected route
 * lazily by computing the wiki destination from whatever page the user
 * was on at the start of beat 3. That doesn't actually work as a static
 * `expectedRoute` (we don't have access to the prior pathname at
 * module-load time), so we rely on the click-demo beat's cursor having
 * landed the user on `/wiki/...` already. Setting
 * `expectedRoute: "/wiki"` as a coarse prefix would handle the
 * refresh-mid-step case: if the user refreshes while the body is on
 * this beat, they're routed to `/wiki` (the landing) which still has
 * the WikiTopBar's "Back to app" button mounted, so the cursor click
 * still finds its target. The button's `router.push` to the cached
 * return path then drops them back home, which is a reasonable resume
 * behavior.
 *
 * The cursor script targets the WikiTopBar's "Back to app" button via
 * the new `data-tour-target="wiki-back-to-app"` stamp. The button's
 * onClick reads the cached `?return=<path>` from sessionStorage (set
 * on wiki arrival in WikiTopBar's mount effect) and `router.push`es
 * back to it - the same affordance a real user would tap.
 */
export const wikiPointerBackDemoStep = buildWalkthroughStep({
  id: "wiki-pointer-back-demo",
  speech:
    "When you're done exploring the wiki, hit the back button up here to jump straight back to where you started.",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.wikiBackToApp),
  cursorScript: cursorScript(async () => {
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.wikiBackToApp),
    );
    return compactScript([click]);
  }),
  completion: manualAdvance("Got it, next"),
  // Coarse prefix - if the user refreshes mid-step, route them back to
  // the wiki landing. The "Back to app" button's sessionStorage-cached
  // return path will still drop them home on click. A more precise
  // expectedRoute would need access to the pathname captured at the
  // start of the click-demo beat, which the static step body can't see.
  expectedRoute: "/wiki",
});

/**
 * @deprecated 2026-05-22 (Wiki pointer manager): retired by the
 * §6.12 multi-beat redesign. Replaced by the 4-beat cluster above
 * (`wiki-pointer-intro` -> `wiki-pointer-icon-spotlight` ->
 * `wiki-pointer-click-demo` -> `wiki-pointer-back-demo`). Kept in tree
 * for git-history reference and to avoid breaking any external
 * importer; removed from `step-registry.ts` and `TOUR_STEP_ORDER` so
 * the controller never lands on it.
 *
 * Original body: a single glide-only beat that landed the cursor on
 * the `?` icon as a visual anchor with no click. Speech read "If you
 * ever get stuck, the Wiki tab up here has guides. Come back to it
 * anytime." The pre-glide-only variant (R4 2026-05-22) actually
 * clicked the icon and navigated, but that killed the tour mid-walk
 * because the wiki layout dropped V4MountForUser. The fix that ships
 * alongside this redesign re-mounts V4MountForUser inside the
 * `isWikiRoute` early-return so the new click-demo beat works without
 * stranding the tour.
 */
export const wikiPointerStep = buildWalkthroughStep({
  id: "wiki-pointer",
  speech:
    "If you ever get stuck, the Wiki tab up here has guides. Come back to it anytime.",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.wikiNavTab),
  completion: manualAdvance("Got it, next"),
});

// Helper retained in this module so tests / debug surfaces can import
// the function used to resolve the wiki target from the current path.
// Re-export keeps `appRouteToWikiRoute` import-tree-discoverable
// alongside the step bodies.
export { appRouteToWikiRoute };
