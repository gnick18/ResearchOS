"use client";

import { useCallback, useRef, useState } from "react";
import type { Dependency, Project, SnapZone, Task } from "@/lib/types";
import { dependenciesApi } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

interface SidebarTreeProps {
  projects: Project[];
  tasksByProject: Record<number, Task[]>;
  dependencies: Dependency[];
  projectColors: Record<number, string>;
  onTaskClick: (taskId: number) => void;
}

/**
 * Build a tree structure from flat tasks + dependencies.
 * Root tasks = tasks that have no parent dependency within the same project.
 */
function buildTree(
  tasks: Task[],
  deps: Dependency[]
): { roots: Task[]; childrenMap: Map<number, Task[]> } {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const childIds = new Set(deps.map((d) => d.child_id));
  const childrenMap = new Map<number, Task[]>();

  for (const dep of deps) {
    if (!childrenMap.has(dep.parent_id)) {
      childrenMap.set(dep.parent_id, []);
    }
    const child = taskMap.get(dep.child_id);
    if (child) {
      childrenMap.get(dep.parent_id)!.push(child);
    }
  }

  const roots = tasks.filter((t) => !childIds.has(t.id));
  return { roots, childrenMap };
}

function TaskNode({
  task,
  childrenMap,
  depth,
  projectColor,
  onTaskClick,
  onDrop,
}: {
  task: Task;
  childrenMap: Map<number, Task[]>;
  depth: number;
  projectColor: string;
  onTaskClick: (taskId: number) => void;
  onDrop: (draggedId: number, targetId: number, zone: SnapZone) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [snapZone, setSnapZone] = useState<SnapZone | null>(null);
  const children = childrenMap.get(task.id) || [];

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!ref.current) return;

      const rect = ref.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const height = rect.height;
      const ratio = y / height;

      if (ratio < 0.25) {
        setSnapZone("top");
      } else if (ratio > 0.75) {
        setSnapZone("bottom");
      } else {
        setSnapZone("middle");
      }
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setSnapZone(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (draggedId && snapZone && draggedId !== task.id) {
        onDrop(draggedId, task.id, snapZone);
      }
      setSnapZone(null);
    },
    [snapZone, task.id, onDrop]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", String(task.id));
      e.dataTransfer.effectAllowed = "move";
    },
    [task.id]
  );

  // Determine dot color based on status
  const dotColor = task.is_complete
    ? "#10b981" // emerald for completed
    : task.is_high_level
    ? "#f59e0b" // amber for high-level
    : projectColor;

  return (
    <div>
      {/* Snap indicator: top line */}
      {snapZone === "top" && (
        <div className="h-0.5 bg-blue-500 rounded-full mx-2" />
      )}

      <div
        ref={ref}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => onTaskClick(task.id)}
        className={`
          flex items-center gap-2 px-3 py-1.5 mx-1 rounded-md cursor-pointer
          text-sm transition-colors select-none
          hover:bg-gray-100
          ${snapZone === "middle" ? "bg-blue-50 ring-1 ring-blue-300" : ""}
          ${task.is_complete ? "text-gray-400 line-through" : "text-gray-700"}
          ${task.is_high_level ? "font-semibold text-gray-900" : ""}
        `}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        {/* Status dot with project color */}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: dotColor }}
        />
        <span className="truncate">{task.name}</span>
        {task.task_type === "experiment" && (
          <span className="text-xs text-purple-400">🧪</span>
        )}
        <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
          {task.duration_days}d
        </span>
      </div>

      {/* Snap indicator: bottom line */}
      {snapZone === "bottom" && (
        <div className="h-0.5 bg-blue-500 rounded-full mx-2" />
      )}

      {/* Render children */}
      {children.map((child) => (
        <TaskNode
          key={child.id}
          task={child}
          childrenMap={childrenMap}
          depth={depth + 1}
          projectColor={projectColor}
          onTaskClick={onTaskClick}
          onDrop={onDrop}
        />
      ))}
    </div>
  );
}

export default function SidebarTree({
  projects,
  tasksByProject,
  dependencies,
  projectColors,
  onTaskClick,
}: SidebarTreeProps) {
  const queryClient = useQueryClient();

  const handleDrop = useCallback(
    async (draggedId: number, targetId: number, zone: SnapZone) => {
      // Map snap zone to dependency type
      // Top 25%: FS (dragged task BEFORE target)
      // Middle 50%: SS (concurrent)
      // Bottom 25%: FS (dragged task AFTER target)
      let depType: "FS" | "SS" | "SF";
      let parentId: number;
      let childId: number;

      if (zone === "top") {
        // Dragged task finishes, then target starts
        depType = "FS";
        parentId = draggedId;
        childId = targetId;
      } else if (zone === "middle") {
        // Both start together
        depType = "SS";
        parentId = targetId;
        childId = draggedId;
      } else {
        // Target finishes, then dragged task starts
        depType = "FS";
        parentId = targetId;
        childId = draggedId;
      }

      try {
        await dependenciesApi.create({
          parent_id: parentId,
          child_id: childId,
          dep_type: depType,
        });
        // Invalidate queries to refresh
        await queryClient.refetchQueries({ queryKey: ["dependencies"] });
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
      } catch (err: unknown) {
        const error = err as { response?: { data?: { detail?: string } } };
        const msg = error?.response?.data?.detail || "Failed to create dependency";
        alert(msg);
      }
    },
    [queryClient]
  );

  return (
    <aside className="w-72 border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0">
      <div className="p-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Tasks
        </h2>
      </div>

      <div className="py-2">
        {projects.map((project) => {
          const tasks = tasksByProject[project.id] || [];
          const projectDeps = dependencies.filter((d) =>
            tasks.some((t) => t.id === d.parent_id || t.id === d.child_id)
          );
          const { roots, childrenMap } = buildTree(tasks, projectDeps);
          const projectColor = projectColors[project.id] || "#3b82f6";

          return (
            <div key={project.id} className="mb-4">
              <div 
                className="px-4 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2"
                style={{ color: projectColor }}
              >
                <span 
                  className="w-2 h-2 rounded-full" 
                  style={{ backgroundColor: projectColor }} 
                />
                {project.name}
              </div>
              {roots.map((task) => (
                <TaskNode
                  key={task.id}
                  task={task}
                  childrenMap={childrenMap}
                  depth={0}
                  projectColor={projectColor}
                  onTaskClick={onTaskClick}
                  onDrop={handleDrop}
                />
              ))}
              {tasks.length === 0 && (
                <p className="px-4 py-2 text-xs text-gray-300 italic">
                  No tasks yet
                </p>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
