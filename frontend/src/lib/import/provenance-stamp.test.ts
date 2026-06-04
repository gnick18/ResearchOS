// frontend/src/lib/import/provenance-stamp.test.ts
//
// Pins the cross-boundary verified-sender provenance stamp on imported
// EXPERIMENTS and METHODS.
//
// When the inbox receive path imports a shared experiment or standalone method,
// it passes an `ImportProvenance` ({ sender, fingerprint }) to applyImportPlan.
// The apply path must then overlay received_from / received_from_fingerprint /
// received_at onto the created entity's on-disk record (the same way the note
// tier stamps a received note), so the "Received from X, verified" badge
// survives on the entity, not just at receive time.
//
// It also pins the negative: a LOCAL file-import (no provenance) stamps NOTHING,
// so a locally imported entity stays native.
//
// Runs the real parse -> resolve -> apply pipeline against an in-memory bundle,
// mocking only the storage boundary, mirroring method-receive.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

// ── Mock surface ────────────────────────────────────────────────────────────
// Capture every full-record overlay write so we can inspect the stamped fields.
const jsonWrites: Array<{ path: string; record: Record<string, unknown> }> = [];
// A tiny on-disk emulation: the API create mocks seed this so the stamp's
// readJson(filePath) returns the just-created record.
const diskRecords = new Map<string, Record<string, unknown>>();

const createdMethods: Array<{ id: number; name: string }> = [];
const createdTasks: Array<{ id: number; name: string }> = [];
const createdProjects: Array<{ id: number; name: string }> = [];

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    writeFileFromBlob: vi.fn(async () => undefined),
    readJson: vi.fn(async (path: string) => diskRecords.get(path) ?? null),
    writeJson: vi.fn(async (path: string, record: Record<string, unknown>) => {
      jsonWrites.push({ path, record });
      diskRecords.set(path, record);
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
      diskRecords.set(`users/alex/projects/${id}.json`, { ...project, owner: "alex" });
      return project;
    }),
  },
  methodsApi: {
    list: vi.fn(async () => []),
    create: vi.fn(async ({ name, source_path }: { name: string; source_path: string | null }) => {
      const id = createdMethods.length + 200;
      const method = { id, name, source_path, is_public: false, owner: "alex" };
      createdMethods.push(method);
      diskRecords.set(`users/alex/methods/${id}.json`, { ...method });
      return method;
    }),
  },
  tasksApi: {
    create: vi.fn(async ({ name }: { name: string }) => {
      const id = createdTasks.length + 300;
      const task = { id, name, owner: "alex" };
      createdTasks.push(task);
      diskRecords.set(`users/alex/tasks/${id}.json`, { ...task });
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
import type { ImportProvenance } from "./types";

beforeEach(() => {
  jsonWrites.length = 0;
  diskRecords.clear();
  createdMethods.length = 0;
  createdTasks.length = 0;
  createdProjects.length = 0;
});

const PROVENANCE: ImportProvenance = {
  sender: "morgan@lab.edu",
  fingerprint: "ABCD 1234 EF56",
};

// ── Bundle factories ──────────────────────────────────────────────────────────

function methodJson(methodId: number) {
  return JSON.stringify(
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
  );
}

function taskJson(methodId: number, kind: "method" | undefined) {
  void kind;
  return JSON.stringify(
    {
      id: 0,
      project_id: 0,
      name: "Western blot",
      start_date: "2026-06-01",
      duration_days: 1,
      end_date: "2026-06-01",
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
  );
}

function projectJson() {
  return JSON.stringify(
    {
      id: 0,
      name: "Project A",
      weekend_active: false,
      tags: null,
      color: null,
      created_at: "2026-06-04T12:00:00.000Z",
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "morgan",
      shared_with: [],
    },
    null,
    2,
  );
}

async function buildBundle(kind: "method" | undefined): Promise<Blob> {
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
        ...(kind ? { kind } : {}),
        task_id: 0,
        task_key: "self:0",
        project_id: 0,
        method_ids: [methodId],
      },
      null,
      2,
    ),
  );
  zip.file("task.json", taskJson(methodId, kind));
  zip.file("project.json", projectJson());
  zip.file(`methods/method-${methodId}.json`, methodJson(methodId));
  zip.file(`methods/method-${methodId}-body.md`, "## Western blot\n\n1. Lyse cells.");

  const exportDate = new Date(exportedAt);
  for (const entry of Object.values(zip.files)) {
    entry.date = exportDate;
  }
  const ab = await zip.generateAsync({ type: "arraybuffer" });
  return ab as unknown as Blob;
}

async function runImport(
  kind: "method" | undefined,
  provenance?: ImportProvenance,
) {
  const blob = await buildBundle(kind);
  const payload = await parseImportBundle(blob);
  const plan = await buildImportPlan(payload);
  const result = await applyImportPlan(plan, provenance);
  return { payload, plan, result };
}

function lastWriteFor(prefix: string): Record<string, unknown> | undefined {
  // The provenance stamp is the LAST overlay write to the entity path.
  for (let i = jsonWrites.length - 1; i >= 0; i--) {
    if (jsonWrites[i].path.startsWith(prefix)) return jsonWrites[i].record;
  }
  return undefined;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("imported experiment provenance stamp", () => {
  it("stamps received_from / fingerprint / at on the experiment task from the manifest sender", async () => {
    const { result } = await runImport(undefined, PROVENANCE);

    expect(result.newTaskId).toBe(300);
    const stamped = lastWriteFor("users/alex/tasks/");
    expect(stamped).toBeTruthy();
    expect(stamped?.received_from).toBe("morgan@lab.edu");
    expect(stamped?.received_from_fingerprint).toBe("ABCD 1234 EF56");
    expect(typeof stamped?.received_at).toBe("string");
    // The stamp overlays, it must not clobber what create wrote.
    expect(stamped?.id).toBe(300);
    expect(stamped?.owner).toBe("alex");
  });

  it("stamps the experiment's newly imported method too", async () => {
    await runImport(undefined, PROVENANCE);
    const stamped = lastWriteFor("users/alex/methods/");
    expect(stamped).toBeTruthy();
    expect(stamped?.received_from).toBe("morgan@lab.edu");
    expect(stamped?.received_from_fingerprint).toBe("ABCD 1234 EF56");
    expect(typeof stamped?.received_at).toBe("string");
  });

  it("LOCAL file-import (no provenance) stamps nothing on the experiment or method", async () => {
    await runImport(undefined, undefined);
    // No overlay write to either entity path: a native import carries no badge.
    expect(lastWriteFor("users/alex/tasks/")).toBeUndefined();
    expect(lastWriteFor("users/alex/methods/")).toBeUndefined();
  });
});

describe("imported standalone method provenance stamp", () => {
  it("stamps received_from / fingerprint / at on the method from the manifest sender", async () => {
    const { result } = await runImport("method", PROVENANCE);

    // Method-only landing: no task created.
    expect(result.newTaskId).toBeNull();
    expect(createdTasks).toHaveLength(0);

    const stamped = lastWriteFor("users/alex/methods/");
    expect(stamped).toBeTruthy();
    expect(stamped?.received_from).toBe("morgan@lab.edu");
    expect(stamped?.received_from_fingerprint).toBe("ABCD 1234 EF56");
    expect(typeof stamped?.received_at).toBe("string");
  });

  it("LOCAL file-import of a method (no provenance) stamps nothing", async () => {
    await runImport("method", undefined);
    expect(lastWriteFor("users/alex/methods/")).toBeUndefined();
  });
});
