"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi, githubApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import ResultsEditor from "@/components/ResultsEditor";
import type { Task } from "@/lib/types";

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

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.list,
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const results = await Promise.all(
        projects.map((p) => tasksApi.listByProject(p.id))
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

  // Project colors
  const projectColors = useMemo(() => {
    const defaultColors = [
      "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
    ];
    const map: Record<number, string> = {};
    projects.forEach((p, i) => {
      map[p.id] = p.color || defaultColors[i % defaultColors.length];
    });
    return map;
  }, [projects]);

  // Project names
  const projectNames = useMemo(() => {
    const map: Record<number, string> = {};
    projects.forEach((p) => {
      map[p.id] = p.name;
    });
    return map;
  }, [projects]);

  // Check which tasks have results (notes.md or attachments)
  const { data: resultCards = [] } = useQuery({
    queryKey: ["resultCards", resultTasks.map((t) => t.id)],
    queryFn: async (): Promise<ResultCard[]> => {
      const cards: ResultCard[] = [];
      
      for (const task of resultTasks) {
        const resultDir = `results/task-${task.id}`;
        let hasNotes = false;
        let attachmentCount = 0;
        
        try {
          const items = await githubApi.listDirectory(resultDir);
          for (const item of items) {
            if (item.type === "file") {
              if (item.name === "notes.md") {
                hasNotes = true;
              } else {
                attachmentCount++;
              }
            }
          }
        } catch {
          // Directory doesn't exist
        }
        
        cards.push({
          task,
          projectName: projectNames[task.project_id] || "Unknown",
          projectColor: projectColors[task.project_id] || "#6b7280",
          hasNotes,
          attachmentCount,
        });
      }
      
      return cards;
    },
    enabled: resultTasks.length > 0,
  });

  // Group by project
  const grouped = useMemo(() => {
    const map: Record<number, { name: string; color: string; cards: ResultCard[] }> = {};
    for (const card of resultCards) {
      if (!map[card.task.project_id]) {
        map[card.task.project_id] = {
          name: card.projectName,
          color: card.projectColor,
          cards: [],
        };
      }
      map[card.task.project_id].cards.push(card);
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
                      ? { backgroundColor: projectColors[p.id] }
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

      {/* Results editor modal */}
      {editingTask && (
        <ResultsEditor
          task={editingTask}
          onClose={handleEditorClose}
        />
      )}
    </AppShell>
  );
}
