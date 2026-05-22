"use client";

import { useState } from "react";
import type { TourStep } from "../../step-types";
import {
  BEAKERBOT_LAB_DISPLAY_NAME,
  BEAKERBOT_EDIT_TASK_NAME,
  BEAKERBOT_VIEW_TASK_NAME,
} from "./lib/lab-fake-user";

/**
 * lab-permission-practice step body. §6.16b.
 *
 * Demonstrates the two permission flavors against the BeakerBot-
 * shared tasks created in `lab-spawn-beakerbot`:
 *
 *   - Edit task: clicking "Rename it" flips the displayed name,
 *     proving edit access lets you change anything.
 *   - View-only task: clicking "Delete" surfaces a red lock indicator
 *     + "Blocked" explanation. No real delete happens: the lock IS
 *     the demo; we don't need to round-trip through the file system
 *     to show what view-only means.
 *
 * Why no cursor scripting of the real Workbench cards in P7:
 *   - The brief says "Cursor opens the edit-permission experiment"
 *     and walks the user to the real Workbench card. That is a
 *     reasonable target for a future polish chip, but P5's universal
 *     walkthrough is the one porting the cursor scripts for real
 *     Workbench surfaces. P7 keeps the practice inside the speech
 *     bubble for two reasons:
 *       1. The shared tasks live in the real Workbench. Navigating
 *          there with a live cursor while still inside the modal-
 *          like speech bubble is awkward, and (more importantly) the
 *          real Workbench surface has no `data-tour-target` on
 *          shared-task cards yet: that's a P5 deliverable.
 *       2. The inline practice card matches the brief's "red lock
 *          indicator fires + delete blocked" requirement without
 *          requiring the real Workbench to render mid-tour. The
 *          card's lock icon + blocked toast IS the indicator.
 *   - The real shares ARE in the user's Workbench either way (the
 *     spawn step created them via the real shareTaskAs API). The
 *     user discovers them naturally after the tour ends, exactly
 *     what L19's minimal scope asked for.
 *
 * Speech is split across the two practice halves. The component
 * renders both halves inline and reveals the second-half copy after
 * the user practices the first half, matching the brief's beat
 * structure: "Edit access lets you change anything." → user clicks
 * → "View-only locks the task, you can read but not edit or delete."
 *
 * Completion contract: manual. The user reads the speech, practices
 * both halves, then clicks "Got it, next" to finish the lab tour.
 * Practicing is NOT required for advance (the user can advance after
 * reading copy alone) but the rename + blocked-delete affordances
 * give them the option to feel the difference.
 */

function LabPermissionPracticeInner() {
  const [edited, setEdited] = useState(false);
  const [blocked, setBlocked] = useState(false);

  return (
    <div
      data-step-id="lab-permission-practice"
      className="space-y-3"
    >
      <div className="leading-relaxed">
        Two flavors of share, green means edit, red means look but
        don&apos;t touch. Try editing the green one. Then try to delete
        the red one.
      </div>

      {/* Edit-permission practice card. */}
      <div
        data-l4-task="edit"
        className="rounded-lg border border-emerald-300 bg-white px-3 py-2 flex items-center gap-2"
      >
        <span
          aria-hidden
          className="text-emerald-600 text-sm font-bold"
          title="Edit permission"
        >
          ✎
        </span>
        <div className="flex-1 text-xs">
          <div className="font-medium text-gray-900">
            {edited
              ? `${BEAKERBOT_EDIT_TASK_NAME} (edited by you)`
              : BEAKERBOT_EDIT_TASK_NAME}
          </div>
          <div className="text-[10px] text-emerald-700">
            Edit permission, owned by {BEAKERBOT_LAB_DISPLAY_NAME}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEdited(true)}
          disabled={edited}
          data-lab-edit-rename
          className="px-2 py-1 text-[10px] font-medium border border-emerald-400 text-emerald-700 rounded-md hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-default"
        >
          {edited ? "Edited" : "Rename it"}
        </button>
      </div>
      {edited && (
        <p className="text-xs text-emerald-700">
          Edit access lets you change anything.
        </p>
      )}

      {/* View-only practice card. */}
      <div
        data-l4-task="view"
        className="rounded-lg border border-rose-300 bg-white px-3 py-2 flex items-center gap-2"
      >
        <span
          aria-hidden
          className="text-rose-600 text-sm font-bold"
          title="View-only permission"
          data-testid="lab-view-lock-indicator"
        >
          🔒
        </span>
        <div className="flex-1 text-xs">
          <div className="font-medium text-gray-900">
            {BEAKERBOT_VIEW_TASK_NAME}
          </div>
          <div className="text-[10px] text-rose-700">
            View only, owned by {BEAKERBOT_LAB_DISPLAY_NAME}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setBlocked(true)}
          data-lab-view-delete
          className="px-2 py-1 text-[10px] font-medium border border-rose-300 text-rose-700 rounded-md hover:bg-rose-50"
        >
          Delete
        </button>
      </div>
      {blocked && (
        <p
          data-testid="lab-view-blocked"
          className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5"
        >
          Blocked. View-only locks the task, you can read but not
          edit or delete.
        </p>
      )}
    </div>
  );
}

/**
 * Build the registry entry for `lab-permission-practice`. Manual
 * completion; advance after the user clicks "Got it, next" in the
 * overlay button. The `onExit` hook fires `cleanupBeakerBotLabUser`
 * via the auto-cleanup step's onEnter, not from here: keeping the
 * cleanup at the LAST lab step (lab-permission-practice or
 * phase4-cleanup, whichever fires) avoids tearing down BeakerBot
 * mid-tour if the user back-steps to the spawn step.
 *
 * The cursor script anchors the spotlight at the Workbench
 * experiment cards so the visual focus is on the real shared tasks
 * the spawn step wrote: even though the practice happens inline in
 * the speech bubble. If the targets aren't present (e.g., the user
 * is on a non-Workbench route), the spotlight gracefully no-ops
 * (TourSpotlight handles missing anchors).
 */
export function buildLabPermissionPracticeStep(): TourStep {
  return {
    id: "lab-permission-practice",
    speech: () => <LabPermissionPracticeInner />,
    pose: "pointing",
    // The shared task cards on the Workbench are the anchor when the
    // user is on /workbench. P5's universal walkthrough will add the
    // canonical data-tour-target on the experiment-card surface; we
    // pre-target it here so the spotlight starts working the moment
    // that anchor lands. Until P5 ships, the spotlight is a no-op
    // (TourSpotlight returns null when the target isn't found),
    // which is the desired behaviour for the minimal scope.
    targetSelector: "[data-tour-target='workbench-shared-experiments']",
    completion: {
      type: "manual",
      buttonLabel: "Got it, next",
    },
    // Live-test R4 (2026-05-22): the spotlight target lives on
    // /workbench (in WorkbenchExperimentsPanel.tsx). If the user
    // lands on this step from any other route, the spotlight selector
    // doesn't resolve and the visual anchor is missing. Auto-nav to
    // /workbench so the speech bubble's "shared experiments" copy
    // actually points at something.
    expectedRoute: "/workbench",
  };
}

export default LabPermissionPracticeInner;
