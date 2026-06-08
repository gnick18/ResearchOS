// sequence editor master (Gantt source sub-bot). Tests for the PURE Gantt
// BeakerSearch source builder. These cover the context-card copy, the command
// set (ids + groups + read-only gating), the Suggested ordering for a selected
// task vs a selected goal vs nothing-selected, and the nav groups (labels,
// tones, hint counts), all without a DOM or a store, mirroring the posture of
// editor-commands.test.ts.

import { describe, it, expect } from "vitest";
import type { HighLevelGoal, Project, Task } from "@/lib/types";
import type { PaletteSubflow } from "@/components/sequences/editor-commands";
import {
  buildGanttSource,
  ganttScopeSummary,
  isGanttTaskReadOnly,
  type GanttSourceData,
  type GanttSourceHandlers,
} from "./gantt-beaker-source";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 10,
    owner: "self",
    name: "PCR optimization",
    start_date: "2026-06-12",
    duration_days: 7,
    end_date: "2026-06-19",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    tags: ["PCR"],
    ...over,
  } as Task;
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 10,
    owner: "self",
    name: "Mitochondria QC",
    color: "#3b82f6",
    is_archived: false,
    tags: [],
    ...over,
  } as Project;
}

function makeGoal(over: Partial<HighLevelGoal> = {}): HighLevelGoal {
  return {
    id: 5,
    project_id: 10,
    name: "Submit R01 aims",
    start_date: "2026-06-01",
    end_date: "2026-08-01",
    color: null,
    smart_goals: [
      { id: "a", text: "Aim 1", is_complete: true },
      { id: "b", text: "Aim 2", is_complete: false },
    ],
    is_complete: false,
    created_at: "2026-06-01",
  } as HighLevelGoal;
}

const noopHandlers: GanttSourceHandlers = {
  setEditingTaskKey: () => {},
  setEditingGoal: () => {},
  setProjectFilterMode: () => {},
  setSelectedProjects: () => {},
  toggleTag: () => {},
  setShowShared: () => {},
  setGanttStartDate: () => {},
  ganttNavigateWeeks: () => {},
  setViewMode: () => {},
  setNewTaskStartDate: () => {},
  createTask: () => {},
  createGoal: () => {},
  markTaskComplete: () => {},
  deleteTask: () => {},
  markGoalComplete: () => {},
  deleteGoal: () => {},
  assignTask: () => {},
  createDependency: () => {},
  moveTaskToProject: () => {},
};

function makeData(over: Partial<GanttSourceData> = {}): GanttSourceData {
  const projects = over.activeProjects ?? [makeProject()];
  return {
    allTasks: [makeTask()],
    filteredTasks: [makeTask()],
    activeProjects: projects,
    goals: [makeGoal()],
    allTags: ["PCR"],
    projectFilterMode: "all",
    selectedProjectIds: [],
    selectedTags: [],
    showShared: true,
    ganttStartDate: null,
    window: { startLabel: "Jun 9", endLabel: "Jul 20" },
    editingTaskKey: null,
    editingGoal: null,
    hovered: null,
    recentTaskKeys: [],
    labMembers: [{ username: "morgan", displayName: "Morgan Lee" }],
    currentUser: "self",
    taskKeyOf: (t) => `${t.is_shared_with_me ? t.owner : "self"}:${t.id}`,
    filterKeyOf: (p) => `${p.owner}:${p.id}`,
    standaloneFilterKey: "__standalone__",
    ...over,
  };
}

// ── Context card ─────────────────────────────────────────────────────────────

describe("ganttScopeSummary", () => {
  it("reads All projects then the window when unfiltered", () => {
    const data = makeData();
    expect(ganttScopeSummary(data)).toBe("All projects, Jun 9 to Jul 20");
  });

  it("names a single explicit project, the tag, and incl. shared when in view", () => {
    const shared = makeTask({
      id: 2,
      owner: "alex",
      is_shared_with_me: true,
      name: "Shared run",
    });
    const data = makeData({
      projectFilterMode: "explicit",
      selectedProjectIds: ["self:10"],
      selectedTags: ["PCR"],
      filteredTasks: [makeTask(), shared],
    });
    expect(ganttScopeSummary(data)).toBe(
      "Mitochondria QC, tag PCR, Jun 9 to Jul 20, incl. shared",
    );
  });

  it("reports the count for many projects and No projects for an empty explicit set", () => {
    const many = makeData({
      projectFilterMode: "explicit",
      selectedProjectIds: ["self:10", "self:11", "self:12"],
    });
    expect(ganttScopeSummary(many)).toContain("3 projects");
    const none = makeData({ projectFilterMode: "explicit", selectedProjectIds: [] });
    expect(ganttScopeSummary(none)).toContain("No projects");
  });

  it("suppresses incl. shared when shared is on but no shared task is in view", () => {
    const data = makeData({ showShared: true, filteredTasks: [makeTask()] });
    expect(ganttScopeSummary(data)).not.toContain("incl. shared");
  });
});

describe("buildGanttSource context card", () => {
  it("is two lines, scope title + meta, no selection when nothing selected", () => {
    const card = buildGanttSource(makeData(), noopHandlers).contextCard!;
    expect(card.title).toBe("Gantt");
    expect(card.meta).toBe("All projects, Jun 9 to Jul 20");
    expect(card.selection).toBeUndefined();
  });

  it("adds the task selection line when a task is selected", () => {
    const data = makeData({ editingTaskKey: "self:1" });
    const card = buildGanttSource(data, noopHandlers).contextCard!;
    expect(card.selection?.text).toBe("PCR optimization, 2026-06-12 to 2026-06-19");
    expect(card.selection?.iconName).toBe("list");
  });

  it("adds the goal selection line with the SMART-goal count when a goal is selected", () => {
    const data = makeData({ editingTaskKey: null, editingGoal: makeGoal() });
    const card = buildGanttSource(data, noopHandlers).contextCard!;
    expect(card.selection?.text).toBe(
      "Submit R01 aims, milestone, due 2026-08-01, 1 of 2 done",
    );
    expect(card.selection?.iconName).toBe("map");
  });
});

// ── Commands ─────────────────────────────────────────────────────────────────

describe("buildGanttSource commands", () => {
  it("always emits Create / Filter / Timeline commands with stable ids and groups", () => {
    const cmds = buildGanttSource(makeData(), noopHandlers).commands;
    const byId = new Map(cmds.map((c) => [c.id, c]));
    expect(byId.get("gantt-new-task")?.group).toBe("Create");
    expect(byId.get("gantt-new-goal")?.group).toBe("Create");
    expect(byId.get("gantt-show-all-projects")?.group).toBe("Filter and scope");
    expect(byId.get("gantt-toggle-shared")?.group).toBe("Filter and scope");
    expect(byId.get("gantt-view-2week")?.group).toBe("Timeline view");
    expect(byId.get("gantt-week-forward")?.group).toBe("Timeline view");
    // Eight view-mode rows, one per VIEW_MODES entry.
    expect(cmds.filter((c) => c.id.startsWith("gantt-view-")).length).toBe(8);
  });

  it("emits one filter command per known tag", () => {
    const cmds = buildGanttSource(makeData({ allTags: ["PCR", "qPCR"] }), noopHandlers).commands;
    expect(cmds.some((c) => c.id === "gantt-tag-PCR")).toBe(true);
    expect(cmds.some((c) => c.id === "gantt-tag-qPCR")).toBe(true);
  });

  it("emits the seven selected-task rows under Selected task when a task is selected", () => {
    const cmds = buildGanttSource(makeData({ editingTaskKey: "self:1" }), noopHandlers).commands;
    const selected = cmds.filter((c) => c.group === "Selected task");
    expect(selected.map((c) => c.id)).toEqual([
      "gantt-task-toggle-complete",
      "gantt-task-shift-dates",
      "gantt-task-add-dependency",
      "gantt-task-assign",
      "gantt-task-open",
      "gantt-task-move-project",
      "gantt-task-delete",
    ]);
  });

  it("greys the mutating rows for a read-only shared task but keeps Open enabled", () => {
    const ro = makeTask({
      id: 3,
      owner: "alex",
      is_shared_with_me: true,
      shared_permission: "view",
      name: "View-only run",
    });
    expect(isGanttTaskReadOnly(ro)).toBe(true);
    const data = makeData({
      allTasks: [ro],
      filteredTasks: [ro],
      editingTaskKey: "alex:3",
    });
    const cmds = buildGanttSource(data, noopHandlers).commands;
    const byId = new Map(cmds.map((c) => [c.id, c]));
    expect(byId.get("gantt-task-toggle-complete")?.enabled).toBe(false);
    expect(byId.get("gantt-task-shift-dates")?.enabled).toBe(false);
    expect(byId.get("gantt-task-add-dependency")?.enabled).toBe(false);
    expect(byId.get("gantt-task-move-project")?.enabled).toBe(false);
    expect(byId.get("gantt-task-delete")?.enabled).toBe(false);
    // Open stays runnable (the popup renders read-only).
    expect(byId.get("gantt-task-open")?.enabled).toBeUndefined();
  });

  it("disables Add a dependency for a non-experiment task", () => {
    const list = makeTask({ id: 4, task_type: "list", name: "Buy reagents" });
    const data = makeData({
      allTasks: [list],
      filteredTasks: [list],
      editingTaskKey: "self:4",
    });
    const byId = new Map(
      buildGanttSource(data, noopHandlers).commands.map((c) => [c.id, c]),
    );
    expect(byId.get("gantt-task-add-dependency")?.enabled).toBe(false);
  });
});

// ── Suggested ────────────────────────────────────────────────────────────────

describe("buildGanttSource suggested ordering", () => {
  it("leads with the seven task actions then orientation defaults when a task is selected", () => {
    const src = buildGanttSource(makeData({ editingTaskKey: "self:1" }), noopHandlers);
    expect(src.suggestedIds?.slice(0, 7)).toEqual([
      "gantt-task-toggle-complete",
      "gantt-task-shift-dates",
      "gantt-task-add-dependency",
      "gantt-task-assign",
      "gantt-task-open",
      "gantt-task-move-project",
      "gantt-task-delete",
    ]);
    expect(src.suggestedIds).toContain("gantt-new-task");
    expect(src.suggestedHint).toBe("for the selected task");
    // Every suggested id must exist in commands.
    const ids = new Set(src.commands.map((c) => c.id));
    for (const id of src.suggestedIds ?? []) expect(ids.has(id)).toBe(true);
  });

  it("leads with the four goal actions when a goal is selected", () => {
    const src = buildGanttSource(
      makeData({ editingTaskKey: null, editingGoal: makeGoal() }),
      noopHandlers,
    );
    expect(src.suggestedIds?.slice(0, 4)).toEqual([
      "gantt-goal-edit",
      "gantt-goal-add-task",
      "gantt-goal-toggle-complete",
      "gantt-goal-delete",
    ]);
    expect(src.suggestedHint).toBe("for the selected milestone");
  });

  it("suggests only orientation defaults when nothing is selected and no filter is active", () => {
    const src = buildGanttSource(makeData(), noopHandlers);
    expect(src.suggestedIds).toEqual(["gantt-new-task", "gantt-new-goal"]);
    expect(src.suggestedHint).toBeUndefined();
  });

  it("adds clear-filter and go-today suggestions when a filter / custom date is active", () => {
    const src = buildGanttSource(
      makeData({
        projectFilterMode: "explicit",
        selectedProjectIds: ["self:10"],
        selectedTags: ["PCR"],
        ganttStartDate: "2026-07-06",
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toContain("gantt-show-all-projects");
    expect(src.suggestedIds).toContain("gantt-tag-PCR");
    expect(src.suggestedIds).toContain("gantt-clear-filters");
    expect(src.suggestedIds).toContain("gantt-go-today");
  });
});

// ── Nav groups ───────────────────────────────────────────────────────────────

describe("buildGanttSource nav groups", () => {
  it("has tasks (amber), projects (violet), goals (teal) tones and an in-view hint", () => {
    const src = buildGanttSource(makeData(), noopHandlers);
    const groups = src.navGroups ?? [];
    const titles = groups.map((g) => g.title);
    expect(titles).toEqual(["Jump to a task", "Jump to a project", "Jump to a goal"]);

    const tasks = groups.find((g) => g.title === "Jump to a task")!;
    expect(tasks.hint).toBe("in view (1)");
    expect(tasks.items[0].tone).toBe("task");
    expect(tasks.items[0].keywords).toContain("PCR");

    expect(groups.find((g) => g.title === "Jump to a project")!.items[0].tone).toBe(
      "project",
    );
    expect(groups.find((g) => g.title === "Jump to a goal")!.items[0].tone).toBe("goal");
  });

  it("omits the Recently opened group when the session list is empty", () => {
    const src = buildGanttSource(makeData(), noopHandlers);
    expect((src.navGroups ?? []).some((g) => g.title === "Recently opened")).toBe(false);
  });

  it("includes a Recently opened group when keys are present", () => {
    const src = buildGanttSource(makeData({ recentTaskKeys: ["self:1"] }), noopHandlers);
    const recent = (src.navGroups ?? []).find((g) => g.title === "Recently opened");
    expect(recent).toBeDefined();
    expect(recent!.items[0].label).toBe("PCR optimization");
    expect(recent!.items[0].detail).toBe("opened recently");
  });
});

// ── Hover as context (SELECTED > HOVERED) ────────────────────────────────────

describe("buildGanttSource hover as context", () => {
  it("drives the seven task action ids and the pointing-at hint from a hovered task with no selection", () => {
    const hov = makeTask();
    const src = buildGanttSource(
      makeData({ editingTaskKey: null, editingGoal: null, hovered: { kind: "task", task: hov } }),
      noopHandlers,
    );
    expect(src.suggestedIds?.slice(0, 7)).toEqual([
      "gantt-task-toggle-complete",
      "gantt-task-shift-dates",
      "gantt-task-add-dependency",
      "gantt-task-assign",
      "gantt-task-open",
      "gantt-task-move-project",
      "gantt-task-delete",
    ]);
    expect(src.suggestedHint).toBe("for the task you were pointing at");
    // The action rows the suggested ids name actually exist in commands.
    const ids = new Set(src.commands.map((c) => c.id));
    for (const id of src.suggestedIds ?? []) expect(ids.has(id)).toBe(true);
  });

  it("frames the context-card selection line as pointing at the hovered task", () => {
    const hov = makeTask();
    const card = buildGanttSource(
      makeData({ hovered: { kind: "task", task: hov } }),
      noopHandlers,
    ).contextCard!;
    expect(card.selection?.text).toBe(
      "Pointing at PCR optimization, 2026-06-12 to 2026-06-19",
    );
    expect(card.selection?.iconName).toBe("list");
  });

  it("drives the four goal action ids and the pointing-at milestone hint from a hovered goal", () => {
    const src = buildGanttSource(
      makeData({ hovered: { kind: "goal", goal: makeGoal() } }),
      noopHandlers,
    );
    expect(src.suggestedIds?.slice(0, 4)).toEqual([
      "gantt-goal-edit",
      "gantt-goal-add-task",
      "gantt-goal-toggle-complete",
      "gantt-goal-delete",
    ]);
    expect(src.suggestedHint).toBe("for the milestone you were pointing at");
    const card = buildGanttSource(
      makeData({ hovered: { kind: "goal", goal: makeGoal() } }),
      noopHandlers,
    ).contextCard!;
    expect(card.selection?.text).toBe(
      "Pointing at Submit R01 aims, milestone, due 2026-08-01, 1 of 2 done",
    );
  });

  it("greys a hovered read-only shared task's mutating rows but keeps Open enabled", () => {
    const ro = makeTask({
      id: 3,
      owner: "alex",
      is_shared_with_me: true,
      shared_permission: "view",
      name: "View-only run",
    });
    const byId = new Map(
      buildGanttSource(
        makeData({ hovered: { kind: "task", task: ro } }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(byId.get("gantt-task-toggle-complete")?.enabled).toBe(false);
    expect(byId.get("gantt-task-delete")?.enabled).toBe(false);
    expect(byId.get("gantt-task-open")?.enabled).toBeUndefined();
  });

  it("lets a SELECTED task outrank a HOVERED goal (selected wins, no pointing-at framing)", () => {
    const src = buildGanttSource(
      makeData({
        editingTaskKey: "self:1",
        hovered: { kind: "goal", goal: makeGoal() },
      }),
      noopHandlers,
    );
    // The selected task drives Suggested, the hovered goal is ignored.
    expect(src.suggestedIds?.slice(0, 7)).toEqual([
      "gantt-task-toggle-complete",
      "gantt-task-shift-dates",
      "gantt-task-add-dependency",
      "gantt-task-assign",
      "gantt-task-open",
      "gantt-task-move-project",
      "gantt-task-delete",
    ]);
    expect(src.suggestedHint).toBe("for the selected task");
    const card = buildGanttSource(
      makeData({
        editingTaskKey: "self:1",
        hovered: { kind: "goal", goal: makeGoal() },
      }),
      noopHandlers,
    ).contextCard!;
    expect(card.selection?.text).toBe("PCR optimization, 2026-06-12 to 2026-06-19");
  });
});

// ── BeakerSearch v2 (sub-flow framework, chunk 1), the two Gantt proofs ──────

describe("buildGanttSource sub-flows", () => {
  it("INLINE assign, picks a member and calls the real assign handler then completes", () => {
    const assigned: Array<[number, string]> = [];
    const handlers: GanttSourceHandlers = {
      ...noopHandlers,
      assignTask: (task, assignee) => {
        assigned.push([task.id, assignee]);
      },
    };
    const cmds = buildGanttSource(
      makeData({ editingTaskKey: "self:1" }),
      handlers,
    ).commands;
    const assign = cmds.find((c) => c.id === "gantt-task-assign")!;
    expect(assign.subflow).toBeDefined();
    const sf = assign.subflow!();
    // Single stage, no explicit presentation (renders inline by inference).
    expect(sf.presentation).toBeUndefined();
    expect(sf.items.map((i) => i.id)).toEqual(["morgan"]);
    expect(sf.items[0].label).toBe("Morgan Lee");
    // Picking a member completes (returns void) and calls the handler.
    const next = sf.onPick(sf.items[0]);
    expect(next).toBeUndefined();
    expect(assigned).toEqual([[1, "morgan"]]);
  });

  it("INLINE move-to-project, lists Standalone plus the active projects and calls the real move handler", () => {
    const moved: Array<[number, number | null]> = [];
    const handlers: GanttSourceHandlers = {
      ...noopHandlers,
      moveTaskToProject: (task, projectId) => {
        moved.push([task.id, projectId]);
      },
    };
    const ownProject = makeProject({ id: 10, owner: "self", name: "Mitochondria QC" });
    const sharedProject = makeProject({ id: 20, owner: "alex", name: "Shared screen" });
    const cmds = buildGanttSource(
      makeData({
        editingTaskKey: "self:1",
        activeProjects: [ownProject, sharedProject],
      }),
      handlers,
    ).commands;
    const move = cmds.find((c) => c.id === "gantt-task-move-project")!;
    expect(move.subflow).toBeDefined();
    const sf = move.subflow!();
    // Single stage, no explicit presentation (renders inline by inference).
    expect(sf.presentation).toBeUndefined();
    // Standalone leads, then each active project; the shared project echoes its owner.
    expect(sf.items.map((i) => i.label)).toEqual([
      "Standalone",
      "Mitochondria QC",
      "Shared screen",
    ]);
    expect(sf.items[0].id).toBe("__standalone__");
    expect(sf.items[1].detail).toBeUndefined();
    expect(sf.items[2].detail).toBe("shared by alex");
    // Picking a real project completes (returns void) and passes its numeric id.
    const next = sf.onPick(sf.items[2]);
    expect(next).toBeUndefined();
    expect(moved).toEqual([[1, 20]]);
    // Picking Standalone passes project_id null.
    const done = sf.onPick(sf.items[0]);
    expect(done).toBeUndefined();
    expect(moved).toEqual([[1, 20], [1, null]]);
  });

  it("gates move-to-project off for a read-only shared task", () => {
    const cmds = buildGanttSource(
      makeData({
        editingTaskKey: "alex:2",
        allTasks: [
          makeTask({
            id: 2,
            owner: "alex",
            is_shared_with_me: true,
            shared_permission: "view",
            name: "Shared run",
          }),
        ],
      }),
      noopHandlers,
    ).commands;
    const move = cmds.find((c) => c.id === "gantt-task-move-project");
    expect(move?.enabled).toBe(false);
    expect(move?.subflow).toBeDefined();
  });

  it("disables assign when there are no assignable members", () => {
    const cmds = buildGanttSource(
      makeData({ editingTaskKey: "self:1", labMembers: [] }),
      noopHandlers,
    ).commands;
    expect(cmds.find((c) => c.id === "gantt-task-assign")?.enabled).toBe(false);
  });

  it("STACK add-dependency, stage 1 lists other experiments and chains to stage 2 dep types", () => {
    const created: Array<[number, number, string]> = [];
    const handlers: GanttSourceHandlers = {
      ...noopHandlers,
      createDependency: (parentId, childId, depType) => {
        created.push([parentId, childId, depType]);
      },
    };
    const parent = makeTask({ id: 1, name: "PCR optimization" });
    const child = makeTask({ id: 2, name: "Cloning run", task_type: "experiment" });
    const cmds = buildGanttSource(
      makeData({
        allTasks: [parent, child],
        filteredTasks: [parent, child],
        editingTaskKey: "self:1",
      }),
      handlers,
    ).commands;
    const addDep = cmds.find((c) => c.id === "gantt-task-add-dependency")!;
    expect(addDep.enabled).toBe(true);
    const sf = addDep.subflow!();
    // Stage 1 is an explicit stack, listing the OTHER experiment only.
    expect(sf.presentation).toBe("stack");
    expect(sf.items.map((i) => i.label)).toEqual(["Cloning run"]);
    // Picking stage 1 CHAINS to stage 2 (the three dep types).
    const stage2 = sf.onPick(sf.items[0]);
    expect(stage2 && typeof stage2 === "object").toBe(true);
    const s2 = stage2 as PaletteSubflow;
    expect(s2.items.map((i) => i.id)).toEqual(["FS", "SS", "SF"]);
    // Picking a dep type completes and calls dependenciesApi.create.
    const done = s2.onPick(s2.items[0]);
    expect(done).toBeUndefined();
    expect(created).toEqual([[1, 2, "FS"]]);
  });

  it("disables add-dependency for an experiment with no other experiment to link to", () => {
    const cmds = buildGanttSource(
      makeData({ editingTaskKey: "self:1" }),
      noopHandlers,
    ).commands;
    // The default fixture has only one experiment, so there is nothing to link to.
    expect(cmds.find((c) => c.id === "gantt-task-add-dependency")?.enabled).toBe(false);
  });
});
