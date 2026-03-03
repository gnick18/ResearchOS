"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi } from "@/lib/api";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import TaskQuickPopup from "@/components/TaskQuickPopup";
import type { Project, Task, ProjectCreate } from "@/lib/types";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

interface ProjectDetailPopupProps {
  project: Project;
  onClose: () => void;
}

export default function ProjectDetailPopup({ project, onClose }: ProjectDetailPopupProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [tags, setTags] = useState(project.tags?.join(", ") || "");
  const [color, setColor] = useState(project.color || DEFAULT_COLORS[0]);
  const [weekendActive, setWeekendActive] = useState(project.weekend_active);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  
  // For quick popup
  const [quickPopupTask, setQuickPopupTask] = useState<Task | null>(null);
  const [quickPopupPosition, setQuickPopupPosition] = useState({ x: 0, y: 0 });
  
  // For full detail popup
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Check if this is the Miscellaneous project (protected)
  const isMiscellaneousProject = project.name === "Miscellaneous";

  // Fetch tasks for this project
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", project.id],
    queryFn: () => tasksApi.listByProject(project.id),
  });

  const today = new Date().toISOString().split("T")[0];

  // Filter future tasks (not completed, start date >= today or in progress)
  const futureTasks = useMemo(() => {
    return tasks
      .filter((t) => !t.is_complete && (t.start_date >= today || (t.start_date <= today && t.end_date >= today)))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [tasks, today]);

  // Group tasks by status
  const tasksByStatus = useMemo(() => {
    const inProgress = futureTasks.filter((t) => t.start_date <= today && t.end_date >= today);
    const upcoming = futureTasks.filter((t) => t.start_date > today);
    const overdue = tasks.filter((t) => !t.is_complete && t.end_date < today);
    return { inProgress, upcoming, overdue };
  }, [futureTasks, tasks, today]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await projectsApi.update(project.id, {
        name: name.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        color,
        weekend_active: weekendActive,
      });
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      setIsEditing(false);
    } catch {
      alert("Failed to save project");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await projectsApi.delete(project.id);
      // Close popup immediately after successful deletion
      onClose();
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to delete project");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await projectsApi.archive(project.id, true);
      // Close popup immediately after successful archive
      onClose();
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to archive project");
    } finally {
      setArchiving(false);
      setShowArchiveConfirm(false);
    }
  };

  const handleUnarchive = async () => {
    setArchiving(true);
    try {
      await projectsApi.archive(project.id, false);
      // Close popup immediately after successful unarchive
      onClose();
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to unarchive project");
    } finally {
      setArchiving(false);
    }
  };

  const projectColor = project.color || DEFAULT_COLORS[0];

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (dateStr === today) return "Today";
    if (dateStr === tomorrow.toISOString().split("T")[0]) return "Tomorrow";
    
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Format archived date
  const formatArchivedDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { 
      year: "numeric", 
      month: "long", 
      day: "numeric" 
    });
  };

  // Handle task click - show quick popup
  const handleTaskClick = useCallback((task: Task, event: React.MouseEvent) => {
    setQuickPopupTask(task);
    setQuickPopupPosition({ x: event.clientX, y: event.clientY });
  }, []);

  // Handle expand from quick popup to full detail
  const handleExpandToDetail = useCallback(() => {
    if (quickPopupTask) {
      setSelectedTask(quickPopupTask);
      setQuickPopupTask(null);
    }
  }, [quickPopupTask]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-2 flex-shrink-0" style={{ backgroundColor: isEditing ? color : projectColor }} />
        
        <div className="p-6 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            {isEditing ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-xl font-bold text-gray-900 border-b-2 border-gray-200 focus:border-blue-500 focus:outline-none pb-1 flex-1 mr-4"
                autoFocus
              />
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900">{project.name}</h2>
                {project.is_archived && (
                  <span className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-500 rounded-full">
                    Archived
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              {!isEditing && !project.is_archived && !isMiscellaneousProject && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Edit project"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Archived date notice */}
          {project.is_archived && project.archived_at && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">
                <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                Archived on {formatArchivedDate(project.archived_at)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                This project is archived. Tasks won't appear in Gantt chart or task sidebar.
              </p>
            </div>
          )}

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Project Color
                </label>
                <div className="flex gap-2 flex-wrap">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${
                        color === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={weekendActive}
                  onChange={(e) => setWeekendActive(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-600">
                  7-day schedule (weekends active)
                </span>
              </label>

              <div className="flex justify-between pt-4 border-t border-gray-100">
                {/* Hide delete button for Miscellaneous project */}
                {!isMiscellaneousProject && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleting}
                    className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Delete Project
                  </button>
                )}
                {isMiscellaneousProject && <div />}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setName(project.name);
                      setTags(project.tags?.join(", ") || "");
                      setColor(project.color || DEFAULT_COLORS[0]);
                      setWeekendActive(project.weekend_active);
                    }}
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !name.trim()}
                    className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Tags */}
              {project.tags && project.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mb-4">
                  {project.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Stats */}
              <div className="flex gap-6 mb-4 text-sm">
                <div>
                  <span className="text-gray-400">Total Tasks</span>
                  <p className="font-semibold text-gray-700">{tasks.length}</p>
                </div>
                <div>
                  <span className="text-gray-400">Completed</span>
                  <p className="font-semibold text-gray-700">{tasks.filter((t) => t.is_complete).length}</p>
                </div>
                {tasksByStatus.overdue.length > 0 && (
                  <div>
                    <span className="text-red-400">Overdue</span>
                    <p className="font-semibold text-red-600">{tasksByStatus.overdue.length}</p>
                  </div>
                )}
              </div>

              {/* Archive/Unarchive buttons - hide for Miscellaneous project */}
              {!isMiscellaneousProject && (
                <div className="flex gap-3 pt-4 border-t border-gray-100">
                  {project.is_archived ? (
                    <button
                      onClick={handleUnarchive}
                      disabled={archiving}
                      className="px-4 py-2 text-sm text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {archiving ? "Unarchiving..." : "Unarchive Project"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowArchiveConfirm(true)}
                      disabled={archiving}
                      className="px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                      Archive Project
                    </button>
                  )}
                </div>
              )}
              {/* Show info message for Miscellaneous project */}
              {isMiscellaneousProject && (
                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-400 italic">
                    The Miscellaneous project is a permanent category for standalone tasks that don't belong to a specific research project.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Task list - only show when not editing */}
        {!isEditing && !project.is_archived && (
          <div className="flex-1 overflow-y-auto border-t border-gray-100">
            {/* In Progress */}
            {tasksByStatus.inProgress.length > 0 && (
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">
                  In Progress ({tasksByStatus.inProgress.length})
                </h3>
                <div className="space-y-1.5">
                  {tasksByStatus.inProgress.map((t) => (
                    <div
                      key={t.id}
                      onClick={(e) => handleTaskClick(t, e)}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {t.task_type === "experiment" && (
                          <div className="w-1 h-4 rounded-full bg-purple-400 flex-shrink-0" />
                        )}
                        <span className="text-sm text-gray-700 truncate">{t.name}</span>
                      </div>
                      <span className="text-xs text-gray-400 group-hover:text-gray-600">
                        {formatDate(t.end_date)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Overdue */}
            {tasksByStatus.overdue.length > 0 && (
              <div className="p-4 border-b border-gray-100 bg-red-50/50">
                <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2">
                  Overdue ({tasksByStatus.overdue.length})
                </h3>
                <div className="space-y-1.5">
                  {tasksByStatus.overdue.map((t) => (
                    <div
                      key={t.id}
                      onClick={(e) => handleTaskClick(t, e)}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-red-100 cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {t.task_type === "experiment" && (
                          <div className="w-1 h-4 rounded-full bg-purple-400 flex-shrink-0" />
                        )}
                        <span className="text-sm text-gray-700 truncate">{t.name}</span>
                      </div>
                      <span className="text-xs text-red-500 group-hover:text-red-600">
                        Due {formatDate(t.end_date)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming */}
            {tasksByStatus.upcoming.length > 0 && (
              <div className="p-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Upcoming ({tasksByStatus.upcoming.length})
                </h3>
                <div className="space-y-1.5">
                  {tasksByStatus.upcoming.map((t) => (
                    <div
                      key={t.id}
                      onClick={(e) => handleTaskClick(t, e)}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {t.task_type === "experiment" && (
                          <div className="w-1 h-4 rounded-full bg-purple-400 flex-shrink-0" />
                        )}
                        <span className="text-sm text-gray-700 truncate">{t.name}</span>
                      </div>
                      <span className="text-xs text-gray-400 group-hover:text-gray-600">
                        {formatDate(t.start_date)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No tasks message */}
            {futureTasks.length === 0 && tasksByStatus.overdue.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-gray-400 text-sm">No active tasks in this project</p>
              </div>
            )}
          </div>
        )}

        {/* Archived project task summary */}
        {!isEditing && project.is_archived && (
          <div className="flex-1 overflow-y-auto border-t border-gray-100 p-4">
            <div className="text-sm text-gray-500">
              <p className="mb-2">This project has {tasks.length} task{tasks.length !== 1 ? "s" : ""}.</p>
              <p className="text-xs text-gray-400">
                Unarchive this project to view and manage tasks.
              </p>
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setShowDeleteConfirm(false)}>
            <div
              className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Project?</h3>
              <p className="text-sm text-gray-600 mb-6">
                Are you sure you want to delete "{project.name}"? This will also delete all tasks associated with this project. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Archive Confirmation Dialog */}
        {showArchiveConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setShowArchiveConfirm(false)}>
            <div
              className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-900 mb-2">Archive Project?</h3>
              <p className="text-sm text-gray-600 mb-4">
                Are you sure you want to archive "{project.name}"?
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-amber-700">
                  <strong>This will:</strong>
                </p>
                <ul className="text-xs text-amber-600 mt-1 list-disc list-inside">
                  <li>Hide the project from the main project list</li>
                  <li>Remove tasks from Gantt chart and task sidebar</li>
                  <li>Prevent adding new tasks to this project</li>
                </ul>
                <p className="text-xs text-amber-700 mt-2">
                  <strong>All data will be preserved</strong> and you can unarchive at any time.
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowArchiveConfirm(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleArchive}
                  disabled={archiving}
                  className="px-4 py-2 text-sm text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
                >
                  {archiving ? "Archiving..." : "Archive Project"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Task Quick Popup */}
        {quickPopupTask && (
          <TaskQuickPopup
            task={quickPopupTask}
            project={project}
            position={quickPopupPosition}
            onClose={() => setQuickPopupTask(null)}
            onExpand={handleExpandToDetail}
          />
        )}

        {/* Task Detail Popup */}
        {selectedTask && (
          <TaskDetailPopup
            task={selectedTask}
            project={project}
            onClose={() => setSelectedTask(null)}
          />
        )}
      </div>
    </div>
  );
}
