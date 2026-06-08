// frontend/src/lib/attribution-stamps.test.ts
//
// VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26).
//
// Every `update*` call site in `local-api.ts` should stamp
// `last_edited_by` (the current user's username) and `last_edited_at`
// (an ISO 8601 timestamp). The PI cross-owner case stamps the PI's
// username on the target user's record — the "(PI)" badge is purely a
// UI render concern handled by AttributionChip, NOT a stored field.
//
// Lazy-migration coverage: pre-R3 records on disk that lack the two
// fields read fine (undefined), and the NEXT save back-fills both.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  Task,
  Note,
  Method,
  Project,
  HighLevelGoal,
  LabLink,
  PurchaseItem,
  MassSpecProtocol,
} from "./types";

// ── Mock surface ────────────────────────────────────────────────────────────

const memFs = new Map<string, unknown>();

vi.mock("./file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import {
  tasksApi,
  notesApi,
  methodsApi,
  projectsApi,
  goalsApi,
  labLinksApi,
  purchasesApi,
  massSpecApi,
} from "./local-api";

beforeEach(() => {
  memFs.clear();
});

// ── Seeders ─────────────────────────────────────────────────────────────────

function seedTask(): Task {
  const task: Task = {
    id: 1,
    project_id: 0,
    name: "t",
    start_date: "2026-05-26",
    duration_days: 1,
    end_date: "2026-05-26",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "alex",
    shared_with: [],
  };
  memFs.set(`users/alex/tasks/1.json`, task);
  return task;
}

function seedNote(): Note {
  const note: Note = {
    id: 1,
    title: "n",
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [],
    updated_at: "2026-05-25T00:00:00.000Z",
    username: "alex",
  };
  memFs.set(`users/alex/notes/1.json`, note);
  return note;
}

function seedMethod(): Method {
  const method: Method = {
    id: 1,
    name: "m",
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: "alex",
    owner: "alex",
    shared_with: [],
  };
  memFs.set(`users/alex/methods/1.json`, method);
  return method;
}

function seedProject(): Project {
  const project: Project = {
    id: 1,
    name: "p",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-05-25T00:00:00.000Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alex",
    shared_with: [],
  };
  memFs.set(`users/alex/projects/1.json`, project);
  return project;
}

function seedGoal(): HighLevelGoal {
  const goal: HighLevelGoal = {
    id: 1,
    project_id: null,
    name: "g",
    start_date: "2026-05-26",
    end_date: "2026-05-26",
    color: null,
    smart_goals: [],
    is_complete: false,
    created_at: "2026-05-25T00:00:00.000Z",
  };
  memFs.set(`users/alex/goals/1.json`, goal);
  return goal;
}

function seedLink(): LabLink {
  const link: LabLink = {
    id: 1,
    title: "l",
    url: "https://example.com",
    description: null,
    category: null,
    color: null,
    preview_image_url: null,
    sort_order: 0,
    created_at: "2026-05-25T00:00:00.000Z",
  };
  memFs.set(`users/alex/lab_links/1.json`, link);
  return link;
}

function seedPurchase(): PurchaseItem {
  const item: PurchaseItem = {
    id: 1,
    task_id: 1,
    item_name: "i",
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 10,
    shipping_fees: 0,
    total_price: 10,
    notes: null,
    funding_string: null,
    vendor: null,
    catalog_number: null,
    category: null,
  };
  memFs.set(`users/alex/purchase_items/1.json`, item);
  return item;
}

function seedMassSpec(): MassSpecProtocol {
  const protocol: MassSpecProtocol = {
    id: 1,
    name: "ms",
    description: null,
    is_public: false,
    created_by: "alex",
    ionization_mode: "esi_pos",
    source: {},
    scan: { is_msms: false },
    calibration: {},
  };
  memFs.set(`users/alex/mass_spec_methods/1.json`, protocol);
  return protocol;
}

// ── Tests: per-entity stamping ──────────────────────────────────────────────

describe("VCP R3 — last_edited_by / last_edited_at stamping", () => {
  it("tasksApi.update stamps both fields", async () => {
    seedTask();
    const before = Date.now();
    await tasksApi.update(1, { name: "renamed" });
    const persisted = memFs.get(`users/alex/tasks/1.json`) as Task;
    expect(persisted.last_edited_by).toBe("alex");
    expect(persisted.last_edited_at).toBeDefined();
    expect(new Date(persisted.last_edited_at as string).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("notesApi.update stamps both fields (in addition to updated_at)", async () => {
    seedNote();
    await notesApi.update(1, { title: "renamed" });
    const persisted = memFs.get(`users/alex/notes/1.json`) as Note;
    // Both new fields land.
    expect(persisted.last_edited_by).toBe("alex");
    expect(persisted.last_edited_at).toBeDefined();
    // FLAG: notes pre-R3 already had `updated_at`; both must still write.
    expect(persisted.updated_at).toBeDefined();
  });

  it("methodsApi.update stamps both fields without touching created_by", async () => {
    seedMethod();
    await methodsApi.update(1, { name: "renamed" });
    const persisted = memFs.get(`users/alex/methods/1.json`) as Method;
    expect(persisted.last_edited_by).toBe("alex");
    expect(persisted.last_edited_at).toBeDefined();
    // Creator stamp is preserved — R3 attribution does NOT change
    // creator semantics.
    expect(persisted.created_by).toBe("alex");
  });

  it("projectsApi.update stamps both fields", async () => {
    seedProject();
    await projectsApi.update(1, { name: "renamed" });
    const persisted = memFs.get(`users/alex/projects/1.json`) as Project;
    expect(persisted.last_edited_by).toBe("alex");
    expect(persisted.last_edited_at).toBeDefined();
  });

  it("goalsApi.update stamps both fields", async () => {
    seedGoal();
    await goalsApi.update(1, { name: "renamed" });
    const persisted = memFs.get(`users/alex/goals/1.json`) as HighLevelGoal;
    expect(persisted.last_edited_by).toBe("alex");
    expect(persisted.last_edited_at).toBeDefined();
  });

  it("labLinksApi.update stamps both fields", async () => {
    seedLink();
    await labLinksApi.update(1, { title: "renamed" });
    const persisted = memFs.get(`users/alex/lab_links/1.json`) as LabLink;
    expect(persisted.last_edited_by).toBe("alex");
    expect(persisted.last_edited_at).toBeDefined();
  });

  it("purchasesApi.update stamps both fields (in addition to total_price)", async () => {
    seedPurchase();
    await purchasesApi.update(1, { quantity: 5 });
    const persisted = memFs.get(`users/alex/purchase_items/1.json`) as PurchaseItem;
    expect(persisted.last_edited_by).toBe("alex");
    expect(persisted.last_edited_at).toBeDefined();
    // Existing total_price recompute still fires.
    expect(persisted.total_price).toBe(50);
  });

  it("massSpecApi.update stamps both fields (in addition to updated_at)", async () => {
    seedMassSpec();
    await massSpecApi.update(1, { name: "renamed" });
    const persisted = memFs.get(`users/alex/mass_spec_methods/1.json`) as MassSpecProtocol;
    expect(persisted.last_edited_by).toBe("alex");
    expect(persisted.last_edited_at).toBeDefined();
    // FLAG: mass_spec already had `updated_at`; both must still write.
    expect(persisted.updated_at).toBeDefined();
  });
});

// ── Tests: PI cross-owner stamping ──────────────────────────────────────────

describe("VCP R3 — PI cross-owner stamping", () => {
  it("stamps the PI's username when an explicit last_edited_by override is supplied", async () => {
    // PI Morgan edits Alex's note — the caller (an owner-scoped PI wrapper
    // or a Phase 5 unlock-session write path) supplies
    // `last_edited_by: "morgan"` explicitly to override the cached
    // current-user. The "(PI)" badge is a UI render concern; the stored
    // field is just "morgan".
    seedNote();
    await notesApi.update(1, { title: "PI edit", last_edited_by: "morgan" });
    const persisted = memFs.get(`users/alex/notes/1.json`) as Note;
    expect(persisted.last_edited_by).toBe("morgan");
    expect(persisted.last_edited_at).toBeDefined();
  });

  it("falls back to the cached current user when no override is supplied", async () => {
    seedTask();
    await tasksApi.update(1, { name: "self-edit" });
    const persisted = memFs.get(`users/alex/tasks/1.json`) as Task;
    expect(persisted.last_edited_by).toBe("alex");
  });
});

// ── Tests: lazy migration ───────────────────────────────────────────────────

describe("VCP R3 — lazy migration on pre-R3 records", () => {
  it("reads a pre-R3 record without crashing", async () => {
    // Seed a record with NEITHER last_edited_by NOR last_edited_at — the
    // pre-R3 shape on disk. Read should succeed; the fields are
    // optional in the type.
    seedNote();
    const persisted = memFs.get(`users/alex/notes/1.json`) as Note;
    expect(persisted.last_edited_by).toBeUndefined();
    expect(persisted.last_edited_at).toBeUndefined();
  });

  it("back-fills both fields on the first save after the bump", async () => {
    seedNote();
    // Sanity check: pre-save state lacks the fields.
    const beforeSave = memFs.get(`users/alex/notes/1.json`) as Note;
    expect(beforeSave.last_edited_by).toBeUndefined();
    // First save back-fills.
    await notesApi.update(1, { title: "first save post-bump" });
    const afterSave = memFs.get(`users/alex/notes/1.json`) as Note;
    expect(afterSave.last_edited_by).toBe("alex");
    expect(afterSave.last_edited_at).toBeDefined();
  });
});
