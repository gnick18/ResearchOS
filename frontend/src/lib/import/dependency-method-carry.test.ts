// frontend/src/lib/import/dependency-method-carry.test.ts
//
// Tests for the two cross-boundary-sharing gaps closed on 2026-06-04 in the
// shared export/import core. These run the real parse -> resolve -> apply
// pipeline against synthetic in-memory bundles, mocking only the storage
// boundary, so they pin the new behavior without touching disk.
//
// Coverage:
//   1. Backward compat: a v1 bundle (no dependencies section) imports
//      unchanged, notCarried is empty.
//   2. A no-dependency v2 round trip is lossless (regression guard for the
//      existing local export/import feature).
//   3. Gap 1, dependency carry: when BOTH endpoints are present in the
//      import the dependency is remapped + created.
//   4. Gap 1, dependency drop: when an endpoint is missing (the common
//      single-experiment share) the dependency is dropped + reported, never
//      recreated against an invented task.
//   5. Gap 2, method localization invariant: every surviving method ref is
//      localized (owner null, remapped id); a referenced-but-not-bundled
//      method is dropped + reported, leaving no dangling foreign reference.

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

// ── Mock surface ────────────────────────────────────────────────────────────
const writeCalls: Array<{ path: string; size: number }> = [];
const createdProjects: Array<{ id: number; name: string }> = [];
const createdMethods: Array<{ id: number; name: string; source_path: string | null }> = [];
const createdTasks: Array<{ id: number; name: string; method_ids: number[]; method_attachments: unknown[] }> = [];
const createdDeps: Array<{ parent_id: number; child_id: number; dep_type: string }> = [];

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    writeFileFromBlob: vi.fn(async (path: string, blob: Blob) => {
      writeCalls.push({ path, size: blob.size });
    }),
  },
}));

vi.mock("@/lib/local-api", () => ({
  projectsApi: {
    list: vi.fn(async () => []),
    create: vi.fn(async ({ name }: { name: string }) => {
      const id = createdProjects.length + 100;
      const project = { id, name };
      createdProjects.push(project);
      return project;
    }),
  },
  methodsApi: {
    list: vi.fn(async () => []),
    create: vi.fn(async ({ name, source_path }: { name: string; source_path: string | null }) => {
      const id = createdMethods.length + 200;
      const method = { id, name, source_path };
      createdMethods.push(method);
      return method;
    }),
  },
  tasksApi: {
    create: vi.fn(
      async ({
        name,
        method_ids,
        method_attachments,
      }: {
        name: string;
        method_ids?: number[];
        method_attachments?: unknown[];
      }) => {
        const id = createdTasks.length + 300;
        const task = {
          id,
          name,
          method_ids: method_ids ?? [],
          method_attachments: method_attachments ?? [],
        };
        createdTasks.push(task);
        return task;
      },
    ),
    update: vi.fn(async () => undefined),
  },
  dependenciesApi: {
    create: vi.fn(async (data: { parent_id: number; child_id: number; dep_type: string }) => {
      createdDeps.push(data);
      return { id: createdDeps.length + 900, ...data };
    }),
  },
  pcrApi: { create: vi.fn(async () => ({ id: 999 })) },
  lcGradientApi: { create: vi.fn(async () => ({ id: 999 })) },
  plateApi: { create: vi.fn(async () => ({ id: 999 })) },
  cellCultureApi: { create: vi.fn(async () => ({ id: 999 })) },
  massSpecApi: { create: vi.fn(async () => ({ id: 999 })) },
  codingWorkflowApi: { create: vi.fn(async () => ({ id: 999 })) },
  qpcrAnalysisApi: { create: vi.fn(async () => ({ id: 999 })) },
}));

vi.mock("@/lib/storage/json-store", () => ({
  getCurrentUserCached: vi.fn(async () => "alex"),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { parseImportBundle } from "./parse";
import { buildImportPlan } from "./resolve";
import { applyImportPlan } from "./apply";

beforeEach(() => {
  writeCalls.length = 0;
  createdProjects.length = 0;
  createdMethods.length = 0;
  createdTasks.length = 0;
  createdDeps.length = 0;
});

// ── Bundle factory ──────────────────────────────────────────────────────────

interface BundleOpts {
  // Manifest version. v1 omits dependencies + dependency_ids entirely.
  version: 1 | 2;
  // The shared task's id (manifest.task_id + task.id).
  taskId: number;
  // method_ids on the task. Each entry that should be bundled needs a record
  // in `bundledMethodIds`.
  methodIds: number[];
  // Which of methodIds get a method-{id}.json record in the bundle. Methods
  // listed in methodIds but NOT here are "referenced but not bundled".
  bundledMethodIds: number[];
  // method_attachments rows (each references a method_id, carries a foreign owner).
  methodAttachments?: Array<{ method_id: number; owner: string | null }>;
  // dependency records to write into dependencies.json (v2 only).
  dependencies?: Array<{ id: number; parent_id: number; child_id: number; dep_type: "FS" | "SS" | "SF" }>;
}

async function buildBundle(opts: BundleOpts): Promise<Blob> {
  const zip = new JSZip();
  const exportedAt = "2026-06-04T12:00:00.000Z";

  const manifest: Record<string, unknown> = {
    format: "researchos-experiment",
    version: opts.version,
    exported_at: exportedAt,
    exported_by: "ResearchOS",
    source_owner: "morgan",
    source_instance: "morgan@2026-06-04",
    task_id: opts.taskId,
    task_key: `self:${opts.taskId}`,
    project_id: 1,
    method_ids: opts.methodIds,
  };
  if (opts.version === 2) {
    manifest.dependency_ids = (opts.dependencies ?? []).map((d) => d.id);
  }
  zip.file("_export-manifest.json", JSON.stringify(manifest, null, 2));

  const task = {
    id: opts.taskId,
    project_id: 1,
    name: "Probe task",
    start_date: "2026-06-04",
    duration_days: 1,
    end_date: "2026-06-04",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment" as const,
    weekend_override: null,
    method_ids: opts.methodIds,
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: (opts.methodAttachments ?? []).map((a) => ({
      method_id: a.method_id,
      owner: a.owner,
      pcr_gradient: null,
      pcr_ingredients: null,
      lc_gradient: null,
      body_override: null,
      plate_annotation: null,
      cell_culture_schedule: null,
      variation_notes: null,
      compound_snapshots: null,
      qpcr_analysis: null,
    })),
    owner: "morgan",
    shared_with: [],
  };
  zip.file("task.json", JSON.stringify(task, null, 2));

  const project = {
    id: 1,
    name: "Probe project",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: exportedAt,
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "morgan",
    shared_with: [],
  };
  zip.file("project.json", JSON.stringify(project, null, 2));

  for (const id of opts.bundledMethodIds) {
    const method = {
      id,
      name: `Method ${id}`,
      source_path: `methods/method-${id}/method-${id}.md`,
      method_type: "markdown" as const,
      folder_path: null,
      parent_method_id: null,
      tags: null,
      is_public: false,
      // A FOREIGN owner — the sender's lab-mate. The localization invariant
      // (Gap 2) must reset this to null on import so it never dangles.
      created_by: "morgan",
      owner: "morgan",
      shared_with: [],
    };
    zip.file(`methods/method-${id}.json`, JSON.stringify(method, null, 2));
    zip.file(`methods/method-${id}-body.md`, `# Method ${id}\n\nBody.`);
  }

  if (opts.version === 2 && opts.dependencies && opts.dependencies.length > 0) {
    zip.file("dependencies.json", JSON.stringify(opts.dependencies, null, 2));
  }

  const exportDate = new Date(exportedAt);
  for (const entry of Object.values(zip.files)) {
    entry.date = exportDate;
  }
  const ab = await zip.generateAsync({ type: "arraybuffer" });
  // JSZip duck-types ArrayBuffer where a Blob is expected (FileReader is
  // absent in vitest's Node env); see unattached-roundtrip.test.ts.
  return ab as unknown as Blob;
}

async function runImport(opts: BundleOpts) {
  const blob = await buildBundle(opts);
  const payload = await parseImportBundle(blob);
  const plan = await buildImportPlan(payload);
  const result = await applyImportPlan(plan);
  return { payload, result };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("v1 backward compatibility", () => {
  it("a v1 bundle (no dependencies section) imports unchanged, notCarried empty", async () => {
    const { payload, result } = await runImport({
      version: 1,
      taskId: 5,
      methodIds: [10],
      bundledMethodIds: [10],
      methodAttachments: [{ method_id: 10, owner: "morgan" }],
    });

    expect(payload.manifest.version).toBe(1);
    expect(payload.dependencies).toEqual([]);

    // Task created, method localized.
    expect(createdTasks).toHaveLength(1);
    expect(createdMethods).toHaveLength(1);
    expect(result.importedMethodIds[10]).toBe(200);

    // No dependencies created, nothing reported.
    expect(createdDeps).toHaveLength(0);
    expect(result.notCarried.dependencies).toEqual([]);
    expect(result.notCarried.methodRefs).toEqual([]);
  });
});

describe("no-dependency v2 round trip (regression guard)", () => {
  it("is lossless: method localized, owner null, no drops reported", async () => {
    const { payload, result } = await runImport({
      version: 2,
      taskId: 5,
      methodIds: [10],
      bundledMethodIds: [10],
      methodAttachments: [{ method_id: 10, owner: "morgan" }],
    });

    expect(payload.manifest.version).toBe(2);
    expect(payload.dependencies).toEqual([]);

    expect(result.notCarried.dependencies).toEqual([]);
    expect(result.notCarried.methodRefs).toEqual([]);

    // The new task's method_attachments carry owner null (localized) and the
    // remapped id.
    const created = createdTasks[0];
    expect(created.method_ids).toEqual([200]);
    expect(created.method_attachments).toEqual([
      expect.objectContaining({ method_id: 200, owner: null }),
    ]);
  });
});

describe("Gap 1, dependency carry", () => {
  it("drops + reports a dependency when the other endpoint is missing (single-experiment share)", async () => {
    const { result } = await runImport({
      version: 2,
      taskId: 5,
      methodIds: [10],
      bundledMethodIds: [10],
      // Task 5 depends on task 99, which is NOT part of this import.
      dependencies: [{ id: 1, parent_id: 99, child_id: 5, dep_type: "FS" }],
    });

    // Not recreated.
    expect(createdDeps).toHaveLength(0);
    // Reported with source-side ids + a human-readable reason.
    expect(result.notCarried.dependencies).toEqual([
      expect.objectContaining({
        sourceParentId: 99,
        sourceChildId: 5,
        depType: "FS",
      }),
    ]);
    expect(result.notCarried.dependencies[0].reason).toMatch(/not carried|not included/i);
  });

  it("remaps + creates a dependency when BOTH endpoints are present (self-link)", async () => {
    // A self-referential dependency (both endpoints == the shared task) is
    // the only both-endpoints-present case a single-task import can express.
    // It exercises the remap-if-both branch end to end.
    const { result } = await runImport({
      version: 2,
      taskId: 5,
      methodIds: [10],
      bundledMethodIds: [10],
      dependencies: [{ id: 1, parent_id: 5, child_id: 5, dep_type: "SS" }],
    });

    const newTaskId = result.newTaskId;
    expect(createdDeps).toEqual([
      { parent_id: newTaskId, child_id: newTaskId, dep_type: "SS" },
    ]);
    // Nothing dropped.
    expect(result.notCarried.dependencies).toEqual([]);
  });
});

describe("Gap 2, method localization invariant", () => {
  it("every surviving method ref is localized (owner null) with no dangling foreign owner", async () => {
    const { result } = await runImport({
      version: 2,
      taskId: 5,
      methodIds: [10, 11],
      bundledMethodIds: [10, 11],
      methodAttachments: [
        { method_id: 10, owner: "morgan" },
        { method_id: 11, owner: "public" },
      ],
    });

    const created = createdTasks[0];
    // Both methods localized to receiver-side ids.
    expect(created.method_ids).toEqual([200, 201]);
    // No attachment retains a foreign owner.
    for (const att of created.method_attachments as Array<{ owner: unknown }>) {
      expect(att.owner).toBeNull();
    }
    expect(result.notCarried.methodRefs).toEqual([]);
  });

  it("drops + reports a referenced method that was not bundled", async () => {
    const { result } = await runImport({
      version: 2,
      taskId: 5,
      methodIds: [10, 12], // 12 is referenced...
      bundledMethodIds: [10], // ...but only 10 is bundled.
      methodAttachments: [
        { method_id: 10, owner: "morgan" },
        { method_id: 12, owner: "morgan" },
      ],
    });

    const created = createdTasks[0];
    // Only the bundled method survived; the dangling ref was dropped.
    expect(created.method_ids).toEqual([200]);
    expect(created.method_attachments).toEqual([
      expect.objectContaining({ method_id: 200, owner: null }),
    ]);

    // Method 12 reported exactly once (deduped across method_ids + attachment).
    const refs = result.notCarried.methodRefs.filter((r) => r.sourceMethodId === 12);
    expect(refs).toHaveLength(1);
    expect(refs[0].reason).toMatch(/not (included|carried)|dropped/i);
  });
});
