/**
 * §6.2b Home widgets walkthrough — STEP 1: canvas intro.
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
    "This is your Home canvas. Everything you actually use day to day lives here as a widget: today's calendar events, what's due, recent activity, and more. Each member arranges their own canvas, so the version you're looking at is yours to shape.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.homeWidgetCanvas),
  // No cursorScript: narration step. The spotlight on the canvas
  // container is the visual cue; the cursor would glide redundantly and
  // there's no click target yet (tile-anatomy owns the first click).
  completion: manualAdvance("Got it, next"),
  // Cluster lives on `/`. The preceding `project-overview-exit` step
  // already pushed the browser to `/`, but setting this lets refresh-
  // mid-tour land on the right surface (P12 Resume + the controller's
  // expectedRoute auto-navigation contract).
  expectedRoute: "/",
});
