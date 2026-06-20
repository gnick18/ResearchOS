"use client";

// StudentAssignmentsDrawer (CT-2): the global slide-over for a class student's
// assignments. Opened from the top-nav Assignments entry (AppShell), it lets a
// student peek at or submit an assignment from ANY page without leaving it, the
// complement to the dedicated workbench Assignments tab. Both render the same
// ClassAssignmentsPanel, so there is one assignments surface with two entry points.
//
// Right-anchored, Escape + backdrop-click to close (mirrors DayDetailDrawer). The
// caller (AppShell) gates the open state on class-student + flag, so this component
// only mounts when it should render.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect } from "react";
import ClassAssignmentsPanel from "./ClassAssignmentsPanel";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

export default function StudentAssignmentsDrawer({
  currentUser,
  onClose,
}: {
  currentUser: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-black/20 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Your assignments"
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-border bg-surface-overlay shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name="mortarboard" className="h-5 w-5 text-foreground-muted" />
            <h2 className="text-body font-semibold text-foreground">
              Your assignments
            </h2>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close assignments"
              className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="x" className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="mb-3 text-meta text-foreground-muted">
            Open an assignment to start your notebook, then submit it when you are
            done.
          </p>
          <ClassAssignmentsPanel currentUser={currentUser} />
        </div>
      </div>
    </div>
  );
}
