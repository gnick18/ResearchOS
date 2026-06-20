"use client";

// PI-Mode Lab Work hub (LW-1..3, Grant approved 2026-06-13).
//
// The PI's version of the Workbench: instead of personal projects/lists, it tabs
// across the lab-wide work surfaces and mentoring. Composes the existing,
// self-contained panels (LabExperimentsPanel, NotesPanel in lab mode,
// WorkbenchOneOnOnePanel) so there is one home for "what my lab is doing" and the
// 1:1s, distinct from People (the roster) and Activity (the feed).
//
// Per Grant's LW-1 note, a PI still uses the notes/list features, just in their
// lab-head way; this v1 gives them the lab-wide experiments + notes browse and
// Mentoring. Personal Projects/Lists/Notes stay on the researcher Workbench,
// reached via the "My work" toggle (LW-3).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useMemo, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useLabData } from "@/hooks/useLabData";
import { tasksApi, type LabTask } from "@/lib/local-api";
import type { Task } from "@/lib/types";
import { Icon, type IconName } from "@/components/icons";
import { PageContainer } from "@/components/layout/PageContainer";
import LabExperimentsPanel from "@/components/LabExperimentsPanel";
import NotesPanel from "@/components/NotesPanel";
import WorkbenchOneOnOnePanel from "@/components/workbench/WorkbenchOneOnOnePanel";
import TaskDetailPopup from "@/components/TaskDetailPopup";

type LabWorkTab = "experiments" | "notes" | "mentoring";

const TABS: { id: LabWorkTab; label: string; icon: IconName }[] = [
  { id: "experiments", label: "Lab experiments", icon: "vial" },
  { id: "notes", label: "Lab notes", icon: "book" },
  { id: "mentoring", label: "Mentoring", icon: "labTree" },
];

export default function LabWorkPage() {
  const { currentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(currentUser);
  const { users } = useLabData();
  const [activeTab, setActiveTab] = useState<LabWorkTab>("experiments");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Browse every member's work (the PI's own included), so the whole lab lives
  // in one view. Mirrors /lab-experiments + /lab-notes.
  const selectedUsernames = useMemo(
    () => new Set(users.map((u) => u.username)),
    [users],
  );

  const openExperiment = async (lt: LabTask) => {
    const full = await tasksApi.get(lt.id, lt.username);
    if (full) setSelectedTask(full);
  };

  if (isLabHead === false) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-meta text-foreground-muted">
          Lab Work is the lab head&apos;s view of the lab&apos;s experiments,
          notes, and mentoring. Sign in as the PI to use it.
        </p>
      </div>
    );
  }

  return (
    <PageContainer width="full" className="py-6">
      <div className="mb-4 space-y-1">
        <h1 className="text-title font-semibold text-foreground">Lab Work</h1>
        <p className="text-meta text-foreground-muted leading-relaxed">
          Browse every member&apos;s experiments and notes, and run your
          check-ins, all in one place. Open a record to review it or edit it as
          the lab head.
        </p>
      </div>

      {/* Tab bar (mirrors the Workbench pattern). */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              data-testid={`lab-work-tab-${t.id}`}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-body font-medium transition ${
                active
                  ? "border-brand-action text-foreground"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              <Icon name={t.icon} className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "experiments" && (
        <LabExperimentsPanel
          selectedUsernames={selectedUsernames}
          onExperimentClick={openExperiment}
        />
      )}
      {activeTab === "notes" && (
        <NotesPanel isLabMode selectedUsernames={selectedUsernames} />
      )}
      {activeTab === "mentoring" && currentUser && (
        <WorkbenchOneOnOnePanel
          currentUser={currentUser}
          isLabHead={isLabHead === true}
        />
      )}

      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          readOnly
          username={selectedTask.owner ?? undefined}
          onClose={() => setSelectedTask(null)}
          onNavigateToTask={(t) => setSelectedTask(t)}
        />
      )}
    </PageContainer>
  );
}
