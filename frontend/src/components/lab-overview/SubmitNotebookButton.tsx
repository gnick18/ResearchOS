"use client";

// SubmitNotebookButton (CT-4 live wiring): the STUDENT submit control for a class
// notebook. A thin, self-contained button any notebook surface can drop in. It
// reads the current submission off the task, runs the legal transition, and
// persists it via the owner-scoped submitNotebookForStudent action (the student
// writes their OWN record, C2). Resubmit after a return is allowed; a double
// submit is refused by the pure state machine.
//
// FLAG: behind CLASS_MODE_ENABLED. Flag off, the button renders nothing, so a
// non-class build never shows it.
//
// PLACEMENT FOLLOW-UP (class-live-wiring lane): the exact notebook surface that
// owns the student's per-assignment notebook task is not yet built (the CT-2
// student-open path is a separate lane). This component is the ready submit
// control; mount it in that surface once it exists, passing the notebook task id +
// the pinned version-history rev. Shipping the control + the action now rather
// than guess-wiring it into the shared TaskModal (a contended surface).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import { submitNotebookForStudent } from "@/lib/lab/class-submission-actions";
import { CLASS_MODE_ENABLED } from "@/lib/lab/class-mode-config";
import type { ClassSubmission } from "@/lib/types";

interface SubmitNotebookButtonProps {
  /** The student's own notebook task id. */
  taskId: number;
  /** The version-history rev to pin at submit time (the "what they submitted"
   *  snapshot). The caller supplies the notebook's current rev. */
  submittedRev: string;
  /** The current submission, so the button shows the right label + disables a
   *  double submit. */
  submission?: ClassSubmission | null;
  /** The student username (owner-scoped write target). Optional; omitted uses the
   *  current-user solo path. */
  owner?: string;
  /** Fired with the updated submission after a successful submit. */
  onSubmitted?: (next: ClassSubmission) => void;
}

export default function SubmitNotebookButton({
  taskId,
  submittedRev,
  submission,
  owner,
  onSubmitted,
}: SubmitNotebookButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!CLASS_MODE_ENABLED) return null;

  const status = submission?.status ?? "not_submitted";
  const alreadySubmitted = status === "submitted";
  const label =
    status === "returned" ? "Resubmit notebook" : "Submit notebook";

  const onClick = async () => {
    setBusy(true);
    setError(null);
    const result = await submitNotebookForStudent({ taskId, submittedRev, owner });
    setBusy(false);
    if (result.ok) {
      onSubmitted?.(result.task.submission ?? { status: "submitted" });
    } else {
      setError(
        result.error instanceof Error
          ? result.error.message
          : "Could not submit the notebook.",
      );
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || alreadySubmitted}
        className="rounded-md bg-brand-action px-4 py-2 text-body font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Submitting..." : label}
      </button>
      {alreadySubmitted && (
        <span className="text-meta text-foreground-muted">
          Submitted. Your instructor will review and return it.
        </span>
      )}
      {error && (
        <span className="text-meta text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
