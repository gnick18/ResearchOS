import { useEffect, useState } from "react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import { appendArtifact } from "../walkthrough/lib/wizard-artifacts";
import { BEAKERBOT_DISPLAY_NAME } from "./lib/beakerbot-user";
import {
  encodeLabTaskId,
  findLabTask,
} from "./lib/lab-artifacts";

/**
 * L4: Permission practice — both edit (green) and view-only (red).
 *
 * L20 lock: the user practices BOTH permission flavors against
 * BeakerBot-owned tasks. The edit-demo task (created at L2) supports
 * an inline "rename" action — clicking it flips the displayed name
 * inside the wizard, demonstrating that the user CAN write through
 * the share. The view-only task is registered here as a second
 * `lab_task` artifact (`view-demo`) and shown with a red lock
 * indicator + disabled delete button — clicking the disabled delete
 * surfaces a tooltip-style hint that view-only blocks writes.
 *
 * sharingApi support: the existing `sharingApi.shareTask` already
 * accepts `permission?: "view" | "edit"` at the task-share level (see
 * `local-api.ts:3343`), so the design ships as-is for P3a per
 * Outcome (a) of the manager's L4 pre-emptive lock.
 *
 * The actual cross-user task records are simulated for P3a (see
 * `lab-artifacts.ts` rationale); the artifact entries persist so
 * Phase 4 cleanup can iterate them. The visual delete button is a
 * pure UI demonstration — no task is removed even if the lock were
 * bypassed.
 */

interface L4Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const EDIT_TASK_BASE_NAME = "Sample experiment, gel screen";
const EDIT_TASK_RENAMED = "Sample experiment, gel screen (edited by you)";
const VIEW_TASK_NAME = "Sample dataset, read-only";

export default function L4PermissionPractice({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: L4Props) {
  const viewArtifact = findLabTask(sidecar, "view-demo");
  const [edited, setEdited] = useState(false);
  const [bouncedDelete, setBouncedDelete] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // L4 needs both the edit-demo task (from L2) and the view-demo task
  // (registered here on mount). The view-demo registration is a tiny
  // patchSidecar call that runs once when the step is reached and no
  // existing view-demo artifact is present (so back-step + forward
  // does not duplicate the entry; appendArtifact also dedupes).
  useEffect(() => {
    if (viewArtifact || registering) return;
    let cancelled = false;
    void (async () => {
      setRegistering(true);
      try {
        await patchSidecar((cur) =>
          appendArtifact(cur, {
            type: "lab_task",
            id: encodeLabTaskId("view-demo"),
            cleanup_default: "discard",
          }),
        );
      } catch (err) {
        if (!cancelled) {
          console.error("[onboarding-v3] L4 view-demo register failed", err);
          setError("Couldn't set up the view-only task. Try again.");
        }
      } finally {
        if (!cancelled) setRegistering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // viewArtifact is the only meaningful dep; registering is internal.
  }, [viewArtifact, patchSidecar, registering]);

  useEffect(() => {
    // Next stays enabled regardless — L4 is a demo step; users can
    // skip the rename / failed-delete interactions and still proceed.
    setNextDisabled(false);
  }, [setNextDisabled]);

  return (
    <div data-step-id="L4" className="space-y-4">
      <SpeechBubble>
        Two flavors of share: green means edit, red means look but
        don&apos;t touch. Try editing the green one. Then try to delete
        the red one. I dare you.
      </SpeechBubble>

      <div className="space-y-3">
        <div
          data-l4-task="edit"
          className="rounded-lg border border-emerald-300 bg-white px-4 py-3 flex items-center gap-3"
        >
          <span
            aria-hidden
            className="text-emerald-600 text-sm font-bold"
            title="Edit permission"
          >
            ✎
          </span>
          <div className="flex-1 text-sm">
            <div className="font-medium text-gray-900">
              {edited ? EDIT_TASK_RENAMED : EDIT_TASK_BASE_NAME}
            </div>
            <div className="text-xs text-emerald-700">
              Edit permission • owned by {BEAKERBOT_DISPLAY_NAME}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEdited(true)}
            disabled={edited}
            className="px-3 py-1.5 text-xs font-medium border border-emerald-400 text-emerald-700 rounded-md hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-default"
          >
            {edited ? "Edited" : "Rename it"}
          </button>
        </div>

        <div
          data-l4-task="view"
          className="rounded-lg border border-rose-300 bg-white px-4 py-3 flex items-center gap-3"
        >
          <span
            aria-hidden
            className="text-rose-600 text-sm font-bold"
            title="View-only permission"
          >
            🔒
          </span>
          <div className="flex-1 text-sm">
            <div className="font-medium text-gray-900">{VIEW_TASK_NAME}</div>
            <div className="text-xs text-rose-700">
              View only • owned by {BEAKERBOT_DISPLAY_NAME}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBouncedDelete(true)}
            data-l4-view-delete
            className="px-3 py-1.5 text-xs font-medium border border-rose-300 text-rose-700 rounded-md hover:bg-rose-50"
          >
            Delete
          </button>
        </div>
        {bouncedDelete && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            Blocked. View-only means you can read but not change or
            delete. If you need write access, ask {BEAKERBOT_DISPLAY_NAME}
            to re-share with edit permission.
          </p>
        )}
        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
