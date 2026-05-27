/**
 * §6.2b Home widgets walkthrough, STEP 4: reorder a tile.
 *
 * Fourth of five §6.2b sub-steps. Teaches the drag-to-reorder mechanic
 * on the home widget canvas: the cursor grabs the first tile by its
 * drag handle and drags it down past a sibling tile so the user sees
 * the layout shift live. Edit mode was already entered in Step 3 (the
 * +Add widget click auto-enables edit mode), so drag handles are
 * already visible when this step fires.
 *
 * Cursor + spotlight:
 *   - spotlight on the drag handle of the first widget tile
 *     (`home-widget-drag-handle`). The Widget component only stamps
 *     this attribute when `tourSurface === "home"` AND `isEditing`,
 *     so the previous step's edit-mode-enter is load-bearing here.
 *   - cursor drags the first tile down to the position of a later
 *     tile. SnapshotCanvas's HTML5 drag-and-drop fires on drop and
 *     `setOrder` persists the new layout via `layout-persistence.ts`.
 *
 * Drag-and-drop note: the Widget component's drag-handle div is INSIDE
 * the per-tile wrapper that carries `draggable={isEditing}`. The
 * browser-level drag starts on the outer draggable wrapper; the
 * cursor's `drag` action triggers a synthetic dragstart/dragover/drop
 * sequence that SnapshotCanvas's handlers see through.
 *
 * Drag endpoints:
 *   - source: the first rendered tile (prefix match, whichever widget
 *     id landed at position 0 in the user's layout, typically the
 *     `sidebar-upcoming` pre-seed default).
 *   - destination: a different tile. We pick the third tile (index 2)
 *     because the canvas now has at least 3 tiles after Step 3 added
 *     `lab-activity-by-type`. Dragging onto an adjacent neighbor only
 *     shifts by one row; dragging past two siblings makes the reorder
 *     visually obvious.
 *
 * If the destination tile selector misses (e.g. the user removed
 * everything before the tour reached this step), `safeDragAction`
 * resolves null and the step gracefully no-ops. The speech bubble
 * still teaches the concept and manual advance carries the user
 * forward.
 *
 * Recovery hint (§6.2b R1 fix, 2026-05-25): the spotlight anchor is
 * the drag handle, which the Widget component only stamps under
 * edit-mode + home surface. If the user accidentally exits edit mode
 * mid-step (e.g. clicking outside the canvas, pressing Esc), the drag
 * handle unmounts and the TourController's target-detach watcher
 * surfaces a recovery line. We supply `recoveryHint.buttonLabel` so
 * the line names the actual re-entry button ("+ Add widget in the
 * canvas toolbar") rather than the generic "the button you clicked
 * before" fallback. Clicking +Add re-enters edit mode and the drag
 * handle re-mounts, the original speech bubble swaps back, and the
 * user can complete the demo.
 *
 * Classification: BEAKERBOT DEMO. Speech says "I'll grab one and drop
 * it lower", an explicit BeakerBot-led promise; the cursor performs
 * the drag as advertised. The universal pacing rule (Grant 2026-05-22)
 * means we still wait on a manual "Got it, next" advance.
 */
import {
  compactScript,
  cursorScript,
  safeDragAction,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

/**
 * Source and destination tile selectors for the drag demo. We use
 * `:nth-of-type` against the prefix match so the demo deterministically
 * drags the first tile onto the third tile's slot, no matter which
 * widget ids actually landed in those positions. This shape mirrors how
 * other steps target a specific child without pinning a widget id.
 */
export const HOME_WIDGETS_REORDER_SOURCE_SELECTOR =
  "[data-tour-target^='home-widget-tile-']:nth-of-type(1)";
export const HOME_WIDGETS_REORDER_DEST_SELECTOR =
  "[data-tour-target^='home-widget-tile-']:nth-of-type(3)";

export const homeWidgetsReorderStep = buildWalkthroughStep({
  id: "home-widgets-reorder",
  speech:
    "You can also drag any tile to reorder it. Keep your most important widgets at the top. If you eventually share this workspace with lab members, your layout stays yours and theirs stays theirs.",
  pose: "pointing",
  // No spotlight on this step (Grant feedback 2026-05-26). The copy is
  // conceptual ("any tile") and the previous version's blue halo on
  // the drag handle implied "this specific tile", which conflicted
  // with the message. The cursor demo below still drives the drag
  // visibly so the user sees the mechanic without the static
  // spotlight overlay.
  //
  // Trade-off: removing the target also removes the target-detach
  // recovery hint (the watcher fired when the drag handle unmounted
  // on accidental edit-mode exit). The "Got it, next" manual advance
  // is the remaining escape; the speech still teaches the concept
  // even if the cursor drag silently no-ops because edit mode
  // collapsed. Acceptable given the step's purpose is conceptual.
  // targetSelector: undefined (speech-only step per step-types.ts:142)
  cursorScript: cursorScript(async () => {
    // Single drag from tile 1 to tile 3 position. SnapshotCanvas's
    // HTML5 drag handlers (handleDragStart / handleDragOver / handleDrop)
    // see the synthetic events the cursor's `drag` action dispatches.
    // On drop, `setOrder` persists the new layout via the home
    // settings sidecar.
    const drag = await safeDragAction(
      HOME_WIDGETS_REORDER_SOURCE_SELECTOR,
      HOME_WIDGETS_REORDER_DEST_SELECTOR,
      3000,
    );
    return compactScript([drag]);
  }),
  // Manual advance per universal pacing (Grant 2026-05-22). The user
  // watches the tile settle into the new slot, reads the speech bubble,
  // then clicks Got it, next to move on to the exit beat.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/",
});
