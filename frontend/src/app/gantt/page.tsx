"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { goalsApi, projectsApi, dependenciesApi, fetchAllTasksIncludingShared, settingsApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import GanttChart from "@/components/GanttChart";
import Toolbar from "@/components/Toolbar";
import BulkMoveModal from "@/components/BulkMoveModal";
import TaskModal from "@/components/TaskModal";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import HighLevelGoalModal from "@/components/HighLevelGoalModal";
import HighLevelGoalSidebar from "@/components/HighLevelGoalSidebar";
import type { Project, HighLevelGoal } from "@/lib/types";

export default function Home() {
  const queryClient = useQueryClient();
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const selectedTags = useAppStore((s) => s.selectedTags);
  const showShared = useAppStore((s) => s.showShared);
  const editingTaskId = useAppStore((s) => s.editingTaskId);
  const setEditingTaskId = useAppStore((s) => s.setEditingTaskId);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const isCreatingGoal = useAppStore((s) => s.isCreatingGoal);
  const setIsCreatingGoal = useAppStore((s) => s.setIsCreatingGoal);
  const editingGoal = useAppStore((s) => s.editingGoal);
  const setEditingGoal = useAppStore((s) => s.setEditingGoal);
  
  // State for delete confirmation
  const [deletingGoal, setDeletingGoal] = useState<HighLevelGoal | null>(null);

  // Get current user
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
  });
  const currentUser = settings?.current_user || "";

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.listWithShared,
  });

  // Load high-level goals
  const { data: goals = [] } = useQuery({
    queryKey: ["goals"],
    queryFn: goalsApi.list,
  });

  // Filter to only active (non-archived) projects for Gantt chart
  const activeProjects = useMemo(() => 
    projects.filter((p) => !p.is_archived),
    [projects]
  );

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchAllTasksIncludingShared,
  });

  // Filter tasks to only include those from active (non-archived) projects
  // and apply the showShared filter
  const activeTasks = useMemo(() => {
    let tasks = allTasks.filter((t) => {
      // Always include tasks shared WITH the current user (regardless of project status)
      // is_shared_with_me is true when the task is shared WITH the current user (not owned by them)
      if (t.is_shared_with_me) return true;
      
      // For own tasks, check if project exists and is not archived
      const project = projects.find((p) => p.id === t.project_id);
      return project && !project.is_archived;
    });
    
    // If showShared is false, filter out tasks that are shared WITH the current user
    // Use the is_shared_with_me flag from the backend which is set correctly
    if (!showShared) {
      tasks = tasks.filter((t) => {
        // Keep tasks that are NOT shared with the current user
        // is_shared_with_me is true when the task is shared WITH the current user
        return !t.is_shared_with_me;
      });
    }
    
    return tasks;
  }, [allTasks, projects, showShared]);

  const { data: dependencies = [] } = useQuery({
    queryKey: ["dependencies"],
    queryFn: () => dependenciesApi.list(),
  });

  // Filter dependencies to only include those between active tasks
  const activeDependencies = useMemo(() => {
    const activeTaskIds = new Set(activeTasks.map((t) => t.id));
    return dependencies.filter(
      (d) => activeTaskIds.has(d.parent_id) && activeTaskIds.has(d.child_id)
    );
  }, [dependencies, activeTasks]);

  const filteredTasks = useMemo(() => {
    let tasks = activeTasks;
    
    // Apply project filter, but always include tasks shared WITH the current user
    // Use the is_shared_with_me flag from the backend
    if (selectedProjectIds.length > 0) {
      tasks = tasks.filter((t) => {
        // Always include tasks shared with the current user (regardless of project)
        if (t.is_shared_with_me) return true;
        // Apply normal project filter for own tasks
        return selectedProjectIds.includes(t.project_id);
      });
    }
    
    if (selectedTags.length > 0) {
      tasks = tasks.filter(
        (t) => t.tags && t.tags.some((tag) => selectedTags.includes(tag))
      );
    }
    return tasks;
  }, [activeTasks, selectedProjectIds, selectedTags]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const p of activeProjects) p.tags?.forEach((t) => tagSet.add(t));
    for (const t of activeTasks) t.tags?.forEach((tag) => tagSet.add(tag));
    return Array.from(tagSet).sort();
  }, [activeProjects, activeTasks]);

  const projectColors = useMemo(() => {
    const defaultColors = [
      "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
      "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
    ];
    const map: Record<number, string> = {};
    activeProjects.forEach((p, i) => {
      map[p.id] = p.color || defaultColors[i % defaultColors.length];
    });
    return map;
  }, [activeProjects]);

  const handleTaskClick = useCallback(
    (taskId: number) => {
      setEditingTaskId(taskId);
    },
    [setEditingTaskId]
  );

  const handleCreateTask = useCallback(
    () => setIsCreatingTask(true),
    [setIsCreatingTask]
  );

  const handleCreateGoal = useCallback(
    () => setIsCreatingGoal(true),
    [setIsCreatingGoal]
  );

  // Delete goal handler with confirmation
  const handleDeleteGoal = useCallback(
    async (goal: HighLevelGoal) => {
      if (!confirm(`Are you sure you want to delete "${goal.name}"? This action cannot be undone.`)) {
        return;
      }
      try {
        await goalsApi.delete(goal.id);
        await queryClient.refetchQueries({ queryKey: ["goals"] });
        setEditingGoal(null);
        setIsCreatingGoal(false);
        setDeletingGoal(null);
      } catch (err) {
        console.error("Failed to delete goal:", err);
        alert("Failed to delete goal");
      }
    },
    [queryClient, setEditingGoal, setIsCreatingGoal]
  );

  // Find the task and project for the detail popup
  const editingTask = editingTaskId
    ? allTasks.find((t) => t.id === editingTaskId)
    : null;
  const editingProject = editingTask
    ? projects.find((p) => p.id === editingTask.project_id)
    : undefined;

  return (
    <AppShell>
      <Toolbar
        projects={activeProjects}
        allTags={allTags}
        onCreateTask={handleCreateTask}
        onCreateGoal={handleCreateGoal}
        projectColors={projectColors}
      />

      <div className="flex flex-1 overflow-hidden">
        <GanttChart
          tasks={filteredTasks}
          dependencies={activeDependencies}
          projectColors={projectColors}
          projects={activeProjects}
          goals={goals}
          onTaskClick={handleTaskClick}
          onGoalClick={(goal) => setEditingGoal(goal)}
        />
        <HighLevelGoalSidebar
          goals={goals}
          onEditGoal={(goal) => setEditingGoal(goal)}
          onDeleteGoal={handleDeleteGoal}
        />
      </div>

      <BulkMoveModal />
      <TaskModal projects={activeProjects} />

      {/* Task Detail Popup when a task is selected */}
      {editingTask && (
        <TaskDetailPopup
          task={editingTask}
          project={editingProject}
          onClose={() => setEditingTaskId(null)}
          readOnly={editingTask.is_shared_with_me === true}
          username={editingTask.is_shared_with_me ? editingTask.owner : undefined}
        />
      )}

      {/* High-Level Goal Modal */}
      {(isCreatingGoal || editingGoal) && (
        <HighLevelGoalModal
          projects={activeProjects}
          onClose={() => {
            setIsCreatingGoal(false);
            setEditingGoal(null);
          }}
          editingGoal={editingGoal}
          onDeleteGoal={handleDeleteGoal}
        />
      )}
    </AppShell>
  );
}
