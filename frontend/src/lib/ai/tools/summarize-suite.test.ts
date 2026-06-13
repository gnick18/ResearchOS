// Unit tests for the rest of the summary suite, summarize_notes,
// summarize_projects, summarize_inventory, and lab_digest. The WHOLE point is to
// assert the TOOL computes the counts, the status tallies, the percent complete,
// the low / out / expiring sets, and the composed digest DETERMINISTICALLY from a
// fixture, never the model. We pin "today" where status / expiry math needs it and
// stub the loaders via each tool's injectable deps seam.

import { describe, it, expect, afterEach } from "vitest";
import {
  aggregateNotes,
  summarizeNotesTool,
  summarizeNotesDeps,
  type SummarizeNotesDeps,
} from "./summarize-notes";
import {
  aggregateProjects,
  summarizeProjectsTool,
  summarizeProjectsDeps,
  type SummarizeProjectsDeps,
} from "./summarize-projects";
import {
  aggregateInventory,
  summarizeInventoryTool,
  summarizeInventoryDeps,
  type SummarizeInventoryDeps,
} from "./summarize-inventory";
import { composeLabDigest, labDigestTool } from "./lab-digest";
import {
  summarizeExperimentsDeps,
} from "./summarize-experiments";
import { summarizePurchasesDeps } from "./summarize-purchases";
import type {
  Note,
  NoteEntry,
  Project,
  Task,
  PurchaseItem,
  InventoryItem,
  InventoryStock,
} from "@/lib/types";

const TODAY = "2026-06-12";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(title: string): NoteEntry {
  return {
    id: crypto.randomUUID(),
    title,
    date: "2026-06-01",
    content: "",
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-01T10:00:00Z",
  };
}

function makeNote(overrides: Partial<Note & { owner: string }> = {}): Note & { owner: string } {
  return {
    id: 1,
    title: "Transformation prep",
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [makeEntry("Colony count")],
    updated_at: "2026-06-10T10:00:00Z",
    username: "grant",
    owner: "grant",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: "cyp51A",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-05-01T10:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 1,
    name: "Run",
    start_date: "2026-06-10",
    duration_days: 1,
    end_date: "2026-06-10",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: [],
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 1,
    name: "Q5 polymerase",
    category: "enzyme",
    catalog_number: null,
    vendor: "NEB",
    cas: null,
    url: null,
    container_label: null,
    storage_class: null,
    hazard_note: null,
    sds_url: null,
    notes: null,
    low_at_count: null,
    product_barcode: null,
    owner: "grant",
    shared_with: [],
    created_by: null,
    ...overrides,
  };
}

function makeStock(overrides: Partial<InventoryStock> = {}): InventoryStock {
  return {
    id: 1,
    item_id: 1,
    lot_number: null,
    container_count: 2,
    status: "in_stock",
    received_date: null,
    expiration_date: null,
    opened_date: null,
    last_touched_at: null,
    amount_per_container: null,
    unit: null,
    concentration: null,
    location_text: null,
    location_node_id: null,
    position: null,
    purchase_item_id: null,
    container_code: null,
    notes: null,
    owner: "grant",
    shared_with: [],
    created_by: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// aggregateNotes (structural counts only)
// ---------------------------------------------------------------------------

describe("aggregateNotes (structural counts)", () => {
  function noteSet(): Array<Note & { owner: string }> {
    return [
      makeNote({ id: 1, owner: "grant", username: "grant", updated_at: "2026-06-10T10:00:00Z", entries: [makeEntry("Colony count"), makeEntry("Replated")] }),
      makeNote({ id: 2, owner: "alice", username: "alice", updated_at: "2026-06-05T10:00:00Z", entries: [makeEntry("Gel image")] }),
      makeNote({ id: 3, owner: "grant", username: "grant", updated_at: "2026-05-20T10:00:00Z", entries: [] }),
    ];
  }

  it("counts the total and by owner", () => {
    const s = aggregateNotes(noteSet(), { types: ["note"] });
    expect(s.total).toBe(3);
    expect(s.byOwner).toEqual({ grant: 2, alice: 1 });
  });

  it("builds a month histogram by updated date, ascending", () => {
    const s = aggregateNotes(noteSet(), { types: ["note"] });
    expect(s.byMonth).toEqual([
      { month: "2026-05", count: 1 },
      { month: "2026-06", count: 2 },
    ]);
  });

  it("totals entries across matched notes", () => {
    const s = aggregateNotes(noteSet(), { types: ["note"] });
    // 2 + 1 + 0 = 3
    expect(s.totalEntries).toBe(3);
  });

  it("surfaces the first entry title structurally, never a finding", () => {
    const s = aggregateNotes(noteSet(), { types: ["note"] });
    const note1 = s.items.find((i) => i.id === "1");
    expect(note1?.firstEntryTitle).toBe("Colony count");
    const note3 = s.items.find((i) => i.id === "3");
    expect(note3?.firstEntryTitle).toBeNull();
  });

  it("respects the owners filter", () => {
    const s = aggregateNotes(noteSet(), { types: ["note"], owners: ["alice"] });
    expect(s.total).toBe(1);
    expect(s.byOwner).toEqual({ alice: 1 });
  });

  it("scopes to a date window on the updated date", () => {
    const s = aggregateNotes(noteSet(), { types: ["note"], since: "2026-06-01" });
    expect(s.total).toBe(2);
  });

  it("returns a clean zero on no match", () => {
    const s = aggregateNotes(noteSet(), { types: ["note"], owners: ["nobody"] });
    expect(s.total).toBe(0);
    expect(s.byMonth).toEqual([]);
    expect(s.items).toEqual([]);
    expect(s.truncated).toBe(false);
  });

  it("does not collide notes from different owners sharing a numeric id", () => {
    // grant's note id 1 and alice's note id 1 share the same per-user numeric id.
    // A plain-id map dropped one of them; the compound owner:id key keeps both.
    const notes = [
      makeNote({ id: 1, owner: "grant", username: "grant", updated_at: "2026-06-10T10:00:00Z", entries: [makeEntry("A")] }),
      makeNote({ id: 1, owner: "alice", username: "alice", updated_at: "2026-06-09T10:00:00Z", entries: [makeEntry("B")] }),
    ];
    const s = aggregateNotes(notes, { types: ["note"] });
    expect(s.total).toBe(2);
    expect(s.byOwner).toEqual({ grant: 1, alice: 1 });
    expect(s.totalEntries).toBe(2);
  });

  it("caps the items list and flags truncation", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeNote({ id: i + 1, updated_at: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z` }),
    );
    const s = aggregateNotes(many, { types: ["note"] }, 15);
    expect(s.total).toBe(20);
    expect(s.items).toHaveLength(15);
    expect(s.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// aggregateProjects (per-project rollups)
// ---------------------------------------------------------------------------

describe("aggregateProjects (deterministic rollup)", () => {
  function fixtures(): { projects: Project[]; tasks: Task[] } {
    const projects = [
      makeProject({ id: 1, name: "cyp51A", owner: "grant" }),
      makeProject({ id: 2, name: "abc1", owner: "grant" }),
      makeProject({ id: 9, name: "Archived thing", is_archived: true, owner: "grant" }),
    ];
    const tasks = [
      // project 1: one complete, one overdue, one upcoming
      makeTask({ id: 1, project_id: 1, is_complete: true, start_date: "2026-06-01", end_date: "2026-06-02" }),
      makeTask({ id: 2, project_id: 1, is_complete: false, start_date: "2026-06-05", end_date: "2026-06-08" }), // overdue
      makeTask({ id: 3, project_id: 1, is_complete: false, start_date: "2026-06-20", end_date: "2026-06-22" }), // upcoming
      // project 2: one active
      makeTask({ id: 4, project_id: 2, is_complete: false, start_date: "2026-06-10", end_date: "2026-06-15" }),
      // a purchase-type row that must be EXCLUDED from the rollup
      makeTask({ id: 5, project_id: 1, task_type: "purchase", is_complete: false, start_date: "2026-06-01", end_date: "2026-06-01" }),
    ];
    return { projects, tasks };
  }

  it("counts projects in scope, excluding archived by default", () => {
    const { projects, tasks } = fixtures();
    const s = aggregateProjects(projects, tasks, TODAY, { includeShared: false, includeArchived: false });
    expect(s.totalProjects).toBe(2);
  });

  it("includes archived projects when asked", () => {
    const { projects, tasks } = fixtures();
    const s = aggregateProjects(projects, tasks, TODAY, { includeShared: false, includeArchived: true });
    expect(s.totalProjects).toBe(3);
  });

  it("rolls up task status per project, excluding purchase-type rows", () => {
    const { projects, tasks } = fixtures();
    const s = aggregateProjects(projects, tasks, TODAY, { includeShared: false, includeArchived: false });
    const p1 = s.projects.find((p) => p.id === "1")!;
    // 3 schedulable tasks (the purchase row is excluded).
    expect(p1.totalTasks).toBe(3);
    expect(p1.byStatus).toEqual({ complete: 1, active: 0, overdue: 1, upcoming: 1 });
  });

  it("computes percent complete as a whole number", () => {
    const { projects, tasks } = fixtures();
    const s = aggregateProjects(projects, tasks, TODAY, { includeShared: false, includeArchived: false });
    const p1 = s.projects.find((p) => p.id === "1")!;
    // 1 of 3 complete -> 33
    expect(p1.percentComplete).toBe(33);
  });

  it("derives the next due date and nearest upcoming start", () => {
    const { projects, tasks } = fixtures();
    const s = aggregateProjects(projects, tasks, TODAY, { includeShared: false, includeArchived: false });
    const p1 = s.projects.find((p) => p.id === "1")!;
    // Open tasks: id2 end 06-08 (< today, excluded from next-due), id3 end 06-22.
    expect(p1.nextDueDate).toBe("2026-06-22");
    expect(p1.nearestUpcomingStart).toBe("2026-06-20");
  });

  it("flags overdue projects and sorts them first", () => {
    const { projects, tasks } = fixtures();
    const s = aggregateProjects(projects, tasks, TODAY, { includeShared: false, includeArchived: false });
    expect(s.projectsWithOverdue).toBe(1);
    expect(s.projects[0].id).toBe("1");
    expect(s.projects[0].overdue).toBe(true);
  });

  it("handles a project with no tasks (0 percent, no flags)", () => {
    const s = aggregateProjects([makeProject({ id: 7, name: "Empty" })], [], TODAY, { includeShared: false, includeArchived: false });
    const p = s.projects[0];
    expect(p.totalTasks).toBe(0);
    expect(p.percentComplete).toBe(0);
    expect(p.overdue).toBe(false);
    expect(p.nextDueDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregateInventory (low / out / expiring from real fields)
// ---------------------------------------------------------------------------

describe("aggregateInventory (deterministic flags)", () => {
  function fixtures(): { items: InventoryItem[]; stocks: InventoryStock[] } {
    const items = [
      makeItem({ id: 1, name: "Q5 polymerase", category: "enzyme", low_at_count: 2, owner: "grant" }),
      makeItem({ id: 2, name: "dNTPs", category: "reagent", low_at_count: null, owner: "grant" }),
      makeItem({ id: 3, name: "Primer mix", category: "primer", low_at_count: 5, owner: "alice" }),
      makeItem({ id: 4, name: "Old antibody", category: "antibody", low_at_count: null, owner: "grant" }),
    ];
    const stocks = [
      // item 1: total 2 containers, threshold 2 -> LOW (2 <= 2), not out
      makeStock({ id: 10, item_id: 1, container_count: 2, last_touched_at: "2026-06-11T10:00:00Z" }),
      // item 2: zero containers, no threshold -> OUT
      makeStock({ id: 20, item_id: 2, container_count: 0, status: "empty", last_touched_at: "2026-06-09T10:00:00Z" }),
      // item 3: 10 containers (above threshold 5), but expiring soon (in 10 days)
      makeStock({ id: 30, item_id: 3, container_count: 10, expiration_date: "2026-06-22", last_touched_at: "2026-06-01T10:00:00Z" }),
      // item 4: expired (date before today)
      makeStock({ id: 40, item_id: 4, container_count: 3, expiration_date: "2026-05-01", last_touched_at: "2026-05-15T10:00:00Z" }),
    ];
    return { items, stocks };
  }

  it("counts items and stocks in scope", () => {
    const { items, stocks } = fixtures();
    const s = aggregateInventory(items, stocks, {}, TODAY);
    expect(s.itemCount).toBe(4);
    expect(s.stockCount).toBe(4);
  });

  it("flags low from the reorder threshold", () => {
    const { items, stocks } = fixtures();
    const s = aggregateInventory(items, stocks, {}, TODAY);
    expect(s.low.map((i) => i.id)).toEqual(["1"]);
    expect(s.low[0].reorderThreshold).toBe(2);
    expect(s.low[0].totalContainers).toBe(2);
  });

  it("flags out when total containers is zero", () => {
    const { items, stocks } = fixtures();
    const s = aggregateInventory(items, stocks, {}, TODAY);
    expect(s.out.map((i) => i.id)).toEqual(["2"]);
  });

  it("flags expiring soon within the window and expired separately", () => {
    const { items, stocks } = fixtures();
    const s = aggregateInventory(items, stocks, {}, TODAY, { expiringWithinDays: 30 });
    expect(s.expiringSoon.map((i) => i.id)).toEqual(["3"]);
    expect(s.expired.map((i) => i.id)).toEqual(["4"]);
  });

  it("narrows expiring soon with a shorter window", () => {
    const { items, stocks } = fixtures();
    // 5-day window: item 3 expires 06-22 (> 06-17), so no longer "soon".
    const s = aggregateInventory(items, stocks, {}, TODAY, { expiringWithinDays: 5 });
    expect(s.expiringSoon).toEqual([]);
  });

  it("tallies by category, descending", () => {
    const { items, stocks } = fixtures();
    const s = aggregateInventory(items, stocks, {}, TODAY);
    // one each of enzyme, reagent, primer, antibody -> all count 1, alpha tiebreak
    expect(s.byCategory).toEqual([
      { category: "antibody", count: 1 },
      { category: "enzyme", count: 1 },
      { category: "primer", count: 1 },
      { category: "reagent", count: 1 },
    ]);
  });

  it("lists recent movements most-recent-first", () => {
    const { items, stocks } = fixtures();
    const s = aggregateInventory(items, stocks, {}, TODAY);
    expect(s.recentMovements.map((m) => m.stockId)).toEqual(["10", "20", "30", "40"]);
  });

  it("respects the owners filter", () => {
    const { items, stocks } = fixtures();
    const s = aggregateInventory(items, stocks, { owners: ["alice"] }, TODAY);
    expect(s.itemCount).toBe(1);
    expect(s.expiringSoon.map((i) => i.id)).toEqual(["3"]);
  });

  it("matches keywords across name / vendor / category", () => {
    const { items, stocks } = fixtures();
    const s = aggregateInventory(items, stocks, { keywords: "primer" }, TODAY);
    expect(s.itemCount).toBe(1);
    expect(s.low).toEqual([]); // primer mix has 10 containers, above threshold 5
  });

  it("returns clean empties on no match", () => {
    const { items, stocks } = fixtures();
    const s = aggregateInventory(items, stocks, { owners: ["nobody"] }, TODAY);
    expect(s.itemCount).toBe(0);
    expect(s.low).toEqual([]);
    expect(s.out).toEqual([]);
    expect(s.expiringSoon).toEqual([]);
    expect(s.recentMovements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// composeLabDigest (composition only, no recompute)
// ---------------------------------------------------------------------------

describe("composeLabDigest (cross-type composition)", () => {
  function fixtures() {
    const experiments = [
      makeTask({ id: 1, is_complete: true, start_date: "2026-06-02", end_date: "2026-06-03" }),
      makeTask({ id: 2, is_complete: false, start_date: "2026-06-05", end_date: "2026-06-08" }), // overdue
      makeTask({ id: 3, is_complete: false, start_date: "2026-06-10", end_date: "2026-06-14" }), // finishing this week
    ];
    const purchases: Array<PurchaseItem & { owner: string }> = [
      { id: 1, task_id: 1, item_name: "Mix", quantity: 1, link: null, cas: null, price_per_unit: 100, shipping_fees: 0, total_price: 100, notes: null, funding_string: null, vendor: "NEB", catalog_number: null, category: "reagents", order_status: "received", last_edited_at: "2026-06-05T10:00:00Z", owner: "grant" } as PurchaseItem & { owner: string },
      { id: 2, task_id: 2, item_name: "Tips", quantity: 1, link: null, cas: null, price_per_unit: 50, shipping_fees: 0, total_price: 50, notes: null, funding_string: null, vendor: "x", catalog_number: null, category: "plastics", order_status: "ordered", last_edited_at: "2026-06-06T10:00:00Z", owner: "grant" } as PurchaseItem & { owner: string },
    ];
    const notes = [
      makeNote({ id: 1, updated_at: "2026-06-07T10:00:00Z", entries: [makeEntry("a"), makeEntry("b")] }),
    ];
    const projects = [makeProject({ id: 1, name: "cyp51A" })];
    const tasks = [
      makeTask({ id: 1, project_id: 1, is_complete: false, start_date: "2026-06-20", end_date: "2026-06-22" }), // upcoming
      makeTask({ id: 2, project_id: 1, is_complete: false, start_date: "2026-06-05", end_date: "2026-06-08" }), // overdue
    ];
    return { experiments, purchases, notes, projects, tasks };
  }

  it("lifts experiment numbers verbatim from the aggregate", () => {
    const f = fixtures();
    const d = composeLabDigest(f, {}, TODAY);
    expect(d.experiments.run).toBe(3);
    expect(d.experiments.finished).toBe(1);
    expect(d.experiments.overdue).toBe(1);
    expect(d.experiments.finishingThisWeek).toBe(1);
  });

  it("lifts the note and purchase numbers", () => {
    const f = fixtures();
    const d = composeLabDigest(f, {}, TODAY);
    expect(d.notes.written).toBe(1);
    expect(d.notes.entries).toBe(2);
    expect(d.purchases.made).toBe(2);
    expect(d.purchases.totalSpend).toBe(150);
    expect(d.purchases.pending).toBe(1); // one ordered, one received
  });

  it("lifts the scheduled-next block from the projects rollup", () => {
    const f = fixtures();
    const d = composeLabDigest(f, {}, TODAY);
    expect(d.scheduled.projectsWithOverdue).toBe(1);
    expect(d.scheduled.nextUpcomingStart).toBe("2026-06-20");
  });

  it("echoes the window", () => {
    const f = fixtures();
    const d = composeLabDigest(f, { since: "2026-06-01", until: "2026-06-30", owners: ["grant"] }, TODAY);
    expect(d.window).toEqual({ since: "2026-06-01", until: "2026-06-30", owners: ["grant"], asOf: TODAY });
  });

  it("scopes the window (experiments started before since drop out)", () => {
    const f = fixtures();
    const d = composeLabDigest(f, { since: "2026-06-09" }, TODAY);
    // Only id3 (start 06-10) survives.
    expect(d.experiments.run).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tool execute paths through the injectable deps seams (no real folder).
// ---------------------------------------------------------------------------

const realNotesLister = summarizeNotesDeps.listNotes;
const realProjList = summarizeProjectsDeps.listProjects;
const realProjTasks = summarizeProjectsDeps.listTasks;
const realInvItems = summarizeInventoryDeps.listItems;
const realInvStocks = summarizeInventoryDeps.listStocks;
const realExpLister = summarizeExperimentsDeps.listExperiments;
const realExpProjList = summarizeExperimentsDeps.listProjects;
const realPurLister = summarizePurchasesDeps.listPurchases;

afterEach(() => {
  summarizeNotesDeps.listNotes = realNotesLister;
  summarizeProjectsDeps.listProjects = realProjList;
  summarizeProjectsDeps.listTasks = realProjTasks;
  summarizeInventoryDeps.listItems = realInvItems;
  summarizeInventoryDeps.listStocks = realInvStocks;
  summarizeExperimentsDeps.listExperiments = realExpLister;
  summarizeExperimentsDeps.listProjects = realExpProjList;
  summarizePurchasesDeps.listPurchases = realPurLister;
});

describe("summarizeNotesTool.execute", () => {
  it("loads, filters, and returns a structural summary", async () => {
    const stub: Partial<SummarizeNotesDeps> = {
      listNotes: async () => [makeNote({ id: 1, owner: "grant" }), makeNote({ id: 2, owner: "alice" })],
    };
    Object.assign(summarizeNotesDeps, stub);
    const out = (await summarizeNotesTool.execute({ owners: ["grant"] })) as {
      ok: true;
      summary: { total: number; filter: unknown };
    };
    expect(out.ok).toBe(true);
    expect(out.summary.total).toBe(1);
    expect(out.summary.filter).toMatchObject({ types: ["note"], owners: ["grant"] });
  });
});

describe("summarizeProjectsTool.execute", () => {
  it("loads projects + tasks and rolls up", async () => {
    const stub: Partial<SummarizeProjectsDeps> = {
      listProjects: async () => [makeProject({ id: 1 })],
      listTasks: async () => [makeTask({ id: 1, project_id: 1, is_complete: true })],
    };
    Object.assign(summarizeProjectsDeps, stub);
    const out = (await summarizeProjectsTool.execute({})) as {
      ok: true;
      summary: { totalProjects: number; projects: Array<{ percentComplete: number }> };
    };
    expect(out.ok).toBe(true);
    expect(out.summary.totalProjects).toBe(1);
    expect(out.summary.projects[0].percentComplete).toBe(100);
  });
});

describe("summarizeInventoryTool.execute", () => {
  it("loads items + stocks and flags low", async () => {
    const stub: Partial<SummarizeInventoryDeps> = {
      listItems: async () => [makeItem({ id: 1, low_at_count: 5 })],
      listStocks: async () => [makeStock({ id: 1, item_id: 1, container_count: 3 })],
    };
    Object.assign(summarizeInventoryDeps, stub);
    const out = (await summarizeInventoryTool.execute({})) as {
      ok: true;
      summary: { itemCount: number; low: Array<{ id: string }> };
    };
    expect(out.ok).toBe(true);
    expect(out.summary.itemCount).toBe(1);
    expect(out.summary.low.map((i) => i.id)).toEqual(["1"]);
  });
});

describe("labDigestTool.execute", () => {
  it("composes a digest from the stubbed per-type loaders", async () => {
    Object.assign(summarizeExperimentsDeps, {
      listExperiments: async () => [makeTask({ id: 1, is_complete: true })],
      listProjects: async (): Promise<Project[]> => [],
    });
    Object.assign(summarizePurchasesDeps, {
      listPurchases: async () => [],
    });
    Object.assign(summarizeNotesDeps, {
      listNotes: async () => [makeNote({ id: 1 })],
    });
    Object.assign(summarizeProjectsDeps, {
      listProjects: async () => [makeProject({ id: 1 })],
      listTasks: async () => [],
    });
    const out = (await labDigestTool.execute({})) as {
      ok: true;
      digest: { experiments: { run: number; finished: number }; notes: { written: number } };
    };
    expect(out.ok).toBe(true);
    expect(out.digest.experiments.run).toBe(1);
    expect(out.digest.experiments.finished).toBe(1);
    expect(out.digest.notes.written).toBe(1);
  });
});
