"use client";

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { githubApi, methodsApi, projectsApi, tasksApi, dependenciesApi, pcrApi, fetchAllTasks, type DuplicateCheckResult } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import PurchaseEditor from "./PurchaseEditor";
import DynamicAnimation from "./DynamicAnimation";
import MethodTabs from "./MethodTabs";
import { useAppStore } from "@/lib/store";
import type { Method, Task, Project, Dependency, ShiftResult, SubTask, PCRProtocol, PCRGradient, PCRIngredient } from "@/lib/types";
import type { GitHubTreeItem } from "@/lib/types";
import { InteractiveGradientEditor, getTemperatureColor } from "@/components/InteractiveGradientEditor";
import { createNewFileContent } from "@/lib/stamp-utils";
import {
  exportSingleExperiment,
  type ExportOptions,
  type ExperimentExportData,
} from "@/lib/export-utils";

interface TaskDetailPopupProps {
  task: Task;
  project?: Project;
  onClose: () => void;
  onNavigateToTask?: (task: Task) => void;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
  username?: string; // When provided, fetch user-specific data (for lab mode)
}

type Tab = "details" | "notes" | "method" | "results" | "purchases";

export default function TaskDetailPopup({
  task: initialTask,
  project,
  onClose,
  onNavigateToTask,
  readOnly = false,
  username,
}: TaskDetailPopupProps) {
  const queryClient = useQueryClient();
  const isExperiment = initialTask.task_type === "experiment";
  const isPurchase = initialTask.task_type === "purchase";
  const isSimpleTask = initialTask.task_type === "list";
  const [activeTab, setActiveTab] = useState<Tab>(isPurchase ? "purchases" : "details");
  const [task, setTask] = useState(initialTask);
  const [isExpanded, setIsExpanded] = useState(false);
  const [animationPosition, setAnimationPosition] = useState<{ x: number; y: number } | null>(null);
  
  // Get the selected animation type from the store
  const animationType = useAppStore((s) => s.animationType);
  
  // Stable callback for animation completion to prevent re-triggering
  const handleAnimationComplete = useCallback(() => {
    setAnimationPosition(null);
  }, []);

  // Refresh task data
  const { data: freshTask } = useQuery({
    queryKey: ["task", initialTask.id],
    queryFn: () => tasksApi.get(initialTask.id),
    initialData: initialTask,
  });

  useEffect(() => {
    if (freshTask) setTask(freshTask);
  }, [freshTask]);

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
                <button
                  onClick={async () => {
                    try {
                      await tasksApi.update(task.id, { is_complete: !task.is_complete });
                      await Promise.all([
                        await queryClient.refetchQueries({ queryKey: ["tasks"] }),
                        await queryClient.refetchQueries({ queryKey: ["task", task.id] }),
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
                  title={task.is_complete ? "Mark as incomplete" : "Mark as complete"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                </button>
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
              {/* Delete button - hidden in readOnly mode */}
              {!readOnly && (
                <button
                  onClick={async () => {
                    if (confirm(`Delete task "${task.name}"?`)) {
                      try {
                        await tasksApi.delete(task.id);
                        // Close popup immediately after successful deletion
                        onClose();
                        // Refetch all task-related queries
                        await Promise.all([
                          await queryClient.refetchQueries({ queryKey: ["tasks"] }),
                          await queryClient.refetchQueries({ queryKey: ["task"] }),
                        ]);
                        queryClient.removeQueries({ queryKey: ["task", task.id] });
                      } catch {
                        alert("Failed to delete task");
                      }
                    }
                  }}
                  className="text-gray-400 hover:text-red-500 p-1.5"
                  title="Delete task"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              )}
              <button
                onClick={() => setIsExpanded(true)}
                className="text-gray-400 hover:text-gray-600 p-1.5"
                title="Expand to full view"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
              </button>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 p-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
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
            : "max-w-5xl max-h-[90vh]"
        }`}
        style={{ borderLeftColor: project?.color || "#3b82f6" }}
        onClick={(e) => e.stopPropagation()}
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
              <button
                onClick={async () => {
                  try {
                    await tasksApi.update(task.id, { is_complete: !task.is_complete });
                    await Promise.all([
                      await queryClient.refetchQueries({ queryKey: ["tasks"] }),
                      await queryClient.refetchQueries({ queryKey: ["task", task.id] }),
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
                title={task.is_complete ? "Mark as incomplete" : "Mark as complete"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </button>
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
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600 p-1"
              title={isExpanded ? "Exit fullscreen" : "Fullscreen"}
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
            {/* Delete button - hidden in readOnly mode */}
            {!readOnly && (
              <button
                onClick={async () => {
                  if (confirm(`Delete task "${task.name}"?`)) {
                    try {
                      await tasksApi.delete(task.id);
                      onClose();
                      await Promise.all([
                        queryClient.refetchQueries({ queryKey: ["tasks"] }),
                        queryClient.refetchQueries({ queryKey: ["task"] }),
                      ]);
                      queryClient.removeQueries({ queryKey: ["task", task.id] });
                    } catch {
                      alert("Failed to delete task");
                    }
                  }
                }}
                className="text-gray-400 hover:text-red-500 p-1"
                title="Delete task"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
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
          {activeTab === "notes" && <LabNotesTab task={task} readOnly={readOnly} />}
          {activeTab === "method" && (
            <MethodTabs 
              task={task} 
              onTaskUpdate={(updatedTask) => setTask(updatedTask)} 
              readOnly={readOnly}
            />
          )}
          {activeTab === "results" && <ResultsTab task={task} readOnly={readOnly} />}
          {activeTab === "purchases" && <PurchaseEditor taskId={task.id} readOnly={readOnly} username={username} />}
        </div>
      </div>
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
  // Initialize with task's sub_tasks immediately
  const [subTasks, setSubTasks] = useState<SubTask[]>(() => task.sub_tasks || []);
  const [newSubTaskText, setNewSubTaskText] = useState("");
  const [saving, setSaving] = useState(false);
  const checkboxRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Sync subTasks state when task prop changes (e.g., after API refresh)
  useEffect(() => {
    setSubTasks(task.sub_tasks || []);
  }, [task.sub_tasks]);

  const handleToggleSubTask = useCallback(async (subTaskId: string, event: React.MouseEvent) => {
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
        await queryClient.refetchQueries({ queryKey: ["task", task.id] }),
      ]);
    } catch {
      alert("Failed to update sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task.id, queryClient, onAnimationTrigger]);

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
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
    } catch {
      alert("Failed to add sub-task");
    } finally {
      setSaving(false);
    }
  }, [newSubTaskText, subTasks, task.id, queryClient]);

  const handleDeleteSubTask = useCallback(async (subTaskId: string) => {
    const updatedSubTasks = subTasks.filter(st => st.id !== subTaskId);
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
    } catch {
      alert("Failed to delete sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task.id, queryClient]);

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
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(task.name);
  const [projectId, setProjectId] = useState(task.project_id);
  const [startDate, setStartDate] = useState(task.start_date);
  const [durationDays, setDurationDays] = useState(task.duration_days);
  const [isComplete, setIsComplete] = useState(task.is_complete);
  const [weekendOverride, setWeekendOverride] = useState<boolean | null>(task.weekend_override);
  const [saving, setSaving] = useState(false);
  const [showShiftConfirm, setShowShiftConfirm] = useState(false);
  const [shiftResult, setShiftResult] = useState<ShiftResult | null>(null);
  const [pendingStartDate, setPendingStartDate] = useState<string | null>(null);
  
  // New dependency fields
  const [newParentTaskId, setNewParentTaskId] = useState<number | null>(null);
  const [newDepType, setNewDepType] = useState<"FS" | "SS" | "SF">("FS");
  
  // Sub-tasks state
  const [subTasks, setSubTasks] = useState<SubTask[]>(task.sub_tasks || []);
  const [newSubTaskText, setNewSubTaskText] = useState("");
  const checkboxRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  
  // Remove from chain state
  const [showRemoveFromChain, setShowRemoveFromChain] = useState(false);
  const [removeStartDate, setRemoveStartDate] = useState(task.start_date);
  
  // Duplicate warning state
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCheckResult | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  
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
        setIsCheckingDuplicate(true);
        try {
          const duplicateCheck = await tasksApi.checkDuplicate(projectId, name.trim(), task.task_type, task.id);
          if (duplicateCheck.has_duplicate) {
            setDuplicateWarning(duplicateCheck);
            setIsCheckingDuplicate(false);
            setSaving(false);
            return;
          }
        } catch (error) {
          console.error("Failed to check for duplicates:", error);
          // Continue with save if check fails
        }
        setIsCheckingDuplicate(false);
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
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
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
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      }
      setEditing(false);
    } catch {
      alert("Failed to update task");
    } finally {
      setSaving(false);
    }
  }, [task.id, task.start_date, task.task_type, task.name, name, projectId, startDate, durationDays, isComplete, weekendOverride, queryClient, dependentTasks.length, parentTasks.length]);

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
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
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
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      }
      setEditing(false);
    } catch {
      alert("Failed to update task");
    } finally {
      setSaving(false);
    }
  }, [task.id, task.start_date, task.task_type, name, projectId, startDate, durationDays, isComplete, weekendOverride, queryClient, dependentTasks.length, parentTasks.length]);

  const handleConfirmShift = useCallback(async () => {
    if (!pendingStartDate) return;
    setSaving(true);
    try {
      await tasksApi.move(task.id, {
        new_start_date: pendingStartDate,
        confirmed: true,
      });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
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
  }, [task.id, pendingStartDate, queryClient]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete task "${task.name}"?`)) return;
    try {
      await tasksApi.delete(task.id);
      // Close popup immediately after successful deletion
      onClose();
      // Invalidate all task-related queries
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task"] });
      queryClient.removeQueries({ queryKey: ["task", task.id] });
    } catch {
      alert("Failed to delete task");
    }
  }, [task.id, task.name, queryClient, onClose]);

  const handleToggleComplete = useCallback(async () => {
    try {
      // If marking as complete, also mark all subtasks as complete
      const updateData: { is_complete: boolean; sub_tasks?: SubTask[] } = { 
        is_complete: !task.is_complete 
      };
      
      if (!task.is_complete && subTasks.length > 0) {
        // Mark all subtasks as complete when marking task as complete
        updateData.sub_tasks = subTasks.map(st => ({ ...st, is_complete: true }));
        setSubTasks(updateData.sub_tasks!);
      }
      
      await tasksApi.update(task.id, updateData);
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
    } catch {
      alert("Failed to update task");
    }
  }, [task.id, task.is_complete, subTasks, queryClient]);

  const handleRemoveDependency = useCallback(async (depId: number) => {
    if (!confirm("Remove this dependency?")) return;
    try {
      await dependenciesApi.delete(depId);
      await queryClient.refetchQueries({ queryKey: ["dependencies"] });
    } catch {
      alert("Failed to remove dependency");
    }
  }, [queryClient]);

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
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      setNewParentTaskId(null);
      setNewDepType("FS");
    } catch {
      alert("Failed to add dependency");
    } finally {
      setSaving(false);
    }
  }, [newParentTaskId, task.id, newDepType, suggestedNewStartDate, queryClient]);

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
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      setShowRemoveFromChain(false);
    } catch (err) {
      console.error("Failed to remove from chain:", err);
      alert("Failed to remove from dependency chain");
    } finally {
      setSaving(false);
    }
  }, [showRemoveFromChain, task.id, removeStartDate, dependencies, queryClient]);

  // Sub-task handlers
  const handleToggleSubTask = useCallback(async (subTaskId: string, event: React.MouseEvent) => {
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
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
    } catch {
      alert("Failed to update sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task.id, queryClient, onAnimationTrigger]);

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
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
    } catch {
      alert("Failed to add sub-task");
    } finally {
      setSaving(false);
    }
  }, [newSubTaskText, subTasks, task.id, queryClient]);

  const handleDeleteSubTask = useCallback(async (subTaskId: string) => {
    const updatedSubTasks = subTasks.filter(st => st.id !== subTaskId);
    setSubTasks(updatedSubTasks);
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: updatedSubTasks });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
    } catch {
      alert("Failed to delete sub-task");
    } finally {
      setSaving(false);
    }
  }, [subTasks, task.id, queryClient]);

  // Handle task type conversion
  const handleConvertTaskType = useCallback(async () => {
    setConverting(true);
    try {
      await tasksApi.convertType(task.id, convertToType);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
        queryClient.refetchQueries({ queryKey: ["task", task.id] }),
      ]);
      setShowConvertModal(false);
    } catch (error) {
      console.error("Failed to convert task type:", error);
      alert("Failed to convert task type");
    } finally {
      setConverting(false);
    }
  }, [task.id, convertToType, queryClient]);

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
            onClick={handleDelete}
            className="px-4 py-2 text-sm text-red-500 rounded-lg hover:bg-red-50"
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
                <select
                  value={newParentTaskId ?? ""}
                  onChange={(e) => setNewParentTaskId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select an experiment this depends on...</option>
                  {availableParentTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.start_date} → {t.end_date})
                    </option>
                  ))}
                </select>
                
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
            <p className="text-sm text-gray-700">{project?.name || "—"}</p>
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

function LabNotesTab({ task, readOnly = false }: { task: Task; readOnly?: boolean }) {
  const [activeSubTab, setActiveSubTab] = useState<ContentSubTab>("markdown");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const notesPath = `results/task-${task.id}/notes.md`;
  const imagesDir = `results/task-${task.id}/Images`;
  const pdfsDir = `results/task-${task.id}/NotesPDFs`;

  // Track if there are unsaved changes
  const hasUnsavedChanges = content !== originalContent && !loading;

  useEffect(() => {
    githubApi
      .readFile(notesPath)
      .then((file) => {
        setContent(file.content);
        setOriginalContent(file.content);
        setLoading(false);
      })
      .catch(() => {
        // File doesn't exist - create new content with stamp
        const projectName = "Unknown Project"; // We don't have project name in this context
        const newContent = createNewFileContent(task.name, projectName, 'notes');
        setContent(newContent);
        setOriginalContent(newContent);
        setLoading(false);
      });
  }, [notesPath, task.name]);

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

  // Handle image upload for LiveMarkdownEditor (from drag-drop, paste, or file picker)
  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const imageName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
          const imagePath = `${imagesDir}/${imageName}`;

          try {
            const response = await githubApi.uploadImage(
              imagePath,
              base64,
              `Upload image for ${task.name}`
            );
            const imageMarkdown = `\n![${file.name}](./Images/${imageName})\n`;
            setContent((prev) => prev + imageMarkdown);
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
          } catch {
            alert(`Failed to upload ${file.name}`);
          }
        };
        reader.readAsDataURL(file);
      }
      setUploading(false);
    },
    [imagesDir, task.name]
  );

  // Handle file upload (saves to attachments folder, does NOT embed in markdown)
  const handleFileUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
          const filePath = `${pdfsDir}/${fileName}`;

          try {
            const response = await githubApi.uploadImage(
              filePath,
              base64,
              `Upload attachment for ${task.name}: ${file.name}`
            );
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
          } catch {
            alert(`Failed to upload ${file.name}`);
          }
        };
        reader.readAsDataURL(file);
      }
      setUploading(false);
    },
    [pdfsDir, task.name]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await githubApi.writeFile(
        notesPath,
        content,
        `Update lab notes for: ${task.name}`
      );
      setOriginalContent(content); // Update original content after successful save
    } catch {
      alert("Failed to save notes");
    } finally {
      setSaving(false);
    }
  }, [content, notesPath, task.name]);

  return (
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
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-6 text-sm text-gray-400 animate-pulse">Loading...</p>
            ) : (
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
                placeholder="Click to start writing lab notes..."
                onImageDrop={handleImageUpload}
                imageBasePath={`results/task-${task.id}`}
                showToolbar={true}
              />
            )}
          </div>
        </>
      ) : (
        <PdfAttachmentsPanel task={task} pdfsDir={pdfsDir} label="Lab Notes" />
      )}
    </div>
  );
}

// ── Method Tab ───────────────────────────────────────────────────────────────

// Helper function to extract PCR protocol ID from github_path
function extractPCRProtocolId(githubPath: string): number | null {
  const match = githubPath.match(/^pcr:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// Gradient Visualizer Component for PCR (same as in pcr/page.tsx)
function PCRGradientVisualizer({ gradient }: { gradient: PCRGradient }) {
  const maxTemp = 100;
  const minTemp = 0;
  const tempRange = maxTemp - minTemp;
  const barWidth = 70;
  const height = 220;
  
  let totalSteps = gradient.initial.length;
  for (const cycle of gradient.cycles) {
    totalSteps += cycle.steps.length;
  }
  totalSteps += gradient.final.length;
  if (gradient.hold) totalSteps += 1;
  
  const width = totalSteps * barWidth + 60;

  const renderStep = (step: { name: string; temperature: number; duration: string }, x: number, inCycle: boolean = false) => {
    const y = 20 + ((maxTemp - step.temperature) / tempRange) * (height - 50);
    const barH = Math.max(10, (step.temperature / tempRange) * (height - 50));

    return (
      <g key={x}>
        <rect
          x={x}
          y={y}
          width={barWidth - 10}
          height={barH}
          fill={getTemperatureColor(step.temperature)}
          rx="4"
          opacity={inCycle ? 1 : 0.8}
          stroke={inCycle ? "#8b5cf6" : "none"}
          strokeWidth={inCycle ? 2 : 0}
        />
        <text
          x={x + (barWidth - 10) / 2}
          y={y - 5}
          textAnchor="middle"
          className="text-[10px] fill-gray-700 font-medium"
        >
          {step.temperature}°C
        </text>
        <text
          x={x + (barWidth - 10) / 2}
          y={y + barH + 12}
          textAnchor="middle"
          className="text-[9px] fill-gray-500"
        >
          {step.duration}
        </text>
        <text
          x={x + (barWidth - 10) / 2}
          y={y + barH + 24}
          textAnchor="middle"
          className="text-[8px] fill-gray-400"
        >
          {step.name.length > 10 ? step.name.substring(0, 10) + "..." : step.name}
        </text>
      </g>
    );
  };

  let currentX = 40;

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className={`min-w-[${width}px] h-auto`}>
        {/* Y-axis */}
        <line x1="30" y1="20" x2="30" y2={height - 20} stroke="#e5e7eb" strokeWidth="1" />
        <text x="5" y="25" className="text-[10px] fill-gray-500">{maxTemp}°C</text>
        <text x="5" y={height - 15} className="text-[10px] fill-gray-500">{minTemp}°C</text>

        {/* Initial steps */}
        {gradient.initial.map((step) => {
          const elem = renderStep(step, currentX);
          currentX += barWidth;
          return elem;
        })}

        {/* Cycle steps with bracket */}
        {gradient.cycles.map((cycle, cycleIndex) => (
          <g key={cycleIndex}>
            {/* Bracket for cycle */}
            <rect
              x={currentX - 5}
              y={10}
              width={cycle.steps.length * barWidth + 10}
              height={height - 30}
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="2"
              strokeDasharray="4 2"
              rx="8"
            />
            <text
              x={currentX + (cycle.steps.length * barWidth) / 2 - 5}
              y={height - 5}
              textAnchor="middle"
              className="text-[11px] fill-purple-600 font-bold"
            >
              x{cycle.repeats}
            </text>
            
            {cycle.steps.map((step) => {
              const elem = renderStep(step, currentX, true);
              currentX += barWidth;
              return elem;
            })}
          </g>
        ))}

        {/* Final steps */}
        {gradient.final.map((step) => {
          const elem = renderStep(step, currentX);
          currentX += barWidth;
          return elem;
        })}

        {/* Hold */}
        {gradient.hold && renderStep(gradient.hold, currentX)}
      </svg>
    </div>
  );
}

// Gradient Table Component for PCR (same as in pcr/page.tsx)
function PCRGradientTable({ gradient }: { gradient: PCRGradient }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Step</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Temperature</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Duration</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {/* Initial steps */}
          {gradient.initial.map((step, i) => (
            <tr key={`initial-${i}`}>
              <td className="px-3 py-2 text-gray-900">{step.name}</td>
              <td className="px-3 py-2 text-gray-600">{step.temperature}°C</td>
              <td className="px-3 py-2 text-gray-600">{step.duration}</td>
              <td className="px-3 py-2 text-gray-400">-</td>
            </tr>
          ))}
          
          {/* Cycle steps */}
          {gradient.cycles.map((cycle, cycleIndex) => (
            <React.Fragment key={cycleIndex}>
              <tr className="bg-purple-50">
                <td colSpan={4} className="px-3 py-1 text-xs font-medium text-purple-700">
                  Cycle {cycleIndex + 1} (repeat {cycle.repeats}x)
                </td>
              </tr>
              {cycle.steps.map((step, i) => (
                <tr key={`cycle-${cycleIndex}-${i}`} className="bg-purple-50/50">
                  <td className="px-3 py-2 text-gray-900 pl-6">{step.name}</td>
                  <td className="px-3 py-2 text-gray-600">{step.temperature}°C</td>
                  <td className="px-3 py-2 text-gray-600">{step.duration}</td>
                  <td className="px-3 py-2 text-purple-500 text-xs">in cycle</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          
          {/* Final steps */}
          {gradient.final.map((step, i) => (
            <tr key={`final-${i}`}>
              <td className="px-3 py-2 text-gray-900">{step.name}</td>
              <td className="px-3 py-2 text-gray-600">{step.temperature}°C</td>
              <td className="px-3 py-2 text-gray-600">{step.duration}</td>
              <td className="px-3 py-2 text-gray-400">-</td>
            </tr>
          ))}
          
          {/* Hold */}
          {gradient.hold && (
            <tr>
              <td className="px-3 py-2 text-gray-900">{gradient.hold.name}</td>
              <td className="px-3 py-2 text-gray-600">{gradient.hold.temperature}°C</td>
              <td className="px-3 py-2 text-gray-600">{gradient.hold.duration}</td>
              <td className="px-3 py-2 text-gray-400">-</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Recipe Table Component for PCR
function PCRRecipeTable({
  ingredients,
  onChange,
  editable,
}: {
  ingredients: PCRIngredient[];
  onChange?: (ingredients: PCRIngredient[]) => void;
  editable: boolean;
}) {
  const handleChange = (id: string, field: keyof PCRIngredient, value: string | boolean) => {
    if (!onChange) return;
    onChange(
      ingredients.map((ing) =>
        ing.id === id ? { ...ing, [field]: value } : ing
      )
    );
  };

  const toggleChecked = (id: string) => {
    if (!onChange) return;
    onChange(
      ingredients.map((ing) =>
        ing.id === id ? { ...ing, checked: !ing.checked } : ing
      )
    );
  };

  const addRow = () => {
    if (!onChange) return;
    const newId = String(Date.now());
    onChange([
      ...ingredients.slice(0, -1),
      { id: newId, name: "", concentration: "", amount_per_reaction: "", checked: false },
      ingredients[ingredients.length - 1],
    ]);
  };

  const removeRow = (id: string) => {
    if (!onChange) return;
    if (ingredients[ingredients.length - 1].id === id) return;
    onChange(ingredients.filter((ing) => ing.id !== id));
  };

  // Count checked items (excluding Total row)
  const checkedCount = ingredients.filter(ing => ing.name !== "Total" && ing.checked).length;
  const totalCount = ingredients.filter(ing => ing.name !== "Total").length;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Progress indicator */}
      {totalCount > 0 && (
        <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${(checkedCount / totalCount) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 flex-shrink-0">
            {checkedCount}/{totalCount} checked
          </span>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-2 py-2 w-10 text-center text-xs font-medium text-gray-500" title="Check off ingredients as you add them">✓</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Ingredient</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Concentration</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Amount (uL)</th>
            {editable && <th className="px-3 py-2 w-10"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ingredients.map((ing) => (
            <tr 
              key={ing.id} 
              className={`${ing.name === "Total" ? "bg-gray-50 font-medium" : ""} ${ing.checked && ing.name !== "Total" ? "bg-green-50" : ""} transition-colors`}
            >
              <td className="px-2 py-2 text-center">
                {ing.name !== "Total" && (
                  <button
                    onClick={() => toggleChecked(ing.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                      ing.checked 
                        ? "bg-green-500 border-green-500 text-white" 
                        : "border-gray-300 hover:border-green-400 hover:bg-green-50"
                    }`}
                    title={ing.checked ? "Mark as not added" : "Mark as added"}
                  >
                    {ing.checked && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )}
              </td>
              <td className="px-3 py-2">
                {editable && ing.name !== "Total" ? (
                  <input
                    type="text"
                    value={ing.name}
                    onChange={(e) => handleChange(ing.id, "name", e.target.value)}
                    className={`w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${ing.checked ? "line-through text-gray-400" : ""}`}
                  />
                ) : (
                  <span className={`text-gray-900 ${ing.checked ? "line-through text-gray-400" : ""}`}>{ing.name}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {editable && ing.name !== "Total" ? (
                  <input
                    type="text"
                    value={ing.concentration}
                    onChange={(e) => handleChange(ing.id, "concentration", e.target.value)}
                    className={`w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${ing.checked ? "line-through text-gray-400" : ""}`}
                    placeholder="e.g. 10x"
                  />
                ) : (
                  <span className={`text-gray-600 ${ing.checked ? "line-through text-gray-400" : ""}`}>{ing.concentration || "-"}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {editable ? (
                  <input
                    type="text"
                    value={ing.amount_per_reaction}
                    onChange={(e) => handleChange(ing.id, "amount_per_reaction", e.target.value)}
                    className={`w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${ing.checked ? "line-through text-gray-400" : ""}`}
                    placeholder="e.g. 2.5"
                  />
                ) : (
                  <span className={`text-gray-600 ${ing.checked ? "line-through text-gray-400" : ""}`}>{ing.amount_per_reaction || "-"}</span>
                )}
              </td>
              {editable && ing.name !== "Total" && (
                <td className="px-3 py-2">
                  <button
                    onClick={() => removeRow(ing.id)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    x
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button
          onClick={addRow}
          className="w-full py-2 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-200"
        >
          + Add Row
        </button>
      )}
    </div>
  );
}

function MethodTab({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [methodContent, setMethodContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDeviationChoice, setShowDeviationChoice] = useState(false);
  const [forkName, setForkName] = useState("");
  const [showMethodSelector, setShowMethodSelector] = useState(false);
  const [variationNote, setVariationNote] = useState("");
  const [showVariationInput, setShowVariationInput] = useState(false);

  // PCR-specific state
  const [pcrProtocol, setPcrProtocol] = useState<PCRProtocol | null>(null);
  const [pcrGradient, setPcrGradient] = useState<PCRGradient | null>(null);
  const [pcrIngredients, setPcrIngredients] = useState<PCRIngredient[]>([]);
  const [originalPcrGradient, setOriginalPcrGradient] = useState<PCRGradient | null>(null);
  const [originalPcrIngredients, setOriginalPcrIngredients] = useState<PCRIngredient[]>([]);
  const [hasExperimentSpecificPcr, setHasExperimentSpecificPcr] = useState(false);

  // Load all available methods
  const { data: allMethods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: methodsApi.list,
  });

  const { data: method } = useQuery({
    queryKey: ["method", task.method_id],
    queryFn: () => methodsApi.get(task.method_id!),
    enabled: !!task.method_id,
  });

  // Check if this is a PCR method
  const isPcrMethod = method?.method_type === "pcr" || (method?.github_path?.startsWith("pcr://") ?? false);
  const pcrProtocolId = method?.github_path ? extractPCRProtocolId(method.github_path) : null;

  // Load PCR protocol data if this is a PCR method
  const { data: fetchedPcrProtocol } = useQuery({
    queryKey: ["pcr-protocol", pcrProtocolId],
    queryFn: () => pcrApi.get(pcrProtocolId!),
    enabled: isPcrMethod && pcrProtocolId !== null,
  });

  // Initialize PCR state - prefer task's experiment-specific copy over protocol data
  useEffect(() => {
    if (!isPcrMethod) return;
    
    // First, check if task has experiment-specific PCR data
    if (task.pcr_gradient && task.pcr_ingredients) {
      try {
        const taskGradient = JSON.parse(task.pcr_gradient) as PCRGradient;
        const taskIngredients = JSON.parse(task.pcr_ingredients) as PCRIngredient[];
        
        setPcrGradient(taskGradient);
        setPcrIngredients(taskIngredients);
        setHasExperimentSpecificPcr(true);
        
        // Still fetch protocol for metadata (name, notes) and to know original values
        if (fetchedPcrProtocol) {
          setPcrProtocol(fetchedPcrProtocol);
          setOriginalPcrGradient(fetchedPcrProtocol.gradient);
          setOriginalPcrIngredients(fetchedPcrProtocol.ingredients);
        }
        setLoading(false);
        return;
      } catch (e) {
        console.error("Failed to parse task PCR data:", e);
      }
    }
    
    // Fall back to protocol data if no task-specific data or parse failed
    if (fetchedPcrProtocol) {
      setPcrProtocol(fetchedPcrProtocol);
      setPcrGradient(fetchedPcrProtocol.gradient);
      setPcrIngredients(fetchedPcrProtocol.ingredients);
      setOriginalPcrGradient(fetchedPcrProtocol.gradient);
      setOriginalPcrIngredients(fetchedPcrProtocol.ingredients);
      setHasExperimentSpecificPcr(false);
      setLoading(false);
    }
  }, [fetchedPcrProtocol, isPcrMethod, task.pcr_gradient, task.pcr_ingredients]);

  // Load method content from GitHub for non-PCR methods
  useEffect(() => {
    if (!method?.github_path) {
      setLoading(false);
      return;
    }
    
    // Skip GitHub loading for PCR methods
    if (isPcrMethod) {
      return;
    }
    
    githubApi
      .readFile(method.github_path)
      .then((file) => {
        setMethodContent(file.content);
        setOriginalContent(file.content);
        setLoading(false);
      })
      .catch(() => {
        setMethodContent("*Method file not found.*");
        setOriginalContent("");
        setLoading(false);
      });
  }, [method?.github_path, isPcrMethod]);

  // Check if PCR data has changes
  const pcrHasChanges = useMemo(() => {
    if (!isPcrMethod || !pcrGradient || !originalPcrGradient) return false;
    return JSON.stringify(pcrGradient) !== JSON.stringify(originalPcrGradient) ||
           JSON.stringify(pcrIngredients) !== JSON.stringify(originalPcrIngredients);
  }, [isPcrMethod, pcrGradient, originalPcrGradient, pcrIngredients, originalPcrIngredients]);

  const hasChanges = isPcrMethod ? pcrHasChanges : (methodContent !== originalContent && originalContent !== "");

  // Handle linking a new method
  const handleLinkMethod = useCallback(async (methodId: number) => {
    setSaving(true);
    try {
      await tasksApi.update(task.id, { method_id: methodId });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      setShowMethodSelector(false);
      setLoading(true); // Trigger reload of method content
    } catch {
      alert("Failed to link method");
    } finally {
      setSaving(false);
    }
  }, [task.id, queryClient]);

  // Handle unlinking method
  const handleUnlinkMethod = useCallback(async () => {
    if (!confirm("Remove linked method from this experiment?")) return;
    setSaving(true);
    try {
      await tasksApi.update(task.id, { method_id: null });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      setMethodContent("");
      setOriginalContent("");
      setPcrProtocol(null);
      setPcrGradient(null);
      setPcrIngredients([]);
    } catch {
      alert("Failed to unlink method");
    } finally {
      setSaving(false);
    }
  }, [task.id, queryClient]);

  // Handle saving variation note
  const handleSaveVariation = useCallback(async () => {
    if (!variationNote.trim()) return;
    setSaving(true);
    try {
      const existingDeviations = task.deviation_log || "";
      const timestamp = new Date().toLocaleDateString();
      const newDeviation = `### Variation (${timestamp})\n\n${variationNote.trim()}\n\n---\n\n`;
      await tasksApi.update(task.id, { 
        deviation_log: newDeviation + existingDeviations 
      });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      setVariationNote("");
      setShowVariationInput(false);
    } catch {
      alert("Failed to save variation");
    } finally {
      setSaving(false);
    }
  }, [task.id, task.deviation_log, variationNote, queryClient]);

  const handleSaveToNotes = useCallback(async () => {
    setSaving(true);
    try {
      const deviations = `## Method Deviations\n\n${methodContent}`;
      await methodsApi.saveDeviation({ task_id: task.id, deviations });
      setMethodContent(originalContent);
      setShowDeviationChoice(false);
      setEditing(false);
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to save deviations");
    } finally {
      setSaving(false);
    }
  }, [methodContent, originalContent, task.id, queryClient]);

  // Save PCR protocol changes to the task's experiment-specific copy (NOT to the base protocol)
  const handleSavePcrChanges = useCallback(async () => {
    if (!pcrGradient || !pcrIngredients) return;
    setSaving(true);
    try {
      // Save the gradient and ingredients to the task's own fields
      await tasksApi.update(task.id, { 
        pcr_gradient: JSON.stringify(pcrGradient),
        pcr_ingredients: JSON.stringify(pcrIngredients)
      });
      
      // Update local state to reflect that we now have experiment-specific data
      setHasExperimentSpecificPcr(true);
      
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
    } catch {
      alert("Failed to save PCR modifications");
    } finally {
      setSaving(false);
    }
  }, [pcrGradient, pcrIngredients, task.id, queryClient]);

  // Reset PCR data to match the original method
  const handleResetPcr = useCallback(async () => {
    if (!confirm("Reset PCR data to match the original method? Your experiment-specific changes will be lost.")) return;
    setSaving(true);
    try {
      const updatedTask = await tasksApi.resetPcr(task.id);
      
      // Update local state with the reset values
      if (updatedTask.pcr_gradient && updatedTask.pcr_ingredients) {
        setPcrGradient(JSON.parse(updatedTask.pcr_gradient));
        setPcrIngredients(JSON.parse(updatedTask.pcr_ingredients));
      }
      setHasExperimentSpecificPcr(false);
      
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
    } catch {
      alert("Failed to reset PCR data");
    } finally {
      setSaving(false);
    }
  }, [task.id, queryClient]);

  const handleForkMethod = useCallback(async () => {
    if (!forkName.trim() || !method) return;
    setSaving(true);
    try {
      const newMethod = await methodsApi.fork(method.id, {
        new_name: forkName.trim(),
        new_github_path: `methods/${forkName.trim().replace(/\s+/g, "-").toLowerCase()}.md`,
        deviations: "Forked with modifications",
      });
      if (newMethod.github_path) {
        await githubApi.writeFile(
          newMethod.github_path,
          methodContent,
          `Fork method: ${forkName} from ${method.name}`
        );
      }
      await tasksApi.update(task.id, { method_id: newMethod.id });
      setShowDeviationChoice(false);
      setEditing(false);
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to fork method");
    } finally {
      setSaving(false);
    }
  }, [forkName, method, methodContent, task.id, queryClient]);

  // No method linked - show method selector
  if (!task.method_id || showMethodSelector) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-50">
          <span className="text-sm font-medium text-gray-700">
            {task.method_id ? "Change Linked Method" : "Link a Method"}
          </span>
          {task.method_id && (
            <button
              onClick={() => setShowMethodSelector(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-sm text-gray-500 mb-4">
            Select a method from the library to link to this experiment:
          </p>
          <div className="space-y-2">
            {allMethods.length === 0 ? (
              <p className="text-sm text-gray-400">No methods available. Create some in the Methods section first.</p>
            ) : (
              allMethods.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleLinkMethod(m.id)}
                  disabled={saving}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    m.id === task.method_id
                      ? "border-green-300 bg-green-50"
                      : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{m.name}</span>
                      {m.method_type === "pcr" && (
                        <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded">PCR</span>
                      )}
                    </div>
                    {m.id === task.method_id && (
                      <span className="text-xs text-green-600">✓ Current</span>
                    )}
                  </div>
                  {m.tags && m.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {m.tags.map((tag) => (
                        <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // PCR Method rendering - always show editable view
  if (isPcrMethod) {
    // Check if current data differs from original (for showing reset button)
    const hasModifiedFromOriginal = hasExperimentSpecificPcr || 
      (pcrGradient && originalPcrGradient && JSON.stringify(pcrGradient) !== JSON.stringify(originalPcrGradient)) ||
      (pcrIngredients && originalPcrIngredients && JSON.stringify(pcrIngredients) !== JSON.stringify(originalPcrIngredients));
    
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50 bg-gray-50">
          <span className="text-sm font-medium text-gray-700">{pcrProtocol?.name || method?.name || "..."}</span>
          <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded">PCR</span>
          {hasExperimentSpecificPcr && (
            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded" title="This experiment has its own copy of the PCR data">
              Experiment Copy
            </span>
          )}
          <div className="flex-1" />
          
          {/* Reset to Method button - show if experiment has its own copy */}
          {hasModifiedFromOriginal && (
            <button
              onClick={handleResetPcr}
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              title="Reset to original method values"
            >
              Reset to Method
            </button>
          )}
          
          {/* Quick variation button */}
          <button
            onClick={() => setShowVariationInput(!showVariationInput)}
            className="px-3 py-1.5 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200"
          >
            Add Variation
          </button>
          
          {/* Change method button */}
          <button
            onClick={() => setShowMethodSelector(true)}
            className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100"
          >
            Change
          </button>
          
          {/* Save button - show when there are unsaved changes */}
          {pcrGradient && pcrIngredients && (
            <button
              onClick={handleSavePcrChanges}
              disabled={saving}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          )}
        </div>

        {/* Variation input panel */}
        {showVariationInput && (
          <div className="px-6 py-4 bg-amber-50 border-b border-amber-200">
            <p className="text-sm font-medium text-amber-800 mb-2">
              Note a variation from the standard protocol:
            </p>
            <textarea
              value={variationNote}
              onChange={(e) => setVariationNote(e.target.value)}
              placeholder="e.g., Used 1.5x concentration of reagent A due to availability..."
              className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
              rows={3}
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  setShowVariationInput(false);
                  setVariationNote("");
                }}
                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveVariation}
                disabled={saving || !variationNote.trim()}
                className="px-3 py-1.5 text-xs text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Variation"}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <p className="text-sm text-gray-400 animate-pulse">Loading PCR protocol...</p>
          ) : (
            <>
              {/* Gradient Visualization - always editable */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">
                  Thermal Gradient
                </label>
                {pcrGradient ? (
                  <InteractiveGradientEditor 
                    gradient={pcrGradient} 
                    onChange={setPcrGradient} 
                  />
                ) : (
                  <p className="text-sm text-gray-400">No gradient data available</p>
                )}
              </div>

              {/* Recipe Table - always editable */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">
                  Reaction Recipe
                </label>
                <PCRRecipeTable
                  ingredients={pcrIngredients}
                  onChange={setPcrIngredients}
                  editable={true}
                />
              </div>

              {/* Notes */}
              {pcrProtocol?.notes && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">
                    {pcrProtocol.notes}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // Standard Markdown Method rendering
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50 bg-gray-50">
        <span className="text-sm font-medium text-gray-700">{method?.name || "..."}</span>
        <div className="flex-1" />
        
        {/* Quick variation button */}
        <button
          onClick={() => setShowVariationInput(!showVariationInput)}
          className="px-3 py-1.5 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200"
        >
          Add Variation
        </button>
        
        {/* Change method button */}
        <button
          onClick={() => setShowMethodSelector(true)}
          className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100"
        >
          Change
        </button>
        
        {/* Edit method button */}
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100"
          >
            Edit
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                setMethodContent(originalContent);
                setEditing(false);
              }}
              className="px-3 py-1.5 text-xs text-gray-600 rounded-lg hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={() => hasChanges && setShowDeviationChoice(true)}
              disabled={!hasChanges}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              Save Changes
            </button>
          </>
        )}
      </div>

      {/* Variation input panel */}
      {showVariationInput && (
        <div className="px-6 py-4 bg-amber-50 border-b border-amber-200">
          <p className="text-sm font-medium text-amber-800 mb-2">
            Note a variation from the standard protocol:
          </p>
          <textarea
            value={variationNote}
            onChange={(e) => setVariationNote(e.target.value)}
            placeholder="e.g., Used 1.5x concentration of reagent A due to availability..."
            className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
            rows={3}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => {
                setShowVariationInput(false);
                setVariationNote("");
              }}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveVariation}
              disabled={saving || !variationNote.trim()}
              className="px-3 py-1.5 text-xs text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Variation"}
            </button>
          </div>
        </div>
      )}

      {showDeviationChoice && (
        <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 space-y-2">
          <p className="text-sm font-medium text-amber-800">
            How would you like to save your changes?
          </p>
          <button
            onClick={handleSaveToNotes}
            disabled={saving}
            className="w-full text-left px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <p className="text-sm font-medium text-gray-900">
              Save to this experiment&apos;s notes only
            </p>
            <p className="text-xs text-gray-400">Original method unchanged</p>
          </button>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm font-medium text-gray-900 mb-2">
              Save as new method
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={forkName}
                onChange={(e) => setForkName(e.target.value)}
                placeholder={`${method?.name} v2`}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
              <button
                onClick={handleForkMethod}
                disabled={saving || !forkName.trim()}
                className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                Fork
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowDeviationChoice(false)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-sm text-gray-400 animate-pulse">Loading...</p>
        ) : editing ? (
          <textarea
            value={methodContent}
            onChange={(e) => setMethodContent(e.target.value)}
            className="w-full h-full min-h-[400px] p-6 text-sm font-mono text-gray-700 resize-none focus:outline-none"
          />
        ) : (
          <div className="p-6 prose prose-sm prose-gray max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {methodContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Results Tab ──────────────────────────────────────────────────────────────

function ResultsTab({ task, readOnly = false }: { task: Task; readOnly?: boolean }) {
  const [activeSubTab, setActiveSubTab] = useState<ContentSubTab>("markdown");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resultsPath = `results/task-${task.id}/results.md`;
  const imagesDir = `results/task-${task.id}/Images`;
  const pdfsDir = `results/task-${task.id}/ResultsPDFs`;

  // Track if there are unsaved changes
  const hasUnsavedChanges = content !== originalContent && !loading;

  useEffect(() => {
    githubApi
      .readFile(resultsPath)
      .then((file) => {
        setContent(file.content);
        setOriginalContent(file.content);
        setLoading(false);
      })
      .catch(() => {
        // File doesn't exist - create new content with stamp
        const projectName = "Unknown Project"; // We don't have project name in this context
        const newContent = createNewFileContent(task.name, projectName, 'results');
        setContent(newContent);
        setOriginalContent(newContent);
        setLoading(false);
      });
  }, [resultsPath, task.name]);

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

  // Handle image upload for LiveMarkdownEditor (from drag-drop, paste, or file picker)
  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const imageName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
          const imagePath = `${imagesDir}/${imageName}`;
          try {
            const response = await githubApi.uploadImage(imagePath, base64, `Upload for ${task.name}`);
            setContent((prev) => prev + `\n![${file.name}](./Images/${imageName})\n`);
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
          } catch {
            alert(`Failed to upload ${file.name}`);
          }
        };
        reader.readAsDataURL(file);
      }
      setUploading(false);
    },
    [imagesDir, task.name]
  );

  // Handle file upload (saves to attachments folder, does NOT embed in markdown)
  const handleFileUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadWarning(null);
      
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
          const filePath = `${pdfsDir}/${fileName}`;

          try {
            const response = await githubApi.uploadImage(
              filePath,
              base64,
              `Upload attachment for ${task.name}: ${file.name}`
            );
            
            // Show warning if file is too large for GitHub
            if (response.warning) {
              setUploadWarning(response.warning);
            }
          } catch {
            alert(`Failed to upload ${file.name}`);
          }
        };
        reader.readAsDataURL(file);
      }
      setUploading(false);
    },
    [pdfsDir, task.name]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await githubApi.writeFile(resultsPath, content, `Update results: ${task.name}`);
      setOriginalContent(content); // Update original content after successful save
    } catch {
      alert("Failed to save results");
    } finally {
      setSaving(false);
    }
  }, [content, resultsPath, task.name]);

  return (
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
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-6 text-sm text-gray-400 animate-pulse">Loading...</p>
            ) : (
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
                placeholder="Click to start writing results..."
                onImageDrop={handleImageUpload}
                imageBasePath={`results/task-${task.id}`}
                showToolbar={true}
              />
            )}
          </div>
        </>
      ) : (
        <PdfAttachmentsPanel task={task} pdfsDir={pdfsDir} label="Results" />
      )}
    </div>
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

function PdfAttachmentsPanel({ task, pdfsDir, label }: { task: Task; pdfsDir: string; label: string }) {
  const [files, setFiles] = useState<PdfAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeFile, setActiveFile] = useState<PdfAttachment | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load files from directory
  useEffect(() => {
    loadFiles();
  }, [pdfsDir]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const dirFiles = await githubApi.listDirectory(pdfsDir);
      
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
          
          await githubApi.uploadImage(
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
        const fileData = await githubApi.readFile(file.path);
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
      const fileData = await githubApi.readFile(file.path);
      
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
      // GitHub API doesn't have a delete method, so we'll use the image delete approach
      // For now, just remove from the list (actual deletion would need backend support)
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
      
      // Fetch lab notes
      let labNotes: string | null = null;
      try {
        const notesFile = await githubApi.readFile(`results/task-${task.id}/notes.md`);
        labNotes = notesFile.content;
      } catch {
        // Notes don't exist
      }

      // Fetch method
      let method: Method | null = null;
      let methodContent: string | null = null;
      if (task.method_id) {
        try {
          method = await methodsApi.get(task.method_id);
          if (method.github_path) {
            const methodFile = await githubApi.readFile(method.github_path);
            methodContent = methodFile.content;
          }
        } catch {
          // Method doesn't exist
        }
      }

      // Fetch results
      let results: string | null = null;
      try {
        const resultsFile = await githubApi.readFile(`results/task-${task.id}/results.md`);
        results = resultsFile.content;
      } catch {
        // Results don't exist
      }

      // Get PDF attachments
      const pdfAttachments: string[] = [];
      try {
        const notesPdfs = await githubApi.listDirectory(`results/task-${task.id}/NotesPDFs`);
        pdfAttachments.push(...notesPdfs.map((f: GitHubTreeItem) => f.path));
      } catch {
        // Directory doesn't exist
      }
      try {
        const resultsPdfs = await githubApi.listDirectory(`results/task-${task.id}/ResultsPDFs`);
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
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={exporting}
        className="text-gray-400 hover:text-gray-600 p-1 disabled:opacity-50"
        title="Export experiment"
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
