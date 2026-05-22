"use client";

/**
 * §6.16 (Lab Mode redesign 2026-05-22) — DemoLabModeViewer.
 *
 * Fullscreen overlay that embeds the real Lab Mode UI on top of the
 * user's app, wired against the demo bundle's data. Used by the new
 * Phase 2c walk-through (lab-mode-warp-to-demo → lab-mode-exit).
 *
 * Why an overlay (not a route push):
 *   - The user's tour state lives in URL-agnostic memory; pushing them
 *     to /lab would trigger the LabModePage's own logout-on-exit
 *     handler and risk losing the active step. Overlaying preserves
 *     the underlying route + tour-controller state.
 *   - The /lab page already aggregates data across every user in the
 *     folder (via labApi); the viewer just re-renders the same panels
 *     under a different chrome so we get demo content for free as long
 *     as the bundle has multiple seeded users.
 *
 * The overlay re-uses every Lab* panel from the live page. Because
 * those panels are already read-only (the live `/lab` route is
 * "View-only access to all researchers' work" per the header), we
 * don't have to disable writes — they're not present to begin with.
 *
 * Tour-target stamps live on the SAME `data-tour-target` names as the
 * live page so the lab-mode-* step cursor scripts can resolve their
 * anchors identically whether the user is on `/lab` or inside the
 * overlay. The exit button uses `lab-mode-exit-button` so the
 * `lab-mode-exit` step can drive it.
 *
 * Demo-data caveats (recorded for the parent caller):
 *   - The demo notes seed is a separate parallel sub-bot; until it
 *     lands, the Notes tab inside this viewer will be empty.
 *   - SMART goals coverage in the demo bundle drives the Roadmaps tab.
 *     If absent, the Roadmaps tab renders empty.
 *
 * Dismissal: parent passes `onExit` which the bottom-right exit
 * button calls. The viewer also calls `onExit` when the user presses
 * Escape, mirroring how the rest of the v4 modals dismiss.
 */

import { useCallback, useEffect, useState } from "react";
import { useLabData } from "@/hooks/useLabData";
import LabUserFilterButton from "@/components/LabUserFilterButton";
import LabSearchPanel from "@/components/LabSearchPanel";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import LabGanttChart from "@/components/LabGanttChart";
import LabPurchasesPanel from "@/components/LabPurchasesPanel";
import LabExperimentsPanel from "@/components/LabExperimentsPanel";
import LabActivityPanel from "@/components/LabActivityPanel";
import LabMethodsPanel from "@/components/LabMethodsPanel";
import LabRoadmapsPanel from "@/components/LabRoadmapsPanel";
import LabUserDetailPanel from "@/components/LabUserDetailPanel";
import NotesPanel from "@/components/NotesPanel";
import type { LabTask } from "@/lib/local-api";
import type { Task } from "@/lib/types";

type TabType =
  | "activity"
  | "gantt"
  | "experiments"
  | "purchases"
  | "roadmaps"
  | "methods"
  | "notes"
  | "search";

function labTaskToTask(labTask: LabTask): Task {
  return {
    id: labTask.id,
    project_id: labTask.project_id,
    name: labTask.name,
    start_date: labTask.start_date,
    duration_days: labTask.duration_days,
    end_date: labTask.end_date,
    is_high_level: false,
    is_complete: labTask.is_complete,
    task_type: labTask.task_type as "experiment" | "purchase" | "list",
    weekend_override: null,
    method_ids: labTask.method_ids || [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: labTask.experiment_color,
    sub_tasks: null,
    method_attachments: (labTask.method_ids || []).map((methodId) => ({
      method_id: methodId,
      owner: null,
      pcr_gradient: null,
      pcr_ingredients: null,
      lc_gradient: null,
      body_override: null,
      plate_annotation: null,
      cell_culture_schedule: null,
      variation_notes: null,
      compound_snapshots: null,
      qpcr_analysis: null,
    })),
    owner: labTask.username,
    shared_with: [],
    inherited_from_project: null,
  };
}

export interface DemoLabModeViewerProps {
  /** Called when the user clicks the "Exit Lab Mode" button or presses
   *  Escape. The parent (TourController step body) should dismiss the
   *  viewer and advance the tour. */
  onExit: () => void;
  /** Optional initial tab. Defaults to "activity" — the same landing
   *  page the real /lab route opens on. */
  initialTab?: TabType;
}

/**
 * DemoLabModeViewer — fullscreen read-only embed of the lab page,
 * mounted as an overlay by the lab-mode-warp-to-demo step.
 */
export default function DemoLabModeViewer({
  onExit,
  initialTab = "activity",
}: DemoLabModeViewerProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [selectedTask, setSelectedTask] = useState<LabTask | null>(null);
  const [viewingUser, setViewingUser] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [seededSelection, setSeededSelection] = useState(false);

  const { users, tasks, projects, isLoading, errorMessage, retry } =
    useLabData();

  // Seed the user-filter selection once users load. Same shape as the
  // live LabModePage so the cross-user lists / Gantt / etc. all see
  // everyone by default.
  useEffect(() => {
    if (seededSelection) return;
    if (isLoading) return;
    if (users.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot seed on async-loaded users
    setSelectedUsers(new Set(users.map((u) => u.username)));
    setSeededSelection(true);
  }, [seededSelection, isLoading, users]);

  // Escape-to-dismiss mirrors the rest of the v4 modal surface.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onExit]);

  const filteredProjects = projects.filter((p) =>
    selectedUsers.has(p.username),
  );
  const experiments = tasks.filter(
    (t) => selectedUsers.has(t.username) && t.task_type === "experiment",
  );
  const purchases = tasks.filter(
    (t) => selectedUsers.has(t.username) && t.task_type === "purchase",
  );

  const toggleUser = useCallback((username: string) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }, []);

  const selectAllUsers = useCallback(() => {
    setSelectedUsers(new Set(users.map((u) => u.username)));
  }, [users]);

  const deselectAllUsers = useCallback(() => {
    setSelectedUsers(new Set());
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Demo Lab Mode viewer"
      data-testid="demo-lab-mode-viewer"
      // Lab Mode fix manager R1 (2026-05-22): bumped from z-[60] to
      // z-[200] so future modal additions inside the lab UI can't
      // peek through the demo overlay. Still sits below the tour
      // BeakerBot speech bubble (z-[450]) so BeakerBot remains
      // clickable on top of the viewer.
      className="fixed inset-0 z-[200] bg-gray-50 overflow-y-auto"
    >
      {/* Header — mirrors the live /lab chrome, plus a DEMO pill so
          the user knows this isn't their own account. The Exit button
          is the same `lab-mode-exit-button` anchor the real page uses
          so the lab-mode-exit step's cursor script doesn't have to
          care which surface mounts the overlay. */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  Lab Mode
                  <span
                    data-testid="demo-lab-mode-pill"
                    className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-100 text-amber-800 border border-amber-200"
                  >
                    Demo
                  </span>
                </h1>
                <p className="text-sm text-gray-500">
                  Read-only preview against fake lab data
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onExit}
              data-tour-target="lab-mode-exit-button"
              data-testid="demo-lab-mode-exit"
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Exit Lab Mode
            </button>
          </div>

          {/* Tabs — identical button list to the live page so the
              cursor scripts that target lab-mode-*-tab anchors keep
              working inside the overlay. */}
          <div className="flex gap-1 flex-wrap">
            <TabButton
              active={activeTab === "activity"}
              onClick={() => setActiveTab("activity")}
              dataTourTarget="lab-mode-activity-tab"
              label="Activity"
            />
            <TabButton
              active={activeTab === "gantt"}
              onClick={() => setActiveTab("gantt")}
              dataTourTarget="lab-mode-gantt-tab"
              label="GANTT"
            />
            <TabButton
              active={activeTab === "experiments"}
              onClick={() => setActiveTab("experiments")}
              dataTourTarget="lab-mode-experiments-tab"
              label="Experiments"
            />
            <TabButton
              active={activeTab === "purchases"}
              onClick={() => setActiveTab("purchases")}
              dataTourTarget="lab-mode-purchases-tab"
              label="Purchases"
            />
            <TabButton
              active={activeTab === "roadmaps"}
              onClick={() => setActiveTab("roadmaps")}
              dataTourTarget="lab-mode-roadmaps-tab"
              label="Roadmaps"
            />
            <TabButton
              active={activeTab === "methods"}
              onClick={() => setActiveTab("methods")}
              dataTourTarget="lab-mode-methods-tab"
              label="Methods"
            />
            <TabButton
              active={activeTab === "notes"}
              onClick={() => setActiveTab("notes")}
              dataTourTarget="lab-mode-notes-tab"
              label="Notes"
            />
            <TabButton
              active={activeTab === "search"}
              onClick={() => setActiveTab("search")}
              dataTourTarget="lab-mode-search-tab"
              label="Search"
            />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
            <p className="text-gray-500">Loading demo lab data...</p>
          </div>
        )}

        {!isLoading && errorMessage && (
          <div className="text-center py-12">
            <p className="text-red-500 mb-4">{errorMessage}</p>
            <button
              type="button"
              onClick={retry}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !errorMessage && (
          <>
            {activeTab === "gantt" && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <StatCard label="Users" value={users.length} />
                <StatCard label="Projects" value={filteredProjects.length} />
                <StatCard
                  label="Experiments"
                  value={experiments.length}
                  tone="blue"
                />
                <StatCard
                  label="Purchases"
                  value={purchases.length}
                  tone="amber"
                />
              </div>
            )}

            {activeTab === "activity" ? (
              <LabActivityPanel
                selectedUsernames={selectedUsers}
                onTaskClick={setSelectedTask}
                onUserClick={setViewingUser}
                onSwitchToNotes={() => setActiveTab("notes")}
              />
            ) : activeTab === "search" ? (
              <LabSearchPanel
                selectedUsernames={selectedUsers}
                onTaskClick={setSelectedTask}
              />
            ) : activeTab === "gantt" ? (
              <LabGanttChart
                selectedUsernames={selectedUsers}
                onTaskClick={(task) => setSelectedTask(task)}
              />
            ) : activeTab === "experiments" ? (
              <LabExperimentsPanel
                selectedUsernames={selectedUsers}
                onExperimentClick={setSelectedTask}
              />
            ) : activeTab === "purchases" ? (
              <LabPurchasesPanel
                selectedUsernames={selectedUsers}
                onPurchaseClick={setSelectedTask}
              />
            ) : activeTab === "methods" ? (
              <LabMethodsPanel
                selectedUsernames={selectedUsers}
                onTaskClick={setSelectedTask}
                onUserClick={setViewingUser}
              />
            ) : activeTab === "roadmaps" ? (
              <LabRoadmapsPanel
                selectedUsernames={selectedUsers}
                onUserClick={setViewingUser}
              />
            ) : activeTab === "notes" ? (
              <NotesPanel
                isLabMode={true}
                selectedUsernames={selectedUsers}
                userColors={users.reduce(
                  (acc, u) => ({ ...acc, [u.username]: u.color }),
                  {} as Record<string, string>,
                )}
              />
            ) : null}
          </>
        )}
      </div>

      {users.length > 0 && (
        <LabUserFilterButton
          selectedUsernames={selectedUsers}
          onToggleUser={toggleUser}
          onSelectAll={selectAllUsers}
          onDeselectAll={deselectAllUsers}
          onViewUser={setViewingUser}
        />
      )}

      {selectedTask && (
        <TaskDetailPopup
          task={labTaskToTask(selectedTask)}
          onClose={() => setSelectedTask(null)}
          readOnly={true}
          username={selectedTask.username}
        />
      )}

      {viewingUser && (
        <LabUserDetailPanel
          username={viewingUser}
          onClose={() => setViewingUser(null)}
          onTaskClick={(task) => {
            setViewingUser(null);
            setSelectedTask(task);
          }}
        />
      )}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  dataTourTarget: string;
  label: string;
}

function TabButton({ active, onClick, dataTourTarget, label }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour-target={dataTourTarget}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-emerald-100 text-emerald-700"
          : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  tone?: "default" | "blue" | "amber";
}

function StatCard({ label, value, tone = "default" }: StatCardProps) {
  const toneClass =
    tone === "blue"
      ? "text-blue-600"
      : tone === "amber"
        ? "text-amber-600"
        : "text-gray-900";
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-200">
      <p className="text-gray-500 text-sm">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}
