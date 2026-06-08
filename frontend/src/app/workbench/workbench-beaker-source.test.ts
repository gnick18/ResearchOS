// sequence editor master (Workbench source sub-bot). Tests for the PURE
// Workbench BeakerSearch source builder. These cover the context-card copy (per
// tab + the filter scope clause + a per-entity selection line), the command set
// (ids + page-defined groups + the selection / filter / permission gating), the
// Suggested ordering per focused-entity kind + the orientation defaults, the nav
// groups (the cross-tab Jump-to groups with their tones + the tab-jump set that
// hides the 1:1 jump when !showOneOnOneTab), and the recently-opened MRU
// resolution, all without a DOM or a store, mirroring
// gantt-beaker-source.test.ts and calendar-beaker-source.test.ts.

import { describe, it, expect } from "vitest";
import type { Note, Notebook, OneOnOne, Project, Task } from "@/lib/types";
import {
  buildWorkbenchSource,
  noteKey,
  type WorkbenchSourceData,
  type WorkbenchSourceHandlers,
} from "./workbench-beaker-source";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 1,
    owner: "alex",
    name: "Mitochondria QC",
    color: "#3b82f6",
    is_shared_with_me: false,
    ...over,
  } as Project;
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 10,
    owner: "alex",
    name: "PCR optimization",
    task_type: "experiment",
    project_id: 1,
    start_date: "2026-06-01",
    end_date: "2026-06-10",
    duration_days: 9,
    is_complete: false,
    is_shared_with_me: false,
    sub_tasks: null,
    ...over,
  } as Task;
}

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: 5,
    title: "PCR optimization log",
    description: "ran a gradient",
    is_running_log: false,
    is_shared: false,
    entries: [],
    updated_at: "2026-06-07",
    username: "alex",
    ...over,
  } as Note;
}

function makeNotebook(over: Partial<Notebook> = {}): Notebook {
  return {
    id: "nb-1",
    members: ["alex", "morgan"],
    created_by: "alex",
    created_at: "2026-06-01",
    title: "Lab meeting",
    owner: "alex",
    shared_with: [],
    ...over,
  } as Notebook;
}

function makeOneOnOne(over: Partial<OneOnOne> = {}): OneOnOne {
  return {
    id: "oo-1",
    labHead: "alex",
    member: "morgan",
    created_by: "alex",
    created_at: "2026-06-01",
    owner: "alex",
    shared_with: [],
    ...over,
  } as OneOnOne;
}

const noopHandlers: WorkbenchSourceHandlers = {
  setActiveTab: () => {},
  requestOpen: () => {},
  recordRecent: () => {},
  openProject: () => {},
  createProject: () => {},
  createExperiment: () => {},
  createListTask: () => {},
  createNote: () => {},
  createRunningLog: () => {},
  createOneOnOne: () => {},
  toggleProjectFilter: () => {},
  toggleStandaloneFilter: () => {},
  clearProjectFilter: () => {},
  selectAllNotes: () => {},
  selectUnfiledNotes: () => {},
  openTaskComments: () => {},
  toggleListComplete: () => {},
  expandListInline: () => {},
  openNoteComments: () => {},
  moveNoteToNotebook: () => {},
  deleteNote: () => {},
  setOneOnOneArea: () => {},
  deleteOneOnOne: () => {},
};

const taskKeyOf = (t: Task) => (t.is_shared_with_me ? `${t.owner}:${t.id}` : `self:${t.id}`);
const projectKeyOf = (p: Project) => `${p.owner}:${p.id}`;

function makeData(over: Partial<WorkbenchSourceData> = {}): WorkbenchSourceData {
  const projects = over.projects ?? [makeProject()];
  const experiments = over.experiments ?? [makeTask()];
  const lists = over.lists ?? [];
  const notes = over.notes ?? [makeNote()];
  const notebooks = over.notebooks ?? [makeNotebook()];
  const oneOnOnes = over.oneOnOnes ?? [makeOneOnOne()];
  return {
    activeTab: "experiments",
    oneOnOneTabLabel: "Mentoring",
    showOneOnOneTab: true,
    isLabHead: true,
    currentUser: "alex",
    projectFilterMode: "all",
    selectedProjectIds: [],
    projects,
    experiments,
    lists,
    notes,
    notebooks,
    oneOnOnes,
    onScreenExperiments: experiments,
    onScreenLists: lists,
    onScreenNotes: notes,
    selectedExperiment: null,
    selectedList: null,
    selectedNote: null,
    selectedOneOnOne: null,
    hovered: null,
    recent: [],
    taskKeyOf,
    projectKeyOf,
    standaloneFilterKey: "__standalone__",
    notebookTitleOf: (nb) => nb.title ?? "Notebook",
    projectDetailOf: () => "8 experiments, 62% complete",
    oneOnOneNameOf: (oo) => `1:1 with ${oo.member}`,
    experimentDetailOf: () => "Running, day 2 of 5",
    listDetailOf: () => "Overdue 3d",
    noteDetailOf: () => "in Lab meeting, updated 2h ago",
    noteEditableOf: () => true,
    projectLabelForTask: () => "Mitochondria QC",
    ...over,
  };
}

// ── Context card ─────────────────────────────────────────────────────────────

describe("buildWorkbenchSource context card", () => {
  it("is Workbench + the active tab + the per-tab sub, no selection when none open", () => {
    const card = buildWorkbenchSource(makeData(), noopHandlers).contextCard!;
    expect(card.title).toBe("Workbench");
    expect(card.meta).toBe("Experiments, 1 in flight");
    expect(card.selection).toBeUndefined();
  });

  it("prints the role-relative 1:1 tab label in the meta", () => {
    const card = buildWorkbenchSource(
      makeData({ activeTab: "oneonone" }),
      noopHandlers,
    ).contextCard!;
    expect(card.meta).toBe("Mentoring, 1 active 1:1");
  });

  it("adds the filtered-to clause for a single project filter (Experiments tab)", () => {
    const card = buildWorkbenchSource(
      makeData({
        projectFilterMode: "explicit",
        selectedProjectIds: ["alex:1"],
      }),
      noopHandlers,
    ).contextCard!;
    expect(card.meta).toBe("Experiments, filtered to Mitochondria QC, 1 in flight");
  });

  it("collapses many project filters and appends Standalone", () => {
    const projects = [
      makeProject({ id: 1, name: "Mitochondria QC" }),
      makeProject({ id: 2, name: "Cloning" }),
    ];
    const card = buildWorkbenchSource(
      makeData({
        projects,
        projectFilterMode: "explicit",
        selectedProjectIds: ["alex:1", "alex:2", "__standalone__"],
      }),
      noopHandlers,
    ).contextCard!;
    expect(card.meta).toBe(
      "Experiments, filtered to 2 projects + Standalone, 1 in flight",
    );
  });

  it("does not show the filter clause on the Notes tab (project-agnostic)", () => {
    const card = buildWorkbenchSource(
      makeData({
        activeTab: "notes",
        projectFilterMode: "explicit",
        selectedProjectIds: ["alex:1"],
      }),
      noopHandlers,
    ).contextCard!;
    expect(card.meta).toBe("Notes, 1 note");
  });

  it("adds the selected-experiment line with the section echo", () => {
    const card = buildWorkbenchSource(
      makeData({ selectedExperiment: makeTask() }),
      noopHandlers,
    ).contextCard!;
    expect(card.selection?.text).toBe("PCR optimization, Running, day 2 of 5");
  });

  it("adds the selected-note line and the selected-1:1 name line", () => {
    const noteCard = buildWorkbenchSource(
      makeData({ activeTab: "notes", selectedNote: makeNote() }),
      noopHandlers,
    ).contextCard!;
    expect(noteCard.selection?.text).toBe(
      "PCR optimization log, in Lab meeting, updated 2h ago",
    );
    const ooCard = buildWorkbenchSource(
      makeData({ activeTab: "oneonone", selectedOneOnOne: makeOneOnOne() }),
      noopHandlers,
    ).contextCard!;
    expect(ooCard.selection?.text).toBe("1:1 with morgan");
  });
});

// ── Commands ─────────────────────────────────────────────────────────────────

describe("buildWorkbenchSource commands", () => {
  it("always emits the Create / Switch tab / Filter / notebook commands with groups", () => {
    const cmds = buildWorkbenchSource(makeData(), noopHandlers).commands;
    const byId = new Map(cmds.map((c) => [c.id, c]));
    expect(byId.get("workbench-new-project")?.group).toBe("Create");
    expect(byId.get("workbench-new-experiment")?.group).toBe("Create");
    expect(byId.get("workbench-new-note")?.group).toBe("Create");
    expect(byId.get("workbench-tab-projects")?.group).toBe("Switch tab");
    expect(byId.get("workbench-filter-clear")?.group).toBe("Filter");
    expect(byId.get("workbench-notebook-all")?.group).toBe("Open a notebook");
  });

  it("gates New 1:1 on lab-head", () => {
    const head = new Map(
      buildWorkbenchSource(makeData({ isLabHead: true }), noopHandlers).commands.map(
        (c) => [c.id, c],
      ),
    );
    expect(head.get("workbench-new-oneonone")?.enabled).toBe(true);
    const member = new Map(
      buildWorkbenchSource(makeData({ isLabHead: false }), noopHandlers).commands.map(
        (c) => [c.id, c],
      ),
    );
    expect(member.get("workbench-new-oneonone")?.enabled).toBe(false);
  });

  it("disables the tab switch for the tab you are on and hides the 1:1 tab when gated", () => {
    const onExp = new Map(
      buildWorkbenchSource(
        makeData({ activeTab: "experiments" }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(onExp.get("workbench-tab-experiments")?.enabled).toBe(false);
    expect(onExp.get("workbench-tab-projects")?.enabled).toBe(true);
    expect(onExp.has("workbench-tab-oneonone")).toBe(true);

    const gated = buildWorkbenchSource(
      makeData({ showOneOnOneTab: false }),
      noopHandlers,
    ).commands.map((c) => c.id);
    expect(gated).not.toContain("workbench-tab-oneonone");
  });

  it("enables Filter only on the Experiments / Lists tabs and Clear only when a filter is active", () => {
    const onNotes = new Map(
      buildWorkbenchSource(
        makeData({ activeTab: "notes" }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(onNotes.get("workbench-filter-alex:1")?.enabled).toBe(false);
    expect(onNotes.get("workbench-filter-clear")?.enabled).toBe(false);

    const filtered = new Map(
      buildWorkbenchSource(
        makeData({
          activeTab: "experiments",
          projectFilterMode: "explicit",
          selectedProjectIds: ["alex:1"],
        }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(filtered.get("workbench-filter-alex:1")?.enabled).toBe(true);
    expect(filtered.get("workbench-filter-clear")?.enabled).toBe(true);
  });

  it("emits the selected-experiment row actions under Selected", () => {
    const sel = buildWorkbenchSource(
      makeData({ selectedExperiment: makeTask() }),
      noopHandlers,
    ).commands.filter((c) => c.group === "Selected");
    expect(sel.map((c) => c.id)).toEqual([
      "workbench-experiment-open",
      "workbench-experiment-comment",
    ]);
  });

  it("gates the list complete toggle on edit permission", () => {
    const viewOnly = makeTask({
      task_type: "list",
      is_shared_with_me: true,
      shared_permission: "view",
    });
    const cmds = buildWorkbenchSource(
      makeData({ activeTab: "lists", selectedList: viewOnly, lists: [viewOnly] }),
      noopHandlers,
    ).commands;
    expect(cmds.find((c) => c.id === "workbench-list-toggle")?.enabled).toBe(false);

    const editable = makeTask({ task_type: "list" });
    const cmds2 = buildWorkbenchSource(
      makeData({ activeTab: "lists", selectedList: editable, lists: [editable] }),
      noopHandlers,
    ).commands;
    expect(cmds2.find((c) => c.id === "workbench-list-toggle")?.enabled).toBe(true);
  });

  it("greys note move + delete for a view-only note and gates 1:1 delete on lab-head", () => {
    const noteCmds = buildWorkbenchSource(
      makeData({
        activeTab: "notes",
        selectedNote: makeNote(),
        noteEditableOf: () => false,
      }),
      noopHandlers,
    ).commands;
    expect(noteCmds.find((c) => c.id === "workbench-note-move")?.enabled).toBe(false);
    expect(noteCmds.find((c) => c.id === "workbench-note-delete")?.enabled).toBe(false);

    const ooCmds = buildWorkbenchSource(
      makeData({
        activeTab: "oneonone",
        selectedOneOnOne: makeOneOnOne(),
        isLabHead: false,
      }),
      noopHandlers,
    ).commands;
    expect(ooCmds.find((c) => c.id === "workbench-oneonone-delete")?.enabled).toBe(false);
  });

  it("echoes the single-project filter into the New experiment detail", () => {
    const cmds = buildWorkbenchSource(
      makeData({
        projectFilterMode: "explicit",
        selectedProjectIds: ["alex:1"],
      }),
      noopHandlers,
    ).commands;
    expect(cmds.find((c) => c.id === "workbench-new-experiment")?.detail).toBe(
      "in Mitochondria QC",
    );
  });
});

// ── Suggested ────────────────────────────────────────────────────────────────

describe("buildWorkbenchSource suggested ordering", () => {
  it("leads with Open + Add a comment for a selected experiment (the mockup order)", () => {
    const src = buildWorkbenchSource(
      makeData({ selectedExperiment: makeTask() }),
      noopHandlers,
    );
    expect(src.suggestedIds!.slice(0, 2)).toEqual([
      "workbench-experiment-open",
      "workbench-experiment-comment",
    ]);
    expect(src.suggestedHint).toBe("for the selected experiment");
    // Every suggested id must exist in commands (absent ones are skipped).
    const ids = new Set(src.commands.map((c) => c.id));
    for (const id of src.suggestedIds ?? []) expect(ids.has(id)).toBe(true);
  });

  it("uses the list / note / 1:1 sets when those are selected", () => {
    const list = makeTask({ task_type: "list" });
    expect(
      buildWorkbenchSource(
        makeData({ activeTab: "lists", selectedList: list, lists: [list] }),
        noopHandlers,
      ).suggestedIds!.slice(0, 3),
    ).toEqual([
      "workbench-list-open",
      "workbench-list-toggle",
      "workbench-list-expand",
    ]);
    expect(
      buildWorkbenchSource(
        makeData({ activeTab: "notes", selectedNote: makeNote() }),
        noopHandlers,
      ).suggestedHint,
    ).toBe("for the selected note");
    expect(
      buildWorkbenchSource(
        makeData({ activeTab: "oneonone", selectedOneOnOne: makeOneOnOne() }),
        noopHandlers,
      ).suggestedHint,
    ).toBe("for the selected 1:1");
  });

  it("falls back to the tab orientation defaults when nothing is selected", () => {
    const src = buildWorkbenchSource(
      makeData({ activeTab: "experiments" }),
      noopHandlers,
    );
    expect(src.suggestedIds![0]).toBe("workbench-new-experiment");
    expect(src.suggestedHint).toBeUndefined();
  });
});

// ── Nav groups ───────────────────────────────────────────────────────────────

describe("buildWorkbenchSource nav groups", () => {
  it("emits the cross-tab Jump-to groups with task / project / note / person tones", () => {
    const src = buildWorkbenchSource(makeData(), noopHandlers);
    const groups = src.navGroups ?? [];
    const titles = groups.map((g) => g.title);
    expect(titles).toEqual([
      "Jump to an experiment",
      "Jump to a project",
      "Jump to a note",
      "Jump to a 1:1",
      "Go to a tab",
    ]);
    const exp = groups.find((g) => g.title === "Jump to an experiment")!;
    expect(exp.items[0].tone).toBe("task");
    expect(groups.find((g) => g.title === "Jump to a project")!.items[0].tone).toBe(
      "project",
    );
    const noteGroup = groups.find((g) => g.title === "Jump to a note")!;
    expect(noteGroup.items[0].tone).toBe("note");
    // The notebook row also lives in the note group, indigo, and reads as a notebook.
    expect(noteGroup.items.some((i) => i.label.includes("notebook"))).toBe(true);
    expect(groups.find((g) => g.title === "Jump to a 1:1")!.items[0].tone).toBe(
      "person",
    );
  });

  it("includes all five tab jumps and self-hides the 1:1 one when gated", () => {
    const shown = buildWorkbenchSource(makeData(), noopHandlers).navGroups!.find(
      (g) => g.title === "Go to a tab",
    )!;
    expect(shown.items.map((i) => i.label)).toEqual([
      "Go to Projects",
      "Go to Experiments",
      "Go to Notes",
      "Go to Lists",
      "Go to Mentoring",
    ]);

    const gated = buildWorkbenchSource(
      makeData({ showOneOnOneTab: false }),
      noopHandlers,
    ).navGroups!;
    const tabJump = gated.find((g) => g.title === "Go to a tab")!;
    expect(tabJump.items.map((i) => i.label)).not.toContain("Go to Mentoring");
    // The 1:1 jump group also vanishes when gated.
    expect(gated.some((g) => g.title === "Jump to a 1:1")).toBe(false);
  });

  it("omits the Recently opened group when the MRU is empty and resolves it when not", () => {
    expect(
      buildWorkbenchSource(makeData(), noopHandlers).navGroups!.some(
        (g) => g.title === "Recently opened",
      ),
    ).toBe(false);

    const exp = makeTask();
    const nb = makeNotebook();
    const src = buildWorkbenchSource(
      makeData({
        recent: [
          { kind: "experiment", key: taskKeyOf(exp) },
          { kind: "notebook", key: `notebook-${nb.id}` },
          { kind: "experiment", key: "self:999" }, // stale, dropped
        ],
      }),
      noopHandlers,
    );
    const recent = src.navGroups!.find((g) => g.title === "Recently opened")!;
    expect(recent.items.map((i) => i.label)).toEqual([
      "PCR optimization",
      "Lab meeting notebook",
    ]);
    expect(recent.items[0].detail).toBe("opened recently");
  });

  it("leads the experiment jump with the on-screen scope then widens to all", () => {
    const inView = makeTask({ id: 10, name: "In view" });
    const offScreen = makeTask({ id: 20, name: "Off screen" });
    const src = buildWorkbenchSource(
      makeData({
        experiments: [inView, offScreen],
        onScreenExperiments: [inView],
      }),
      noopHandlers,
    );
    const exp = src.navGroups!.find((g) => g.title === "Jump to an experiment")!;
    expect(exp.items.map((i) => i.label)).toEqual(["In view", "Off screen"]);
    expect(exp.hint).toBe("in view (1)");
  });
});

// ── Hover as context (SELECTED > HOVERED) ────────────────────────────────────

describe("buildWorkbenchSource hover as context", () => {
  it("a hovered experiment with no selection drives its Suggested + a Pointing at line", () => {
    const hov = makeTask({ id: 42, name: "Hovered run" });
    const src = buildWorkbenchSource(
      makeData({
        experiments: [hov],
        hovered: { kind: "experiment", task: hov },
      }),
      noopHandlers,
    );
    // The context-card selection line frames the hovered card.
    expect(src.contextCard!.selection?.text).toBe(
      "Pointing at Hovered run, Running, day 2 of 5",
    );
    // Suggested leads with the same per-entity action ids a selection would.
    expect(src.suggestedIds!.slice(0, 2)).toEqual([
      "workbench-experiment-open",
      "workbench-experiment-comment",
    ]);
    expect(src.suggestedHint).toBe("for the experiment you were pointing at");
    // Those ids resolve to real commands (the hovered card emits the rows).
    const ids = new Set(src.commands.map((c) => c.id));
    expect(ids.has("workbench-experiment-open")).toBe(true);
    expect(ids.has("workbench-experiment-comment")).toBe(true);
  });

  it("SELECTED outranks HOVERED, the open entity wins over a stale hover", () => {
    const selected = makeTask({ id: 1, name: "Open experiment" });
    const hov = makeTask({ id: 2, name: "Hovered experiment" });
    const src = buildWorkbenchSource(
      makeData({
        experiments: [selected, hov],
        selectedExperiment: selected,
        hovered: { kind: "experiment", task: hov },
      }),
      noopHandlers,
    );
    // The selection line names the open entity plainly, no "Pointing at".
    expect(src.contextCard!.selection?.text).toBe(
      "Open experiment, Running, day 2 of 5",
    );
    expect(src.suggestedHint).toBe("for the selected experiment");
  });

  it("frames a hovered note and a hovered project with their own copy", () => {
    const note = makeNote({ id: 9, title: "Hovered note" });
    const noteSrc = buildWorkbenchSource(
      makeData({ activeTab: "notes", notes: [note], hovered: { kind: "note", note } }),
      noopHandlers,
    );
    expect(noteSrc.contextCard!.selection?.text).toBe(
      "Pointing at Hovered note, in Lab meeting, updated 2h ago",
    );
    expect(noteSrc.suggestedHint).toBe("for the note you were pointing at");

    const project = makeProject({ id: 3, name: "Hovered project" });
    const projSrc = buildWorkbenchSource(
      makeData({
        activeTab: "projects",
        projects: [project],
        hovered: { kind: "project", project },
      }),
      noopHandlers,
    );
    // A hovered project surfaces a context-card line but has no per-entity
    // Suggested rows, so it carries no selection-specific hint.
    expect(projSrc.contextCard!.selection?.text).toBe(
      "Pointing at Hovered project, 8 experiments, 62% complete",
    );
    expect(projSrc.suggestedHint).toBeUndefined();
  });
});

describe("noteKey", () => {
  it("composes a collision-safe owner-namespaced key, falling back to the viewer", () => {
    expect(noteKey(makeNote({ id: 5, username: "morgan" }), "alex")).toBe(
      "note-morgan:5",
    );
    expect(noteKey(makeNote({ id: 7, username: "" }), "alex")).toBe("note-alex:7");
  });
});
