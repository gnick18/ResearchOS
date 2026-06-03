"use client";

import { useQuery } from "@tanstack/react-query";
import { tasksApi, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import type { Task } from "@/lib/types";
import { useState, useCallback } from "react";
import TaskDetailPopup from "./TaskDetailPopup";
import TaskQuickPopup from "./TaskQuickPopup";

interface MethodExperimentsSidebarProps {
  methodId: number;
  methodName: string;
}

export default function MethodExperimentsSidebar({
  methodId,
}: MethodExperimentsSidebarProps) {
  // For quick popup
  const [quickPopupTask, setQuickPopupTask] = useState<Task | null>(null);
  const [quickPopupPosition, setQuickPopupPosition] = useState({ x: 0, y: 0 });
  
  // Local row type: a Task with the per-method variation_notes lifted off
  // the matching TaskMethodAttachment. Carrying the full Task (and thus
  // `owner`) is what lets us do composite-key project lookups below.
  type ExperimentRow = Task & { variation_notes: string | null };

  // For full detail popup
  const [selectedExperiment, setSelectedExperiment] = useState<Task | null>(null);
  const [hoveredExperiment, setHoveredExperiment] = useState<ExperimentRow | null>(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });

  // Fetch experiments using this method - always fetch fresh data.
  // Switched from `methodsApi.getExperiments` (which returns a lighter
  // `MethodExperiment` shape with no `owner`) to `tasksApi.listByMethod`
  // so we have the owner needed for composite-key project lookups
  // (per-user ID spaces — see AGENTS.md §2 + §6). `variation_notes` lives
  // on the matching `TaskMethodAttachment`, not on Task itself, so lift it
  // here to preserve the existing hover-popup contract.
  const { data: experiments = [], isLoading, error } = useQuery<ExperimentRow[]>({
    queryKey: ["method-experiments", methodId],
    queryFn: async () => {
      const tasks = await tasksApi.listByMethod(methodId);
      return tasks
        .filter((t) => t.task_type === "experiment")
        .map((t) => ({
          ...t,
          variation_notes:
            t.method_attachments?.find((a) => a.method_id === methodId)
              ?.variation_notes ?? null,
        }));
    },
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: true, // Refetch when component mounts
  });

  // Fetch all projects to get project names
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchAllProjectsIncludingShared,
    staleTime: 60000, // Cache projects for 1 minute
  });

  // Get project by composite (owner, id). Per-user ID spaces mean alex's
  // project 1 and morgan's project 1 are different projects — a numeric-id-
  // only lookup picks whichever happens to be first in the array. Callers
  // pass `{ owner, id }`; for tasks that's `{ owner, id: project_id }`.
  const getProject = useCallback(
    (ref: { owner: string; id: number }) =>
      projects.find((p) => p.id === ref.id && p.owner === ref.owner),
    [projects]
  );

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Get status badge color
  const getStatusColor = (exp: Task) => {
    const today = new Date().toISOString().split("T")[0];
    if (exp.is_complete) return "bg-green-100 text-green-700";
    if (exp.end_date < today) return "bg-red-100 text-red-700";
    if (exp.start_date <= today && exp.end_date >= today) return "bg-blue-100 text-blue-700";
    return "bg-gray-100 text-gray-600";
  };

  // Get status text
  const getStatusText = (exp: Task) => {
    const today = new Date().toISOString().split("T")[0];
    if (exp.is_complete) return "Complete";
    if (exp.end_date < today) return "Overdue";
    if (exp.start_date <= today && exp.end_date >= today) return "In Progress";
    return "Upcoming";
  };

  // Handle clicking on an experiment - show quick popup
  const handleExperimentClick = useCallback(async (exp: Task, event: React.MouseEvent) => {
    try {
      // Route shared tasks to their owner so we get the right per-user record.
      const task = await tasksApi.get(
        exp.id,
        exp.is_shared_with_me ? exp.owner : undefined,
      );
      setQuickPopupTask(task);
      setQuickPopupPosition({ x: event.clientX, y: event.clientY });
    } catch (error) {
      console.error("Failed to fetch task:", error);
    }
  }, []);

  // Handle expand from quick popup to full detail
  const handleExpandToDetail = useCallback(() => {
    if (quickPopupTask) {
      setSelectedExperiment(quickPopupTask);
      setQuickPopupTask(null);
    }
  }, [quickPopupTask]);

  if (isLoading) {
    return (
      <div className="w-72 border-l border-gray-200 bg-gray-50 p-4 flex flex-col">
        <h3 className="text-meta font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Linked Experiments
        </h3>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-meta text-gray-400 animate-pulse">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-72 border-l border-gray-200 bg-gray-50 p-4 flex flex-col">
        <h3 className="text-meta font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Linked Experiments
        </h3>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-meta text-red-400">Failed to load experiments</p>
            <p className="text-meta text-gray-300 mt-1">
              {String(error)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (experiments.length === 0) {
    return (
      <div className="w-72 border-l border-gray-200 bg-gray-50 p-4 flex flex-col">
        <h3 className="text-meta font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Linked Experiments
        </h3>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-meta text-gray-400">No experiments linked</p>
            <p className="text-meta text-gray-300 mt-1">
              Experiments using this method will appear here
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-72 border-l border-gray-200 bg-gray-50 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-white">
          <h3 className="text-meta font-semibold text-gray-500 uppercase tracking-wider">
            Linked Experiments
          </h3>
          <p className="text-meta text-gray-400 mt-0.5">
            {experiments.length} experiment{experiments.length !== 1 ? "s" : ""} using this method
          </p>
        </div>

        {/* Experiment cards */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {experiments.map((exp) => {
            const project = getProject({ owner: exp.owner, id: exp.project_id });
            return (
              <button
                key={`${exp.owner}:${exp.id}`}
                onClick={(e) => handleExperimentClick(exp, e)}
                onMouseEnter={(e) => {
                  if (exp.variation_notes) {
                    setHoveredExperiment(exp);
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPopupPosition({ x: rect.left - 10, y: rect.top });
                  }
                }}
                onMouseLeave={() => setHoveredExperiment(null)}
                className="w-full text-left bg-white rounded-lg border border-gray-200 p-3 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer relative"
              >
                {/* Project color indicator */}
                <div className="flex items-start gap-2">
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ backgroundColor: project?.color || "#9ca3af" }}
                  />
                  <div className="flex-1 min-w-0">
                    {/* Experiment name */}
                    <h4 className="text-body font-medium text-gray-900 truncate">
                      {exp.name}
                    </h4>
                    
                    {/* Project name */}
                    <p className="text-meta text-gray-400 truncate mt-0.5">
                      {project?.name || "Unknown Project"}
                    </p>
                    
                    {/* Date range */}
                    <div className="flex items-center gap-1 mt-1.5 text-meta text-gray-500">
                      <span>{formatDate(exp.start_date)}</span>
                      <span>→</span>
                      <span>{formatDate(exp.end_date)}</span>
                      <span className="text-gray-300">·</span>
                      <span>{exp.duration_days}d</span>
                    </div>
                    
                    {/* Status badge */}
                    <div className="mt-2">
                      <span className={`text-meta px-2 py-0.5 rounded-full ${getStatusColor(exp)}`}>
                        {getStatusText(exp)}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Variation notes hover popup */}
      {hoveredExperiment && hoveredExperiment.variation_notes && (
        <div
          className="fixed z-50 w-80 bg-white rounded-lg shadow-xl border border-gray-200 p-4 pointer-events-none"
          style={{
            left: `calc(${popupPosition.x}px - 330px)`,
            top: `${popupPosition.y}px`,
            maxHeight: "300px",
            overflowY: "auto",
          }}
        >
          <h4 className="text-meta font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Variations
          </h4>
          <div className="text-meta text-gray-600 whitespace-pre-wrap prose prose-xs max-w-none">
            {hoveredExperiment.variation_notes}
          </div>
        </div>
      )}

      {/* Task Quick Popup */}
      {quickPopupTask && (
        <TaskQuickPopup
          task={quickPopupTask}
          project={getProject({
            owner: quickPopupTask.owner,
            id: quickPopupTask.project_id,
          })}
          position={quickPopupPosition}
          onClose={() => setQuickPopupTask(null)}
          onExpand={handleExpandToDetail}
        />
      )}

      {/* Experiment detail popup overlay */}
      {selectedExperiment && (
        <TaskDetailPopup
          task={selectedExperiment}
          project={getProject({
            owner: selectedExperiment.owner,
            id: selectedExperiment.project_id,
          })}
          onClose={() => setSelectedExperiment(null)}
        />
      )}
    </>
  );
}
