"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAllTasksIncludingShared,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import NotesPanel from "@/components/NotesPanel";
import WorkbenchExperimentsPanel from "@/components/workbench/WorkbenchExperimentsPanel";

type TabType = "experiments" | "notes";

export default function WorkbenchPage() {
  // Mirror the active tab into the URL (?tab=notes or ?tab=experiments)
  // so:
  //  1. the onboarding orchestrator's `workbench-experiments-tab` gate
  //     can read it without subscribing to local component state, and
  //  2. a deep-linked `/workbench?tab=notes` lands on the right tab.
  // Default is "experiments" — matches the prior behavior and what most
  // users want.
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab: TabType =
    searchParams?.get("tab") === "notes" ? "notes" : "experiments";
  const [activeTab, setActiveTab] = useState<TabType>(urlTab);

  // Re-sync local state if the URL tab changes (e.g. user clicks a
  // deep-link from somewhere else in the app).
  useEffect(() => {
    if (urlTab !== activeTab) setActiveTab(urlTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-way sync: URL → state. State → URL goes through changeTab().
  }, [urlTab]);

  const changeTab = (next: TabType) => {
    setActiveTab(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "experiments") params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    router.replace(query ? `/workbench?${query}` : "/workbench");
  };

  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // The header only needs a top-line count; the panel does its own fetches
  // and section assignment. Sharing the same query key (["tasks", user])
  // means the cache is reused.
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });

  const upcomingCount = useMemo(() => {
    let xs = allTasks.filter(
      (t) => t.task_type === "experiment" && !t.is_complete,
    );
    if (selectedProjectIds.length > 0) {
      xs = xs.filter((t) => selectedProjectIds.includes(t.project_id));
    }
    return xs.length;
  }, [allTasks, selectedProjectIds]);

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Workbench</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {activeTab === "experiments"
                ? `${upcomingCount} experiment${upcomingCount !== 1 ? "s" : ""} in flight`
                : "Meeting notes and running logs"}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 pb-3">
          <button
            onClick={() => changeTab("experiments")}
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
            onClick={() => changeTab("notes")}
            data-onboarding-target="workbench-notes"
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
        </div>

        {activeTab === "notes" && <NotesPanel />}
        {activeTab === "experiments" && <WorkbenchExperimentsPanel />}
      </div>
    </AppShell>
  );
}
