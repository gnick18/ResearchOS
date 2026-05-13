"use client";

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { filesApi, methodsApi, projectsApi, tasksApi as rawTasksApi, dependenciesApi, fetchAllTasks, type DuplicateCheckResult } from "@/lib/local-api";
import type { TaskUpdate, TaskMoveRequest } from "@/lib/local-api";

/**
 * When the current viewer is a receiver of a shared task with edit
 * permission, every mutation needs to write back to the OWNER's directory
 * (e.g. `users/Kritika/tasks/1.json`), not the current user's. Plain own
 * tasks (or read-only views) pass undefined and the writes go to the
 * current user's directory.
 */
function effectiveOwnerOf(task: Task): string | undefined {
  return task.is_shared_with_me && task.shared_permission === "edit" ? task.owner : undefined;
}

/**
 * Build a shadowed `tasksApi` that automatically threads the right owner
 * into every mutating call. Used at the top of each component that calls
 * `tasksApi` so the existing call sites don't need to be touched.
 */
function ownerScopedTasksApi(task: Task) {
  const owner = effectiveOwnerOf(task);
  return {
    ...rawTasksApi,
    get: (id: number) => rawTasksApi.get(id, owner),
    update: (id: number, data: TaskUpdate) => rawTasksApi.update(id, data, owner),
    move: (id: number, data: TaskMoveRequest) => rawTasksApi.move(id, data, owner),
    convertType: (id: number, type: "experiment" | "purchase" | "list") =>
      rawTasksApi.convertType(id, type, owner),
    resetPcr: (id: number, methodId?: number) => rawTasksApi.resetPcr(id, methodId, owner),
    addMethod: (taskId: number, methodId: number) => rawTasksApi.addMethod(taskId, methodId, owner),
    removeMethod: (taskId: number, methodId: number) =>
      rawTasksApi.removeMethod(taskId, methodId, owner),
    updateMethodPcr: (
      taskId: number,
      methodId: number,
      data: { pcr_gradient?: string; pcr_ingredients?: string }
    ) => rawTasksApi.updateMethodPcr(taskId, methodId, data, owner),
    saveVariationNote: (taskId: number, methodId: number, notes: string) =>
      rawTasksApi.saveVariationNote(taskId, methodId, notes, owner),
    // `delete` intentionally not owner-routed: only the original owner
    // should be able to destroy the file.
  };
}
import { useQuery, useQueryClient } from "@tanstack/react-query";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import PurchaseEditor from "./PurchaseEditor";
import DynamicAnimation from "./DynamicAnimation";
import MethodTabs from "./MethodTabs";
import TaskPicker from "./TaskPicker";
import SharePopup from "./SharePopup";
import Tooltip from "./Tooltip";
import { useAppStore } from "@/lib/store";
import { taskKey } from "@/lib/types";
import type { Method, Task, Project, ShiftResult, SubTask } from "@/lib/types";
import type { GitHubTreeItem } from "@/lib/types";
import { createNewFileContent, normalizeStampFormat, hasLegacyStampFormat } from "@/lib/stamp-utils";
import {
  exportSingleExperiment,
  type ExportOptions,
  type ExperimentExportData,
} from "@/lib/export-utils";
import { useFileRenamePopup } from "@/components/FileRenamePopup";
import { fileService } from "@/lib/file-system/file-service";
import { migrateNoteImages } from "@/lib/notes/migrate-images";
import { findExistingTaskResultsBase, resolveTaskResultsBase, taskResultsBase } from "@/lib/tasks/results-paths";
import { migrateTaskAttachmentsToFiles } from "@/lib/tasks/migrate-attachments";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { fileEvents } from "@/lib/attachments/file-events";
import { gcUnreferencedAttachments } from "@/lib/attachments/gc";
import { imageEvents } from "@/lib/attachments/image-events";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface TaskDetailPopupProps {
  task: Task;
  project?: Project;
  onClose: () => void;
  onNavigateToTask?: (task: Task) => void;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
  username?: string; // When provided, fetch user-specific data (for lab mode)
  /** Tab to land on when the popup opens. Falls back to "purchases" for
   *  purchase tasks and "details" otherwise. Used by the /results route to
   *  open straight into the Results tab. */
  initialTab?: Tab;
}

type Tab = "details" | "notes" | "method" | "results" | "purchases";

export default function TaskDetailPopup({
  task: initialTask,
  project,
  onClose,
  onNavigateToTask,
  readOnly = false,
  username,
  initialTab,
}: TaskDetailPopupProps) {
  const queryClient = useQueryClient();
  const isExperiment = initialTask.task_type === "experiment";
  const isPurchase = initialTask.task_type === "purchase";
  const isSimpleTask = initialTask.task_type === "list";
  const [activeTab, setActiveTab] = useState<Tab>(
    initialTab ?? (isPurchase ? "purchases" : "details")
  );
  const [task, setTask] = useState(initialTask);
  const [isExpanded, setIsExpanded] = useState(false);
  const [animationPosition, setAnimationPosition] = useState<{ x: number; y: number } | null>(null);
  const [showSharePopup, setShowSharePopup] = useState(false);

  // Owner-aware view of tasksApi: when this popup is showing a task that was
  // shared to the current user with edit permission, every mutating call
  // routes through the owner's directory instead of the current user's.
  const tasksApi = useMemo(() => ownerScopedTasksApi(task), [task]);

  // Universal drop: any file dragged anywhere onto the popup card uploads to
  // the task's Files/ (or Images/) folder, no matter which tab is active.
  // LiveMarkdownEditor instances inside Lab Notes / Results already handle
  // their own drops and stopPropagation, so this handler only fires for
  // drops outside an editor (Details, Methods rendered content, header, etc).
  const popupBasePath = useMemo(() => taskResultsBase(task), [task]);
  const [universalDropToast, setUniversalDropToast] = useState<
    { msg: string; x: number; y: number } | null
  >(null);
  const handleUniversalDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const handleUniversalDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      // stopPropagation so the window-level GlobalDropGuard doesn't also fire
      // its "no attachment target" toast on top of our success toast.
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const dropX = e.clientX;
      const dropY = e.clientY;
      const landed: string[] = [];
      for (const file of files) {
        const isImage = file.type.startsWith("image/");
        const folder = isImage ? "Images" : "Files";
        const dir = `${popupBasePath}/${folder}`;
        try {
          const finalName = await pickUniqueFilename(dir, file.name);
          await fileService.writeFileFromBlob(`${dir}/${finalName}`, file);
          const detail = { basePath: popupBasePath, relativePath: `${folder}/${finalName}` };
          if (isImage) {
            imageEvents.emitAttached(detail);
          } else {
            fileEvents.emitAttached(detail);
          }
          landed.push(finalName);
        } catch (err) {
          console.error("Failed to upload", file.name, err);
        }
      }
      if (landed.length > 0) {
        const msg =
          landed.length === 1
            ? `Added ${landed[0]} to this task. View in Lab Notes / Results.`
            : `Added ${landed.length} files to this task. View in Lab Notes / Results.`;
        setUniversalDropToast({ msg, x: dropX, y: dropY });
        window.setTimeout(() => setUniversalDropToast(null), 3000);
      }
    },
    [popupBasePath]
  );

  // Get the selected animation type from the store
  const animationType = useAppStore((s) => s.animationType);

  // Expose this task as the "active task" while the popup is open, so the
  // Telegram image router knows where to drop inbound photos.
  const setActiveTask = useAppStore((s) => s.setActiveTask);
  useEffect(() => {
    setActiveTask({ id: task.id, owner: task.owner, name: task.name });
    return () => setActiveTask(null);
  }, [setActiveTask, task.id, task.owner, task.name]);
  
  // Stable callback for animation completion to prevent re-triggering
  const handleAnimationComplete = useCallback(() => {
    setAnimationPosition(null);
  }, []);

  // Refresh task data — but only when the viewer owns the task.
  //
  // In readOnly mode (Lab Mode or shared-with-me views) `initialTask` belongs to
  // another user (`username` prop). `tasksApi.get` always reads from the CURRENT
  // user's directory and each user has their own ID space, so refetching here
  // would silently overwrite the popup with whatever task happens to share the
  // same numeric id in the viewer's folder — the "screen freakout" symptom.
  const { data: freshTask } = useQuery({
    queryKey: ["task", taskKey(initialTask)],
    queryFn: () => tasksApi.get(initialTask.id),
    initialData: initialTask,
    enabled: !readOnly,
  });

  // Sync local task state with the freshly-fetched record from disk while
  // preserving the sharing-metadata overlay from the prop (the on-disk file
  // never carries it). Legitimate external-state-into-React sync.
  useEffect(() => {
    if (!freshTask) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTask({
      ...freshTask,
      owner: initialTask.owner || freshTask.owner,
      is_shared_with_me: initialTask.is_shared_with_me,
      shared_permission: initialTask.shared_permission,
    });
  }, [freshTask, initialTask.owner, initialTask.is_shared_with_me, initialTask.shared_permission]);

  // Handle escape key to close or exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isExpanded) {
          setIsExpanded(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded, onClose]);

  const tabs: Tab[] = isExperiment
    ? ["details", "notes", "method", "results"]
    : isPurchase
    ? ["purchases", "details"]
    : ["details"];

  // For simple tasks, render a minimal popup showing only the list and sublists
  if (isSimpleTask && !isExpanded) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
        onClick={onClose}
      >
        {animationPosition && (
          <DynamicAnimation
            type={animationType}
            x={animationPosition.x}
            y={animationPosition.y}
            onComplete={handleAnimationComplete}
          />
        )}
        <div
          className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col border-l-4"
          style={{ borderLeftColor: project?.color || "#3b82f6" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Minimal Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-3 flex-1 mr-3 min-w-0">
              {/* Completion toggle with hint - hidden in readOnly mode */}
              {!readOnly && !task.is_complete && (
                <span className="text-xs text-gray-400 italic flex-shrink-0">Mark as complete →</span>
              )}
              {!readOnly && (
                <Tooltip label={task.is_complete ? "Mark as incomplete" : "Mark as complete"} placement="bottom">
                <button
                  onClick={async () => {
                    try {
                      await tasksApi.update(task.id, { is_complete: !task.is_complete });
                      await Promise.all([
                        await queryClient.refetchQueries({ queryKey: ["tasks"] }),
                        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
                      ]);
                    } catch {
                      alert("Failed to update task");
                    }
                  }}
                  className={`p-1.5 rounded-full transition-all flex-shrink-0 ${
                    task.is_complete
                      ? "bg-green-500 text-white hover:bg-green-600"
                      : "text-gray-300 hover:text-green-500 hover:bg-green-50"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                </button>
                </Tooltip>
              )}
              {/* Show static status indicator in readOnly mode */}
              {readOnly && (
                <span className={`p-1.5 rounded-full flex-shrink-0 ${
                  task.is_complete
                    ? "bg-green-500 text-white"
                    : "text-gray-300"
                }`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                </span>
              )}
              <h3 className="text-lg font-semibold text-gray-800 truncate">{task.name}</h3>
              <span className={`text-sm flex-shrink-0 ${task.is_complete ? "text-green-600" : "text-gray-400"}`}>
                {task.is_complete ? "Complete" : "Not complete"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {/* Delete button - hidden in readOnly mode, greyed out for shared receivers */}
              {!readOnly && (
                <Tooltip label={task.is_shared_with_me ? `Only the owner (${task.owner}) can delete this task` : "Delete task"} placement="bottom">
                <button
                  disabled={task.is_shared_with_me}
                  onClick={async () => {
                    if (confirm(`Delete task "${task.name}"?`)) {
                      try {
                        await tasksApi.delete(task.id);
                        onClose();
                        await Promise.all([
                          await queryClient.refetchQueries({ queryKey: ["tasks"] }),
                          await queryClient.refetchQueries({ queryKey: ["task"] }),
                        ]);
                        queryClient.removeQueries({ queryKey: ["task", taskKey(task)] });
                      } catch {
                        alert("Failed to delete task");
                      }
                    }
                  }}
                  className={`p-1.5 ${task.is_shared_with_me ? "text-gray-300 cursor-not-allowed" : "text-gray-400 hover:text-red-500"}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
                </Tooltip>
              )}
              <Tooltip label="Expand to full view" placement="bottom">
              <button
                onClick={() => setIsExpanded(true)}
                className="text-gray-400 hover:text-gray-600 p-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
              </button>
              </Tooltip>
              <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 p-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
              </Tooltip>
            </div>
          </div>

          {/* Sub-tasks checklist */}
          <SimpleTaskChecklist 
            task={task} 
            onAnimationTrigger={(pos) => setAnimationPosition(pos)}
            readOnly={readOnly}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      {animationPosition && (
        <DynamicAnimation
          type={animationType}
          x={animationPosition.x}
          y={animationPosition.y}
          onComplete={handleAnimationComplete}
        />
      )}
      <div
        className={`bg-white rounded-xl shadow-2xl w-full mx-4 flex flex-col transition-all duration-300 border-l-4 ${
          isExpanded
            ? "inset-4 max-w-none max-h-none h-[calc(100vh-2rem)]"
            : "max-w-5xl h-[90vh]"
        }`}
        style={{ borderLeftColor: project?.color || "#3b82f6" }}
        // LiveMarkdownEditor walks up to this attribute and draws its
        // file-drag ring on the popup card so the ring isn't clipped by
        // the editor's overflow parents.
        data-drag-ring-target=""
        onClick={(e) => e.stopPropagation()}
        onDragOver={handleUniversalDragOver}
        onDrop={handleUniversalDrop}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isExperiment ? "bg-purple-500" : "bg-blue-500"}`} />
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                {task.name}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {project?.name && `${project.name} · `}
                {task.start_date} → {task.end_date} · {task.duration_days} day
                {task.duration_days !== 1 ? "s" : ""}
                {task.is_complete && " · Complete"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Completion toggle with hint - hidden in readOnly mode */}
            {!readOnly && !task.is_complete && (
              <span className="text-xs text-gray-400 italic">Mark as complete →</span>
            )}
            {!readOnly && (
              <Tooltip label={task.is_complete ? "Mark as incomplete" : "Mark as complete"} placement="bottom">
              <button
                onClick={async () => {
                  try {
                    await tasksApi.update(task.id, { is_complete: !task.is_complete });
                    await Promise.all([
                      await queryClient.refetchQueries({ queryKey: ["tasks"] }),
                      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
                    ]);
                  } catch {
                    alert("Failed to update task");
                  }
                }}
                className={`p-1.5 rounded-full transition-all ${
                  task.is_complete
                    ? "bg-green-500 text-white hover:bg-green-600"
                    : "text-gray-300 hover:text-green-500 hover:bg-green-50"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </button>
              </Tooltip>
            )}
            {/* Show static status indicator in readOnly mode */}
            {readOnly && (
              <span className={`p-1.5 rounded-full ${
                task.is_complete
                  ? "bg-green-500 text-white"
                  : "text-gray-300"
              }`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </span>
            )}
            {isExperiment && (
              <TaskExportButton task={task} />
            )}
            {/* Share button - hidden in readOnly mode */}
            {!readOnly && (
              <Tooltip label="Share task" placement="bottom">
              <button
                onClick={() => setShowSharePopup(true)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3"/>
                  <circle cx="6" cy="12" r="3"/>
                  <circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
              </button>
              </Tooltip>
            )}
            <Tooltip label={isExpanded ? "Exit fullscreen" : "Fullscreen"} placement="bottom">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600 p-1"
            >
              {isExpanded ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
              )}
            </button>
            </Tooltip>
            {/* Delete button - hidden in readOnly mode, greyed out for shared receivers */}
            {!readOnly && (
              <Tooltip label={task.is_shared_with_me ? `Only the owner (${task.owner}) can delete this task` : "Delete task"} placement="bottom">
              <button
                disabled={task.is_shared_with_me}
                onClick={async () => {
                  if (confirm(`Delete task "${task.name}"?`)) {
                    try {
                      await tasksApi.delete(task.id);
                      onClose();
                      await Promise.all([
                        queryClient.refetchQueries({ queryKey: ["tasks"] }),
                        queryClient.refetchQueries({ queryKey: ["task"] }),
                      ]);
                      queryClient.removeQueries({ queryKey: ["task", taskKey(task)] });
                    } catch {
                      alert("Failed to delete task");
                    }
                  }
                }}
                className={`p-1 ${task.is_shared_with_me ? "text-gray-300 cursor-not-allowed" : "text-gray-400 hover:text-red-500"}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
              </Tooltip>
            )}
            <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
            </Tooltip>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6 bg-gray-50">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-blue-500 text-blue-600 bg-white"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab === "details" && "Details"}
              {tab === "notes" && "Lab Notes"}
              {tab === "method" && "Method"}
              {tab === "results" && "Results"}
              {tab === "purchases" && "Items"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "details" && (
            <DetailsTab task={task} project={project} onClose={onClose} onAnimationTrigger={(pos) => setAnimationPosition(pos)} onNavigateToTask={onNavigateToTask} readOnly={readOnly} />
          )}
          {activeTab === "notes" && <LabNotesTab task={task} readOnly={readOnly} ownerUsername={username} />}
          {activeTab === "method" && (
            <MethodTabs 
              task={task} 
              onTaskUpdate={(updatedTask) => setTask(updatedTask)} 
              readOnly={readOnly}
            />
          )}
          {activeTab === "results" && <ResultsTab task={task} readOnly={readOnly} ownerUsername={username} />}
          {activeTab === "purchases" && <PurchaseEditor taskId={task.id} readOnly={readOnly} username={username} />}
        </div>
        {universalDropToast && (
          <div
            className="fixed z-50 max-w-sm rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-lg pointer-events-none"
            style={{
              left: Math.max(8, Math.min(universalDropToast.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - 400)),
              top: Math.max(8, Math.min(universalDropToast.y + 12, (typeof window !== "undefined" ? window.innerHeight : 768) - 100)),
            }}
          >
            {universalDropToast.msg}
          </div>
        )}
      </div>

      {/* Share Popup */}
      <SharePopup
        isOpen={showSharePopup}
        onClose={() => setShowSharePopup(false)}
        itemType="task"
        itemId={task.id}
        itemName={task.name}
        currentOwner={task.owner}
        currentSharedWith={task.shared_with || []}
        onShared={() => queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] })}
      />
    </div>
  );
}

// ── Simple Task Checklist (for "list" task type) ──────────────────────────────

function SimpleTaskChecklist({
  task,
  onAnimationTrigger,
  readOnly = false,
}: {
  task: Task;
  onAnimationTrigger: (pos: { x: number; y: number }) => void;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task), [task]);
  // Initialize with task's sub_tasks immediately
  const [subTasks, setSubTasks] = useState<SubTask[]>(() => task.sub_tasks || []);
  const [newSubTaskText, setNewSubTaskText] = useState("");
  const [saving, setSaving] = useState(false);
  const checkboxRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Sync subTasks state when task prop changes (e.g., after API refresh)
  useEffect(() => {
    setSubTasks(task.sub_tasks || []);
  }, [task.sub_tasks]);

  const handleToggleSubTask = useCallback(async (subTaskId: string, _event: React.MouseEvent) => {
    const checkbox = checkboxRefs.current.get(subTaskId);
    const rect = checkbox?.getBoundingClientRect();
    
    const updatedSubTasks = subTasks.map(st => 
      st.id === subTaskId ? { ...st, is_complete: !st.is_complete } : st
    );
    
    // If we're checking it (not unchecking), trigger animation
    const subTask = subTasks.find(st => st.id === subTaskId);
    if (subTask && !subTask.is_complete && rect) {
      onAnimationTrigger({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await Promise.all([
        await queryClient.refetchQueries({ queryKey: ["tasks"] }),
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
      ]);
    } catch {
      alert("Failed to update sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task, tasksApi, queryClient, onAnimationTrigger]);

  const handleAddSubTask = useCallback(async () => {
    if (!newSubTaskText.trim()) return;
    
    const newSubTask: SubTask = {
      id: `st-${Date.now()}`,
      text: newSubTaskText.trim(),
      is_complete: false,
    };
    
    const updatedSubTasks = [...subTasks, newSubTask];
    setSubTasks(updatedSubTasks);
    setNewSubTaskText("");
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to add sub-task");
    } finally {
      setSaving(false);
    }
  }, [newSubTaskText, subTasks, task, tasksApi, queryClient]);

  const handleDeleteSubTask = useCallback(async (subTaskId: string) => {
    const updatedSubTasks = subTasks.filter(st => st.id !== subTaskId);
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to delete sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task, tasksApi, queryClient]);

  return (
    <div className="p-4">
      {/* Sub-tasks list */}
      <div className="space-y-1.5 mb-3">
        {subTasks.map((st) => (
          <div 
            key={st.id} 
            className={`flex items-center gap-3 group py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors ${
              st.is_complete ? "opacity-50" : ""
            }`}
          >
            <button
              ref={(el) => { if (el) checkboxRefs.current.set(st.id, el); }}
              onClick={readOnly ? undefined : (e) => handleToggleSubTask(st.id, e)}
              disabled={saving || readOnly}
              className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                st.is_complete
                  ? "bg-blue-500 border-blue-500"
                  : "border-gray-300 hover:border-blue-400"
              } ${readOnly ? "cursor-default" : ""}`}
              title={st.is_complete ? "Mark as incomplete" : "Mark as complete"}
            >
              {st.is_complete && (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            <span className={`flex-1 text-base ${st.is_complete ? "line-through text-gray-400" : "text-gray-700"}`}>
              {st.text}
            </span>
            {!readOnly && (
              <button
                onClick={() => handleDeleteSubTask(st.id)}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
                title="Delete item"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add new sub-task - hidden in readOnly mode */}
      {!readOnly && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newSubTaskText}
            onChange={(e) => setNewSubTaskText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddSubTask()}
            placeholder="Add item..."
            className="flex-1 px-4 py-2.5 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          />
          <button
            onClick={handleAddSubTask}
            disabled={!newSubTaskText.trim() || saving}
            className="px-4 py-2.5 text-base bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Add item"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

// ── Details Tab ──────────────────────────────────────────────────────────────

function DetailsTab({
  task,
  project,
  onClose,
  onAnimationTrigger,
  onNavigateToTask,
  readOnly = false,
}: {
  task: Task;
  project?: Project;
  onClose: () => void;
  onAnimationTrigger?: (pos: { x: number; y: number }) => void;
  onNavigateToTask?: (task: Task) => void;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task), [task]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(task.name);
  const [projectId, setProjectId] = useState(task.project_id);
  const [startDate, setStartDate] = useState(task.start_date);
  const [durationDays, setDurationDays] = useState(task.duration_days);
  const isComplete = task.is_complete;
  const [weekendOverride, setWeekendOverride] = useState<boolean | null>(task.weekend_override);
  const [saving, setSaving] = useState(false);
  const [showShiftConfirm, setShowShiftConfirm] = useState(false);
  const [shiftResult, setShiftResult] = useState<ShiftResult | null>(null);
  const [pendingStartDate, setPendingStartDate] = useState<string | null>(null);
  
  // New dependency fields
  const [newParentTaskId, setNewParentTaskId] = useState<number | null>(null);
  const [newDepType, setNewDepType] = useState<"FS" | "SS" | "SF">("FS");
  const [showParentPicker, setShowParentPicker] = useState(false);
  
  // Sub-tasks state
  const [subTasks, setSubTasks] = useState<SubTask[]>(task.sub_tasks || []);
  const [newSubTaskText, setNewSubTaskText] = useState("");
  const checkboxRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  
  // Remove from chain state
  const [showRemoveFromChain, setShowRemoveFromChain] = useState(false);
  const [removeStartDate, setRemoveStartDate] = useState(task.start_date);
  
  // Duplicate warning state
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCheckResult | null>(null);
  
  // Task type conversion state
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertToType, setConvertToType] = useState<"experiment" | "purchase" | "list">("list");
  const [converting, setConverting] = useState(false);

  // Sync subTasks state when task prop changes (e.g., after API refresh)
  useEffect(() => {
    setSubTasks(task.sub_tasks || []);
  }, [task.sub_tasks]);

  // Load projects for the dropdown
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.list,
    enabled: editing,
  });

  // Load all tasks for dependency display
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchAllTasks,
  });

  // Load dependencies
  const { data: dependencies = [] } = useQuery({
    queryKey: ["dependencies"],
    queryFn: () => dependenciesApi.list(),
  });

  // Find dependencies for this task
  const taskDependencies = dependencies.filter(d => d.child_id === task.id);
  const dependentTasks = dependencies.filter(d => d.parent_id === task.id);

  // Get parent task names
  const parentTasks = taskDependencies
    .map(dep => allTasks.find(t => t.id === dep.parent_id))
    .filter(Boolean) as Task[];

  // Get child task names
  const childTasks = dependentTasks
    .map(dep => allTasks.find(t => t.id === dep.child_id))
    .filter(Boolean) as Task[];

  // Check if task has any dependencies
  const hasDependencies = parentTasks.length > 0 || childTasks.length > 0;

  // Available tasks to add as parent (exclude self, existing parents, and non-experiment tasks)
  // Only experiment tasks can participate in dependencies
  const availableParentTasks = allTasks.filter(t => 
    t.id !== task.id && 
    !taskDependencies.some(d => d.parent_id === t.id) &&
    t.task_type === "experiment"
  );

  // Check if this task can have dependencies (only experiments)
  const canHaveDependencies = task.task_type === "experiment";

  // Calculate suggested start date based on selected parent
  const selectedNewParent = availableParentTasks.find(t => t.id === newParentTaskId);
  const suggestedNewStartDate = useMemo(() => {
    if (!selectedNewParent) return startDate;
    
    const parentEnd = new Date(selectedNewParent.end_date);
    const parentStart = new Date(selectedNewParent.start_date);
    
    if (newDepType === "FS") {
      parentEnd.setDate(parentEnd.getDate() + 1);
      return parentEnd.toISOString().split("T")[0];
    } else if (newDepType === "SS") {
      return selectedNewParent.start_date;
    } else if (newDepType === "SF") {
      const newStart = new Date(parentStart);
      newStart.setDate(newStart.getDate() - durationDays + 1);
      return newStart.toISOString().split("T")[0];
    }
    return startDate;
  }, [selectedNewParent, newDepType, durationDays, startDate]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Check for duplicate name if name has changed
      if (name.trim() !== task.name) {
        try {
          const duplicateCheck = await tasksApi.checkDuplicate(projectId, name.trim(), task.task_type, task.id);
          if (duplicateCheck.has_duplicate) {
            setDuplicateWarning(duplicateCheck);
            setSaving(false);
            return;
          }
        } catch (error) {
          console.error("Failed to check for duplicates:", error);
          // Continue with save if check fails
        }
      }
      
      // Check if start date changed and task has dependents
      // Skip start date check if task has parent dependencies (date is determined by dependency)
      const shouldCheckDateChange = parentTasks.length === 0 && startDate !== task.start_date;
      
      if (shouldCheckDateChange && dependentTasks.length > 0) {
        // Try to move with confirmation check
        const result = await tasksApi.move(task.id, {
          new_start_date: startDate,
          confirmed: false,
        });
        
        if (result.requires_confirmation) {
          setShiftResult(result);
          setPendingStartDate(startDate);
          setShowShiftConfirm(true);
          setSaving(false);
          return;
        }
        
        // No confirmation needed, apply the move
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      } else {
        // Regular update - don't send start_date if task has parent dependencies
        const updateData: Parameters<typeof tasksApi.update>[1] = {
          name: name.trim(),
          project_id: projectId,
          task_type: task.task_type,
          duration_days: durationDays,
          is_complete: isComplete,
          weekend_override: weekendOverride,
        };
        
        // Only include start_date if task doesn't have parent dependencies
        if (parentTasks.length === 0) {
          updateData.start_date = startDate;
        }
        
        await tasksApi.update(task.id, updateData);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      }
      setEditing(false);
    } catch {
      alert("Failed to update task");
    } finally {
      setSaving(false);
    }
  }, [task, tasksApi, name, projectId, startDate, durationDays, isComplete, weekendOverride, queryClient, dependentTasks.length, parentTasks.length]);

  // Function to proceed with save despite duplicate warning
  const handleProceedWithDuplicate = useCallback(async () => {
    setDuplicateWarning(null);
    setSaving(true);
    try {
      // Check if start date changed and task has dependents
      const shouldCheckDateChange = parentTasks.length === 0 && startDate !== task.start_date;
      
      if (shouldCheckDateChange && dependentTasks.length > 0) {
        const result = await tasksApi.move(task.id, {
          new_start_date: startDate,
          confirmed: false,
        });
        
        if (result.requires_confirmation) {
          setShiftResult(result);
          setPendingStartDate(startDate);
          setShowShiftConfirm(true);
          setSaving(false);
          return;
        }
        
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      } else {
        const updateData: Parameters<typeof tasksApi.update>[1] = {
          name: name.trim(),
          project_id: projectId,
          task_type: task.task_type,
          duration_days: durationDays,
          is_complete: isComplete,
          weekend_override: weekendOverride,
        };
        
        if (parentTasks.length === 0) {
          updateData.start_date = startDate;
        }
        
        await tasksApi.update(task.id, updateData);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      }
      setEditing(false);
    } catch {
      alert("Failed to update task");
    } finally {
      setSaving(false);
    }
  }, [task, tasksApi, name, projectId, startDate, durationDays, isComplete, weekendOverride, queryClient, dependentTasks.length, parentTasks.length]);

  const handleConfirmShift = useCallback(async () => {
    if (!pendingStartDate) return;
    setSaving(true);
    try {
      await tasksApi.move(task.id, {
        new_start_date: pendingStartDate,
        confirmed: true,
      });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      await queryClient.refetchQueries({ queryKey: ["dependencies"] });
      setShowShiftConfirm(false);
      setShiftResult(null);
      setPendingStartDate(null);
      setEditing(false);
    } catch {
      alert("Failed to move task");
    } finally {
      setSaving(false);
    }
  }, [task, tasksApi, pendingStartDate, queryClient]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete task "${task.name}"?`)) return;
    try {
      await tasksApi.delete(task.id);
      // Close popup immediately after successful deletion
      onClose();
      // Invalidate all task-related queries
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task"] });
      queryClient.removeQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to delete task");
    }
  }, [task, tasksApi, queryClient, onClose]);

  // Handle adding a new dependency
  const handleAddDependency = useCallback(async () => {
    if (!newParentTaskId) return;
    setSaving(true);
    try {
      // Create the dependency
      await dependenciesApi.create({
        parent_id: newParentTaskId,
        child_id: task.id,
        dep_type: newDepType,
      });
      
      // Update the task's start date based on dependency type
      await tasksApi.update(task.id, {
        start_date: suggestedNewStartDate,
      });
      
      await queryClient.refetchQueries({ queryKey: ["dependencies"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      setNewParentTaskId(null);
      setNewDepType("FS");
    } catch {
      alert("Failed to add dependency");
    } finally {
      setSaving(false);
    }
  }, [newParentTaskId, task, tasksApi, newDepType, suggestedNewStartDate, queryClient]);

  // Build the ordered dependency chain for the tree visualization
  // Returns an array of "levels" - each level contains tasks that start at the same time
  // Tasks at the same level should be displayed horizontally (parallel)
  // Different levels should be displayed vertically (sequential)
  const buildDependencyChain = useCallback((): Task[][] => {
    // First, collect all tasks in the dependency graph
    const chainTasks = new Set<number>();
    const visited = new Set<number>();
    
    // Helper to find all tasks in the chain (both upstream and downstream)
    const collectChainTasks = (taskId: number) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);
      chainTasks.add(taskId);
      
      // Add parents (tasks this depends on)
      const parentDeps = dependencies.filter(d => d.child_id === taskId);
      for (const dep of parentDeps) {
        collectChainTasks(dep.parent_id);
      }
      
      // Add children (tasks that depend on this)
      const childDeps = dependencies.filter(d => d.parent_id === taskId);
      for (const dep of childDeps) {
        collectChainTasks(dep.child_id);
      }
    };
    
    // Collect all tasks in this chain
    collectChainTasks(task.id);
    
    // Get all tasks in the chain with their data
    const tasksInChain = allTasks.filter(t => chainTasks.has(t.id));
    
    // Group tasks by start date
    const tasksByStartDate = new Map<string, Task[]>();
    for (const t of tasksInChain) {
      const existing = tasksByStartDate.get(t.start_date) || [];
      existing.push(t);
      tasksByStartDate.set(t.start_date, existing);
    }
    
    // Sort the dates and create levels
    const sortedDates = Array.from(tasksByStartDate.keys()).sort();
    const levels: Task[][] = sortedDates.map(date => {
      // Sort tasks within a level by name for consistent ordering
      return (tasksByStartDate.get(date) || []).sort((a, b) => a.name.localeCompare(b.name));
    });
    
    return levels;
  }, [task.id, allTasks, dependencies]);

  // Get the ordered chain levels
  const dependencyChainLevels = useMemo(() => buildDependencyChain(), [buildDependencyChain]);

  // Handle "Remove from dependency chain" checkbox
  const handleRemoveFromChain = useCallback(async () => {
    if (!showRemoveFromChain) return;
    
    setSaving(true);
    try {
      // Find and delete all dependencies for this task
      const depsToDelete = dependencies.filter(
        d => d.parent_id === task.id || d.child_id === task.id
      );
      
      for (const dep of depsToDelete) {
        await dependenciesApi.delete(dep.id);
      }
      
      // Update the task's start date
      await tasksApi.update(task.id, { start_date: removeStartDate });
      
      await queryClient.refetchQueries({ queryKey: ["dependencies"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
      setShowRemoveFromChain(false);
    } catch (err) {
      console.error("Failed to remove from chain:", err);
      alert("Failed to remove from dependency chain");
    } finally {
      setSaving(false);
    }
  }, [showRemoveFromChain, task, tasksApi, removeStartDate, dependencies, queryClient]);

  // Sub-task handlers
  const handleToggleSubTask = useCallback(async (subTaskId: string, _event: React.MouseEvent) => {
    const checkbox = checkboxRefs.current.get(subTaskId);
    const rect = checkbox?.getBoundingClientRect();
    
    const updatedSubTasks = subTasks.map(st => 
      st.id === subTaskId ? { ...st, is_complete: !st.is_complete } : st
    );
    
    // If we're checking it (not unchecking), trigger animation
    const subTask = subTasks.find(st => st.id === subTaskId);
    if (subTask && !subTask.is_complete && rect && onAnimationTrigger) {
      onAnimationTrigger({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to update sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task, tasksApi, queryClient, onAnimationTrigger]);

  const handleAddSubTask = useCallback(async () => {
    if (!newSubTaskText.trim()) return;
    
    const newSubTask: SubTask = {
      id: `st-${Date.now()}`,
      text: newSubTaskText.trim(),
      is_complete: false,
    };
    
    const updatedSubTasks = [...subTasks, newSubTask];
    setSubTasks(updatedSubTasks);
    setNewSubTaskText("");
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to add sub-task");
    } finally {
      setSaving(false);
    }
  }, [newSubTaskText, subTasks, task, tasksApi, queryClient]);

  const handleDeleteSubTask = useCallback(async (subTaskId: string) => {
    const updatedSubTasks = subTasks.filter(st => st.id !== subTaskId);
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] });
    } catch {
      alert("Failed to delete sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task, tasksApi, queryClient]);

  // Handle task type conversion
  const handleConvertTaskType = useCallback(async () => {
    setConverting(true);
    try {
      await tasksApi.convertType(task.id, convertToType);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
        queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
      ]);
      setShowConvertModal(false);
    } catch (error) {
      console.error("Failed to convert task type:", error);
      alert("Failed to convert task type");
    } finally {
      setConverting(false);
    }
  }, [task, tasksApi, convertToType, queryClient]);

  // Get warning message for task type conversion
  const getConversionWarnings = useCallback((fromType: string) => {
    const warnings: string[] = [];
    
    if (fromType === "experiment") {
      warnings.push("Linked methods and their PCR data will be removed");
      warnings.push("Deviation log will be cleared");
      warnings.push("Experiment color will be removed");
    }
    if (fromType === "purchase") {
      warnings.push("All purchase items will be permanently deleted");
    }
    if (fromType === "list") {
      warnings.push("All sub-tasks will be cleared");
    }
    
    return warnings;
  }, []);

  // Get available conversion types
  const availableConversionTypes = useMemo(() => {
    const types: { value: "experiment" | "purchase" | "list"; label: string }[] = [];
    if (task.task_type !== "experiment") {
      types.push({ value: "experiment", label: "Experiment" });
    }
    if (task.task_type !== "purchase") {
      types.push({ value: "purchase", label: "Purchase" });
    }
    if (task.task_type !== "list") {
      types.push({ value: "list", label: "List" });
    }
    return types;
  }, [task.task_type]);

  return (
    <div className="p-6 space-y-6">
      {/* Duplicate Warning Modal */}
      {duplicateWarning && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <h4 className="text-sm font-semibold text-red-600 mb-2">
            Duplicate Task Name Detected
          </h4>
          <p className="text-xs text-gray-600 mb-2">
            A task with the same name already exists in this project with the same task type:
          </p>
          <div className="bg-white border border-red-100 rounded p-2 mb-3">
            {duplicateWarning.matching_tasks.map((t) => (
              <div key={t.id} className="text-xs text-red-700 mb-1">
                <strong>{t.name}</strong>
                <span className="text-red-500 ml-2">
                  (Started: {t.start_date}, {t.is_complete ? "Completed" : "In Progress"})
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600 mb-3">
            Would you like to change the name, or proceed with this name anyway?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setDuplicateWarning(null)}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              Change Name
            </button>
            <button
              onClick={handleProceedWithDuplicate}
              className="px-3 py-1.5 text-xs text-red-600 border border-red-300 hover:bg-red-50 rounded-lg"
            >
              Save Anyway
            </button>
          </div>
        </div>
      )}

      {/* Quick actions - hidden in readOnly mode */}
      {!readOnly && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEditing(!editing)}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
          >
            Edit
          </button>
          <button
            onClick={() => {
              setConvertToType(availableConversionTypes[0]?.value || "list");
              setShowConvertModal(true);
            }}
            className="px-4 py-2 text-sm text-purple-600 rounded-lg hover:bg-purple-50"
          >
            Convert Type
          </button>
          <button
            disabled={task.is_shared_with_me}
            onClick={handleDelete}
            className={`px-4 py-2 text-sm rounded-lg ${
              task.is_shared_with_me
                ? "text-gray-300 cursor-not-allowed"
                : "text-red-500 hover:bg-red-50"
            }`}
            title={task.is_shared_with_me ? `Only the owner (${task.owner}) can delete this task` : undefined}
          >
            Delete
          </button>
        </div>
      )}

      {/* Task Type Conversion Modal */}
      {showConvertModal && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-red-600 mb-2">
            ⚠️ Convert Task Type
          </h4>
          <p className="text-xs text-gray-600 mb-3">
            Converting this task from <strong className="capitalize">{task.task_type}</strong> to another type will permanently delete type-specific data:
          </p>
          
          <ul className="text-xs text-red-600 mb-3 space-y-1">
            {getConversionWarnings(task.task_type).map((warning, i) => (
              <li key={i}>• {warning}</li>
            ))}
          </ul>
          
          <p className="text-xs text-gray-600 mb-3">
            The following shared data will be preserved: name, dates, duration, project, completion status, and tags.
          </p>
          
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Convert to:
            </label>
            <select
              value={convertToType}
              onChange={(e) => setConvertToType(e.target.value as "experiment" | "purchase" | "list")}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {availableConversionTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          
          <div className="bg-white border border-red-200 rounded-lg p-3 mb-3">
            <p className="text-xs text-gray-700 font-medium mb-2">
              Are you sure you want to proceed? This action cannot be undone.
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={true}
                readOnly
                className="w-4 h-4 text-red-500 border-red-300 rounded"
              />
              <span className="text-xs text-red-600 font-medium">
                Yes, I am OK with losing this data
              </span>
            </label>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setShowConvertModal(false)}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleConvertTaskType}
              disabled={converting}
              className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
            >
              {converting ? "Converting..." : "Convert Task"}
            </button>
          </div>
        </div>
      )}

      {/* Sub-tasks Section - only for list type tasks */}
      {task.task_type === "list" && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-2">
            <span>Sub-Tasks</span>
            {subTasks.length > 0 && (
              <span className="text-xs font-normal text-gray-400">
                ({subTasks.filter(st => st.is_complete).length}/{subTasks.length} complete)
              </span>
            )}
          </h4>
          
          {/* Progress bar */}
          {subTasks.length > 0 && (
            <div className="mb-3">
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-orange-500 to-yellow-400 transition-all duration-300"
                  style={{ width: `${(subTasks.filter(st => st.is_complete).length / subTasks.length) * 100}%` }}
                />
              </div>
            </div>
          )}
          
          {/* Sub-tasks list */}
          <div className="space-y-1.5 mb-3">
            {subTasks.map((st) => (
              <div 
                key={st.id} 
                className={`flex items-center gap-2 group py-1.5 px-2 rounded-lg hover:bg-white transition-colors ${
                  st.is_complete ? "opacity-60" : ""
                }`}
              >
                <button
                  ref={(el) => { if (el) checkboxRefs.current.set(st.id, el); }}
                  onClick={(e) => handleToggleSubTask(st.id, e)}
                  disabled={saving}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    st.is_complete
                      ? "bg-gradient-to-br from-orange-500 to-yellow-400 border-orange-400"
                      : "border-gray-300 hover:border-orange-400"
                  }`}
                  title={st.is_complete ? "Mark as incomplete" : "Mark as complete"}
                >
                  {st.is_complete && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <span className={`flex-1 text-sm ${st.is_complete ? "line-through text-gray-400" : "text-gray-700"}`}>
                  {st.text}
                </span>
                <button
                  onClick={() => handleDeleteSubTask(st.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-xs transition-opacity"
                  title="Delete sub-task"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          
          {/* Add new sub-task */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newSubTaskText}
              onChange={(e) => setNewSubTaskText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddSubTask()}
              placeholder="Add a sub-task..."
              className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
            />
            <button
              onClick={handleAddSubTask}
              disabled={!newSubTaskText.trim() || saving}
              className="px-3 py-1.5 text-sm bg-gradient-to-r from-orange-500 to-yellow-400 text-white rounded-lg hover:from-orange-600 hover:to-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Shift Confirmation Modal */}
      {showShiftConfirm && shiftResult && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-orange-800 mb-2">
            ⚠️ This change will affect {shiftResult.affected_tasks.length} task(s)
          </h4>
          <div className="max-h-40 overflow-y-auto mb-3">
            <ul className="text-xs text-orange-700 space-y-1">
              {shiftResult.affected_tasks.map((t) => (
                <li key={t.task_id}>
                  <strong>{t.name}</strong>: {t.old_start} → {t.new_start}
                </li>
              ))}
            </ul>
          </div>
          {shiftResult.warnings.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-red-700 mb-1">Warnings:</p>
              <ul className="text-xs text-red-600 space-y-1">
                {shiftResult.warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowShiftConfirm(false);
                setShiftResult(null);
                setPendingStartDate(null);
              }}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmShift}
              disabled={saving}
              className="px-3 py-1.5 text-xs text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50"
            >
              {saving ? "Applying..." : "Apply Changes"}
            </button>
          </div>
        </div>
      )}

      {/* Dependency Tree Section */}
      {hasDependencies && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-gray-500 mb-3">
            Dependency Chain
          </h4>
          
          {/* Levels-based chain - tasks at same level shown horizontally */}
          <div className="flex flex-col items-center">
            {dependencyChainLevels.map((levelTasks, levelIndex) => {
              const isMultiTaskLevel = levelTasks.length > 1;
              
              return (
                <div key={`level-${levelIndex}`} className="flex flex-col items-center">
                  {/* Connector line above (except for first level) */}
                  {levelIndex > 0 && (
                    <div className="flex items-center justify-center w-full mb-2">
                      {isMultiTaskLevel ? (
                        // Multiple connectors for parallel tasks
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-0.5 bg-gray-300" />
                          <svg width="16" height="16" viewBox="0 0 16 16" className="text-gray-400">
                            <path d="M8 0 L8 16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                          </svg>
                          <div className="w-8 h-0.5 bg-gray-300" />
                        </div>
                      ) : (
                        <div className="w-0.5 h-4 bg-gradient-to-b from-gray-300 to-gray-400" />
                      )}
                    </div>
                  )}
                  
                  {/* Tasks at this level - horizontal if multiple */}
                  <div className={`flex items-center gap-3 ${isMultiTaskLevel ? 'flex-wrap justify-center' : ''}`}>
                    {levelTasks.map((chainTask) => {
                      const isCurrentTask = chainTask.id === task.id;
                      
                      return (
                        <div key={chainTask.id} className="relative">
                          {/* Task node */}
                          <div
                            className={`relative px-4 py-2 rounded-lg text-sm transition-all ${
                              isCurrentTask
                                ? "bg-blue-500 text-white font-medium shadow-md ring-2 ring-blue-300 ring-offset-1"
                                : "bg-white text-gray-700 border border-gray-200 hover:border-blue-400 hover:shadow-md cursor-pointer hover:bg-blue-50"
                            }`}
                            onClick={() => {
                              if (!isCurrentTask && onNavigateToTask) {
                                onNavigateToTask(chainTask);
                              }
                            }}
                            title={!isCurrentTask ? `Click to view: ${chainTask.name}` : undefined}
                          >
                            <span className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${isCurrentTask ? "bg-white" : "bg-gray-400"}`} />
                              <span className="max-w-[200px] truncate">{chainTask.name}</span>
                              {isCurrentTask && (
                                <span className="text-xs opacity-75">(this task)</span>
                              )}
                              {!isCurrentTask && onNavigateToTask && (
                                <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Connector line below (except for last level) */}
                  {levelIndex < dependencyChainLevels.length - 1 && (
                    <div className="flex items-center justify-center w-full mt-2">
                      {(() => {
                        const nextLevel = dependencyChainLevels[levelIndex + 1];
                        const nextIsMulti = nextLevel.length > 1;
                        if (nextIsMulti) {
                          return (
                            <div className="flex items-center gap-4">
                              <div className="w-8 h-0.5 bg-gray-300" />
                              <svg width="16" height="16" viewBox="0 0 16 16" className="text-gray-400">
                                <path d="M8 0 L8 16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                              </svg>
                              <div className="w-8 h-0.5 bg-gray-300" />
                            </div>
                          );
                        }
                        return <div className="w-0.5 h-4 bg-gradient-to-b from-gray-400 to-gray-300" />;
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing ? (
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Task Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Project */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Project
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Hide start date field if task has parent dependencies */}
            {parentTasks.length === 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {dependentTasks.length > 0 && startDate !== task.start_date && (
                  <p className="text-xs text-orange-500 mt-1">
                    ⚠️ Will shift {dependentTasks.length} dependent task(s)
                  </p>
                )}
              </div>
            )}
            <div className={parentTasks.length > 0 ? "col-span-2" : ""}>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Duration (days)
              </label>
              <input
                type="number"
                min={1}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Remove from Dependency Chain Section - only show if task has dependencies */}
          {hasDependencies && (
            <div className="border-t border-gray-100 pt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRemoveFromChain}
                  onChange={(e) => {
                    setShowRemoveFromChain(e.target.checked);
                    if (e.target.checked) {
                      setRemoveStartDate(task.start_date);
                    }
                  }}
                  className="w-4 h-4 text-red-500 border-gray-300 rounded focus:ring-red-500"
                />
                <span className="text-sm text-red-600 font-medium">
                  Remove from dependency chain
                </span>
              </label>
              
              {showRemoveFromChain && (
                <div className="mt-3 pl-6 space-y-2">
                  <p className="text-xs text-gray-500">
                    This task will become standalone. Set its new start date:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={removeStartDate}
                      onChange={(e) => setRemoveStartDate(e.target.value)}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <button
                      type="button"
                      onClick={handleRemoveFromChain}
                      disabled={saving}
                      className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                    >
                      {saving ? "Removing..." : "Remove from Chain"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Add Dependency Section - only for experiment tasks */}
          {canHaveDependencies && (
            <div className="border-t border-gray-100 pt-4">
              <label className="block text-xs font-medium text-gray-500 mb-2">
                Add Dependency (optional)
              </label>
              <div className="space-y-2">
                {selectedNewParent ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-gray-900 truncate">
                        {selectedNewParent.name}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {selectedNewParent.start_date} → {selectedNewParent.end_date}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewParentTaskId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowParentPicker(true)}
                    disabled={availableParentTasks.length === 0}
                    className="w-full text-left px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {availableParentTasks.length === 0
                      ? "No eligible experiments to depend on"
                      : "Select an experiment this depends on…"}
                  </button>
                )}

                {newParentTaskId && (
                  <>
                    <select
                      value={newDepType}
                      onChange={(e) => setNewDepType(e.target.value as "FS" | "SS" | "SF")}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="FS">Start after (after parent ends)</option>
                      <option value="SS">Start at same time (as parent)</option>
                      <option value="SF">Finish before (parent starts)</option>
                    </select>
                    
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                      <p className="text-xs text-orange-700">
                        <strong>New Start Date:</strong> {suggestedNewStartDate}
                      </p>
                      <p className="text-xs text-orange-600 mt-1">
                        {newDepType === "FS" && `Will start after "${selectedNewParent?.name}" ends`}
                        {newDepType === "SS" && `Will start at same time as "${selectedNewParent?.name}"`}
                        {newDepType === "SF" && `Will finish when "${selectedNewParent?.name}" starts`}
                      </p>
                    </div>
                    
                    <button
                      type="button"
                      onClick={handleAddDependency}
                      disabled={saving}
                      className="px-3 py-1.5 text-xs text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50"
                    >
                      {saving ? "Adding..." : "Add Dependency"}
                    </button>
                  </>
                )}
              </div>
              <TaskPicker
                open={showParentPicker}
                availableTasks={availableParentTasks}
                currentProjectId={task.project_id}
                title="Add dependency"
                placeholder="Search experiments by name or #tag…"
                onSelect={(id) => {
                  setNewParentTaskId(id);
                  setShowParentPicker(false);
                }}
                onClose={() => setShowParentPicker(false)}
              />
            </div>
          )}

          {/* Weekend Override - only show if project is not 7-day */}
          {(() => {
            const taskProject = projects.find(p => p.id === projectId);
            const is7DayProject = taskProject?.weekend_active ?? false;
            if (is7DayProject) return null;
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={weekendOverride === true}
                    onChange={(e) => setWeekendOverride(e.target.checked ? true : null)}
                    className="w-4 h-4 text-amber-600 border-amber-300 rounded focus:ring-amber-500 mt-0.5"
                  />
                  <div>
                    <span className="text-sm text-amber-800 font-medium">
                      I&apos;m okay with working on the weekend
                    </span>
                    <p className="text-xs text-amber-600 mt-0.5">
                      By default, tasks that span weekends show weekend days as non-working. 
                      Check this to indicate you plan to work on weekends.
                    </p>
                  </div>
                </label>
              </div>
            );
          })()}

          <div className="flex gap-3">
            <button
              onClick={() => setEditing(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6 max-w-lg">
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Project</p>
            <p className="text-sm text-gray-700">
              {project?.name || (task.is_shared_with_me ? `Shared Project (by ${task.owner})` : "—")}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Type</p>
            <p className="text-sm text-gray-700">
              {task.task_type === "experiment" ? "Experiment" : task.task_type === "purchase" ? "Purchase" : "List"}
            </p>
          </div>
          {/* Hide start and end date if task has parent dependencies */}
          {!hasDependencies && (
            <>
              <div>
                <p className="text-xs font-medium text-gray-400 mb-1">Start</p>
                <p className="text-sm text-gray-700">{task.start_date}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400 mb-1">End</p>
                <p className="text-sm text-gray-700">{task.end_date}</p>
              </div>
            </>
          )}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Duration</p>
            <p className="text-sm text-gray-700">
              {task.duration_days} day{task.duration_days !== 1 ? "s" : ""}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Status</p>
            <p className="text-sm text-gray-700">
              {task.is_complete ? "Complete" : "In Progress"}
            </p>
          </div>
          {/* Show weekend override status if set */}
          {task.weekend_override && (
            <div className="col-span-2">
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-xs text-amber-700">
                  📅 Weekend work enabled for this task
                </p>
              </div>
            </div>
          )}
          {task.tags && task.tags.length > 0 && (
            <div className="col-span-2">
              <p className="text-xs font-medium text-gray-400 mb-1">Tags</p>
              <div className="flex gap-1 flex-wrap">
                {task.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          {task.deviation_log && (
            <div className="col-span-2">
              <p className="text-xs font-medium text-gray-400 mb-1">
                Deviation Log
              </p>
              <div className="prose prose-sm prose-gray max-w-none bg-amber-50 rounded-lg p-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {task.deviation_log}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Lab Notes Tab (with LiveMarkdownEditor) ──────────────────────────────────

type ContentSubTab = "markdown" | "pdfs";

function splitFilenameExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

async function pickUniqueFilename(dirPath: string, desired: string): Promise<string> {
  const { stem, ext } = splitFilenameExt(desired);
  let candidate = desired;
  let n = 1;
  while (await fileService.fileExists(`${dirPath}/${candidate}`)) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

function LabNotesTab({ task, readOnly = false, ownerUsername }: { task: Task; readOnly?: boolean; ownerUsername?: string }) {
  const [activeSubTab, setActiveSubTab] = useState<ContentSubTab>("markdown");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();
  const { currentUser } = useCurrentUser();

  // Resolved lazily: the per-user path is canonical, but if legacy global
  // `results/task-{id}/` is the only one with data we read from there until
  // the owner triggers a one-time copy (see resolveTaskResultsBase).
  const legacyOwner = ownerUsername || task.owner;
  const [basePath, setBasePath] = useState<string>(() => taskResultsBase(task));
  const notesPath = `${basePath}/notes.md`;
  const pdfsDir = `${basePath}/NotesPDFs`;

  // Look up the project name so a fresh notes.md gets a real project in its
  // stamp instead of "Unknown Project". Reuses the same query key as the
  // export button (`TaskExportButton`).
  const { data: stampProject } = useQuery({
    queryKey: ["project", task.project_id],
    queryFn: () => projectsApi.get(task.project_id),
  });

  // Track if there are unsaved changes
  const hasUnsavedChanges = content !== originalContent && !loading;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = currentUser
          ? await resolveTaskResultsBase({ id: task.id, owner: task.owner }, currentUser)
          : taskResultsBase({ id: task.id, owner: task.owner });
        if (cancelled) return;
        setBasePath(resolved);
        const resolvedNotes = `${resolved}/notes.md`;
        const file = await filesApi.readFile(resolvedNotes);
        const raw = file.content;
        if (readOnly) {
          if (!cancelled) {
            setContent(raw);
            setOriginalContent(raw);
            setLoading(false);
          }
          return;
        }
        // Lazy-migrate any legacy `Attachments/` content into `Files/` on the
        // owner's first read. Cheap no-op if the folder doesn't exist.
        const attachMig = await migrateTaskAttachmentsToFiles(resolved, raw);
        const startContent = attachMig.contentRewritten ? attachMig.content : raw;
        const { content: migrated, didMigrate } = await migrateNoteImages(startContent, task.id, resolved, legacyOwner);
        // Lazy-normalize legacy stamp formats so the rendered preview stops
        // leaking the `[stamp-end]: # (hidden)` marker as visible text.
        const stampNormalizedContent = hasLegacyStampFormat(migrated)
          ? normalizeStampFormat(migrated)
          : migrated;
        const stampDidNormalize = stampNormalizedContent !== migrated;
        if (didMigrate || attachMig.contentRewritten || stampDidNormalize) {
          await filesApi.writeFile(resolvedNotes, stampNormalizedContent, `Migrate image references for: ${task.name}`);
        }
        if (!cancelled) {
          setContent(stampNormalizedContent);
          setOriginalContent(stampNormalizedContent);
          setLoading(false);
        }
      } catch {
        if (cancelled) return;
        const projectName = stampProject?.name ?? "Unknown Project";
        const newContent = createNewFileContent(task.name, projectName, 'notes');
        setContent(newContent);
        setOriginalContent(newContent);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id, task.name, task.owner, task.project_id, currentUser, legacyOwner, readOnly, stampProject?.name]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        try {
          const { markdownSnippet } = await attachImageToTask({
            ownerUsername: task.owner,
            taskId: task.id,
            basePath,
            blob: renamedFile,
            suggestedFilename: renamedFile.name,
          });
          setContent((prev) => prev + markdownSnippet);
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
      setUploading(false);
    },
    [basePath, requestRename, task.id, task.owner]
  );

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      const filesDir = `${basePath}/Files`;
      for (const file of files) {
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        try {
          const finalName = await pickUniqueFilename(filesDir, renamedFile.name);
          const destPath = `${filesDir}/${finalName}`;
          await fileService.writeFileFromBlob(destPath, renamedFile);
          fileEvents.emitAttached({ basePath, relativePath: `Files/${finalName}` });
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
      setUploading(false);
    },
    [basePath, requestRename]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await filesApi.writeFile(notesPath, content, `Update lab notes for: ${task.name}`);
      await gcUnreferencedAttachments(content, basePath);
      setOriginalContent(content);
    } catch {
      alert("Failed to save notes");
    } finally {
      setSaving(false);
    }
  }, [content, notesPath, basePath, task.name]);

  return (
    <>
      <FileRenamePopup />
      <div className="flex flex-col h-full">
        {/* Sub-tabs for Markdown and PDFs */}
        <div className="flex items-center gap-1 px-6 py-2 bg-gray-50 border-b border-gray-100">
          <button
            onClick={() => setActiveSubTab("markdown")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeSubTab === "markdown"
                ? "bg-white text-blue-600 shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            📝 Markdown
          </button>
          <button
            onClick={() => setActiveSubTab("pdfs")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeSubTab === "pdfs"
                ? "bg-white text-blue-600 shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            📎 Files
          </button>
        </div>

        {activeSubTab === "markdown" ? (
          <>
            {/* Toolbar - hidden in readOnly mode */}
            {!readOnly && (
              <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {uploading ? "Uploading..." : "📎 Add File"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFileUpload(Array.from(e.target.files));
                    e.target.value = "";
                  }}
                />
                <div className="flex-1" />
                {hasUnsavedChanges && (
                  <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    hasUnsavedChanges
                      ? "text-white bg-blue-600 hover:bg-blue-700"
                      : "text-gray-400 bg-gray-200 cursor-not-allowed"
                  } disabled:opacity-50`}
                >
                  {saving ? "Saving..." : "Save Notes"}
                </button>
              </div>
            )}

            {/* File size warning */}
            {uploadWarning && (
              <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
                <div className="flex items-start gap-2">
                  <span className="text-amber-500 text-sm">⚠️</span>
                  <div className="flex-1">
                    <p className="text-sm text-amber-800">{uploadWarning}</p>
                  </div>
                  <button
                    onClick={() => setUploadWarning(null)}
                    className="text-amber-400 hover:text-amber-600 text-sm"
                    title="Dismiss warning"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Editor — give it a sized flex slot so the editor scrolls
                internally (the markdown body, toolbar, and image strip
                stay anchored) instead of pushing the whole popup tab
                to scroll as a unit. */}
            <div className="flex-1 min-h-0 flex flex-col">
              {loading ? (
                <p className="p-6 text-sm text-gray-400 animate-pulse">Loading...</p>
              ) : (
                <LiveMarkdownEditor
                  value={content}
                  onChange={setContent}
                  placeholder="Click to start writing lab notes..."
                  onImageDrop={handleImageUpload}
                  onFileDrop={handleFileUpload}
                  allowAnyFileType={true}
                  imageBasePath={basePath}
                  showToolbar={true}
                />
              )}
            </div>
          </>
        ) : (
          <PdfAttachmentsPanel pdfsDir={pdfsDir} label="Lab Notes" />
        )}
      </div>
    </>
  );
}

// ── Results Tab ──────────────────────────────────────────────────────────────

function ResultsTab({ task, readOnly = false, ownerUsername }: { task: Task; readOnly?: boolean; ownerUsername?: string }) {
  const [activeSubTab, setActiveSubTab] = useState<ContentSubTab>("markdown");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();
  const { currentUser } = useCurrentUser();

  // See LabNotesTab for the per-user / legacy fallback rules.
  const legacyOwner = ownerUsername || task.owner;
  const [basePath, setBasePath] = useState<string>(() => taskResultsBase(task));
  const resultsPath = `${basePath}/results.md`;
  const pdfsDir = `${basePath}/ResultsPDFs`;

  // See LabNotesTab — same lookup so a fresh results.md gets a real project
  // name in its stamp instead of "Unknown Project".
  const { data: stampProject } = useQuery({
    queryKey: ["project", task.project_id],
    queryFn: () => projectsApi.get(task.project_id),
  });

  // Track if there are unsaved changes
  const hasUnsavedChanges = content !== originalContent && !loading;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = currentUser
          ? await resolveTaskResultsBase({ id: task.id, owner: task.owner }, currentUser)
          : taskResultsBase({ id: task.id, owner: task.owner });
        if (cancelled) return;
        setBasePath(resolved);
        const resolvedResults = `${resolved}/results.md`;
        const file = await filesApi.readFile(resolvedResults);
        const raw = file.content;
        if (readOnly) {
          if (!cancelled) {
            setContent(raw);
            setOriginalContent(raw);
            setLoading(false);
          }
          return;
        }
        // Lazy-migrate any legacy `Attachments/` content into `Files/` on the
        // owner's first read. Cheap no-op if the folder doesn't exist.
        const attachMig = await migrateTaskAttachmentsToFiles(resolved, raw);
        const startContent = attachMig.contentRewritten ? attachMig.content : raw;
        const { content: migrated, didMigrate } = await migrateNoteImages(startContent, task.id, resolved, legacyOwner);
        // Lazy-normalize legacy stamp formats so the rendered preview stops
        // leaking the `[stamp-end]: # (hidden)` marker as visible text.
        const stampNormalizedContent = hasLegacyStampFormat(migrated)
          ? normalizeStampFormat(migrated)
          : migrated;
        const stampDidNormalize = stampNormalizedContent !== migrated;
        if (didMigrate || attachMig.contentRewritten || stampDidNormalize) {
          await filesApi.writeFile(resolvedResults, stampNormalizedContent, `Migrate image references for: ${task.name}`);
        }
        if (!cancelled) {
          setContent(stampNormalizedContent);
          setOriginalContent(stampNormalizedContent);
          setLoading(false);
        }
      } catch {
        if (cancelled) return;
        const projectName = stampProject?.name ?? "Unknown Project";
        const newContent = createNewFileContent(task.name, projectName, 'results');
        setContent(newContent);
        setOriginalContent(newContent);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id, task.name, task.owner, task.project_id, currentUser, legacyOwner, readOnly, stampProject?.name]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        try {
          const { markdownSnippet } = await attachImageToTask({
            ownerUsername: task.owner,
            taskId: task.id,
            basePath,
            blob: renamedFile,
            suggestedFilename: renamedFile.name,
          });
          setContent((prev) => prev + markdownSnippet);
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
      setUploading(false);
    },
    [basePath, requestRename, task.id, task.owner]
  );

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      const filesDir = `${basePath}/Files`;
      for (const file of files) {
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        try {
          const finalName = await pickUniqueFilename(filesDir, renamedFile.name);
          const destPath = `${filesDir}/${finalName}`;
          await fileService.writeFileFromBlob(destPath, renamedFile);
          fileEvents.emitAttached({ basePath, relativePath: `Files/${finalName}` });
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
      setUploading(false);
    },
    [basePath, requestRename]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await filesApi.writeFile(resultsPath, content, `Update results: ${task.name}`);
      await gcUnreferencedAttachments(content, basePath);
      setOriginalContent(content);
    } catch {
      alert("Failed to save results");
    } finally {
      setSaving(false);
    }
  }, [content, resultsPath, basePath, task.name]);

  return (
    <>
      <FileRenamePopup />
      <div className="flex flex-col h-full">
        {/* Sub-tabs for Markdown and PDFs */}
        <div className="flex items-center gap-1 px-6 py-2 bg-gray-50 border-b border-gray-100">
          <button
            onClick={() => setActiveSubTab("markdown")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeSubTab === "markdown"
                ? "bg-white text-blue-600 shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            📝 Markdown
          </button>
          <button
            onClick={() => setActiveSubTab("pdfs")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeSubTab === "pdfs"
                ? "bg-white text-blue-600 shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            📎 Files
          </button>
        </div>

        {activeSubTab === "markdown" ? (
        <>
          {/* Toolbar - hidden in readOnly mode */}
          {!readOnly && (
            <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {uploading ? "Uploading..." : "📎 Add File"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFileUpload(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
              <div className="flex-1" />
              {hasUnsavedChanges && (
                <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  hasUnsavedChanges
                    ? "text-white bg-blue-600 hover:bg-blue-700"
                    : "text-gray-400 bg-gray-200 cursor-not-allowed"
                } disabled:opacity-50`}
              >
                {saving ? "Saving..." : "Save Results"}
              </button>
            </div>
          )}

          {/* File size warning */}
          {uploadWarning && (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
              <div className="flex items-start gap-2">
                <span className="text-amber-500 text-sm">⚠️</span>
                <div className="flex-1">
                  <p className="text-sm text-amber-800">{uploadWarning}</p>
                </div>
                <button
                  onClick={() => setUploadWarning(null)}
                  className="text-amber-400 hover:text-amber-600 text-sm"
                  title="Dismiss warning"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Editor — sized flex slot so the markdown scrolls inside the
              editor, not by pushing the whole tab. Matches the LabNotes
              tab and the fullscreen behavior. */}
          <div className="flex-1 min-h-0 flex flex-col">
            {loading ? (
              <p className="p-6 text-sm text-gray-400 animate-pulse">Loading...</p>
            ) : (
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
                placeholder="Click to start writing results..."
                onImageDrop={handleImageUpload}
                onFileDrop={handleFileUpload}
                allowAnyFileType={true}
                imageBasePath={basePath}
                showToolbar={true}
              />
            )}
          </div>
        </>
      ) : (
        <PdfAttachmentsPanel pdfsDir={pdfsDir} label="Results" />
      )}
    </div>
    </>
  );
}

// ── PDF Attachments Panel ─────────────────────────────────────────────────────

// Helper to determine if a file is renderable in browser
const isRenderableFile = (filename: string): boolean => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'md', 'txt'].includes(ext);
};

// Helper to determine if a file is markdown
const isMarkdownFile = (filename: string): boolean => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return ext === 'md';
};

// Helper to get file icon based on extension
const getFileIcon = (filename: string): string => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (ext === 'pdf') return '📕';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return '🖼️';
  if (ext === 'md') return '📝';
  if (ext === 'txt') return '📄';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['zip', 'tar', 'gz'].includes(ext)) return '📦';
  return '📎';
};

// Helper to get MIME type
const getMimeType = (filename: string): string => {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

interface PdfAttachment {
  name: string;
  path: string;
  url: string | null;
  loading: boolean;
  isRenderable: boolean;
}

function PdfAttachmentsPanel({ pdfsDir, label }: { pdfsDir: string; label: string }) {
  const [files, setFiles] = useState<PdfAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeFile, setActiveFile] = useState<PdfAttachment | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const dirFiles = await filesApi.listDirectory(pdfsDir);

      const attachments: PdfAttachment[] = dirFiles.map((f: GitHubTreeItem) => ({
        name: f.name,
        path: f.path,
        url: null,
        loading: false,
        isRenderable: isRenderableFile(f.name),
      }));

      setFiles(attachments);
    } catch {
      // Directory doesn't exist yet
      setFiles([]);
    }
    setLoading(false);
  }, [pdfsDir]);

  // Load files from directory. loadFiles is async and calls setState
  // internally; the lint rule trips on the transitive setState but this is
  // a standard "fetch on mount/dep change" pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFiles();
  }, [loadFiles]);

  // Handle file upload
  const handleUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    
    setUploading(true);
    for (const file of Array.from(fileList)) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(",")[1];
          const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
          const filePath = `${pdfsDir}/${fileName}`;
          
          await filesApi.uploadImage(
            filePath,
            base64,
            `Upload file for ${label}: ${file.name}`
          );
          
          // Refresh the list
          await loadFiles();
        } catch {
          alert(`Failed to upload ${file.name}`);
        }
      };
      reader.readAsDataURL(file);
    }
    setUploading(false);
  }, [pdfsDir, label, loadFiles]);

  // Load and display a file
  const handleViewFile = useCallback(async (file: PdfAttachment) => {
    if (!file.isRenderable) {
      // For non-renderable files, offer download
      try {
        const fileData = await filesApi.readFile(file.path);
        const binaryString = atob(fileData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: getMimeType(file.name) });
        const url = URL.createObjectURL(blob);
        
        // Create download link
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        alert("Failed to download file");
      }
      return;
    }
    
    setActiveFile(file);
    setFileUrl(null);
    setMarkdownContent(null);
    
    try {
      const fileData = await filesApi.readFile(file.path);
      
      // Check if it's a markdown file - render with ReactMarkdown
      if (isMarkdownFile(file.name)) {
        // Decode base64 to text
        const binaryString = atob(fileData.content);
        const textContent = decodeURIComponent(escape(binaryString));
        setMarkdownContent(textContent);
      } else {
        // For PDFs and images, create blob URL for iframe
        const binaryString = atob(fileData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: getMimeType(file.name) });
        const url = URL.createObjectURL(blob);
        setFileUrl(url);
      }
    } catch {
      alert("Failed to load file");
      setActiveFile(null);
    }
  }, []);

  // Delete a file
  const handleDeleteFile = useCallback(async (file: PdfAttachment) => {
    if (!confirm(`Delete "${file.name}"?`)) return;
    
    try {
      // NB: this only removes the file from the in-memory list — the file on
      // disk is left in place. Wire this up to fileService when real deletion
      // is wanted.
      setFiles((prev) => prev.filter((f) => f.path !== file.path));
      if (activeFile?.path === file.path) {
        setActiveFile(null);
        setFileUrl(null);
        setMarkdownContent(null);
      }
    } catch {
      alert("Failed to delete file");
    }
  }, [activeFile]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  if (activeFile) {
    const isMarkdown = isMarkdownFile(activeFile.name);
    
    return (
      <div className="flex flex-col h-full">
        {/* File Viewer Header */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
          <button
            onClick={() => {
              setActiveFile(null);
              setFileUrl(null);
              setMarkdownContent(null);
            }}
            className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
          >
            ← Back to Files
          </button>
          <span className="text-sm text-gray-600 truncate">{activeFile.name}</span>
        </div>
        
        {/* File Viewer */}
        <div className="flex-1 overflow-hidden">
          {isMarkdown ? (
            markdownContent ? (
              <div className="h-full overflow-y-auto p-6 prose prose-sm prose-gray max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {markdownContent}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
              </div>
            )
          ) : (
            fileUrl ? (
              <iframe
                src={fileUrl}
                className="w-full h-full"
                title={activeFile.name}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "📎 Add File"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <span className="text-xs text-gray-400">
          PDFs & images viewable, other files downloadable
        </span>
        <div className="flex-1" />
        <span className="text-xs text-gray-400">
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-gray-400 animate-pulse">Loading files...</p>
        ) : files.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">📎</p>
            <p className="text-sm text-gray-400 mb-1">No files attached yet</p>
            <p className="text-xs text-gray-300">
              Upload PDFs (viewable), images (viewable), or other files (downloadable)
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {files.map((file) => (
              <div
                key={file.path}
                className="group relative bg-gray-50 border border-gray-200 rounded-lg p-4 hover:bg-gray-100 transition-colors cursor-pointer"
                onClick={() => handleViewFile(file)}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{getFileIcon(file.name)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {file.isRenderable ? "Click to view" : "Click to download"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFile(file);
                  }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                  title="Delete file"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Task Export Button Component ───────────────────────────────────────────────

function TaskExportButton({ task }: { task: Task }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch project name
  const { data: project } = useQuery({
    queryKey: ["project", task.project_id],
    queryFn: () => projectsApi.get(task.project_id),
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleExport = useCallback(async (format: 'markdown' | 'pdf') => {
    setExporting(true);
    setShowDropdown(false);

    try {
      const projectName = project?.name || "Unknown Project";
      const base = (await findExistingTaskResultsBase(task)) ?? taskResultsBase(task);

      // Fetch lab notes
      let labNotes: string | null = null;
      try {
        const notesFile = await filesApi.readFile(`${base}/notes.md`);
        labNotes = notesFile.content;
      } catch {
        // Notes don't exist
      }

      // Fetch primary method (first attached). Multi-method export support
      // would need to extend this; today the export bundle is single-method.
      let method: Method | null = null;
      let methodContent: string | null = null;
      const primaryMethodId = task.method_ids?.[0];
      if (primaryMethodId != null) {
        try {
          method = await methodsApi.get(primaryMethodId);
          if (method && method.source_path) {
            const methodFile = await filesApi.readFile(method.source_path);
            methodContent = methodFile.content;
          }
        } catch {
          // Method doesn't exist
        }
      }

      // Fetch results
      let results: string | null = null;
      try {
        const resultsFile = await filesApi.readFile(`${base}/results.md`);
        results = resultsFile.content;
      } catch {
        // Results don't exist
      }

      // Get PDF attachments
      const pdfAttachments: string[] = [];
      try {
        const notesPdfs = await filesApi.listDirectory(`${base}/NotesPDFs`);
        pdfAttachments.push(...notesPdfs.map((f: GitHubTreeItem) => f.path));
      } catch {
        // Directory doesn't exist
      }
      try {
        const resultsPdfs = await filesApi.listDirectory(`${base}/ResultsPDFs`);
        pdfAttachments.push(...resultsPdfs.map((f: GitHubTreeItem) => f.path));
      } catch {
        // Directory doesn't exist
      }

      const exportData: ExperimentExportData = {
        task,
        projectName,
        labNotes,
        method,
        methodContent,
        results,
        pdfAttachments,
      };

      const options: ExportOptions = {
        format,
        includeLabNotes: true,
        includeMethod: true,
        includeResults: true,
        includeAttachments: true,
      };

      await exportSingleExperiment(exportData, options);
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export experiment");
    } finally {
      setExporting(false);
    }
  }, [task, project]);

  return (
    <div className="relative" ref={dropdownRef}>
      <Tooltip label="Export experiment" placement="bottom">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={exporting}
        className="text-gray-400 hover:text-gray-600 p-1 disabled:opacity-50"
      >
        {exporting ? (
          <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        )}
      </button>
      </Tooltip>

      {showDropdown && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
          <button
            onClick={() => handleExport('markdown')}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <span>📝</span> Markdown
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <span>📕</span> PDF
          </button>
        </div>
      )}
    </div>
  );
}
