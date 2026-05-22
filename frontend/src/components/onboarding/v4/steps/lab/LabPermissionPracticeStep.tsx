"use client";

import { useEffect, useState } from "react";
import type { TourStep, CursorAction } from "../../step-types";
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
  waitForElement,
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
 * Speech-bubble narration moves through three beats keyed off the
 * `tour:lab-permission-beat` custom event:
 *   - "intro"        — opening copy.
 *   - "edit-done"    — after the real rename succeeds.
 *   - "view-blocked" — after the delete attempt fires (and is blocked
 *                      by the product's `disabled` gate).
 *
 * Why a custom-event channel (not React props):
 *   The speech component lives inside the speech bubble (mounted by
 *   TourController), the cursor script runs side-effectfully on step
 *   entry. They share NO React tree, so a window-level CustomEvent is
 *   the cheapest cross-tree coordination signal, the same pattern used
 *   by every other v4 step that needs to bridge a cursor demo to a
 *   speech update (`tour:notifications-popup-opened`, etc.).
 *
 * Delete-blocking, verified: `TaskDetailPopup`'s action-row Delete
 * button uses `disabled={task.is_shared_with_me}` (no permission check,
 * shared-into-me is the strong condition because only the owner can
 * delete). View-only AND edit-permission shares are both blocked by
 * this gate, which is the correct product behavior for the cursor demo
 * (the demo only fires the delete attempt on the VIEW share). The
 * native tooltip "Only the owner (BeakerBot) can delete this task"
 * already explains why; we surface the same explanation in the speech
 * bubble so the user reads it in the natural reading flow.
 */

const BEAT_EVENT = "tour:lab-permission-beat";

type PermissionBeat = "intro" | "edit-done" | "view-blocked";

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
      if (next === "intro" || next === "edit-done" || next === "view-blocked") {
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
          look but don&apos;t touch. Watch {BEAKERBOT_LAB_DISPLAY_NAME}
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
    </div>
  );
}

/**
 * Build the cursor script that drives the real-Workbench permission
 * demo. The script is intentionally tolerant: every step is `safe*`
 * (returns null on miss) and the whole pipeline runs through
 * `compactScript` so a missing anchor never throws, the demo just
 * skips that beat. This matches the rest of the v4 walkthrough.
 */
async function buildPermissionDemoScript(): Promise<CursorAction[]> {
  const actions: Array<CursorAction | null> = [];

  // Reset the beat to intro (no-op if the speech bubble already mounted
  // with intro). Done via a non-cursor side effect; the cursor primitives
  // don't include "emit event" so we fire this directly here.
  emitBeat("intro");

  // -- Edit-permission arc -------------------------------------------------
  // Click the edit-permission shared card => opens the TaskDetailPopup.
  const editCardClick = await safeClickAction(
    targetSelector(TOUR_TARGETS.workbenchSharedEditExperiment),
  );
  actions.push(editCardClick);

  // Click the popup's Edit button to enter edit mode. The popup mounts
  // on the click above; wait for the Edit button to appear before
  // queuing the click action.
  await waitForElement(targetSelector(TOUR_TARGETS.taskPopupEditButton));
  const editClick = await safeClickAction(
    targetSelector(TOUR_TARGETS.taskPopupEditButton),
  );
  actions.push(editClick);

  // Type a rename into the Task Name input. Wait for the input to mount
  // (it only renders after `editing` flips true above).
  await waitForElement(targetSelector(TOUR_TARGETS.taskPopupNameInput));
  const typeRename = await safeTypeAction(
    targetSelector(TOUR_TARGETS.taskPopupNameInput),
    " (edited by me)",
    45,
  );
  actions.push(typeRename);

  // Click Save Changes. Real `tasksApi.update` lands the rename on disk.
  // The save button's `disabled` flips false once the name diverges from
  // `originalValues.name`, which the type action above ensures.
  const saveClick = await safeClickAction(
    targetSelector(TOUR_TARGETS.taskPopupSaveButton),
  );
  actions.push(saveClick);

  // Close the popup. Wait briefly for the save to settle so the close
  // doesn't race with the React refetch.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const closeAfterEdit = await safeClickAction(
    targetSelector(TOUR_TARGETS.taskPopupClose),
  );
  actions.push(closeAfterEdit);

  // Flip the speech narration to "edit-done". Delayed by another beat so
  // the user sees the rename land before the copy changes.
  await new Promise((resolve) => setTimeout(resolve, 400));
  emitBeat("edit-done");
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // -- View-only arc -------------------------------------------------------
  // Click the view-only shared card => opens the popup for the view task.
  const viewCardClick = await safeClickAction(
    targetSelector(TOUR_TARGETS.workbenchSharedViewExperiment),
  );
  actions.push(viewCardClick);

  // Glide to the (disabled) Delete button. Programmatic `target.click()`
  // on a `disabled` button is a no-op in the DOM (no event fires), but
  // the glide-and-click still LOOKS like an attempt to the user. We
  // deliberately fire it so the cursor visibly tries; the speech bubble
  // then explains why nothing happened.
  await waitForElement(targetSelector(TOUR_TARGETS.taskPopupDeleteButton));
  const deleteAttempt = await safeClickAction(
    targetSelector(TOUR_TARGETS.taskPopupDeleteButton),
  );
  actions.push(deleteAttempt);

  // Flip the speech narration to "view-blocked" so the blocked-toast
  // copy lands as the cursor's click ripple settles.
  await new Promise((resolve) => setTimeout(resolve, 600));
  emitBeat("view-blocked");
  await new Promise((resolve) => setTimeout(resolve, 1500));

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
 * overlay button. The cursor demo plays as soon as the step enters; the
 * user reads the narration as the cursor moves, then clicks the manual
 * advance once they're done.
 *
 * The spotlight target is the experiments container (the same anchor as
 * the prior R1 implementation) so the broad surface is visually framed
 * while the cursor drills into specific cards. The per-card targets are
 * resolved inside the cursor script, not as the step's spotlight, since
 * the script transitions between two cards during the demo.
 *
 * Cleanup safety: the rename in the edit arc writes to BeakerBot's
 * shared task on disk. `lab-auto-cleanup` (next step) calls
 * `cleanupBeakerBotLabUser` which iterates every task in BeakerBot's
 * namespace and revokes shares + soft-tombstones the user; the whole
 * folder cascades, so the renamed task goes with it. The rename never
 * outlives the tour.
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
