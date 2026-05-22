"use client";

import { useEffect, useState } from "react";
import type { TourStep, CursorAction } from "../../step-types";
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
  waitForElement,
  callbackAction,
} from "../walkthrough/lib/cursor-script";
import { TOUR_TARGETS, targetSelector } from "../walkthrough/lib/targets";
import { BEAKERBOT_LAB_DISPLAY_NAME } from "./lib/lab-fake-user";

/**
 * lab-permission-practice step body. §6.16b (HR sub-bot rebuild
 * 2026-05-22).
 *
 * R2 rebuild: the cursor drives a REAL interaction against the
 * BeakerBot-shared experiments on the Workbench. No more inline
 * paper-doll card. The flow:
 *
 *   1. Cursor glides to the EDIT-permission shared card and clicks.
 *   2. The real `TaskDetailPopup` opens for BeakerBot's edit task.
 *   3. Cursor clicks "Edit", types a rename into the Task Name input,
 *      clicks "Save Changes". The real `tasksApi.update` lands the
 *      rename on disk.
 *   4. Cursor closes the popup with the close button.
 *   5. Cursor glides to the VIEW-only shared card and clicks.
 *   6. The popup opens. The Delete button is `disabled` because
 *      `task.is_shared_with_me` is true, the product code already
 *      enforces this. The cursor "lands on" the disabled button and we
 *      surface a Blocked toast inside the speech bubble to make the
 *      lock visible (the disabled state alone is too subtle).
 *   7. Cursor closes the popup. Manual advance via "Got it, next".
 *
 * Speech-bubble narration moves through five beats keyed off the
 * `tour:lab-permission-beat` custom event. Three happy-path:
 *   - "intro"        — opening copy.
 *   - "edit-done"    — after the real rename succeeds.
 *   - "view-blocked" — after the delete attempt fires (and is blocked
 *                      by the product's `disabled` gate).
 * Two graceful-degradation beats (HR P0-2 fix 2026-05-22) the script
 * falls back to when the cursor demo can't actually run (e.g., the
 * shared cards never mounted, the popup never opened, the rename
 * input never appeared):
 *   - "edit-failed" — narrates the edit-permission TEACHING ("edit-
 *                      share lets the recipient change anything") in
 *                      first-principles voice, without pretending the
 *                      demo succeeded.
 *   - "view-failed" — same but for view-only ("view blocks edits and
 *                      deletes").
 *
 * Why the failure beats matter: before R7-B's narration-honesty fix
 * the speech bubble fired "edit-done" + "view-blocked" on `setTimeout`
 * regardless of cursor outcome. If the shared cards weren't in the
 * DOM (a parallel bug being worked on) the user would read "the
 * rename just landed on the real shared task" while NOTHING visibly
 * happened. The post-fix contract: every speech-bubble beat after the
 * intro is gated on the corresponding cursor action ACTUALLY
 * completing; on a verifiable miss we emit the teaching-only fallback
 * instead. See the `callbackAction` helper in `lib/cursor-script.ts`
 * for the playback-order primitive that makes this possible.
 *
 * Why a custom-event channel (not React props):
 *   The speech component lives inside the speech bubble (mounted by
 *   TourController), the cursor script runs side-effectfully on step
 *   entry. They share NO React tree, so a window-level CustomEvent is
 *   the cheapest cross-tree coordination signal, the same pattern
 *   used by every other v4 step that needs to bridge a cursor demo to
 *   a speech update (`tour:notifications-popup-opened`, etc.).
 *
 * Delete-blocking, verified: `TaskDetailPopup`'s action-row Delete
 * button uses `disabled={task.is_shared_with_me}` (no permission
 * check, shared-into-me is the strong condition because only the
 * owner can delete). View-only AND edit-permission shares are both
 * blocked by this gate, which is the correct product behavior for
 * the cursor demo (the demo only fires the delete attempt on the
 * VIEW share). The native tooltip "Only the owner (BeakerBot) can
 * delete this task" already explains why; we surface the same
 * explanation in the speech bubble so the user reads it in the
 * natural reading flow.
 */

const BEAT_EVENT = "tour:lab-permission-beat";

type PermissionBeat =
  | "intro"
  | "edit-done"
  | "view-blocked"
  | "edit-failed"
  | "view-failed";

function emitBeat(beat: PermissionBeat): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PermissionBeat>(BEAT_EVENT, { detail: beat }),
  );
}

function LabPermissionPracticeInner() {
  const [beat, setBeat] = useState<PermissionBeat>("intro");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const next = (event as CustomEvent<PermissionBeat>).detail;
      if (
        next === "intro" ||
        next === "edit-done" ||
        next === "view-blocked" ||
        next === "edit-failed" ||
        next === "view-failed"
      ) {
        setBeat(next);
      }
    };
    window.addEventListener(BEAT_EVENT, handler);
    return () => window.removeEventListener(BEAT_EVENT, handler);
  }, []);

  return (
    <div data-step-id="lab-permission-practice" className="space-y-2">
      {beat === "intro" && (
        <div className="leading-relaxed">
          Two flavors of share. Edit means do whatever, view-only means
          look but don&apos;t touch. Watch {BEAKERBOT_LAB_DISPLAY_NAME}{" "}
          show the difference on the two cards in your Workbench.
        </div>
      )}
      {beat === "edit-done" && (
        <div
          data-testid="lab-permission-beat-edit-done"
          className="leading-relaxed"
        >
          Edit access lets you change anything. The rename just landed
          on the real shared task.
        </div>
      )}
      {beat === "view-blocked" && (
        <div
          data-testid="lab-permission-beat-view-blocked"
          className="leading-relaxed space-y-2"
        >
          <p>
            View-only locks the task. You can read but not edit or
            delete.
          </p>
          <p
            data-testid="lab-view-blocked-toast"
            className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5"
          >
            Blocked. Only the owner ({BEAKERBOT_LAB_DISPLAY_NAME}) can
            delete this task.
          </p>
        </div>
      )}
      {beat === "edit-failed" && (
        <div
          data-testid="lab-permission-beat-edit-failed"
          className="leading-relaxed"
        >
          Hmm, I couldn&apos;t find the shared edit card. The
          teaching: edit-share lets the recipient change anything
          (rename, reschedule, even mark complete) just like an owner.
        </div>
      )}
      {beat === "view-failed" && (
        <div
          data-testid="lab-permission-beat-view-failed"
          className="leading-relaxed"
        >
          Hmm, I couldn&apos;t find the view-only card. The teaching:
          view-only blocks edits and deletes; the recipient can read
          the task but not change it. Only the owner can delete.
        </div>
      )}
    </div>
  );
}

/**
 * Probe helper: did the edit arc actually land?
 *
 * After the cursor script has clicked the edit-permission card,
 * opened the popup, clicked Edit, typed a rename, and clicked Save,
 * we can verify the rename actually committed by checking that the
 * popup's Task Name input (if still mounted) contains the suffix, or
 * that the popup has already closed (the close-after-edit click ran).
 * The save write goes to disk async, so we don't probe disk: the
 * visible UI state is the source of truth for "the user saw it
 * happen."
 *
 * We treat the arc as landed when EITHER:
 *  - the name input still mounts AND contains the typed suffix, OR
 *  - the popup closed (close button click landed) AND the edit arc
 *    was actually started (anchor was found at build time).
 *
 * The second condition's `editArcStarted` guard prevents a false
 * positive when the popup never opened at all (no input mounted, no
 * popup to close, but the probe would otherwise see "no input
 * present" and falsely conclude "popup closed therefore done").
 */
function didEditArcLand(
  typedSuffix: string,
  editArcStarted: boolean,
): boolean {
  if (typeof document === "undefined") return false;
  const popupNameInput = document.querySelector(
    targetSelector(TOUR_TARGETS.taskPopupNameInput),
  );
  if (
    popupNameInput instanceof HTMLInputElement ||
    popupNameInput instanceof HTMLTextAreaElement
  ) {
    if (popupNameInput.value.includes(typedSuffix)) return true;
  }
  // Popup unmounted plus the arc was started = the close-after-edit
  // click landed = demo succeeded end-to-end.
  return !popupNameInput && editArcStarted;
}

/**
 * Probe helper: did the view-only delete attempt actually land on a
 * disabled Delete button?
 *
 * Strong success signal: the popup is still mounted AND the Delete
 * button exists AND is `disabled`. (The whole point: the click on a
 * disabled button is a no-op, the popup stays open.)
 */
function didViewBlockArcLand(): boolean {
  if (typeof document === "undefined") return false;
  const deleteBtn = document.querySelector(
    targetSelector(TOUR_TARGETS.taskPopupDeleteButton),
  );
  if (deleteBtn instanceof HTMLButtonElement) {
    return deleteBtn.disabled;
  }
  return false;
}

/**
 * Build the cursor script that drives the real-Workbench permission
 * demo. The script is intentionally tolerant: every step is `safe*`
 * (returns null on miss) and the whole pipeline runs through
 * `compactScript` so a missing anchor never throws, the demo just
 * skips that beat. This matches the rest of the v4 walkthrough.
 *
 * Narration honesty (HR P0-2 fix 2026-05-22): the beat emits are NOT
 * inline `emitBeat()` calls during the build phase any more (those
 * fired BEFORE any cursor action ran). They are `callbackAction`
 * entries threaded into the action array, so runScript replays them
 * in playback order, AFTER the preceding cursor action's promise has
 * resolved. Each callback also probes the DOM to decide whether to
 * emit the happy-path beat or the failure fallback, so a missing
 * shared card no longer produces "the rename just landed" copy over
 * a blank Workbench.
 */
async function buildPermissionDemoScript(): Promise<CursorAction[]> {
  const actions: Array<CursorAction | null> = [];
  const TYPED_SUFFIX = " (edited by me)";

  // Reset the beat to intro. Safe to fire at build time: the speech
  // component already mounts at intro by default; this is a belt-
  // and-suspenders reset for a re-entry case where the user back-
  // stepped out of a later beat and came back. Build-time emit is
  // FINE for the intro reset, the bug only existed for happy-path
  // success beats that pretended a cursor action had completed.
  emitBeat("intro");

  // Track whether each major arc found its starting anchor. Lets the
  // failure-fallback callback distinguish "the demo couldn't even
  // start" from "the demo started but the verifying DOM probe
  // missed."
  let editArcStarted = false;
  let viewArcStarted = false;

  // -- Edit-permission arc -------------------------------------------------
  // Click the edit-permission shared card => opens the TaskDetailPopup.
  const editCardClick = await safeClickAction(
    targetSelector(TOUR_TARGETS.workbenchSharedEditExperiment),
  );
  if (editCardClick) {
    editArcStarted = true;
    actions.push(editCardClick);
  }

  // Click the popup's Edit button to enter edit mode. The popup
  // mounts on the click above; wait for the Edit button to appear
  // before queuing the click action.
  await waitForElement(targetSelector(TOUR_TARGETS.taskPopupEditButton));
  const editClick = await safeClickAction(
    targetSelector(TOUR_TARGETS.taskPopupEditButton),
  );
  actions.push(editClick);

  // Type a rename into the Task Name input. Wait for the input to
  // mount (it only renders after `editing` flips true above).
  await waitForElement(targetSelector(TOUR_TARGETS.taskPopupNameInput));
  const typeRename = await safeTypeAction(
    targetSelector(TOUR_TARGETS.taskPopupNameInput),
    TYPED_SUFFIX,
    45,
  );
  actions.push(typeRename);

  // Click Save Changes. Real `tasksApi.update` lands the rename on
  // disk. The save button's `disabled` flips false once the name
  // diverges from `originalValues.name`, which the type action above
  // ensures.
  const saveClick = await safeClickAction(
    targetSelector(TOUR_TARGETS.taskPopupSaveButton),
  );
  actions.push(saveClick);

  // Brief in-script pause (via callback) to let the save settle
  // before the close-button click. We can't use `setTimeout` outside
  // the action array: that would advance the build past this point
  // before the cursor has even reached the Save button. The
  // `callbackAction` sits in the playback queue and blocks the next
  // action until its promise resolves.
  actions.push(
    callbackAction(
      () => new Promise<void>((resolve) => setTimeout(resolve, 600)),
    ),
  );

  const closeAfterEdit = await safeClickAction(
    targetSelector(TOUR_TARGETS.taskPopupClose),
  );
  actions.push(closeAfterEdit);

  // Emit the edit-done beat AT PLAYBACK TIME, gated on the DOM
  // probe. The arc-started flag handles "shared cards never mounted
  // at all" (we don't pretend the demo ran). The probe handles
  // "demo started but didn't visibly finish." Either failure mode
  // emits the teaching-only fallback.
  actions.push(
    callbackAction(() => {
      if (!editArcStarted) {
        emitBeat("edit-failed");
        return;
      }
      if (didEditArcLand(TYPED_SUFFIX, editArcStarted)) {
        emitBeat("edit-done");
      } else {
        emitBeat("edit-failed");
      }
    }),
  );

  // Hold on the edit-done copy briefly before transitioning to the
  // view-blocked arc. Same callback-as-pause pattern.
  actions.push(
    callbackAction(
      () => new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ),
  );

  // -- View-only arc -------------------------------------------------------
  // Click the view-only shared card => opens the popup for the view task.
  const viewCardClick = await safeClickAction(
    targetSelector(TOUR_TARGETS.workbenchSharedViewExperiment),
  );
  if (viewCardClick) {
    viewArcStarted = true;
    actions.push(viewCardClick);
  }

  // Glide to the (disabled) Delete button. Programmatic
  // `target.click()` on a `disabled` button is a no-op in the DOM
  // (no event fires), but the glide-and-click still LOOKS like an
  // attempt to the user. We deliberately fire it so the cursor
  // visibly tries; the speech bubble then explains why nothing
  // happened.
  await waitForElement(targetSelector(TOUR_TARGETS.taskPopupDeleteButton));
  const deleteAttempt = await safeClickAction(
    targetSelector(TOUR_TARGETS.taskPopupDeleteButton),
  );
  actions.push(deleteAttempt);

  // Emit the view-blocked beat AT PLAYBACK TIME, gated on the DOM
  // probe verifying the Delete button is mounted + disabled. Falls
  // back to view-failed if the popup never opened or the button
  // isn't there.
  actions.push(
    callbackAction(() => {
      if (!viewArcStarted) {
        emitBeat("view-failed");
        return;
      }
      if (didViewBlockArcLand()) {
        emitBeat("view-blocked");
      } else {
        emitBeat("view-failed");
      }
    }),
  );

  // Hold on the view-blocked copy briefly before the cursor moves to
  // close the popup.
  actions.push(
    callbackAction(
      () => new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ),
  );

  // Close the popup.
  const closeAfterView = await safeClickAction(
    targetSelector(TOUR_TARGETS.taskPopupClose),
  );
  actions.push(closeAfterView);

  return compactScript(actions);
}

/**
 * Build the registry entry for `lab-permission-practice`. Manual
 * completion; advance after the user clicks "Got it, next" in the
 * overlay button. The cursor demo plays as soon as the step enters;
 * the user reads the narration as the cursor moves, then clicks the
 * manual advance once they're done.
 *
 * The spotlight target is the experiments container (the same anchor
 * as the prior R1 implementation) so the broad surface is visually
 * framed while the cursor drills into specific cards. The per-card
 * targets are resolved inside the cursor script, not as the step's
 * spotlight, since the script transitions between two cards during
 * the demo.
 *
 * Cleanup safety: the rename in the edit arc writes to BeakerBot's
 * shared task on disk. `lab-auto-cleanup` (next step) calls
 * `cleanupBeakerBotLabUser` which iterates every task in BeakerBot's
 * namespace and revokes shares + soft-tombstones the user; the whole
 * folder cascades, so the renamed task goes with it. The rename
 * never outlives the tour.
 */
export function buildLabPermissionPracticeStep(): TourStep {
  return {
    id: "lab-permission-practice",
    speech: () => <LabPermissionPracticeInner />,
    pose: "pointing",
    targetSelector: "[data-tour-target='workbench-shared-experiments']",
    cursorScript: cursorScript(buildPermissionDemoScript),
    completion: {
      type: "manual",
      buttonLabel: "Got it, next",
    },
    // Live-test R4 (2026-05-22): the spotlight + cursor demo live on
    // /workbench. Auto-nav so the cards are mounted before the cursor
    // tries to click them.
    expectedRoute: "/workbench",
  };
}

export default LabPermissionPracticeInner;
