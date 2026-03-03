"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { tasksApi, methodsApi, githubApi, dependenciesApi, type DuplicateCheckResult } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Method, Project, Task, Dependency, SubTask } from "@/lib/types";
import { createNewFileContent } from "@/lib/stamp-utils";

interface TaskModalProps {
  projects: Project[];
}

type SchedulingMode = "date" | "dependency";

export default function TaskModal({ projects }: TaskModalProps) {
  const isCreatingTask = useAppStore((s) => s.isCreatingTask);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const newTaskStartDate = useAppStore((s) => s.newTaskStartDate);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const restrictedTaskType = useAppStore((s) => s.restrictedTaskType);
  const setRestrictedTaskType = useAppStore((s) => s.setRestrictedTaskType);
  const queryClient = useQueryClient();

  // Filter to only active (non-archived) projects, ensuring Miscellaneous is included
  const activeProjects = useMemo(() => {
    let filtered = projects.filter((p) => !p.is_archived);
    // Check if Miscellaneous project exists
    const hasMiscProject = filtered.some(p => p.name === "Miscellaneous");
    if (!hasMiscProject) {
      // Add a placeholder for the Miscellaneous project (will be created on backend)
      filtered = [...filtered, {
        id: 0,
        name: "Miscellaneous",
        color: "#6b7280",
        is_archived: false,
        weekend_active: false,
        tags: ["default"],
        created_at: new Date().toISOString(),
        sort_order: -1,
        archived_at: null
      }];
    }
    // Sort projects with Miscellaneous first, then by sort order
    return filtered.sort((a, b) => {
      if (a.name === "Miscellaneous") return -1;
      if (b.name === "Miscellaneous") return 1;
      return a.sort_order - b.sort_order;
    });
  }, [projects]);

  // Basic fields
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<number>(activeProjects[0]?.id || 0);
  const [startDate, setStartDate] = useState(
    newTaskStartDate || new Date().toISOString().split("T")[0]
  );
  const [durationDays, setDurationDays] = useState(1);
  const [isHighLevel, setIsHighLevel] = useState(false);
  const [taskType, setTaskType] = useState<"experiment" | "purchase" | "list">("list");

  // Scheduling mode
  const [schedulingMode, setSchedulingMode] = useState<SchedulingMode>("date");
  const [parentTaskId, setParentTaskId] = useState<number | null>(null);
  const [depType, setDepType] = useState<"FS" | "SS" | "SF">("FS");

  // Experiment-specific fields
  const [methodId, setMethodId] = useState<number | null>(null);

  // Sub-tasks for list type
  const [subTasks, setSubTasks] = useState<SubTask[]>([]);
  const [newSubTaskText, setNewSubTaskText] = useState("");

  // Duplicate warning state
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCheckResult | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  // Load methods for the dropdown
  const { data: methods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: methodsApi.list,
    enabled: isCreatingTask && taskType === "experiment",
  });

  // Load all tasks for dependency selection
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const results = await Promise.all(
        projects.map((p) => tasksApi.listByProject(p.id))
      );
      return results.flat();
    },
    enabled: isCreatingTask && projects.length > 0,
  });

  // Load existing dependencies for reference
  const { data: existingDependencies = [] } = useQuery({
    queryKey: ["dependencies"],
    queryFn: () => dependenciesApi.list(),
    enabled: isCreatingTask,
  });

  // Filter tasks to show as potential parents (exclude tasks from different projects if needed)
  // Also exclude tasks from archived projects
  const availableParentTasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (t.project_id !== projectId) return false;
      const project = projects.find((p) => p.id === t.project_id);
      return project && !project.is_archived;
    });
  }, [allTasks, projectId, projects]);

  // Get the selected parent task info
  const selectedParentTask = useMemo(() => {
    return availableParentTasks.find((t) => t.id === parentTaskId) || null;
  }, [availableParentTasks, parentTaskId]);

  // Calculate suggested start date based on dependency type
  const suggestedStartDate = useMemo(() => {
    if (!selectedParentTask) return startDate;
    
    const parentEnd = new Date(selectedParentTask.end_date);
    const parentStart = new Date(selectedParentTask.start_date);
    
    if (depType === "FS") {
      // Finish-to-Start: start after parent ends
      parentEnd.setDate(parentEnd.getDate() + 1);
      return parentEnd.toISOString().split("T")[0];
    } else if (depType === "SS") {
      // Start-to-Start: start at same time as parent
      return selectedParentTask.start_date;
    } else if (depType === "SF") {
      // Start-to-Finish: start so that this task finishes when parent starts
      // Calculate backwards from parent start
      const duration = durationDays;
      const newStart = new Date(parentStart);
      newStart.setDate(newStart.getDate() - duration + 1);
      return newStart.toISOString().split("T")[0];
    }
    return startDate;
  }, [selectedParentTask, depType, durationDays, startDate]);

  // Reset form when modal opens
  useEffect(() => {
    if (isCreatingTask) {
      setProjectId(activeProjects[0]?.id || 0);
      // Use the newTaskStartDate if provided (from double-click on Gantt)
      if (newTaskStartDate) {
        setStartDate(newTaskStartDate);
        setSchedulingMode("date"); // Ensure we're in date mode
      } else {
        setStartDate(new Date().toISOString().split("T")[0]);
      }
      // If task type is restricted, set it
      if (restrictedTaskType) {
        setTaskType(restrictedTaskType);
      }
    }
  }, [isCreatingTask, activeProjects, newTaskStartDate, restrictedTaskType]);

  const createTask = useCallback(async () => {
    try {
      // Determine the start date based on scheduling mode
      const finalStartDate = schedulingMode === "dependency" 
        ? suggestedStartDate 
        : startDate;

      const task = await tasksApi.create({
        project_id: projectId === 0 ? null : projectId,
        name: name.trim(),
        start_date: finalStartDate,
        duration_days: durationDays,
        is_high_level: isHighLevel,
        task_type: taskType,
        method_id: taskType === "experiment" ? methodId : null,
        sub_tasks: taskType === "list" && subTasks.length > 0 ? subTasks : undefined,
      });

      // If dependency mode is selected, create the dependency
      if (schedulingMode === "dependency" && parentTaskId) {
        try {
          await dependenciesApi.create({
            parent_id: parentTaskId,
            child_id: task.id,
            dep_type: depType,
          });
        } catch (depError) {
          console.error("Failed to create dependency:", depError);
          // Non-fatal - task was created, dependency failed
        }
      }

      // If experiment, create the lab notes file scaffold
      if (taskType === "experiment") {
        const notesPath = `results/task-${task.id}/notes.md`;
        const projectName = projects.find((p) => p.id === projectId)?.name || "Unknown Project";
        const template = createNewFileContent(name.trim(), projectName, 'notes');
        try {
          await githubApi.writeFile(
            notesPath,
            template,
            `Create lab notes for: ${name.trim()}`
          );
        } catch {
          // Non-fatal - notes file can be created later
        }
      }

      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["dependencies"] });
      setIsCreatingTask(false);
      resetForm();
    } catch (error: unknown) {
      console.error("Failed to create task:", error);
      // Type guard for axios error
      const axiosError = error as { response?: { data?: { detail?: string } } };
      const detail = axiosError?.response?.data?.detail;
      alert(`Failed to create task: ${detail || "Unknown error"}`);
    }
  }, [
    name,
    projectId,
    startDate,
    durationDays,
    isHighLevel,
    taskType,
    methodId,
    methods,
    queryClient,
    setIsCreatingTask,
    schedulingMode,
    parentTaskId,
    depType,
    suggestedStartDate,
    subTasks,
  ]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !projectId) return;

      // Check if project is archived
      const selectedProject = projects.find((p) => p.id === projectId);
      if (selectedProject?.is_archived) {
        alert("Cannot create tasks in an archived project. Please unarchive the project first.");
        return;
      }

      // Check for duplicates before creating
      setIsCheckingDuplicate(true);
      try {
        const duplicateCheck = await tasksApi.checkDuplicate(projectId, name.trim(), taskType);
        if (duplicateCheck.has_duplicate) {
          setDuplicateWarning(duplicateCheck);
          setIsCheckingDuplicate(false);
          return;
        }
      } catch (error) {
        console.error("Failed to check for duplicates:", error);
        // Continue with creation if check fails
      }
      setIsCheckingDuplicate(false);

      await createTask();
    },
    [
      name,
      projectId,
      taskType,
      projects,
      createTask,
    ]
  );

  const resetForm = () => {
    setName("");
    setDurationDays(1);
    setIsHighLevel(false);
    setTaskType("list");
    setMethodId(null);
    setSchedulingMode("date");
    setParentTaskId(null);
    setDepType("FS");
    setNewTaskStartDate(null);
    setRestrictedTaskType(null);
    setDuplicateWarning(null);
    setSubTasks([]);
    setNewSubTaskText("");
  };

  // Sub-task handlers
  const handleAddSubTask = useCallback(() => {
    if (!newSubTaskText.trim()) return;
    
    const newSubTask: SubTask = {
      id: `st-${Date.now()}`,
      text: newSubTaskText.trim(),
      is_complete: false,
    };
    
    setSubTasks([...subTasks, newSubTask]);
    setNewSubTaskText("");
  }, [newSubTaskText, subTasks]);

  const handleDeleteSubTask = useCallback((subTaskId: string) => {
    setSubTasks(subTasks.filter(st => st.id !== subTaskId));
  }, [subTasks]);

  if (!isCreatingTask) return null;

  // If no active projects, show a message
  if (activeProjects.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
        <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Cannot Create Task
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            There are no active projects available. Please create a new project or unarchive an existing one before creating tasks.
          </p>
          <div className="flex justify-end">
            <button
              onClick={() => {
                setIsCreatingTask(false);
                resetForm();
              }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      {/* Duplicate Warning Modal */}
      {duplicateWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-red-600 mb-4">
              Duplicate Task Name Detected
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              A task with the same name already exists in this project with the same task type:
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              {duplicateWarning.matching_tasks.map((task) => (
                <div key={task.id} className="text-sm text-red-700 mb-2">
                  <strong>{task.name}</strong>
                  <span className="text-red-500 ml-2">
                    (Started: {task.start_date}, {task.is_complete ? "Completed" : "In Progress"})
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Would you like to change the name of your new task, or proceed with creating it anyway?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setDuplicateWarning(null);
                  // Focus back on the name input
                }}
                className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Change Name
              </button>
              <button
                onClick={() => {
                  setDuplicateWarning(null);
                  createTask();
                }}
                className="px-4 py-2 text-sm text-red-600 border border-red-300 hover:bg-red-50 rounded-lg transition-colors"
              >
                Create Anyway
              </button>
              <button
                onClick={() => {
                  setIsCreatingTask(false);
                  resetForm();
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          New Task
        </h3>

        <div className="space-y-4">
          {/* Task Type Toggle - only show if not restricted */}
          {!restrictedTaskType && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                Task Type
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTaskType("list")}
                  className={`flex-1 px-3 py-2.5 text-sm rounded-lg border transition-colors ${
                    taskType === "list"
                      ? "bg-blue-50 border-blue-300 text-blue-700 font-medium"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setTaskType("experiment")}
                  className={`flex-1 px-3 py-2.5 text-sm rounded-lg border transition-colors ${
                    taskType === "experiment"
                      ? "bg-purple-50 border-purple-300 text-purple-700 font-medium"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  Experiment
                </button>
                <button
                  type="button"
                  onClick={() => setTaskType("purchase")}
                  className={`flex-1 px-3 py-2.5 text-sm rounded-lg border transition-colors ${
                    taskType === "purchase"
                      ? "bg-amber-50 border-amber-300 text-amber-700 font-medium"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  Purchase
                </button>
              </div>
            </div>
          )}

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
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name === "Miscellaneous" ? "📋 Miscellaneous (standalone tasks)" : p.name}
                </option>
              ))}
            </select>
            {projectId === 0 && (
              <p className="text-xs text-gray-400 mt-1">
                Standalone tasks are perfect for daily lists, quick notes, or small items that don't belong to a specific research project.
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Task Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                taskType === "experiment"
                  ? "e.g. Western Blot - Sample A"
                  : "e.g. Write literature review"
              }
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {/* Sub-tasks for List type */}
          {taskType === "list" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                List Items
              </label>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                {/* Existing sub-tasks */}
                {subTasks.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {subTasks.map((st) => (
                      <div 
                        key={st.id} 
                        className="flex items-center gap-2 group py-1.5 px-2 rounded-lg hover:bg-white transition-colors"
                      >
                        <div className="w-5 h-5 rounded border-2 border-gray-300 flex items-center justify-center flex-shrink-0">
                          {/* Empty checkbox - just visual */}
                        </div>
                        <span className="flex-1 text-sm text-gray-700">{st.text}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteSubTask(st.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-xs transition-opacity"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Add new sub-task */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubTaskText}
                    onChange={(e) => setNewSubTaskText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSubTask())}
                    placeholder="Add a list item..."
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={handleAddSubTask}
                    disabled={!newSubTaskText.trim()}
                    className="px-3 py-1.5 text-sm bg-gradient-to-r from-orange-500 to-yellow-400 text-white rounded-lg hover:from-orange-600 hover:to-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
                
                {subTasks.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    Add items to your list. You can also add items after creating the task.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Scheduling Mode Toggle */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              Scheduling
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSchedulingMode("date")}
                className={`flex-1 px-4 py-2.5 text-sm rounded-lg border transition-colors ${
                  schedulingMode === "date"
                    ? "bg-purple-50 border-purple-300 text-purple-700 font-medium"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                Set Date
              </button>
              <button
                type="button"
                onClick={() => setSchedulingMode("dependency")}
                className={`flex-1 px-4 py-2.5 text-sm rounded-lg border transition-colors ${
                  schedulingMode === "dependency"
                    ? "bg-orange-50 border-orange-300 text-orange-700 font-medium"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                After Task
              </button>
            </div>
          </div>

          {/* Date Mode: Start Date + Duration */}
          {schedulingMode === "date" && (
            <div className="grid grid-cols-2 gap-3">
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
              </div>
              <div>
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
          )}

          {/* Dependency Mode: Parent Task + Dependency Type */}
          {schedulingMode === "dependency" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Depends on Task
                </label>
                <select
                  value={parentTaskId ?? ""}
                  onChange={(e) =>
                    setParentTaskId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a task...</option>
                  {availableParentTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.start_date} to {t.end_date})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Dependency Type
                </label>
                <select
                  value={depType}
                  onChange={(e) => setDepType(e.target.value as "FS" | "SS" | "SF")}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="FS">Start after (after parent ends)</option>
                  <option value="SS">Start at same time (as parent)</option>
                  <option value="SF">Finish before (parent starts)</option>
                </select>
              </div>

              <div>
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

              {/* Show calculated start date */}
              {selectedParentTask && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <p className="text-xs text-orange-700">
                    <strong>Calculated Start Date:</strong> {suggestedStartDate}
                  </p>
                  <p className="text-xs text-orange-600 mt-1">
                    {depType === "FS" && `Starts the day after "${selectedParentTask.name}" ends (${selectedParentTask.end_date})`}
                    {depType === "SS" && `Starts at the same time as "${selectedParentTask.name}" (${selectedParentTask.start_date})`}
                    {depType === "SF" && `Starts ${durationDays} day(s) before "${selectedParentTask.name}" begins`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Method selection (experiment only) */}
          {taskType === "experiment" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Linked Method
              </label>
              <select
                value={methodId ?? ""}
                onChange={(e) =>
                  setMethodId(e.target.value ? Number(e.target.value) : null)
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No method linked</option>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Link a protocol from the Methods library. You can edit it later
                and choose to save changes as notes or fork a new method.
              </p>
            </div>
          )}

          {/* Experiment info box */}
          {taskType === "experiment" && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-xs text-green-700">
                <strong>Experiment tasks</strong> include lab notes (Markdown
                with image support), results tracking, and method deviation
                workflows. You can add notes and results after creating the task.
              </p>
            </div>
          )}

          {/* Purchase info box */}
          {taskType === "purchase" && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700">
                <strong>Purchase tasks</strong> let you track items to buy.
                After creating, open the task to add items with quantities,
                prices, and links. Previously purchased items will be suggested
                as you type.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end mt-6">
          <button
            type="button"
            onClick={() => {
              setIsCreatingTask(false);
              resetForm();
            }}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCheckingDuplicate}
            className={`px-4 py-2 text-sm text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              taskType === "experiment"
                ? "bg-green-600 hover:bg-green-700"
                : taskType === "purchase"
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isCheckingDuplicate ? "Checking..." : `Create ${taskType === "experiment" ? "Experiment" : taskType === "purchase" ? "Purchase" : "List"}`}
          </button>
        </div>
      </form>
    </div>
  );
}
