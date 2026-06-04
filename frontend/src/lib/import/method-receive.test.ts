// frontend/src/lib/import/method-receive.test.ts
//
// Pins the receive side of standalone method cross-boundary sharing.
//
// A shared method rides inside a synthetic "envelope" experiment (a task-shaped
// wrapper carrying the one method) so the unchanged experiment parser can read
// it, marked `kind: "method"` on the manifest. The bug this guards against,
// importing such a bundle ALSO created the throwaway envelope task / project
// alongside the method. The method-only apply path (manifest.kind === "method")
// must land ONLY the method, no phantom task and no placeholder project.
//
// Runs the real parse -> resolve -> apply pipeline against an in-memory bundle,
// mocking only the storage boundary, mirroring dependency-method-carry.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

// ── Mock surface ────────────────────────────────────────────────────────────
const writeCalls: Array<{ path: string; size: number }> = [];
const createdProjects: Array<{ id: number; name: string }> = [];
const createdMethods: Array<{ id: number; name: string; source_path: string | null; is_public: boolean }> = [];
const createdTasks: Array<{ id: number; name: string }> = [];

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
    create: vi.fn(
      async ({
        name,
        source_path,
        is_public,
      }: {
        name: string;
        source_path: string | null;
        is_public?: boolean;
      }) => {
        const id = createdMethods.length + 200;
        const method = { id, name, source_path, is_public: is_public ?? false };
        createdMethods.push(method);
        return method;
      },
    ),
  },
  tasksApi: {
    create: vi.fn(async ({ name }: { name: string }) => {
      const id = createdTasks.length + 300;
      const task = { id, name };
      createdTasks.push(task);
      return task;
    }),
    update: vi.fn(async () => undefined),
  },
  dependenciesApi: { create: vi.fn(async () => ({ id: 900 })) },
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
});

// ── Method-bundle factory ─────────────────────────────────────────────────────
// Mirrors what buildMethodSendPayload emits: a researchos-experiment envelope
// (synthetic task + placeholder project carrying ONE markdown method) with the
// manifest stamped kind: "method".
async function buildMethodBundle(): Promise<Blob> {
  const zip = new JSZip();
  const exportedAt = "2026-06-04T12:00:00.000Z";
  const methodId = 11;

  zip.file(
    "_export-manifest.json",
    JSON.stringify(
      {
        format: "researchos-experiment",
        version: 2,
        exported_at: exportedAt,
        exported_by: "ResearchOS",
        source_owner: "morgan",
        source_instance: "morgan@2026-06-04",
        kind: "method",
        task_id: 0,
        task_key: "self:0",
        project_id: 0,
        method_ids: [methodId],
      },
      null,
      2,
    ),
  );

  zip.file(
    "task.json",
    JSON.stringify(
      {
        id: 0,
        project_id: 0,
        name: "Western blot",
        start_date: "",
        duration_days: 1,
        end_date: "",
        is_high_level: false,
        is_complete: false,
        task_type: "experiment",
        weekend_override: null,
        method_ids: [methodId],
        deviation_log: null,
        tags: null,
        sort_order: 0,
        experiment_color: null,
        sub_tasks: null,
        method_attachments: [],
        owner: "morgan",
        shared_with: [],
      },
      null,
      2,
    ),
  );

  zip.file(
    "project.json",
    JSON.stringify(
      {
        id: 0,
        name: "(method share)",
        weekend_active: false,
        tags: null,
        color: null,
        created_at: exportedAt,
        sort_order: 0,
        is_archived: false,
        archived_at: null,
        owner: "morgan",
        shared_with: [],
      },
      null,
      2,
    ),
  );

  zip.file(
    `methods/method-${methodId}.json`,
    JSON.stringify(
      {
        id: methodId,
        name: "Western blot",
        source_path: `methods/method-${methodId}/western-blot.md`,
        method_type: "markdown",
        folder_path: "Molecular Biology",
        parent_method_id: null,
        tags: ["wb"],
        is_public: false,
        created_by: "morgan",
        owner: "morgan",
        shared_with: [],
      },
      null,
      2,
    ),
  );
  zip.file(`methods/method-${methodId}-body.md`, "## Western blot\n\n1. Lyse cells.");

  const exportDate = new Date(exportedAt);
  for (const entry of Object.values(zip.files)) {
    entry.date = exportDate;
  }
  const ab = await zip.generateAsync({ type: "arraybuffer" });
  // JSZip duck-types ArrayBuffer where a Blob is expected in vitest's Node env.
  return ab as unknown as Blob;
}

async function runMethodImport() {
  const blob = await buildMethodBundle();
  const payload = await parseImportBundle(blob);
  const plan = await buildImportPlan(payload);
  const result = await applyImportPlan(plan);
  return { payload, plan, result };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("standalone method receive", () => {
  it("lands ONLY the method, never the envelope task or placeholder project", async () => {
    const { payload, result } = await runMethodImport();

    // The bundle is sniffed/parsed as a method bundle.
    expect(payload.manifest.kind).toBe("method");

    // The method localized into the receiver's library, private.
    expect(createdMethods).toHaveLength(1);
    expect(createdMethods[0].is_public).toBe(false);
    expect(createdMethods[0].source_path).toMatch(/^methods\//);
    expect(result.importedMethodIds[11]).toBe(200);

    // The crux: NO envelope task and NO placeholder project were created.
    expect(createdTasks).toHaveLength(0);
    expect(createdProjects).toHaveLength(0);

    // The result reflects a method-only landing.
    expect(result.newTaskId).toBeNull();
    expect(result.newProjectId).toBeNull();
    expect(result.notCarried.dependencies).toEqual([]);
    expect(result.notCarried.methodRefs).toEqual([]);

    // The method body was written under the receiver-side methods/ path,
    // nothing under a task results subtree (the dropped envelope).
    expect(writeCalls.some((w) => w.path.startsWith("methods/"))).toBe(true);
  });
});
