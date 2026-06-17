"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { tasksApi, filesApi, dependenciesApi, fetchAllMethodsIncludingShared, type DuplicateCheckResult } from "@/lib/local-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, SubTask } from "@/lib/types";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import { createNewFileContent } from "@/lib/stamp-utils";
import { taskResultsBase } from "@/lib/tasks/results-paths";
import LoadingOverlay from "@/components/LoadingOverlay";
import LivingPopup from "@/components/ui/LivingPopup";
import MethodPicker from "@/components/MethodPicker";
import TaskPicker from "@/components/TaskPicker";
import Tooltip from "@/components/Tooltip";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";

interface TaskModalProps {
  projects: Project[];
}

type SchedulingMode = "date" | "dependency";

// Local-tz date math (TaskModal date math manager 2026-05-27). Parses a
// YYYY-MM-DD string as local midnight (not UTC) and returns the offset day
// in the same local-tz format. `new Date("2026-05-27")` parses as UTC, so
// reading the day back out via `toISOString()` drifts in west-of-UTC zones;
// `new Date("2026-05-27T00:00:00")` parses as local and `toLocaleDateString
// ("en-CA")` re-emits YYYY-MM-DD. Exported for the sibling unit test.
export function addDaysLocal(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
}

export default function TaskModal({ projects }: TaskModalProps) {
  const isCreatingTask = useAppStore((s) => s.isCreatingTask);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const newTaskStartDate = useAppStore((s) => s.newTaskStartDate);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const restrictedTaskType = useAppStore((s) => s.restrictedTaskType);
  const setRestrictedTaskType = useAppStore((s) => s.setRestrictedTaskType);
  const setGanttLoading = useAppStore((s) => s.setGanttLoading);
  const queryClient = useQueryClient();

  // Filter to only active (non-archived) projects owned by the current user.
  // Shared-in projects are excluded by design: TaskModal creates under the
  // active user, and cross-owner creation here would collide on bare project
  // ids (alex's project 1 vs morgan-shared-with-alex project 1) since the
  // HTML `<select>` value is just `p.id`. Collaborators add tasks from the
  // shared project's own page instead.
  const hasSharedProjects = useMemo(
    () => projects.some((p) => p.is_shared_with_me),
    [projects],
  );
  const activeProjects = useMemo(() => {
    let filtered = projects.filter((p) => !p.is_archived && !p.is_shared_with_me);
    // Check if Miscellaneous project exists
    const hasMiscProject = filtered.some(p => p.name === "Miscellaneous");
    if (!hasMiscProject) {
      // Add a placeholder for the Miscellaneous project (created on first save)
      filtered = [...filtered, {
        id: 0,
        name: "Miscellaneous",
        color: "#6b7280",
        is_archived: false,
        weekend_active: false,
        tags: ["default"],
        created_at: new Date().toISOString(),
        sort_order: -1,
        archived_at: null,
        owner: "",
        shared_with: [],
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
    newTaskStartDate || new Date().toLocaleDateString("en-CA")
  );
  const [durationDays, setDurationDays] = useState(1);
  const [isHighLevel, setIsHighLevel] = useState(false);
  const [taskType, setTaskType] = useState<"experiment" | "purchase" | "list">("list");

  // Scheduling mode
  const [schedulingMode, setSchedulingMode] = useState<SchedulingMode>("date");
  const [parentTaskId, setParentTaskId] = useState<number | null>(null);
  const [depType, setDepType] = useState<"FS" | "SS" | "SF">("FS");

  // Experiment-specific fields. `methodOwner` is captured alongside the id
  // so the new task's first method_attachment can be persisted with the
  // right owner namespace, sidestepping addMethod's bare-id fallback and
  // matching the routing-fix contract (3f8b42d2).
  const [methodId, setMethodId] = useState<number | null>(null);
  const [methodOwner, setMethodOwner] = useState<string | null>(null);
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [showParentPicker, setShowParentPicker] = useState(false);

  // Sub-tasks for list type
  const [subTasks, setSubTasks] = useState<SubTask[]>([]);
  const [newSubTaskText, setNewSubTaskText] = useState("");

  // Duplicate warning state
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCheckResult | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  // Draft persistence + navigation guard. TaskModal is controlled via a
  // global store flag (isCreatingTask), not a parent prop, so the modal
  // component is always mounted and the draft key is stable.
  const TASK_DRAFT_KEY = "researchos:draft:new-task";
  const hasTaskContent = name.trim().length > 0;
  const { clearDraft: clearTaskDraft } = useDraftPersistence(
    TASK_DRAFT_KEY,
    { name, projectId, taskType, startDate, durationDays },
    hasTaskContent,
    {
      onRestore: (saved) => {
        if (!saved.name?.trim()) return;
        setName(saved.name ?? "");
        if (saved.taskType) setTaskType(saved.taskType);
        if (saved.startDate) {
          // setStartDate is local state -- update it
          setStartDate(saved.startDate);
        }
        if (typeof saved.durationDays === "number") setDurationDays(saved.durationDays);
      },
    },
  );
  useUnsavedChangesGuard(hasTaskContent && isCreatingTask);

  // Load methods for the dropdown
  const { data: methods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
    enabled: isCreatingTask && taskType === "experiment",
  });

  // Load tasks for dependency selection — limited to own (non-shared)
  // projects, mirroring the project dropdown above. Without this gate the
  // parent-task list could surface a cross-owner sibling whose `project_id`
  // happens to collide with the selected own project's id.
  const ownProjectKeys = useMemo(
    () =>
      projects
        .filter((p) => !p.is_shared_with_me)
        .map((p) => p.id)
        .join(","),
    [projects],
  );
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", "own", ownProjectKeys],
    queryFn: async () => {
      const ownProjects = projects.filter((p) => !p.is_shared_with_me);
      if (ownProjects.length === 0) return [];
      const results = await Promise.all(
        ownProjects.map((p) => tasksApi.listByProject(p.id)),
      );
      return results.flat();
    },
    enabled: isCreatingTask,
  });

  // Filter tasks to show as potential parents. The fetcher already restricts
  // to own projects, but we also gate on the matched project being own here
  // (defense in depth so a stale cache or future fetcher change cannot
  // re-introduce cross-owner siblings). Experiments-only gate (Grant
  // 2026-05-27): dependency chains are restricted to experiments on both
  // sides, so the parent picker only surfaces experiment tasks.
  const availableParentTasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (t.project_id !== projectId) return false;
      if (t.task_type !== "experiment") return false;
      const project = projects.find(
        (p) =>
          p.id === t.project_id &&
          p.owner === t.owner &&
          !p.is_shared_with_me,
      );
      return project && !project.is_archived;
    });
  }, [allTasks, projectId, projects]);

  // Get the selected parent task info
  const selectedParentTask = useMemo(() => {
    return availableParentTasks.find((t) => t.id === parentTaskId) || null;
  }, [availableParentTasks, parentTaskId]);

  // Calculate suggested start date based on dependency type. Date math stays
  // in local-tz YYYY-MM-DD throughout (TaskModal date math manager 2026-05-27):
  // the prior `new Date(yyyy-mm-dd)` + `toISOString()` round-trip parsed the
  // local date as UTC midnight and then read the UTC day back out, which in
  // west-of-UTC zones near end-of-day landed the suggested child start on the
  // wrong calendar day. Matches the sibling fix at lines 76 + 248. SF formula
  // is strict-gap (child.end = parent.start - 1 → child.start = parent.start -
  // duration), matching GanttChart + engine (9548b32c) and TaskDetailPopup's
  // preview (e7e9242b); the prior `- duration + 1` was the old "no-gap"
  // overlap.
  const suggestedStartDate = useMemo(() => {
    if (!selectedParentTask) return startDate;

    if (depType === "FS") {
      // Finish-to-Start: start the day after parent ends
      return addDaysLocal(selectedParentTask.end_date, 1);
    } else if (depType === "SS") {
      // Start-to-Start: start at same time as parent
      return selectedParentTask.start_date;
    } else if (depType === "SF") {
      // Start-to-Finish strict-gap: child finishes the day before parent starts
      return addDaysLocal(selectedParentTask.start_date, -durationDays);
    }
    return startDate;
  }, [selectedParentTask, depType, durationDays, startDate]);

  // Escape close is owned by LivingPopup, so no manual keydown handler here. The
  // create form stands its Escape down while the duplicate-name warning is open
  // (closeOnEscape={!duplicateWarning} below) so the warning, layered on top,
  // gets the press first.

  // Reset form when modal opens. Mirrors the NewPurchaseModal draft-race
  // fix: when the form already carries meaningful content (either restored
  // from a sessionStorage draft on first mount, or carried over from a
  // typed-and-closed previous open) we skip the project + date seeds so
  // they don't trample the restored values. The `newTaskStartDate` and
  // `restrictedTaskType` paths still apply on top of the existing content,
  // since those are explicit caller intents (double-click on Gantt at a
  // specific date, restricted-type entrypoint) and overriding them would
  // be wrong.
  useEffect(() => {
    if (isCreatingTask) {
      const draftPresent = hasTaskContent;
      if (!draftPresent) {
        setProjectId(activeProjects[0]?.id || 0);
      }
      // Use the newTaskStartDate if provided (from double-click on Gantt)
      if (newTaskStartDate) {
        setStartDate(newTaskStartDate);
        setSchedulingMode("date"); // Ensure we're in date mode
      } else if (!draftPresent) {
        // Local-tz YYYY-MM-DD (Grant 2026-05-27 hand-walk fix). The
        // codebase convention is local-tz date strings; using UTC
        // (toISOString) here meant experiments created near end-of-day
        // in west-of-UTC timezones got start_date = tomorrow-local,
        // which the workbench's sectionAssignment then classified as
        // "scheduled" and filtered out of the visible list. Visible
        // symptom: header showed "1 experiment in flight" but the
        // panel rendered the empty state. Sibling fix at the useState
        // initial above (line 76).
        setStartDate(new Date().toLocaleDateString("en-CA"));
      }
      // If task type is restricted, set it
      if (restrictedTaskType) {
        setTaskType(restrictedTaskType);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hasTaskContent` intentionally omitted so the effect doesn't re-fire as the user types
  }, [isCreatingTask, activeProjects, newTaskStartDate, restrictedTaskType]);

  // Experiments-only gate (Grant 2026-05-27): dependency mode is
  // experiment-only. If the user flips from experiment to list /
  // purchase while dependency mode is selected, snap back to date mode
  // so the form doesn't carry hidden dependency intent the user can't
  // see (the After Task toggle is hidden for non-experiment types).
  useEffect(() => {
    if (taskType !== "experiment" && schedulingMode === "dependency") {
      setSchedulingMode("date");
      setParentTaskId(null);
    }
  }, [taskType, schedulingMode]);

  const resetForm = useCallback(() => {
    setName("");
    setDurationDays(1);
    setIsHighLevel(false);
    setTaskType("list");
    setMethodId(null);
    setMethodOwner(null);
    setSchedulingMode("date");
    setParentTaskId(null);
    setDepType("FS");
    setNewTaskStartDate(null);
    setRestrictedTaskType(null);
    setDuplicateWarning(null);
    setSubTasks([]);
    setNewSubTaskText("");
  }, [setNewTaskStartDate, setRestrictedTaskType]);

  const createTask = useCallback(async () => {
    setGanttLoading(true, "Creating task...");
    try {
      // Determine the start date based on scheduling mode
      const finalStartDate = schedulingMode === "dependency" 
        ? suggestedStartDate 
        : startDate;

      const attachExperimentMethod =
        taskType === "experiment" && methodId !== null;
      const task = await tasksApi.create({
        project_id: projectId === 0 ? null : projectId,
        name: name.trim(),
        start_date: finalStartDate,
        duration_days: durationDays,
        is_high_level: isHighLevel,
        task_type: taskType,
        method_ids: attachExperimentMethod ? [methodId] : [],
        // Persist the picker-resolved owner on the attachment so the new
        // task carries the disambiguator from the moment it lands on
        // disk — no addMethod fallback round-trip, no chance of
        // mis-routing if the new id collides with a foreign-namespace
        // sibling.
        method_attachments: attachExperimentMethod
          ? [{ method_id: methodId, owner: methodOwner }]
          : undefined,
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
        const notesPath = `${taskResultsBase(task)}/notes.md`;
        // The modal creates tasks under the active user, so when resolving
        // projectId we exclude shared projects — otherwise alex's project 1
        // and morgan's-shared-with-alex project 1 collide on the id alone.
        // Legacy own projects have `owner: ""` on disk, so we filter on the
        // shared flag rather than current-user owner equality.
        const projectName =
          projects.find((p) => p.id === projectId && !p.is_shared_with_me)
            ?.name || "Unknown Project";
        const template = createNewFileContent(name.trim(), projectName, 'notes');
        try {
          await filesApi.writeFile(
            notesPath,
            template,
            `Create lab notes for: ${name.trim()}`
          );
        } catch {
          // Non-fatal - notes file can be created later
        }
        // Scaffold results.md with its own "# Results: <name>" header at the
        // same time as notes.md. Without this, the Results doc rebuilds from an
        // empty mirror (the Loro seed reads results.md, which never existed) and
        // shows no header, while Lab Notes does. This kept Results looking
        // headerless next to Lab Notes (caught in the demo). Symmetric with the
        // notes scaffold above so both tabs open with their title.
        const resultsPath = `${taskResultsBase(task)}/results.md`;
        const resultsTemplate = createNewFileContent(name.trim(), projectName, 'results');
        try {
          await filesApi.writeFile(
            resultsPath,
            resultsTemplate,
            `Create results for: ${name.trim()}`
          );
        } catch {
          // Non-fatal - results file can be created later
        }
      }

      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["dependencies"] });

      // Onboarding v4 §6.5 (experiment-flow fix manager, 2026-05-27): the
      // §6.5 USER_ACTION refactor 2026-05-27: the `tour:experiment-created`
      // dispatch moved DOWN one layer (from this UI handler to
      // `tasksApi.create` in `lib/local-api.ts`). That way both the
      // modal-driven create flow AND the programmatic create flow used
      // by the tour's `ensureFirstExperimentExists` helper fire the
      // same event. Keeping the dispatch here too would double-fire
      // (the artifact-capture listener in the submit step would stamp
      // the task twice). Intentionally removed from here.

      setGanttLoading(false);
      clearTaskDraft();
      setIsCreatingTask(false);
      resetForm();
    } catch (error: unknown) {
      console.error("Failed to create task:", error);
      setGanttLoading(false);
      const msg = error instanceof Error ? error.message : "Unknown error";
      alert(`Failed to create task: ${msg}`);
    }
  }, [
    name,
    projectId,
    startDate,
    durationDays,
    isHighLevel,
    taskType,
    methodId,
    methodOwner,
    queryClient,
    setIsCreatingTask,
    schedulingMode,
    parentTaskId,
    depType,
    suggestedStartDate,
    subTasks,
    setGanttLoading,
    projects,
    resetForm,
    clearTaskDraft,
  ]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      // projectId 0 is the "Miscellaneous (standalone)" sentinel — a valid
      // choice that maps to project_id: null in createTask. Only the name is
      // actually required, so don't block submit on a 0 (standalone) project.
      if (!name.trim()) return;

      // Check if project is archived
      // See note above on createTask: TaskModal creates under the active
      // user, so resolve projectId against own (non-shared) projects only.
      const selectedProject = projects.find(
        (p) => p.id === projectId && !p.is_shared_with_me,
      );
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

  const closeAndReset = () => {
    setIsCreatingTask(false);
    resetForm();
  };

  // If no active projects, show a message
  if (activeProjects.length === 0) {
    return (
      <LivingPopup
        open={isCreatingTask}
        onClose={closeAndReset}
        label="Cannot create task"
        widthClassName="max-w-md"
        card={false}
      >
        <div className="bg-surface-raised rounded-xl ros-popup-card-shadow w-full p-6">
          <h3 className="text-heading font-semibold text-foreground mb-4">
            Cannot Create Task
          </h3>
          <p className="text-body text-foreground-muted mb-4">
            You need an active project first. Create one or unarchive an existing project, then add tasks.
          </p>
          <div className="flex justify-end">
            <button
              onClick={closeAndReset}
              className="px-4 py-2 text-body text-foreground-muted hover:text-foreground rounded-lg hover:bg-surface-sunken transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </LivingPopup>
    );
  }

  return (
    <>
      <LivingPopup
        open={isCreatingTask}
        onClose={closeAndReset}
        label="New task"
        widthClassName="max-w-lg"
        card={false}
        closeOnScrimClick={false}
        // While the duplicate-name warning is layered on top, it owns Escape so
        // one press dismisses just the warning (back to the form), not the whole
        // create modal. LivingPopup's stack-based isTop guard already defers to
        // the warning (it opens on top); gating here makes that explicit.
        closeOnEscape={!duplicateWarning}
      >
      <form
        onSubmit={handleSubmit}
        className="bg-surface-raised rounded-xl ros-popup-card-shadow w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-heading font-semibold text-foreground mb-4">
          {taskType === "experiment"
            ? "New Experiment"
            : taskType === "purchase"
            ? "New Purchase"
            : taskType === "list"
            ? "New List Task"
            : "New Task"}
        </h3>

        <div className="space-y-4">
          {/* Task Type Toggle - only show if not restricted */}
          {!restrictedTaskType && (
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-2">
                Task Type
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTaskType("list")}
                  className={`flex-1 px-3 py-2.5 text-body rounded-lg border transition-colors ${
                    taskType === "list"
                      ? "bg-blue-50 dark:bg-blue-500/15 border-blue-300 dark:border-blue-500/30 text-blue-700 dark:text-blue-300 font-medium"
                      : "border-border text-foreground-muted hover:bg-surface-sunken"
                  }`}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setTaskType("experiment")}
                  className={`flex-1 px-3 py-2.5 text-body rounded-lg border transition-colors ${
                    taskType === "experiment"
                      ? "bg-purple-50 dark:bg-purple-500/15 border-purple-300 dark:border-purple-500/30 text-purple-700 dark:text-purple-300 font-medium"
                      : "border-border text-foreground-muted hover:bg-surface-sunken"
                  }`}
                >
                  Experiment
                </button>
                <button
                  type="button"
                  onClick={() => setTaskType("purchase")}
                  className={`flex-1 px-3 py-2.5 text-body rounded-lg border transition-colors ${
                    taskType === "purchase"
                      ? "bg-amber-50 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 font-medium"
                      : "border-border text-foreground-muted hover:bg-surface-sunken"
                  }`}
                >
                  Purchase
                </button>
              </div>
            </div>
          )}

          {/* Project */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Project
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(Number(e.target.value))}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-tour-target="workbench-experiment-project-select"
            >
              {activeProjects.map((p) => (
                <option key={`${p.owner}:${p.id}`} value={p.id}>
                  {p.name === "Miscellaneous" ? "Miscellaneous (standalone tasks)" : p.name}
                </option>
              ))}
            </select>
            {projectId === 0 && (
              <p className="text-meta text-foreground-muted mt-1">
                Standalone tasks are for daily lists, quick notes, or anything not tied to a research project.
              </p>
            )}
            {hasSharedProjects && (
              <p className="text-meta text-foreground-muted mt-1">
                Shared projects aren&apos;t listed here. Open the project&apos;s page to add a task to it.
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
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
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              data-tour-target="workbench-experiment-name-input"
            />
          </div>

          {/* Sub-tasks for List type */}
          {taskType === "list" && (
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-2">
                List Items
              </label>
              <div className="bg-surface-sunken rounded-lg p-3 space-y-2">
                {/* Existing sub-tasks */}
                {subTasks.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {subTasks.map((st) => (
                      <div 
                        key={st.id} 
                        className="flex items-center gap-2 group py-1.5 px-2 rounded-lg hover:bg-surface-raised transition-colors"
                      >
                        <div className="w-5 h-5 rounded border-2 border-border flex items-center justify-center flex-shrink-0">
                          {/* Empty checkbox - just visual */}
                        </div>
                        <span className="flex-1 text-body text-foreground">{st.text}</span>
                        <Tooltip label="Remove item" placement="left">
                          <button
                            type="button"
                            onClick={() => handleDeleteSubTask(st.id)}
                            className="opacity-0 group-hover:opacity-100 text-foreground-muted hover:text-red-500 text-meta transition-opacity"
                            data-force-hover-controls-target
                          >
                            ✕
                          </button>
                        </Tooltip>
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
                    className="flex-1 px-3 py-1.5 text-body border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                    data-tour-target="workbench-list-modal-item-input"
                  />
                  <button
                    type="button"
                    onClick={handleAddSubTask}
                    disabled={!newSubTaskText.trim()}
                    className="px-3 py-1.5 text-body bg-gradient-to-r from-orange-500 to-yellow-400 text-white rounded-lg hover:from-orange-600 hover:to-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-tour-target="workbench-list-modal-item-add"
                  >
                    Add
                  </button>
                </div>
                
                {subTasks.length === 0 && (
                  <p className="text-meta text-foreground-muted mt-1">
                    Add items now or after creating the task.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Scheduling Mode Toggle. Experiments-only gate (Grant
              2026-05-27): the "After Task" (dependency) mode is hidden
              for list + purchase tasks since dependency chains are
              experiment-only. For non-experiment task types we render
              just the Set-Date branch without the toggle, since there's
              only one option. If the user changes task type from
              experiment to list / purchase while in dependency mode,
              snap back to date mode (handled by the effect below). */}
          {taskType === "experiment" ? (
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-2">
                Scheduling
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSchedulingMode("date")}
                  className={`flex-1 px-4 py-2.5 text-body rounded-lg border transition-colors ${
                    schedulingMode === "date"
                      ? "bg-purple-50 dark:bg-purple-500/15 border-purple-300 dark:border-purple-500/30 text-purple-700 dark:text-purple-300 font-medium"
                      : "border-border text-foreground-muted hover:bg-surface-sunken"
                  }`}
                >
                  Set Date
                </button>
                <button
                  type="button"
                  onClick={() => setSchedulingMode("dependency")}
                  className={`flex-1 px-4 py-2.5 text-body rounded-lg border transition-colors ${
                    schedulingMode === "dependency"
                      ? "bg-orange-50 dark:bg-orange-500/15 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-300 font-medium"
                      : "border-border text-foreground-muted hover:bg-surface-sunken"
                  }`}
                >
                  After Task
                </button>
              </div>
            </div>
          ) : null}

          {/* Date Mode: Start Date + Duration */}
          {schedulingMode === "date" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Duration (days)
                </label>
                <input
                  type="number"
                  min={1}
                  value={durationDays}
                  onChange={(e) => setDurationDays(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Dependency Mode: Parent Task + Dependency Type */}
          {schedulingMode === "dependency" && (
            <div className="space-y-3">
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Depends on Task
                </label>
                {selectedParentTask ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border border-border rounded-lg bg-surface-raised text-body">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-foreground truncate">
                        {selectedParentTask.name}
                      </span>
                      <span className="text-meta text-foreground-muted shrink-0">
                        {selectedParentTask.start_date} → {selectedParentTask.end_date}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowParentPicker(true)}
                      className="text-meta text-foreground-muted hover:text-foreground shrink-0"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowParentPicker(true)}
                    disabled={availableParentTasks.length === 0}
                    className="w-full text-left px-3 py-2 border border-dashed border-border rounded-lg text-body text-foreground-muted hover:border-blue-400 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {availableParentTasks.length === 0
                      ? "No eligible experiments to depend on"
                      : "Select a task this depends on…"}
                  </button>
                )}
                <TaskPicker
                  open={showParentPicker}
                  availableTasks={availableParentTasks}
                  currentProjectId={projectId}
                  title="Depends on task"
                  placeholder="Search experiments by name or #tag…"
                  onSelect={(id) => {
                    setParentTaskId(id);
                    setShowParentPicker(false);
                  }}
                  onClose={() => setShowParentPicker(false)}
                />
              </div>

              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Dependency Type
                </label>
                <select
                  value={depType}
                  onChange={(e) => setDepType(e.target.value as "FS" | "SS" | "SF")}
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="FS">Start after (after parent ends)</option>
                  <option value="SS">Start at same time (as parent)</option>
                  <option value="SF">Finish before (parent starts)</option>
                </select>
              </div>

              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Duration (days)
                </label>
                <input
                  type="number"
                  min={1}
                  value={durationDays}
                  onChange={(e) => setDurationDays(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Show calculated start date */}
              {selectedParentTask && (
                <div className="bg-orange-50 dark:bg-orange-500/15 border border-orange-200 dark:border-orange-500/30 rounded-lg p-3">
                  <p className="text-meta text-orange-700 dark:text-orange-300">
                    <strong>Calculated Start Date:</strong> {suggestedStartDate}
                  </p>
                  <p className="text-meta text-orange-600 dark:text-orange-300 mt-1">
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
              <label className="block text-meta font-medium text-foreground-muted mb-1">
                Linked Method
              </label>
              {(() => {
                // Match on `(id, owner)` so the modal preview chip surfaces
                // the exact method the picker resolved — bare-id `find`
                // would silently pick the wrong namespace when an id
                // collides across `methods` (per-user id space, public
                // method same id as a private one).
                const selectedMethod = methodId
                  ? methods.find(
                      (m) => m.id === methodId && (methodOwner === null || m.owner === methodOwner),
                    ) ?? null
                  : null;
                return selectedMethod ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border border-border rounded-lg bg-surface-raised text-body">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-foreground truncate">
                        {selectedMethod.name}
                      </span>
                      {selectedMethod.method_type && selectedMethod.method_type !== "markdown" && (() => {
                        const meta = getMethodTypeMeta(selectedMethod.method_type);
                        return (
                          <span className={`text-meta px-1.5 py-0.5 rounded shrink-0 ${meta.color.bg} ${meta.color.text}`}>
                            {meta.shortLabel}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowMethodPicker(true)}
                        className="text-meta text-foreground-muted hover:text-foreground"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMethodId(null);
                          setMethodOwner(null);
                        }}
                        className="text-meta text-foreground-muted hover:text-foreground-muted"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowMethodPicker(true)}
                    className="w-full text-left px-3 py-2 border border-dashed border-border rounded-lg text-body text-foreground-muted hover:border-blue-400 hover:text-foreground"
                  >
                    + Link a method (optional)
                  </button>
                );
              })()}
              <p className="text-meta text-foreground-muted mt-1">
                Link a protocol from the Methods library. Edits can be saved as
                notes or forked into a new method.
              </p>
              <MethodPicker
                open={showMethodPicker}
                currentMethodId={methodId}
                currentProjectId={projectId}
                onSelect={(id, owner) => {
                  setMethodId(id);
                  setMethodOwner(owner);
                  setShowMethodPicker(false);
                }}
                onClose={() => setShowMethodPicker(false)}
              />
            </div>
          )}

          {/* Experiment info box */}
          {taskType === "experiment" && (
            <div className="bg-green-50 dark:bg-green-500/15 border border-green-200 dark:border-green-500/30 rounded-lg p-3">
              <p className="text-meta text-green-700 dark:text-green-300">
                <strong>Experiment tasks</strong> include lab notes (Markdown
                with images), results tracking, and method deviations. Add notes
                and results after creating the task.
              </p>
            </div>
          )}

          {/* Purchase info box */}
          {taskType === "purchase" && (
            <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
              <p className="text-meta text-amber-700 dark:text-amber-300">
                <strong>Purchase tasks</strong> track items to buy. Open the
                task to add quantities, prices, and links. Past purchases are
                suggested as you type.
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
            className="px-4 py-2 text-body text-foreground-muted hover:text-foreground rounded-lg hover:bg-surface-sunken transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            // projectId 0 = "Miscellaneous (standalone)" is a valid selection
            // (maps to project_id: null). Gating on !projectId wrongly
            // disabled Create whenever no real project was picked, even though
            // standalone is an intended outcome. Only the name is required.
            disabled={isCheckingDuplicate || !name.trim()}
            data-tour-target="workbench-experiment-submit"
            className={`px-4 py-2 text-body text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              taskType === "experiment"
                ? "bg-green-600 hover:bg-green-700"
                : taskType === "purchase"
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-brand-action hover:bg-brand-action/90"
            }`}
          >
            {isCheckingDuplicate ? "Checking..." : `Create ${taskType === "experiment" ? "Experiment" : taskType === "purchase" ? "Purchase" : "List"}`}
          </button>
        </div>
      </form>
      </LivingPopup>

      {/* Duplicate-name warning, its own popup layered above the create form. */}
      {duplicateWarning && (
        <LivingPopup
          open
          onClose={() => setDuplicateWarning(null)}
          label="Duplicate task name"
          widthClassName="max-w-md"
          card={false}
          closeOnScrimClick={false}
        >
          <div className="bg-surface-raised rounded-xl ros-popup-card-shadow w-full p-6">
            <h3 className="text-heading font-semibold text-red-600 dark:text-red-300 mb-4">
              Duplicate Task Name Detected
            </h3>
            <p className="text-body text-foreground-muted mb-3">
              A task with the same name already exists in this project with the same task type:
            </p>
            <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-3 mb-4">
              {duplicateWarning.matching_tasks.map((task) => (
                <div key={task.id} className="text-body text-red-700 dark:text-red-300 mb-2">
                  <strong>{task.name}</strong>
                  <span className="text-red-500 ml-2">
                    (Started: {task.start_date}, {task.is_complete ? "Completed" : "In Progress"})
                  </span>
                </div>
              ))}
            </div>
            <p className="text-body text-foreground-muted mb-4">
              Rename it, or create it anyway?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDuplicateWarning(null)}
                className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors"
              >
                Change Name
              </button>
              <button
                onClick={() => {
                  setDuplicateWarning(null);
                  createTask();
                }}
                className="px-4 py-2 text-body text-red-600 dark:text-red-300 border border-red-300 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-lg transition-colors"
              >
                Create Anyway
              </button>
              <button
                onClick={closeAndReset}
                className="px-4 py-2 text-body text-foreground-muted hover:text-foreground rounded-lg hover:bg-surface-sunken transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </LivingPopup>
      )}

      {/* Loading overlay for task creation */}
      <LoadingOverlay />
    </>
  );
}
