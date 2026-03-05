"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi, settingsApi, usersApi, setDataPathErrorCallback, fetchAllTasks, type DataPathCheckResponse } from "@/lib/api";
import AppShell from "@/components/AppShell";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import ProjectDetailPopup from "@/components/ProjectDetailPopup";
import DataSetupScreen from "@/components/DataSetupScreen";
import DesktopLauncherPopup from "@/components/DesktopLauncherPopup";
import ResearchFolderSetup from "@/components/ResearchFolderSetup";
import UserLoginScreen from "@/components/UserLoginScreen";
import type { Project, Task } from "@/lib/types";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

// Helper to make a color dull/muted for archived projects
function getMutedColor(color: string): string {
  // Convert hex to RGB, reduce saturation, add gray
  const hex = color.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Mix with gray and reduce intensity
  const mutedR = Math.round(r * 0.5 + 128 * 0.5);
  const mutedG = Math.round(g * 0.5 + 128 * 0.5);
  const mutedB = Math.round(b * 0.5 + 128 * 0.5);
  
  return `rgb(${mutedR}, ${mutedG}, ${mutedB})`;
}

export default function HomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWeekendActive, setNewWeekendActive] = useState(false);
  const [newTags, setNewTags] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLORS[0]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showMacAppLauncher, setShowMacAppLauncher] = useState(false);
  const [showUserSwitch, setShowUserSwitch] = useState(false);
  const [currentUser, setCurrentUser] = useState<string>("");
  const [checkingUser, setCheckingUser] = useState(true);
  
  // Data path check state
  const [dataPathError, setDataPathError] = useState<DataPathCheckResponse | null>(null);
  const [checkingPath, setCheckingPath] = useState(true);
  
  // Drag and drop state
  const [draggedProjectId, setDraggedProjectId] = useState<number | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<number | null>(null);

  // Check data path on mount
  useEffect(() => {
    const checkDataPath = async () => {
      try {
        const result = await settingsApi.checkDataPath();
        if (result.status === "error") {
          setDataPathError(result);
        } else {
          setDataPathError(null);
        }
      } catch {
        // If the check fails, show a generic error
        setDataPathError({
          status: "error",
          error_type: "not_configured",
          message: "Unable to verify data path configuration. Please check your settings.",
        });
      } finally {
        setCheckingPath(false);
      }
    };
    checkDataPath();
  }, []);

  // Fetch current user on mount
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const result = await usersApi.validate();
        if (result.valid) {
          setCurrentUser(result.current_user);
          // Redirect to lab page if user is "lab"
          if (result.current_user.toLowerCase() === "lab") {
            router.push("/lab");
            return; // Don't set checkingUser to false, let the redirect happen
          }
        } else {
          // No valid user - clear current user
          setCurrentUser("");
        }
      } catch {
        // Ignore errors - user will need to login
        setCurrentUser("");
      } finally {
        setCheckingUser(false);
      }
    };
    fetchCurrentUser();
  }, [router]);

  // Register callback for data path errors from API calls
  useEffect(() => {
    setDataPathErrorCallback((error) => {
      setDataPathError(error);
    });
  }, []);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.list,
  });

  // Separate active and archived projects
  const { activeProjects, archivedProjects } = useMemo(() => {
    const active = projects.filter((p) => !p.is_archived);
    const archived = projects.filter((p) => p.is_archived);
    return { activeProjects: active, archivedProjects: archived };
  }, [projects]);

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchAllTasks,
  });

  const today = new Date().toISOString().split("T")[0];

  // Compute summaries per project
  const projectSummaries = useMemo(() => {
    return projects.map((p, i) => {
      const tasks = allTasks.filter((t) => t.project_id === p.id);
      const total = tasks.length;
      const completed = tasks.filter((t) => t.is_complete).length;
      const upcoming = tasks
        .filter((t) => !t.is_complete && t.start_date >= today)
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .slice(0, 5);
      const overdue = tasks.filter(
        (t) => !t.is_complete && t.end_date < today
      );
      const inProgress = tasks.filter(
        (t) => !t.is_complete && t.start_date <= today && t.end_date >= today
      );
      const color = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      const displayColor = p.is_archived ? getMutedColor(color) : color;

      return { project: p, total, completed, upcoming, overdue, inProgress, color, displayColor };
    });
  }, [projects, allTasks, today]);

  // Get summaries for active and archived projects
  const activeSummaries = useMemo(() => 
    projectSummaries.filter((s) => !s.project.is_archived),
    [projectSummaries]
  );
  
  const archivedSummaries = useMemo(() => 
    projectSummaries.filter((s) => s.project.is_archived),
    [projectSummaries]
  );

  const handleCreateProject = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await projectsApi.create({
        name: newName.trim(),
        weekend_active: newWeekendActive,
        tags: newTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        color: newColor,
      });
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      setCreating(false);
      setNewName("");
      setNewTags("");
      setNewWeekendActive(false);
    } catch {
      alert("Failed to create project");
    }
  }, [newName, newWeekendActive, newTags, newColor, queryClient]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, projectId: number) => {
    setDraggedProjectId(projectId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", projectId.toString());
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, projectId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverProjectId(projectId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverProjectId(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetProjectId: number) => {
    e.preventDefault();
    setDragOverProjectId(null);
    
    if (!draggedProjectId || draggedProjectId === targetProjectId) {
      setDraggedProjectId(null);
      return;
    }

    // Find the indices and reorder
    const currentIds = activeSummaries.map((s) => s.project.id);
    const draggedIdx = currentIds.indexOf(draggedProjectId);
    const targetIdx = currentIds.indexOf(targetProjectId);
    
    if (draggedIdx === -1 || targetIdx === -1) {
      setDraggedProjectId(null);
      return;
    }

    // Reorder the array
    const newOrder = [...currentIds];
    newOrder.splice(draggedIdx, 1);
    newOrder.splice(targetIdx, 0, draggedProjectId);

    try {
      await projectsApi.reorder(newOrder);
      await queryClient.refetchQueries({ queryKey: ["projects"] });
    } catch {
      alert("Failed to reorder projects");
    }

    setDraggedProjectId(null);
  }, [draggedProjectId, activeSummaries, queryClient]);

  const handleDragEnd = useCallback(() => {
    setDraggedProjectId(null);
    setDragOverProjectId(null);
  }, []);

  // Format archived date
  const formatArchivedDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { 
      year: "numeric", 
      month: "short", 
      day: "numeric" 
    });
  };

  // Show folder setup if path is invalid
  if (!checkingPath && dataPathError) {
    return (
      <ResearchFolderSetup
        errorData={dataPathError}
        onComplete={() => {
          setDataPathError(null);
          window.location.reload();
        }}
      />
    );
  }

  // Show login screen if no current user
  if (!checkingUser && !currentUser) {
    return (
      <UserLoginScreen
        onLogin={() => {
          queryClient.invalidateQueries();
          // Refresh current user and redirect if lab
          usersApi.validate().then((result) => {
            if (result.valid) {
              setCurrentUser(result.current_user);
              // Redirect to lab page if user is "lab"
              if (result.current_user.toLowerCase() === "lab") {
                router.push("/lab");
              }
            }
          });
        }}
      />
    );
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              Research Project Overview
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {activeProjects.length} active project{activeProjects.length !== 1 ? "s" : ""} ·{" "}
              {allTasks.filter((t) => !t.is_complete).length} active tasks
              {archivedProjects.length > 0 && (
                <span className="text-gray-300"> · {archivedProjects.length} archived</span>
              )}
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            + New Project
          </button>
        </div>

        {/* Create project form */}
        {creating && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8 max-w-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              New Research Project
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. CRISPR Gene Editing Study"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="e.g. sequencing, LC-MS, cell-culture"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Project Color
                </label>
                <div className="flex gap-2">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${
                        newColor === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newWeekendActive}
                  onChange={(e) => setNewWeekendActive(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-600">
                  7-day schedule (weekends active)
                </span>
              </label>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setCreating(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProject}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  Create Project
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active Project cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {activeSummaries.map(
            ({ project, total, completed, upcoming, overdue, inProgress, color, displayColor }) => (
              <div
                key={project.id}
                draggable
                onDragStart={(e) => handleDragStart(e, project.id)}
                onDragOver={(e) => handleDragOver(e, project.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, project.id)}
                onDragEnd={handleDragEnd}
                onClick={() => setSelectedProject(project)}
                className={`bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer ${
                  draggedProjectId === project.id ? "opacity-50 scale-95" : ""
                } ${dragOverProjectId === project.id ? "ring-2 ring-blue-400 ring-offset-2" : ""}`}
              >
                {/* Color bar */}
                <div className="h-1.5" style={{ backgroundColor: displayColor }} />

                <div className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-gray-900">
                      {project.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      {project.weekend_active && (
                        <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                          7-day
                        </span>
                      )}
                      <span className="text-gray-300 cursor-grab" title="Drag to reorder">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
                        </svg>
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mb-4">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>
                        {completed}/{total} tasks
                      </span>
                      <span>
                        {total > 0
                          ? Math.round((completed / total) * 100)
                          : 0}
                        %
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${total > 0 ? (completed / total) * 100 : 0}%`,
                          backgroundColor: displayColor,
                        }}
                      />
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex gap-4 mb-4 text-xs">
                    <div>
                      <span className="text-gray-400">Active</span>
                      <p className="font-semibold text-gray-700">
                        {inProgress.length}
                      </p>
                    </div>
                    <div>
                      <span className={overdue.length > 0 ? "text-red-400" : "text-gray-400"}>Overdue</span>
                      <p className={`font-semibold ${overdue.length > 0 ? "text-red-600" : "text-gray-700"}`}>
                        {overdue.length}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400">Upcoming</span>
                      <p className="font-semibold text-gray-700">
                        {upcoming.length}
                      </p>
                    </div>
                  </div>

                  {/* Upcoming tasks */}
                  {upcoming.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                        Next Up
                      </p>
                      <div className="space-y-1">
                        {upcoming.map((t) => (
                          <div
                            key={t.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTask(t);
                            }}
                            className="flex items-center justify-between text-xs cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 py-0.5"
                          >
                            <span className="text-gray-600 truncate mr-2 flex items-center gap-1.5">
                              {t.task_type === "experiment" && (
                                <span className="w-1 h-3 rounded-full bg-purple-400 flex-shrink-0" />
                              )}
                              {t.name}
                            </span>
                            <span className="text-gray-400 flex-shrink-0">
                              {t.start_date}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {project.tags && project.tags.length > 0 && (
                    <div className="flex gap-1 mt-3 flex-wrap">
                      {project.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        {/* Archived Projects Section */}
        {archivedSummaries.length > 0 && (
          <div className="mt-12">
            <h3 className="text-lg font-semibold text-gray-500 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Archived Projects
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {archivedSummaries.map(
                ({ project, total, completed, color, displayColor }) => (
                  <div
                    key={project.id}
                    onClick={() => setSelectedProject(project)}
                    className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer opacity-75 hover:opacity-100"
                  >
                    {/* Color bar - muted */}
                    <div className="h-1.5" style={{ backgroundColor: displayColor }} />

                    <div className="p-5">
                      {/* Archived date badge */}
                      <div className="mb-2">
                        <span className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-500 rounded-full">
                          Archived {formatArchivedDate(project.archived_at)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-base font-semibold text-gray-600">
                          {project.name}
                        </h3>
                        {project.weekend_active && (
                          <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-400 rounded-full">
                            7-day
                          </span>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="mb-4">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>
                            {completed}/{total} tasks
                          </span>
                          <span>
                            {total > 0
                              ? Math.round((completed / total) * 100)
                              : 0}
                            %
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${total > 0 ? (completed / total) * 100 : 0}%`,
                              backgroundColor: displayColor,
                            }}
                          />
                        </div>
                      </div>

                      {/* Tags */}
                      {project.tags && project.tags.length > 0 && (
                        <div className="flex gap-1 mt-3 flex-wrap">
                          {project.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-400 rounded"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {projects.length === 0 && !creating && (
          <div className="text-center py-16">
            <p className="text-lg text-gray-400 mb-2">No projects yet</p>
            <p className="text-sm text-gray-300 mb-6">
              Create your first research project to get started
            </p>
            <button
              onClick={() => setCreating(true)}
              className="px-6 py-3 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Project
            </button>
          </div>
        )}
      </div>

      {/* Project Detail Popup */}
      {selectedProject && (
        <ProjectDetailPopup
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
        />
      )}

      {/* Task Detail Popup */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          project={projects.find((p) => p.id === selectedTask.project_id)}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Settings Button - Bottom Right */}
      <button
        onClick={() => setShowSettings(true)}
        className="fixed bottom-6 right-6 w-12 h-12 bg-white border border-gray-200 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-gray-600 hover:text-gray-900 z-50"
        title="Environment Settings"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Create Desktop Launcher Button - Bottom Right (left of settings) */}
      <button
        onClick={() => setShowMacAppLauncher(true)}
        className="fixed bottom-6 right-20 w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-white z-50"
        title="Create Desktop Launcher"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </button>

      {/* User Switch Button - Bottom Right (left of desktop launcher) */}
      <button
        onClick={() => setShowUserSwitch(true)}
        className="fixed bottom-6 w-12 h-12 bg-white border border-gray-200 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-gray-600 hover:text-gray-900 z-50"
        style={{ right: '136px' }}
        title={`Switch User (currently: ${currentUser || 'Unknown'})`}
      >
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xs font-semibold">
          {currentUser ? currentUser.charAt(0).toUpperCase() : "?"}
        </div>
      </button>

      {/* Data Setup Screen */}
      <DataSetupScreen
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Desktop Launcher Popup */}
      <DesktopLauncherPopup
        isOpen={showMacAppLauncher}
        onClose={() => setShowMacAppLauncher(false)}
      />

      {/* User Switch Screen */}
      {showUserSwitch && (
        <UserLoginScreen
          onLogin={() => {
            setShowUserSwitch(false);
            queryClient.invalidateQueries();
            // Refresh current user and redirect if lab
            usersApi.validate().then((result) => {
              if (result.valid) {
                setCurrentUser(result.current_user);
                // Redirect to lab page if user is "lab"
                if (result.current_user.toLowerCase() === "lab") {
                  router.push("/lab");
                }
              }
            });
          }}
        />
      )}

      {/* Loading overlay while checking path or user */}
      {(checkingPath || checkingUser) && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className="text-sm text-gray-500">
              {checkingPath ? "Checking data path..." : "Checking user..."}
            </p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
