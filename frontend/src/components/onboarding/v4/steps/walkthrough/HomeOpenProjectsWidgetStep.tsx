/**
 * §6.1 Home + first project — OPEN-WIDGET sub-step (NEW, dashboard-tour-fix
 * bot 2026-05-29).
 *
 * Why this beat exists:
 *
 *   The dashboard unification (2026-05-29) deleted the hardcoded "Research
 *   Project Overview" grid from `app/page.tsx` (Home is now a pure widget
 *   canvas). The §6.1 "create your first project" anchors
 *   (`home-new-project`, `home-project-create-form`, the name input + submit,
 *   the project cards) moved onto the Projects Overview WIDGET, but that
 *   widget's New Project flow lives inside the widget's EXPANDED tile popup
 *   (`SnapshotTilePopup`), not on the compact snapshot tile. So before the
 *   existing create beats can resolve their anchors, the tour has to OPEN the
 *   Projects Overview widget. This beat is that missing step: it intros the
 *   project concept AND opens the widget so the New Project affordance is on
 *   screen for `home-create-project` (the next beat).
 *
 * Teaching shape (BEAKERBOT DEMO, mirrors §6.2b `home-widgets-tile-anatomy`):
 *
 *   BeakerBot's cursor glides to the Projects Overview tile (the first
 *   seeded default on every account's dashboard — see
 *   `layout-persistence.ts`) and clicks it. The SnapshotTilePopup mounts,
 *   revealing the project grid + the inline New Project flow. BeakerBot
 *   then frames "make your first one here" and the user advances with a
 *   manual "Got it, next". The popup STAYS open across the advance because
 *   it is controlled by SnapshotCanvas's own `openWidgetId` state (not the
 *   tour), so the follow-up `home-create-project` beat finds the
 *   `home-new-project` anchor inside the still-open popup.
 *
 * PI scope fix (dashboard-tour-fix bot 2026-05-29, walkthrough-verified):
 * the Projects Overview popup's New Project button is gated to "my" scope
 * (`ProjectsOverviewWidget.tsx`). For a lab_head the popup defaults to "lab"
 * scope (`resolveScope` surface default on the canvas/dashboard surface), so
 * the New Project button is ABSENT and the follow-up `home-create-project`
 * beat would be stuck. After opening the popup the cursor therefore clicks the
 * "My projects" scope toggle (`projects-overview-scope-my`) so the New Project
 * flow is on screen. For solo + member viewers the toggle is not rendered
 * (PI-only) and the popup is already in "my" scope, so the deferred toggle
 * click resolves null and is a safe no-op.
 *
 * Spotlight: the Projects Overview tile (`home-widget-tile-projects-overview`).
 * Once the cursor opens the popup, the SnapshotTilePopup stamps
 * `data-tour-popup-occluding`, so TourSpotlight suppresses the ring on the
 * tile beneath the popup (the active surface has moved to the popup). The
 * follow-up `home-create-project` beat spotlights the `home-new-project`
 * button INSIDE the popup, which the occlusion-guard refinement (TourSpotlight
 * 2026-05-27, `targetInsideOccludingPopup`) lets render on top of the popup.
 *
 * Classification: BEAKERBOT DEMO. Speech says "let me open it", an explicit
 * BeakerBot-led promise; the cursor performs the click as advertised. Manual
 * advance per the universal pacing rule (Grant 2026-05-22): the user reads,
 * sees the popup open, then clicks Got it, next.
 *
 * No artifact (opening the popup is purely visual; the project lands on the
 * `home-create-project-fill` beat).
 */
import {
  compactScript,
  cursorScript,
  deferredClickAction,
  pause,
  safeClickAction,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

/**
 * Tile selector pinned to the `projects-overview` widget id. Projects
 * Overview is seeded at the top of the unified dashboard for EVERY account
 * type (`layout-persistence.ts` default seed, dashboard-unification build
 * 2026-05-29), so the tile is always on canvas when the tour arrives at
 * §6.1. The `home-widget-tile-<id>` attribute is stamped by SnapshotCanvas
 * when the surface is the unified dashboard (`usesHomeTourAnchors`).
 * Exported so the registry / step-body tests can assert the demo
 * deterministically opens the Projects Overview popup.
 */
export const HOME_OPEN_PROJECTS_WIDGET_TILE_SELECTOR =
  "[data-tour-target='home-widget-tile-projects-overview']";

/**
 * The popup's "My projects" scope toggle. PI-only: a lab_head's popup
 * defaults to "lab" scope (no New Project button), so the cursor clicks
 * this to flip to "my" scope where the create flow lives. Selected via the
 * existing testid (no dedicated tour-target on the toggle, and stamping one
 * would also fire on the lab-overview popup). For solo + member viewers the
 * toggle is not rendered, so the deferred click resolves null and no-ops.
 */
export const HOME_OPEN_PROJECTS_WIDGET_MY_SCOPE_SELECTOR =
  "[data-testid='projects-overview-scope-my']";

export const homeOpenProjectsWidgetStep = buildWalkthroughStep({
  id: "home-open-projects-widget",
  speech: (
    <>
      <p className="mb-2">
        Projects are the top-level folders for all your work. Your Projects
        view lives right here on your dashboard.
      </p>
      <p>
        Let me open it up so we can make your first one. Click Got it, next
        once it expands.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: HOME_OPEN_PROJECTS_WIDGET_TILE_SELECTOR,
  cursorScript: cursorScript(async () => {
    // Click the Projects Overview tile. The SnapshotTilePopup mounts on the
    // next React commit, revealing the inline New Project flow + the moved
    // §6.1 anchors. The popup is controlled by SnapshotCanvas's own state,
    // so it stays open across the manual advance into `home-create-project`.
    const clickTile = await safeClickAction(
      HOME_OPEN_PROJECTS_WIDGET_TILE_SELECTOR,
      2000,
    );
    // PI scope fix: flip the popup to "my" scope so the New Project button
    // is on screen for the follow-up create beats. Deferred because the
    // toggle only exists AFTER the popup mounts. Resolves null (safe no-op)
    // for solo + member viewers, who have no toggle and are already in "my"
    // scope. `deferredClickAction` rides past the InputLockOverlay via the
    // cursor-clicking flag, same as the §6.2b tile-anatomy close click.
    const clickMyScope = deferredClickAction(
      HOME_OPEN_PROJECTS_WIDGET_MY_SCOPE_SELECTOR,
      2000,
    );
    // A short beat after the click so the popup-open animation settles
    // before the user reads the "make your first one" framing. Matches the
    // pacing of the §6.2b tile-anatomy demo without the close click (we want
    // the popup to STAY open for the create beats that follow).
    const beat = pause(600);
    return compactScript([clickTile, clickMyScope, beat]);
  }),
  // Manual advance per the universal pacing rule (Grant 2026-05-22): the
  // user watches the popup open, reads the speech, then advances. The popup
  // remains open into `home-create-project`.
  completion: manualAdvance("Got it, next"),
  // Cluster lives on `/` (the unified dashboard). Setting expectedRoute lets
  // a refresh mid-tour land back on the dashboard so the tile anchor
  // resolves (P12 Resume + the controller's expectedRoute auto-nav contract).
  expectedRoute: "/",
});
