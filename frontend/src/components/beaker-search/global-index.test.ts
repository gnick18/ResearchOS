// sequence editor master. BeakerSearch global object search, chunk 1, tests for
// the PURE index builder. These cover the data shape the global source ranks and
// renders without a DOM (mirrors editor-commands.test.ts), the composite keys,
// the deep-link hrefs, the sublines, the haystack folding, and the recency
// stamp, so the index brain is verified before any provider wiring.

import { describe, it, expect } from "vitest";
import { buildGlobalIndex, buildInventoryEntry, type GlobalIndexInput } from "./global-index";
import type { Task, Method, Project, SequenceRecord, InventoryItem } from "@/lib/types";

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
    inventoryItems: [],
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

// ── Inventory entries (chunk-5 bot 2026-06-07) ───────────────────────────────
// buildInventoryEntry is tested directly (the pure per-item builder) so the
// entry shape is verified independently of INVENTORY_ENABLED (which is false
// by default and cannot be flipped in unit tests). The gating behavior (flag
// off => no entries in buildGlobalIndex) is covered by a separate assertion.

function makeInventoryItem(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 5,
    name: "Q5 Polymerase",
    category: "enzyme",
    catalog_number: "M0491S",
    vendor: "NEB",
    cas: null,
    url: null,
    container_label: null,
    notes: null,
    low_at_count: 2,
    product_barcode: null,
    owner: CURRENT_USER,
    shared_with: [],
    created_by: CURRENT_USER,
    last_edited_at: "2026-06-06T09:00:00Z",
    ...over,
  } as InventoryItem;
}

describe("buildInventoryEntry (pure entry builder)", () => {
  it("builds the composite key and base href", () => {
    const entry = buildInventoryEntry(makeInventoryItem({ id: 5, owner: CURRENT_USER }));
    expect(entry.type).toBe("inventory");
    expect(entry.key).toBe(`${CURRENT_USER}:5`);
    expect(entry.href).toBe("/inventory");
    expect(entry.enabled).toBe(true);
  });

  it("uses the owner namespace for a shared item", () => {
    const entry = buildInventoryEntry(makeInventoryItem({ id: 9, owner: "alex" }));
    expect(entry.key).toBe("alex:9");
  });

  it("sets the label to the item name", () => {
    const entry = buildInventoryEntry(makeInventoryItem({ name: "Q5 Polymerase" }));
    expect(entry.label).toBe("Q5 Polymerase");
  });

  it("builds the meta subline from category, vendor, catalog_number", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ category: "enzyme", vendor: "NEB", catalog_number: "M0491S" }),
    );
    expect(entry.meta).toContain("enzyme");
    expect(entry.meta).toContain("NEB");
    expect(entry.meta).toContain("M0491S");
  });

  it("falls back to category-only when vendor and catalog_number are null", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ vendor: null, catalog_number: null }),
    );
    expect(entry.meta).toBe("enzyme");
  });

  it("folds name + vendor + catalog_number + cas + notes into a lowercased haystack", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ name: "Q5", vendor: "NEB", cas: "9007-49-2", notes: "premium" }),
    );
    expect(entry.haystack).toContain("q5");
    expect(entry.haystack).toContain("neb");
    expect(entry.haystack).toContain("9007-49-2");
    expect(entry.haystack).toContain("premium");
    expect(entry.haystack).toBe(entry.haystack.toLowerCase());
  });

  it("parses last_edited_at to epoch ms for recency", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ last_edited_at: "2026-06-06T09:00:00Z" }),
    );
    expect(entry.recencyAt).toBe(Date.parse("2026-06-06T09:00:00Z"));
  });

  it("falls back to 0 recency when the stamp is absent", () => {
    const entry = buildInventoryEntry(
      makeInventoryItem({ last_edited_at: undefined }),
    );
    expect(entry.recencyAt).toBe(0);
  });

  it("uses the vial icon name", () => {
    const entry = buildInventoryEntry(makeInventoryItem());
    expect(entry.iconName).toBe("vial");
  });
});

describe("buildGlobalIndex inventory gating", () => {
  it("suppresses inventory entries when INVENTORY_ENABLED is false (default)", () => {
    // The config default is false; the index builder skips the inventory loop.
    const entries = build({ inventoryItems: [makeInventoryItem()] });
    expect(entries.filter((e) => e.type === "inventory")).toHaveLength(0);
  });
});
