"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { goalsApi, dependenciesApi, fetchAllTasksIncludingShared, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import GanttChart from "@/components/GanttChart";
import Toolbar from "@/components/Toolbar";
import BulkMoveModal from "@/components/BulkMoveModal";
import TaskModal from "@/components/TaskModal";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import HighLevelGoalModal from "@/components/HighLevelGoalModal";
import HighLevelGoalSidebar from "@/components/HighLevelGoalSidebar";
import { taskKey } from "@/lib/types";
import type { Project, HighLevelGoal } from "@/lib/types";

export default function Home() {
  const queryClient = useQueryClient();
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const selectedTags = useAppStore((s) => s.selectedTags);
  const showShared = useAppStore((s) => s.showShared);
  const editingTaskKey = useAppStore((s) => s.editingTaskKey);
  const setEditingTaskKey = useAppStore((s) => s.setEditingTaskKey);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const isCreatingGoal = useAppStore((s) => s.isCreatingGoal);
  const setIsCreatingGoal = useAppStore((s) => s.setIsCreatingGoal);
  const editingGoal = useAppStore((s) => s.editingGoal);
  const setEditingGoal = useAppStore((s) => s.setEditingGoal);
  
  // State for delete confirmation
  const [deletingGoal, setDeletingGoal] = useState<HighLevelGoal | null>(null);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["goals", currentUser],
    queryFn: goalsApi.list,
  });

  const activeProjects = useMemo(() => 
    projects.filter((p) => !p.is_archived),
    [projects]
  );

  // Use a distinct query key from the rest of the app: other pages cache the
  // current user's own tasks under ["tasks", currentUser] via `fetchAllTasks`.
  // Without a distinct key, React Query would hand the Gantt a stale 15-task
  // result when the user navigates back from one of those pages. The key still
  // begins with "tasks" so existing `invalidateQueries({ queryKey: ["tasks"] })`
  // calls elsewhere will continue to invalidate it via prefix match.
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", "with-shared", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });

  useEffect(() => {
    console.log("[Gantt] Data loaded:", {
      currentUser,
      projectsCount: projects.length,
      tasksCount: allTasks.length,
      activeProjectsCount: activeProjects.length,
      sampleTask: allTasks[0] ? { id: allTasks[0].id, name: allTasks[0].name, project_id: allTasks[0].project_id } : null,
      sampleProject: projects[0] ? { id: projects[0].id, name: projects[0].name } : null,
    });
  }, [projects, allTasks, activeProjects, currentUser]);

  const activeTasks = useMemo(() => {
    if (projects.length === 0) {
      console.log("[Gantt] Projects not loaded yet, returning all tasks:", allTasks.length);
      return allTasks;
    }
    
    console.log("[Gantt.activeTasks] Projects loaded:", projects.length, "project IDs:", projects.map(p => p.id));
    console.log("[Gantt.activeTasks] All tasks:", allTasks.length, "task project IDs:", allTasks.map(t => t.project_id));
    
    let tasks = allTasks.filter((t) => {
      if (t.is_shared_with_me) {
        console.log("[Gantt.activeTasks] Task", t.id, "is shared with me, keeping");
        return true;
      }
      const project = projects.find((p) => p.id === t.project_id);
      const result = project && !project.is_archived;
      if (!project) {
        console.log("[Gantt.activeTasks] Task", t.id, "project", t.project_id, "not found in projects array");
      } else if (project.is_archived) {
        console.log("[Gantt.activeTasks] Task", t.id, "project", project.name, "is archived");
      }
      return result;
    });
    
    if (!showShared) {
      tasks = tasks.filter((t) => {
        return !t.is_shared_with_me;
      });
    }

    console.log("[Gantt] Active tasks filtered:", {
      allTasksCount: allTasks.length,
      projectsCount: projects.length,
      activeTasksCount: tasks.length,
    });
    
    return tasks;
  }, [allTasks, projects, showShared]);

  const { data: dependencies = [] } = useQuery({
    queryKey: ["dependencies", currentUser],
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
    console.log("[Gantt.filteredTasks] Computing from activeTasks:", activeTasks.length);
    let tasks = activeTasks;
    
    if (selectedProjectIds.length > 0) {
      tasks = tasks.filter((t) => {
        if (t.is_shared_with_me) return true;
        return selectedProjectIds.includes(t.project_id);
      });
      console.log("[Gantt.filteredTasks] After project filter:", tasks.length);
    }
    
    if (selectedTags.length > 0) {
      tasks = tasks.filter(
        (t) => t.tags && t.tags.some((tag) => selectedTags.includes(tag))
      );
      console.log("[Gantt.filteredTasks] After tag filter:", tasks.length);
    }
    
    console.log("[Gantt.filteredTasks] Final count:", tasks.length, "Sample:", tasks[0] ? { id: tasks[0].id, name: tasks[0].name, start: tasks[0].start_date } : null);
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
    (key: string) => {
      setEditingTaskKey(key);
    },
    [setEditingTaskKey]
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
  const editingTask = editingTaskKey
    ? allTasks.find((t) => taskKey(t) === editingTaskKey)
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
          onClose={() => setEditingTaskKey(null)}
          readOnly={editingTask.is_shared_with_me === true && editingTask.shared_permission !== "edit"}
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
