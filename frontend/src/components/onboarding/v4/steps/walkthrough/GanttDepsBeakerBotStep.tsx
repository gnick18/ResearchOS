/**
 * §6.8 Gantt — BeakerBot wires Fake A → user_experiment as a dependency
 * (Gantt redesign 2026-05-22, Gantt manager).
 *
 * Replaces the FIRST half of the legacy `gantt-chained-deps` step. The
 * legacy step had BeakerBot wire an entire A→B→C chain in one beat;
 * the new arc splits the teaching: BeakerBot wires ONE dep (this step),
 * then the user wires the second dep themselves (gantt-deps-user), then
 * BeakerBot moves the head of the chain so the user sees the cascade
 * (gantt-deps-cascade).
 *
 * onEnter:
 *   - Spawn Fake experiment A + Fake experiment B (idempotent on name).
 *     NOTHING ELSE: the dep edge is created at the END of the cursor
 *     script via the picker-dialog click below, NOT pre-stamped in
 *     data. (Tour deps fix manager 2026-05-27 — see bug below.)
 *
 * Cursor:
 *   1. Glide to Fake A's bar.
 *   2. Visually drag Fake A onto the user's experiment bar.
 *   3. Pause so the drop animation lands cleanly.
 *   4. Dispatch `tour:open-dep-popup` with Fake A as child and
 *      user_experiment as parent. GanttChart's listener seeds the
 *      picker dialog state. (The cursor's mouse events alone don't
 *      drive the Gantt's HTML5 DragEvent drop handler, so the dialog
 *      will not open from the drag itself; same mismatch documented
 *      in the legacy GanttDependenciesStep docstring.)
 *   5. Pause so the dialog mount + reposition settles.
 *   6. Click the picker's "Finish before" button (purple, SF type)
 *      via a deferred click that resolves the button at PLAYBACK time
 *      (the button only mounts AFTER step 4 plays). The click goes
 *      through `tourClickWithLockBypass` so the InputLockOverlay's
 *      capture-phase blocker lets it through and React's onClick
 *      handler creates the dep edge.
 *
 * onExit:
 *   - Record the freshly-committed dep edge as a discard artifact for
 *     Phase 4 cleanup. Mirror of `gantt-deps-user`'s onExit.
 *
 * Tour deps fix manager 2026-05-27 (bug Grant reported with
 * screenshot): the previous build pre-created the dep edge in onEnter
 * and the cursor's drag was purely narrative; the picker dialog never
 * actually opened and never got a "Finish before" click. From the
 * user's POV: "beaker never clicked finish before, it got stuck on
 * this screen, the experiment was spawned immediately as a dependency
 * chain". This step now spawns Fake A standalone, the cursor opens
 * the dialog programmatically, and the cursor clicks the dialog's
 * "Finish before" option. The resulting dep edge is SF (parent =
 * user_experiment, child = Fake A) instead of the legacy FS (parent
 * = Fake A, child = user_experiment); both layouts cascade correctly
 * via the shift engine's upstream-and-downstream traversal, so the
 * downstream `gantt-deps-cascade` step's `moveFakeAForward` still
 * propagates through the chain.
 *
 * Manual advance — same pattern as the legacy chained-deps step.
 *
 * gantt cluster consolidation manager (2026-05-27, Bug #29): added the
 * "Finish before" click after the drag. Without it the Create
 * Dependency dialog stayed open on screen and blocked the cursor +
 * spotlight on the next step.
 */
import {
  callbackAction,
  cursorScript,
  safeClickAction,
  safeDragAction,
  compactScript,
  tourClickWithLockBypass,
  waitForElement,
  pause,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  recordFakeAToUserDepArtifact,
  resolveFakeTaskIds,
  resolveUserExperiment,
  spawnGanttRedesignFakeTasks,
} from "./lib/gantt-redesign-helpers";
import { getCurrentUserCached } from "@/lib/storage/json-store";

/** Pause (ms) between the visual drag landing and the popup-open event.
 *  Lets the drop animation settle so the dialog doesn't pop up mid-glide. */
const POST_DRAG_PAUSE_MS = 800;

/** Pause (ms) between the popup-open event and the cursor's click on
 *  "Finish before". Lets the dialog mount + the BeakerBot cursor
 *  reposition over the purple option. */
const PRE_CLICK_PAUSE_MS = 800;

export const ganttDepsBeakerBotStep = buildWalkthroughStep({
  id: "gantt-deps-beakerbot",
  speech: (
    <>
      <p className="mb-2">
        Dependencies ensure you don't schedule an experiment before you
        have the necessary prerequisites. I'm linking "Fake A" so it
        has to finish before your experiment can start.
      </p>
      <p>Notice the arrow pointing from A to your experiment.</p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarFakeA),
  onEnter: async (ctx) => {
    // Spawn A + B only. The A→user_experiment edge is created by the
    // picker-dialog click in the cursor script below, NOT in onEnter.
    await spawnGanttRedesignFakeTasks(ctx);
  },
  cursorScript: cursorScript(async () => {
    // Visual narration: drag Fake A onto the user's experiment bar.
    // The cursor's mouse events don't trigger the Gantt's HTML5
    // DragEvent drop handler (mismatch documented in the legacy
    // GanttDependenciesStep docstring), so the drag is a "watch me
    // do it" beat; the actual dialog gets opened programmatically by
    // the callback below.
    const dragOntoUserExp = await safeDragAction(
      targetSelector(TOUR_TARGETS.ganttBarFakeA),
      targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
    );

    // Open the dep-picker dialog at PLAYBACK time, after the visual
    // drag lands. GanttChart listens for `tour:open-dep-popup` and
    // seeds its dep-popup state from the detail's parent / child ids.
    const openDialog = callbackAction(async () => {
      if (typeof window === "undefined") return;
      const { fakeAId } = await resolveFakeTaskIds();
      const userExp = await resolveUserExperiment();
      if (!fakeAId || !userExp) return;
      // Match `handleDropOnTask`'s convention: the task dropped ON is
      // the parent, the dragged task is the child. The drag goes Fake
      // A onto user_experiment, so parent=user_exp, child=Fake A.
      window.dispatchEvent(
        new CustomEvent("tour:open-dep-popup", {
          detail: { parentId: userExp.id, childId: fakeAId },
        }),
      );
    });

    // Click the "Finish before" option (purple, SF type) at playback
    // time. We can't use safeClickAction here because the picker's
    // buttons don't mount until the openDialog callback above plays;
    // safeClickAction resolves at BUILD time and would time out.
    // tourClickWithLockBypass sets the __beakerBotCursorClicking flag
    // so the InputLockOverlay's capture-phase blocker lets the click
    // through to React's onClick handler.
    const clickFinishBefore = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const selector = targetSelector(
        TOUR_TARGETS.ganttDepPickerStartBefore,
      );
      const btn = await waitForElement(selector, 3000);
      if (!(btn instanceof HTMLElement)) return;
      tourClickWithLockBypass(btn);
    });

    return compactScript([
      dragOntoUserExp,
      pause(POST_DRAG_PAUSE_MS),
      openDialog,
      pause(PRE_CLICK_PAUSE_MS),
      clickFinishBefore,
    ]);
  }),
  // Record the freshly-committed dep edge for Phase 4 cleanup. Mirrors
  // gantt-deps-user's onExit (which records the user→Fake B edge).
  onExit: async () => {
    try {
      const username = await getCurrentUserCached();
      const resolved = username && username !== "_no_user_" ? username : null;
      await recordFakeAToUserDepArtifact({ username: resolved });
    } catch (err) {
      console.warn(
        "[gantt-deps-beakerbot] onExit artifact persist failed",
        err,
      );
    }
  },
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
