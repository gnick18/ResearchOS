// sequence editor master. BeakerSearch global object search, chunk 1, tests for
// the PURE index builder. These cover the data shape the global source ranks and
// renders without a DOM (mirrors editor-commands.test.ts), the composite keys,
// the deep-link hrefs, the sublines, the haystack folding, and the recency
// stamp, so the index brain is verified before any provider wiring.

import { describe, it, expect } from "vitest";
import { buildGlobalIndex, type GlobalIndexInput } from "./global-index";
import type { Task, Method, Project, SequenceRecord } from "@/lib/types";

const CURRENT_USER = "morgan";

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 7,
    name: "PCR optimization",
    start_date: "2026-06-01",
    duration_days: 1,
    task_type: "experiment",
    tags: ["pcr", "qpcr"],
    owner: CURRENT_USER,
    last_edited_at: "2026-06-05T10:00:00Z",
    ...over,
  } as Task;
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 7,
    name: "Mitochondria QC",
    tags: ["mito"],
    owner: CURRENT_USER,
    last_edited_at: "2026-06-04T10:00:00Z",
    ...over,
  } as Project;
}

function makeMethod(over: Partial<Method> = {}): Method {
  return {
    id: 3,
    name: "qPCR master mix",
    method_type: "pcr",
    folder_path: "Molecular Biology",
    parent_method_id: null,
    tags: ["mix"],
    is_public: false,
    owner: CURRENT_USER,
    last_edited_at: "2026-06-03T10:00:00Z",
    ...over,
  } as Method;
}

function makeSequence(over: Partial<SequenceRecord> = {}): SequenceRecord {
  return {
    id: 12,
    display_name: "pGEX-3X",
    project_ids: [],
    added_at: "2026-06-02T10:00:00Z",
    seq_type: "DNA",
    length: 4952,
    circular: true,
    feature_count: 5,
    organism: "Schistosoma japonicum",
    ...over,
  } as SequenceRecord;
}

function build(over: Partial<GlobalIndexInput> = {}) {
  return buildGlobalIndex({
    tasks: [],
    projects: [],
    methods: [],
    sequences: [],
    currentUser: CURRENT_USER,
    ...over,
  });
}

describe("buildGlobalIndex (shape and counts)", () => {
  it("emits one entry per core record across all four types", () => {
    const entries = build({
      tasks: [makeTask()],
      projects: [makeProject()],
      methods: [makeMethod()],
      sequences: [makeSequence()],
    });
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.type).sort()).toEqual(["method", "project", "sequence", "task"]);
  });

  it("returns an empty index when every set is empty", () => {
    expect(build()).toEqual([]);
  });

  it("precomputes a lowercased haystack and marks entries enabled", () => {
    const [entry] = build({ tasks: [makeTask()] });
    expect(entry.haystack).toBe(entry.haystack.toLowerCase());
    expect(entry.haystack).toContain("pcr optimization");
    expect(entry.enabled).toBe(true);
  });
});

describe("task entries", () => {
  it("keys an own task self:<id> and resolves its project name into the subline", () => {
    const [task] = build({ tasks: [makeTask()], projects: [makeProject()] }).filter(
      (e) => e.type === "task",
    );
    expect(task.key).toBe("self:1");
    expect(task.meta).toBe("Experiment in Mitochondria QC");
    expect(task.href).toBe("/?openTask=self%3A1");
  });

  it("reads Standalone when the task has no resolvable project", () => {
    const [task] = build({ tasks: [makeTask({ project_id: 999 })] }).filter(
      (e) => e.type === "task",
    );
    expect(task.meta).toBe("Experiment in Standalone");
  });

  it("keys a shared task by its owner namespace and notes the sharer", () => {
    const [task] = build({
      tasks: [makeTask({ owner: "alex", is_shared_with_me: true })],
    }).filter((e) => e.type === "task");
    expect(task.key).toBe("alex:1");
    expect(task.meta).toContain("shared by alex");
    expect(task.href).toContain("openTask=alex%3A1");
    expect(task.haystack).toContain("alex");
  });

  it("opens a purchase task through the same home-route opener as any task", () => {
    const [task] = build({ tasks: [makeTask({ task_type: "purchase" })] }).filter(
      (e) => e.type === "task",
    );
    expect(task.meta.startsWith("Purchase in")).toBe(true);
    expect(task.href).toBe("/?openTask=self%3A1");
  });
});

describe("project entries", () => {
  it("keys an own project ${owner}:${id} with a bare /workbench/projects route", () => {
    const [project] = build({ projects: [makeProject()] });
    expect(project.key).toBe("morgan:7");
    expect(project.href).toBe("/workbench/projects/7");
    expect(project.meta).toBe("Project");
  });

  it("appends ?owner= for a shared project", () => {
    const [project] = build({
      projects: [makeProject({ owner: "alex", is_shared_with_me: true })],
    });
    expect(project.key).toBe("alex:7");
    expect(project.href).toBe("/workbench/projects/7?owner=alex");
    expect(project.meta).toBe("Project, shared by alex");
  });
});

describe("method entries", () => {
  it("keys an owned method, labels its type and folder, and uses ?openMethod=", () => {
    const [method] = build({ methods: [makeMethod()] });
    expect(method.key).toBe("morgan:3");
    expect(method.href).toBe("/methods?openMethod=3");
    expect(method.meta).toContain("PCR");
    expect(method.meta).toContain("Molecular Biology");
  });

  it("keys a lab-wide method public:<id> and labels it lab-wide", () => {
    const [method] = build({ methods: [makeMethod({ is_public: true })] });
    expect(method.key).toBe("public:3");
    expect(method.meta).toContain("lab-wide");
  });

  it("notes read-only for a shared method", () => {
    const [method] = build({
      methods: [makeMethod({ owner: "alex", is_shared_with_me: true })],
    });
    expect(method.key).toBe("alex:3");
    expect(method.meta).toContain("read-only");
  });

  it("reads Uncategorized when the method has no folder", () => {
    const [method] = build({ methods: [makeMethod({ folder_path: null })] });
    expect(method.meta).toContain("Uncategorized");
  });
});

describe("sequence entries", () => {
  it("keys a sequence by its bare numeric id and uses ?seq=", () => {
    const [seq] = build({ sequences: [makeSequence()] });
    expect(seq.key).toBe("12");
    expect(seq.href).toBe("/sequences?seq=12");
    expect(seq.iconName).toBe("moleculeCircular");
    expect(seq.meta).toBe("DNA, Circular, 4,952 bp, Schistosoma japonicum");
    expect(seq.haystack).toContain("schistosoma");
  });

  it("uses the linear icon and omits the organism when absent", () => {
    const [seq] = build({
      sequences: [makeSequence({ circular: false, organism: undefined, length: 338 })],
    });
    expect(seq.iconName).toBe("moleculeLinear");
    expect(seq.meta).toBe("DNA, Linear, 338 bp");
  });
});

describe("recency", () => {
  it("parses an edit stamp to epoch ms and falls back to 0 when absent", () => {
    const [withStamp] = build({ tasks: [makeTask()] });
    expect(withStamp.recencyAt).toBe(Date.parse("2026-06-05T10:00:00Z"));
    const [noStamp] = build({ tasks: [makeTask({ last_edited_at: undefined })] });
    expect(noStamp.recencyAt).toBe(0);
  });
});
