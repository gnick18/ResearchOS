"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi, filesApi, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { findExistingTaskResultsBase, taskResultsBase } from "@/lib/tasks/results-paths";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import type { Task, Project } from "@/lib/types";

interface ResultCard {
  task: Task;
  projectName: string;
  projectColor: string;
  hasNotes: boolean;
  attachmentCount: number;
}

export default function ResultsPage() {
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const queryClient = useQueryClient();

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const results = await Promise.all(
        projects.map((p) =>
          tasksApi.listByProject(p.id, p.is_shared_with_me ? p.owner : undefined)
        )
      );
      return results.flat();
    },
    enabled: projects.length > 0,
  });

  // Filter completed tasks or tasks with deviation logs (result-worthy tasks)
  const resultTasks = useMemo(() => {
    let tasks = allTasks.filter((t) => t.is_complete || t.deviation_log);
    if (selectedProjectIds.length > 0) {
      tasks = tasks.filter((t) => selectedProjectIds.includes(t.project_id));
    }
    return tasks.sort(
      (a, b) => b.start_date.localeCompare(a.start_date) // newest first
    );
  }, [allTasks, selectedProjectIds]);

  // Composite key for project lookups: per-user ID spaces mean alex's project
  // 1 and morgan's project 1 are different projects; indexing maps by just
  // p.id silently merges them. Mirrors search/page.tsx.
  const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;
  const taskProjectKey = (t: Pick<Task, "owner" | "project_id">) =>
    `${t.owner}:${t.project_id}`;

  // Project colors, keyed by composite `${owner}:${id}`.
  const projectColors = useMemo(() => {
    const defaultColors = [
      "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
    ];
    const map: Record<string, string> = {};
    projects.forEach((p, i) => {
      map[projectKey(p)] = p.color || defaultColors[i % defaultColors.length];
    });
    return map;
  }, [projects]);

  // Project names, keyed by composite `${owner}:${id}`.
  const projectNames = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p) => {
      map[projectKey(p)] = p.name;
    });
    return map;
  }, [projects]);

  // Check which tasks have results (results.md / notes.md + Files/ + Images/).
  // The popup edits write into `${basePath}/Files/` and `${basePath}/Images/`;
  // legacy ResultsEditor wrote into `${basePath}/Attachments/` and the lazy
  // boundary in TaskDetailPopup folds those into Files/ on first open. Count
  // Attachments/ here too so cards still surface the right badge for tasks
  // whose attachments haven't been touched since the migration.
  const { data: resultCards = [] } = useQuery({
    queryKey: ["resultCards", resultTasks.map((t) => t.id)],
    queryFn: async (): Promise<ResultCard[]> => {
      const cards: ResultCard[] = [];

      const countDir = async (path: string): Promise<number> => {
        try {
          const items = await filesApi.listDirectory(path);
          return items.filter((item) => item.type === "file").length;
        } catch {
          return 0;
        }
      };

      for (const task of resultTasks) {
        const resultDir = (await findExistingTaskResultsBase(task)) ?? taskResultsBase(task);
        let hasNotes = false;
        let attachmentCount = 0;

        try {
          const items = await filesApi.listDirectory(resultDir);
          for (const item of items) {
            if (item.type === "file" && (item.name === "results.md" || item.name === "notes.md")) {
              hasNotes = true;
            }
          }
        } catch {
          // Directory doesn't exist
        }
        attachmentCount += await countDir(`${resultDir}/Files`);
        attachmentCount += await countDir(`${resultDir}/Images`);
        attachmentCount += await countDir(`${resultDir}/Attachments`);

        cards.push({
          task,
          projectName: projectNames[taskProjectKey(task)] || "Unknown",
          projectColor: projectColors[taskProjectKey(task)] || "#6b7280",
          hasNotes,
          attachmentCount,
        });
      }

      return cards;
    },
    enabled: resultTasks.length > 0,
  });

  // Group by project, keyed by composite `${owner}:${id}` so alex's project 1
  // and morgan's project 1 stay in separate buckets. Each bucket carries its
  // own resolved name/color (sourced from the first card's already-composite-
  // keyed lookup), which the group header renders directly.
  const grouped = useMemo(() => {
    const map: Record<string, { name: string; color: string; cards: ResultCard[] }> = {};
    for (const card of resultCards) {
      const key = taskProjectKey(card.task);
      if (!map[key]) {
        map[key] = {
          name: card.projectName,
          color: card.projectColor,
          cards: [],
        };
      }
      map[key].cards.push(card);
    }
    return map;
  }, [resultCards]);

  const handleTaskClick = (task: Task) => {
    setEditingTask(task);
  };

  const handleEditorClose = async () => {
    setEditingTask(null);
    // Refresh the result cards to show updated counts
    await queryClient.refetchQueries({ queryKey: ["resultCards"] });
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Results</h2>

          {/* Project filter */}
          <div className="flex items-center gap-1.5">
            {projects.map((p) => {
              const isSelected =
                selectedProjectIds.length === 0 ||
                selectedProjectIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => useAppStore.getState().toggleProject(p.id)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                    isSelected
                      ? "text-white font-medium"
                      : "bg-gray-100 text-gray-400"
                  }`}
                  style={
                    isSelected
                      ? { backgroundColor: projectColors[projectKey(p)] }
                      : undefined
                  }
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results grouped by project */}
        {Object.entries(grouped).map(([pid, { name, color, cards }]) => (
          <div key={pid} className="mb-8">
            <h3
              className="text-sm font-bold uppercase tracking-widest mb-3 px-1"
              style={{ color }}
            >
              {name}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {cards.map((card) => (
                <div
                  key={card.task.id}
                  onClick={() => handleTaskClick(card.task)}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all cursor-pointer hover:border-gray-300"
                >
                  {/* Header with status */}
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-900 line-clamp-2">
                      {card.task.name}
                    </h4>
                    {card.task.is_complete && (
                      <span className="ml-2 flex-shrink-0 w-2 h-2 bg-emerald-400 rounded-full" />
                    )}
                  </div>
                  
                  {/* Date and duration */}
                  <p className="text-xs text-gray-400 mb-3">
                    {card.task.start_date} · {card.task.duration_days}d
                  </p>
                  
                  {/* Results indicators */}
                  <div className="flex items-center gap-2">
                    {card.hasNotes && (
                      <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                        Notes
                      </span>
                    )}
                    {card.attachmentCount > 0 && (
                      <span className="text-[10px] px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full">
                        {card.attachmentCount} file{card.attachmentCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {card.task.deviation_log && (
                      <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full">
                        Deviations
                      </span>
                    )}
                    {!card.hasNotes && card.attachmentCount === 0 && (
                      <span className="text-[10px] px-2 py-0.5 bg-gray-50 text-gray-400 rounded-full">
                        No results yet
                      </span>
                    )}
                  </div>
                  
                  {/* Tags */}
                  {card.task.tags && card.task.tags.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {card.task.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                        >
                          #{tag}
                        </span>
                      ))}
                      {card.task.tags.length > 3 && (
                        <span className="text-[10px] text-gray-400">
                          +{card.task.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {resultTasks.length === 0 && (
          <div className="text-center py-16">
            <p className="text-lg text-gray-400 mb-2">No results yet</p>
            <p className="text-sm text-gray-300">
              Complete tasks to see them here.
            </p>
          </div>
        )}
      </div>

      {/* Task detail popup, opened straight on the Results tab. This is the
          canonical editor (same component the rest of the app uses), so the
          editor's content, file storage, and lazy migrations all stay in
          lockstep with how a task is edited from /experiments or /gantt. */}
      {editingTask && (
        <TaskDetailPopup
          task={editingTask}
          project={projects.find(
            (p) =>
              p.id === editingTask.project_id && p.owner === editingTask.owner,
          )}
          onClose={handleEditorClose}
          initialTab="results"
        />
      )}
    </AppShell>
  );
}
