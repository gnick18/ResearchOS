/**
 * §6.2b Home widgets walkthrough, STEP 2: tile anatomy.
 *
 * Second of five §6.2b sub-steps. Builds on the canvas-intro spotlight
 * by teaching what a single tile is FOR: a snapshot of one surface
 * that expands into the same full popup you'd see anywhere else in the
 * app. The demo clicks the Upcoming-tasks widget tile, the popup opens,
 * BeakerBot lets the user read for a beat, and the cursor then closes
 * it again.
 *
 * Cursor + spotlight:
 *   - spotlight on the `sidebar-upcoming` widget tile (the first Chip A
 *     pre-seed default). Pinned by widget id, not by "first rendered"
 *     prefix match, so the popup shown matches the tile the user
 *     actually has on their canvas.
 *   - cursor clicks the Upcoming-tasks tile, the SnapshotTilePopup mounts
 *     (Upcoming-tasks popup), the user reads, and then a deferred click
 *     on the popup's Close (X) button dismisses the popup so the canvas
 *     is visible again for the next step.
 *
 * Why pin to `sidebar-upcoming` (§6.2b R1 fix, 2026-05-25):
 *
 *   The original implementation used a prefix selector
 *   `[data-tour-target^='home-widget-tile-']:first` plus prefix
 *   resolution. In practice that resolved to `sidebar-today` (the
 *   Today's-tasks tile), which is NOT in the Chip A pre-seed defaults
 *   (`sidebar-upcoming` + `calendar-events-today`). The user saw a
 *   popup for a widget they did not have on their canvas, breaking the
 *   "expand the tile in front of you" promise. Pinning to
 *   `home-widget-tile-sidebar-upcoming` aligns the demo's click target
 *   with the actual seeded default. If a future maintainer changes
 *   the seed defaults, the test asserting `sidebar-upcoming` will
 *   surface the drift.
 *
 * Classification: BEAKERBOT DEMO. Speech literally says "click the
 * tile to expand it", an explicit BeakerBot-led promise; the cursor
 * performs the click as advertised. The popup-close is also cursor-
 * driven because leaving the popup open would conflict with the next
 * step's spotlight on the +Add widget button (the popup overlays the
 * toolbar).
 *
 * Why a deferred close click (not a build-time `safeClickAction`):
 *
 *   The close button is part of `SnapshotTilePopup`, which mounts
 *   AFTER the tile-click. At cursor-script build time, the popup's
 *   close button doesn't exist in the DOM. `safeClickAction` would
 *   resolve null and the close action would never fire.
 *   `deferredClickAction` re-queries the selector at PLAYBACK time so
 *   it runs after the popup mount, and (post §6.2b R1) sets
 *   `__beakerBotCursorClicking` around the native `.click()` so the
 *   InputLockOverlay's capture-phase blocker lets the close through.
 *
 * `pause()` between the open and the close gives the user a beat to
 * see the popup's full content before the cursor dismisses it. The
 * universal pacing rule (Grant 2026-05-22) means we still need a
 * manual "Got it, next" advance after the close lands so the user
 * controls the actual step transition.
 *
 * No artifact (the popup mount-and-close is purely visual; nothing
 * lands in storage).
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
 * Tile selector pinned to the `sidebar-upcoming` widget id. This is the
 * first Chip A pre-seed default (see `home-widgets-default.ts`), so the
 * demo's click target always matches a tile the user actually has on
 * their canvas. Exported so the registry test can assert the demo
 * deterministically picks Upcoming-tasks.
 */
export const HOME_WIDGETS_TILE_ANATOMY_TILE_SELECTOR =
  "[data-tour-target='home-widget-tile-sidebar-upcoming']";

/**
 * Close-button selector inside the SnapshotTilePopup. The component
 * stamps `aria-label="Close"` on the dismiss button; we select via the
 * aria attribute rather than a dedicated `data-tour-target` because no
 * tour-target is stamped on the close button (and the popup chrome is
 * shared across surfaces, so adding a stamp here would also fire on the
 * Lab Overview popup which doesn't need one).
 */
export const HOME_WIDGETS_TILE_ANATOMY_CLOSE_SELECTOR =
  '[role="dialog"] button[aria-label="Close"]';

export const homeWidgetsTileAnatomyStep = buildWalkthroughStep({
  id: "home-widgets-tile-anatomy",
  speech:
    "Each tile shows you a snapshot. The numbers and the top few rows give you the gist at a glance. Click the tile to expand it into a full popup, where you get filters, search, and the same actions you'd find on the dedicated page.",
  pose: "pointing",
  targetSelector: HOME_WIDGETS_TILE_ANATOMY_TILE_SELECTOR,
  cursorScript: cursorScript(async () => {
    // Click the Upcoming-tasks tile. The popup mounts synchronously on
    // the next React commit, so the deferred-close action can resolve
    // the popup's close button on its first re-query.
    const clickTile = await safeClickAction(
      HOME_WIDGETS_TILE_ANATOMY_TILE_SELECTOR,
      2000,
    );
    // Beat for the user to see the popup's content before the cursor
    // dismisses it. 1800ms is a comfortable read of the title + first-
    // row summary without dragging the step.
    const beat = pause(1800);
    // Re-resolve at playback because the close button doesn't exist
    // at script-build time (the popup hasn't mounted yet).
    // §6.2b R1: deferredClickAction now sets the cursor-clicking flag
    // and scrolls into view, so the close click rides past the
    // InputLockOverlay and stays visible.
    const clickClose = deferredClickAction(
      HOME_WIDGETS_TILE_ANATOMY_CLOSE_SELECTOR,
      3000,
    );
    return compactScript([clickTile, beat, clickClose]);
  }),
  // Manual advance per universal pacing (Grant 2026-05-22). The user
  // watches the open + close happen, reads the speech bubble, then
  // clicks Got it, next to move on to the add step.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/",
});
