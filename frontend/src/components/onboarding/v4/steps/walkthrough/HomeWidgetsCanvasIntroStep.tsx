/**
 * §6.2b Home widgets walkthrough, STEP 1: canvas intro.
 *
 * First of five §6.2b sub-steps. Sits between `project-overview-exit`
 * (which has just navigated the browser back to `/`) and the rest of
 * the §6.2b cluster (tile-anatomy, add, reorder, exit). The user is
 * already on the home page when this step fires; the §6.2-exit
 * `expectedRoute: "/"` push handles that bit.
 *
 * Teaching shape (narration + spotlight, no cursor demo):
 *
 *   BeakerBot points at the entire widget canvas and explains that
 *   Home is a per-user dashboard. The two pre-seeded default widgets
 *   (Upcoming tasks + Today's events, wired by Chip A in
 *   `home-widgets-default.ts`) provide visible content the moment the
 *   spotlight lands, so the canvas feels alive rather than empty.
 *
 * Spotlight: the whole `home-widget-canvas` container (the SnapshotCanvas
 * mount wrapped by HomeCanvas). This dims the project grid below so the
 * user's attention lands on the widgets section.
 *
 * Cursor: none on this beat. The cursor's last known position is the
 * Home nav tab from `project-overview-exit`; a redundant glide-to-canvas
 * would just be visual noise. The follow-up `home-widgets-tile-anatomy`
 * step owns the first cursor demo (click a tile to expand it).
 *
 * Viewport scroll (§6.2b R1 fix, 2026-05-25): at 1440x900 the canvas
 * sits at y=781 with bottom=1003, so the spotlight rings an element
 * mostly below the fold. `onEnter` scrolls the canvas into view (center
 * block, smooth) BEFORE the spotlight measures its rect, so the user
 * sees the canvas the spotlight is talking about. No `viewportAnchor`
 * here because that hook only triggers when the step has a
 * `cursorScript`; narration steps need a sibling mechanism, and onEnter
 * is the established lifecycle hook for "run when this step becomes
 * active".
 *
 * Completion: manual "Got it, next" per the universal pacing rule
 * (Grant 2026-05-22). The user reads, then advances.
 *
 * Voice match: §6.2 pedagogical paragraph (north-star cousin). Multi-
 * sentence, second-person, casual conjunctions, no em-dashes, no emojis.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const homeWidgetsCanvasIntroStep = buildWalkthroughStep({
  id: "home-widgets-canvas-intro",
  speech:
    "This is your Home canvas. Right now you've got two starter widgets: what's due and today's events. The canvas can host plenty more, and you can add or remove them as you go. If you share this folder with lab members later, each person tailors their own view, so what you see here is yours to shape.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.homeWidgetCanvas),
  // No cursorScript: narration step. The spotlight on the canvas
  // container is the visual cue; the cursor would glide redundantly and
  // there's no click target yet (tile-anatomy owns the first click).
  //
  // §6.2b R1 fresh-eyes fix: scroll the canvas into view so the
  // spotlight rings a visible surface (the canvas sits below the fold
  // at 1440x900). Best-effort: missing scrollIntoView (jsdom) or a
  // missing canvas element are both silent no-ops; the spotlight still
  // mounts wherever the rect ends up.
  onEnter: async () => {
    if (typeof document === "undefined") return;
    const el = document.querySelector(
      targetSelector(TOUR_TARGETS.homeWidgetCanvas),
    );
    if (!(el instanceof HTMLElement)) return;
    if (typeof el.scrollIntoView !== "function") return;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // No-op: some test environments throw on options.
    }
  },
  completion: manualAdvance("Got it, next"),
  // Cluster lives on `/`. The preceding `project-overview-exit` step
  // already pushed the browser to `/`, but setting this lets refresh-
  // mid-tour land on the right surface (P12 Resume + the controller's
  // expectedRoute auto-navigation contract).
  expectedRoute: "/",
});
