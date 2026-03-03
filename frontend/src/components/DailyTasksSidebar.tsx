"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi, tasksApi, fetchAllTasks } from "@/lib/api";
import TaskDetailPopup from "./TaskDetailPopup";
import TaskQuickPopup from "./TaskQuickPopup";
import type { Task, Project } from "@/lib/types";

/**
 * Always-visible sidebar showing today's tasks.
 * Clicking a task opens a quick popup with checkbox and expand button.
 */
export default function DailyTasksSidebar() {
  // For quick popup
  const [quickPopupTask, setQuickPopupTask] = useState<Task | null>(null);
  const [quickPopupPosition, setQuickPopupPosition] = useState({ x: 0, y: 0 });
  
  // For full detail popup
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.list,
  });

  // Filter to only active (non-archived) projects
  const activeProjects = useMemo(() => 
    projects.filter((p) => !p.is_archived),
    [projects]
  );

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchAllTasks,
  });

  // Filter tasks to only include those from active (non-archived) projects
  const activeTasks = useMemo(() => 
    allTasks.filter((t) => {
      const project = projects.find((p) => p.id === t.project_id);
      return project && !project.is_archived;
    }),
    [allTasks, projects]
  );

  const today = new Date().toISOString().split("T")[0];

  // Categorize tasks
  const { todaysTasks, overdueTasks, futureTasks } = useMemo(() => {
    const todayTasks = activeTasks.filter(
      (t) => t.start_date <= today && t.end_date >= today && !t.is_complete
    );
    const overdue = activeTasks.filter(
      (t) => t.end_date < today && !t.is_complete
    );
    const future = activeTasks.filter(
      (t) => t.start_date > today && !t.is_complete
    );
    return { todaysTasks: todayTasks, overdueTasks: overdue, futureTasks: future };
  }, [activeTasks, today]);

  // Group tasks by project
  const groupByProject = (tasks: Task[]): Record<number, Task[]> => {
    const groups: Record<number, Task[]> = {};
    for (const task of tasks) {
      if (!groups[task.project_id]) {
        groups[task.project_id] = [];
      }
      groups[task.project_id].push(task);
    }
    return groups;
  };

  const todaysTasksByProject = useMemo(() => groupByProject(todaysTasks), [todaysTasks]);
  const futureTasksByProject = useMemo(() => groupByProject(futureTasks), [futureTasks]);

  const selectedProject = selectedTask
    ? projects.find((p) => p.id === selectedTask.project_id)
    : undefined;

  const quickPopupProject = quickPopupTask
    ? projects.find((p) => p.id === quickPopupTask.project_id)
    : undefined;

  // Get project color
  const getProjectColor = (projectId: number): string => {
    const project = projects.find((p) => p.id === projectId);
    return project?.color || "#3b82f6";
  };

  // Handle task click - show quick popup
  const handleTaskClick = useCallback((task: Task, event: React.MouseEvent) => {
    setQuickPopupTask(task);
    setQuickPopupPosition({ x: event.clientX, y: event.clientY });
  }, []);

  // Handle expand from quick popup
  const handleExpandToDetail = useCallback(() => {
    if (quickPopupTask) {
      setSelectedTask(quickPopupTask);
      setQuickPopupTask(null);
    }
  }, [quickPopupTask]);

  return (
    <>
      <aside className="w-64 border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0">
        {/* Overdue tasks - shown first if any exist */}
        {overdueTasks.length > 0 && (
          <>
            <div className="p-4 border-b border-gray-100">
              <h2 className="text-xs font-bold text-red-400 uppercase tracking-widest">
                Overdue ({overdueTasks.length})
              </h2>
            </div>
            <div className="p-3">
              {overdueTasks.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  projectColor={getProjectColor(t.project_id)}
                  overdue
                  onClick={handleTaskClick}
                />
              ))}
            </div>
          </>
        )}

        {/* Today's tasks by project */}
        <div className={overdueTasks.length > 0 ? "px-4 py-2 border-t border-gray-100" : "p-4 border-b border-gray-100"}>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Today
          </h2>
        </div>
        <div className="p-3">
          {todaysTasks.length === 0 ? (
            <p className="text-xs text-gray-300 italic px-1">
              No tasks for today
            </p>
          ) : (
            activeProjects.map((project) => {
              const projectTasks = todaysTasksByProject[project.id] || [];
              if (projectTasks.length === 0) return null;
              return (
                <div key={project.id} className="mb-3">
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getProjectColor(project.id) }}
                    />
                    <span className="text-xs font-medium text-gray-500">
                      {project.name}
                    </span>
                  </div>
                  {projectTasks.map((t) => (
                    <TaskItem
                      key={t.id}
                      task={t}
                      projectColor={getProjectColor(t.project_id)}
                      onClick={handleTaskClick}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* Future tasks by project */}
        {futureTasks.length > 0 && (
          <>
            <div className="px-4 py-2 border-t border-gray-100">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                Upcoming ({futureTasks.length})
              </h3>
            </div>
            <div className="p-3">
              {activeProjects.map((project) => {
                const projectTasks = futureTasksByProject[project.id] || [];
                if (projectTasks.length === 0) return null;
                // Sort by start date
                projectTasks.sort((a, b) => a.start_date.localeCompare(b.start_date));
                // Show max 3 per project
                const displayTasks = projectTasks.slice(0, 3);
                const hasMore = projectTasks.length > 3;
                return (
                  <div key={project.id} className="mb-3">
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: getProjectColor(project.id) }}
                      />
                      <span className="text-xs font-medium text-gray-500">
                        {project.name}
                      </span>
                      {hasMore && (
                        <span className="text-xs text-gray-400">
                          +{projectTasks.length - 3} more
                        </span>
                      )}
                    </div>
                    {displayTasks.map((t) => (
                      <TaskItem
                        key={t.id}
                        task={t}
                        projectColor={getProjectColor(t.project_id)}
                        future
                        onClick={handleTaskClick}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </aside>

      {/* Task Quick Popup */}
      {quickPopupTask && (
        <TaskQuickPopup
          task={quickPopupTask}
          project={quickPopupProject}
          position={quickPopupPosition}
          onClose={() => setQuickPopupTask(null)}
          onExpand={handleExpandToDetail}
        />
      )}

      {/* Task Detail Popup */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          project={selectedProject}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </>
  );
}

function TaskItem({
  task,
  projectColor,
  overdue,
  future,
  onClick,
}: {
  task: Task;
  projectColor: string;
  overdue?: boolean;
  future?: boolean;
  onClick: (task: Task, event: React.MouseEvent) => void;
}) {
  const isExperiment = task.task_type === "experiment";
  
  const handleClick = (e: React.MouseEvent) => {
    onClick(task, e);
  };
  
  return (
    <div
      onClick={handleClick}
      className={`relative px-2 py-1.5 rounded-md text-sm mb-1 cursor-pointer transition-colors ${
        overdue
          ? "text-red-600 bg-red-50 hover:bg-red-100"
          : future
          ? "text-gray-500 bg-gray-50 hover:bg-gray-100"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {/* Accent line for experiments */}
      {isExperiment && (
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-md"
          style={{ backgroundColor: "#8b5cf6" }}
        />
      )}
      <p className="truncate font-medium pl-1">
        {task.name}
      </p>
      <p className="text-xs text-gray-400 pl-1">
        {task.duration_days}d · {task.start_date}
      </p>
    </div>
  );
}
