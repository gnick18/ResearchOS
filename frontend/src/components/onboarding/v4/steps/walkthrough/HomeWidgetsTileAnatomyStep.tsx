/**
 * §6.2b Home widgets walkthrough, STEP 2: tile anatomy.
 *
 * Second of five §6.2b sub-steps. Builds on the canvas-intro spotlight
 * by teaching what a single tile is FOR: a snapshot of one surface
 * that expands into the same full popup you'd see anywhere else in the
 * app. The demo clicks the Today's-events widget tile, the popup opens,
 * BeakerBot lets the user read for a beat, and the cursor then closes
 * it again.
 *
 * Cursor + spotlight:
 *   - spotlight on the `calendar-events-today` widget tile (the second
 *     Chip A pre-seed default). Pinned by widget id, not by "first
 *     rendered" prefix match, so the popup shown matches the tile the
 *     user actually has on their canvas.
 *   - cursor clicks the Today's-events tile, the SnapshotTilePopup mounts
 *     (calendar day view scoped to today), the user reads, and then a
 *     deferred click on the popup's Close (X) button dismisses the popup
 *     so the canvas is visible again for the next step.
 *
 * Why pin to `calendar-events-today` (§6.2b R3 fix, 2026-05-25):
 *
 *   R1 pinned this step to `sidebar-upcoming` to fix the prefix-match
 *   landing on `sidebar-today` (not seeded). R2 fresh-eyes then
 *   surfaced a deeper issue: the `sidebar-upcoming` tile (label
 *   "Upcoming tasks") opens the shared daily-tasks popup, which is
 *   titled "Today's tasks" and renders OVERDUE / TODAY / UPCOMING
 *   sections. Title mismatch breaks the "click the tile to expand it"
 *   teaching contract because the popup header doesn't match the tile
 *   label the user just clicked.
 *
 *   Both home defaults have some chrome mismatch (the tool registry
 *   maps each widget to a tool whose title becomes the popup header),
 *   but `calendar-events-today` is the closer match on CONTENT: the
 *   tile says "Today's events", the popup body renders a single-day
 *   calendar timeline scoped to today (CalendarDayPopupView). The
 *   header reads "Calendar" (the tool name) rather than "Today's
 *   events", but the body content matches the tile's promise far
 *   better than the daily-tasks popup matches "Upcoming tasks".
 *
 *   Trade-off documented for a future cleanup: the deeper product fix
 *   is to let widgets override the popup title (so the tile and popup
 *   chrome carry the same label). That's out of scope for the R3
 *   teaching-bubble pass; switching demo target gets us 80% of the
 *   way without touching the popup-title resolver.
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
import { pushTourWidgetDemoPreview } from "../../TourWidgetDemoPreview";

// §6.2b Home widgets demo-preview lease (tour-fixtures sub-bot R2,
// 2026-05-26). See HomeWidgetsCanvasIntroStep for the design rationale
// (refcount avoids transition flicker between adjacent §6.2b steps).
// This step's lease keeps the snapshot tiles populated while the user
// reads "Each tile shows you a snapshot... click to expand" and
// watches the cursor demo open + close the Today's-events popup.
let releaseDemoPreview: (() => void) | null = null;

/**
 * Tile selector pinned to the `calendar-events-today` widget id. This
 * is the second Chip A pre-seed default (see `home-widgets-default.ts`),
 * and the only seeded default whose popup body matches the tile content
 * on CONTENT (the Calendar Tool's day view scoped to today renders the
 * same today's-events list the SnapshotTile previews). Exported so the
 * registry test can assert the demo deterministically picks Today's
 * events. §6.2b R3 fix (2026-05-25): switched from `sidebar-upcoming`
 * for the popup-title-mismatch reason documented in the file header.
 */
export const HOME_WIDGETS_TILE_ANATOMY_TILE_SELECTOR =
  "[data-tour-target='home-widget-tile-calendar-events-today']";

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
  onEnter: async () => {
    // §6.2b demo-preview push (tour-fixtures sub-bot R2, 2026-05-26).
    // Keeps the snapshot tiles populated while the cursor demos
    // tile-click-to-expand. The TourController contract guarantees
    // onExit fires before a re-entry, so we don't defensively release
    // here (release is microtask-deferred and would race the push).
    releaseDemoPreview = pushTourWidgetDemoPreview();
  },
  onExit: async () => {
    if (releaseDemoPreview) {
      const release = releaseDemoPreview;
      releaseDemoPreview = null;
      try {
        release();
      } catch (err) {
        console.error(
          "[home-widgets-tile-anatomy] demo-preview release threw:",
          err,
        );
      }
    }
  },
  cursorScript: cursorScript(async () => {
    // Click the Today's-events tile. The popup mounts synchronously on
    // the next React commit, so the deferred-close action can resolve
    // the popup's close button on its first re-query.
    const clickTile = await safeClickAction(
      HOME_WIDGETS_TILE_ANATOMY_TILE_SELECTOR,
      2000,
    );
    // Beat for the user to see the popup's content before the cursor
    // dismisses it. §6.2b R4 fix (2026-05-25): bumped from 1800ms to
    // 3500ms after the fresh-eyes verifier struggled to read both the
    // speech bubble and the popup contents inside the prior window.
    // 3500ms is the comfortable upper bound for a "BeakerBot is demo'ing"
    // beat without making the user feel stalled.
    const beat = pause(3500);
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
