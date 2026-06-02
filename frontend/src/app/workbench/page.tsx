"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import NotesPanel from "@/components/NotesPanel";
import WorkbenchExperimentsPanel from "@/components/workbench/WorkbenchExperimentsPanel";
import WorkbenchListsPanel from "@/components/workbench/WorkbenchListsPanel";
import WorkbenchProjectFilterPills from "@/components/workbench/WorkbenchProjectFilterPills";
import { matchesAnyProjectFilter } from "@/lib/search/filterKey";
import type { Project } from "@/lib/types";

type TabType = "experiments" | "notes" | "lists";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

export default function WorkbenchPage() {
  // Sub-tab state stays purely local. The onboarding orchestrator's
  // `workbench-experiments-tab` gate reads tab state from the DOM via
  // `WorkbenchExperimentsPanel`'s `data-current-tab="experiments"`
  // root attribute (only present when that panel is mounted). That
  // lets the gate work without coupling Workbench's routing to the
  // onboarding system — the planned Lists-tab redesign can route
  // however it wants and this gate keeps working.
  const [activeTab, setActiveTab] = useState<TabType>("experiments");

  // Shared Notebooks Phase 4 (notebooks-phase4-widget sub-bot, 2026-06-02):
  // the Shared Notebook home/dashboard widget deep-links here with
  // `?tab=notes&notebook=<id>` to open the full Phase 2 SharedNotebookView for
  // a chosen 1:1 notebook. Read the query string ONCE on mount (window, not
  // useSearchParams, to avoid a CSR-bailout Suspense boundary): if `tab=notes`,
  // land on the Notes tab; the `notebook` id is handed to NotesPanel as its
  // initial selection. Absent params leave the default Experiments tab + the
  // Personal notes section untouched.
  const [initialNotebookId, setInitialNotebookId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "notes") setActiveTab("notes");
    const nb = params.get("notebook");
    if (nb) setInitialNotebookId(nb);
  }, []);

  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  // The header only needs a top-line count; the panel does its own fetches
  // and section assignment. Sharing the same query key (["tasks", user])
  // means the cache is reused.
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });

  const projectColors = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p, i) => {
      map[projectKey(p)] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  const upcomingCount = useMemo(() => {
    let xs = allTasks.filter(
      (t) => t.task_type === "experiment" && !t.is_complete,
    );
    // Composite-key match (alex:1 vs morgan:1 are different projects). See
    // matchesAnyProjectFilter / store.ts selectedProjectIds type comment.
    xs = xs.filter((t) => matchesAnyProjectFilter(t, selectedProjectIds));
    return xs.length;
  }, [allTasks, selectedProjectIds]);

  const openListCount = useMemo(() => {
    let xs = allTasks.filter(
      (t) => t.task_type === "list" && !t.is_complete,
    );
    xs = xs.filter((t) => matchesAnyProjectFilter(t, selectedProjectIds));
    return xs.length;
  }, [allTasks, selectedProjectIds]);

  const subtitle =
    activeTab === "experiments"
      ? `${upcomingCount} experiment${upcomingCount !== 1 ? "s" : ""} in flight`
      : activeTab === "lists"
        ? `${openListCount} open list task${openListCount !== 1 ? "s" : ""}`
        : "Meeting notes and running logs";

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Workbench</h2>
            <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 pb-3">
          <button
            onClick={() => setActiveTab("experiments")}
            data-tour-target="workbench-experiments-tab"
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === "experiments"
                ? "bg-blue-100 text-blue-700"
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            Experiments
          </button>
          <button
            onClick={() => setActiveTab("notes")}
            data-tour-target="workbench-notes-tab"
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === "notes"
                ? "bg-emerald-100 text-emerald-700"
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Notes
          </button>
          <button
            onClick={() => setActiveTab("lists")}
            data-tour-target="workbench-lists-tab"
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === "lists"
                ? "bg-violet-100 text-violet-700"
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Lists
          </button>
        </div>

        {/* Project filter — hidden on Notes (project-agnostic). */}
        {activeTab !== "notes" && (
          <WorkbenchProjectFilterPills
            projects={projects}
            projectColors={projectColors}
          />
        )}

        {activeTab === "notes" && (
          <NotesPanel initialNotebookId={initialNotebookId} />
        )}
        {activeTab === "experiments" && (
          <WorkbenchExperimentsPanel projects={projects} />
        )}
        {activeTab === "lists" && (
          <WorkbenchListsPanel projects={projects} />
        )}
      </div>
    </AppShell>
  );
}
