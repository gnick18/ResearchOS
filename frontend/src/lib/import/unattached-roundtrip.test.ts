// frontend/src/lib/import/unattached-roundtrip.test.ts
//
// Probe for the Raw-bundle round-trip behavior when the bundle carries a
// `methods/unattached/{filename}` directory. This shape is the defensive
// fallback that B2 added in `lib/export/raw.ts:86` for orphan
// `method_attachments` rows whose `method_id` isn't in the task's
// `method_ids` — instead of dropping them, the exporter dumps them into
// `methods/unattached/` so receivers can decide what to do.
//
// The receiver-side handling hadn't been exercised end-to-end. This probe
// constructs a synthetic Raw bundle in memory, runs it through
// `parseImportBundle` → `buildImportPlan` → `applyImportPlan`, and reports
// where (or whether) the orphan ends up in the receiver's filesystem.

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

// ── Mock surface ────────────────────────────────────────────────────────────
// Apply.ts touches fileService.writeFileFromBlob, methodsApi/projectsApi/
// tasksApi/pcrApi, getCurrentUserCached. We mock all of them at the module
// boundary so the test exercises real parse/resolve/apply logic without
// touching any real storage.

const writeCalls: Array<{ path: string; size: number }> = [];
const createdProjects: Array<{ id: number; name: string }> = [];
const createdMethods: Array<{ id: number; name: string; source_path: string | null }> = [];
const createdTasks: Array<{ id: number; name: string; method_ids: number[] }> = [];

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
    create: vi.fn(async ({ name, method_ids }: { name: string; method_ids?: number[] }) => {
      const id = createdTasks.length + 300;
      const task = { id, name, method_ids: method_ids ?? [] };
      createdTasks.push(task);
      return task;
    }),
    update: vi.fn(async () => undefined),
  },
  pcrApi: {
    create: vi.fn(async () => ({ id: 999 })),
  },
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

// ── Bundle factory ──────────────────────────────────────────────────────────
async function buildRawBundleWithUnattached(): Promise<Blob> {
  // JSZip's `loadAsync` rejects a Node `Blob` ("Can't read the data ...") —
  // its isBlob path uses FileReader, which doesn't exist in vitest's Node
  // env. Build the bundle as ArrayBuffer and hand it through where a Blob is
  // expected. `parseImportBundle` passes the argument straight to JSZip,
  // which duck-types and accepts ArrayBuffer.
  const zip = new JSZip();

  const manifest = {
    format: "researchos-experiment" as const,
    version: 1 as const,
    exported_at: "2026-05-14T12:00:00.000Z",
    exported_by: "ResearchOS",
    source_owner: "morgan",
    source_instance: "morgan@2026-05-14",
    task_id: 5,
    task_key: "self:5",
    project_id: 1,
    method_ids: [10], // ← Only method 10 is "attached"; the unattached method
                      //   files in `methods/unattached/` reference no manifest
                      //   method id.
  };
  zip.file("_export-manifest.json", JSON.stringify(manifest, null, 2));

  const task = {
    id: 5,
    project_id: 1,
    name: "Probe task",
    start_date: "2026-05-14",
    duration_days: 1,
    end_date: "2026-05-14",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment" as const,
    weekend_override: null,
    method_ids: [10],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
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
    created_at: "2026-05-14T12:00:00.000Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "morgan",
    shared_with: [],
  };
  zip.file("project.json", JSON.stringify(project, null, 2));

  // The attached method.
  const method10 = {
    id: 10,
    name: "Western blot",
    source_path: "methods/western-blot/western-blot.md",
    method_type: "markdown" as const,
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: "morgan",
    owner: "morgan",
    shared_with: [],
  };
  zip.file("methods/method-10.json", JSON.stringify(method10, null, 2));
  zip.file("methods/method-10-body.md", "# Western blot\n\nProtocol body.");

  // The orphan defensive-fallback files. These are method-origin attachments
  // whose source-side method_id wasn't in the task's method_ids, so extract.ts
  // filtered them out of the bound list and raw.ts dumped them here.
  zip.file(
    "methods/unattached/orphan-method-7.pdf",
    new TextEncoder().encode("%PDF-fake-pdf-bytes").buffer,
  );
  zip.file(
    "methods/unattached/orphan-method-7-supplement.png",
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
  );

  // Stamp deterministic dates so the zip is reproducible.
  const exportDate = new Date(manifest.exported_at);
  for (const entry of Object.values(zip.files)) {
    entry.date = exportDate;
  }
  const ab = await zip.generateAsync({ type: "arraybuffer" });
  // Intentional shape mismatch — see note above.
  return ab as unknown as Blob;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Raw-bundle `methods/unattached/` round-trip", () => {
  it("parse pulls orphan files into attachments[] with origin='methods', sub=null", async () => {
    const blob = await buildRawBundleWithUnattached();
    const payload = await parseImportBundle(blob);

    // Manifest + method 10 parsed normally.
    expect(payload.manifest.method_ids).toEqual([10]);
    expect(payload.methods).toHaveLength(1);
    expect(payload.methods[0].record.id).toBe(10);

    // Orphan files should be in `attachments`, tagged origin='methods', sub=null,
    // and WITHOUT a methodId (the parser has no way to recover it from the path).
    const unattached = payload.attachments.filter(
      (a) => a.origin === "methods" && a.sub === null && a.methodId === undefined,
    );
    expect(unattached.map((a) => a.filename).sort()).toEqual([
      "orphan-method-7-supplement.png",
      "orphan-method-7.pdf",
    ]);

    // Bytes preserved.
    for (const a of unattached) {
      expect(a.bytes.byteLength).toBeGreaterThan(0);
    }
  });

  it("apply does NOT write orphan files to disk — they are silently dropped", async () => {
    const blob = await buildRawBundleWithUnattached();
    const payload = await parseImportBundle(blob);
    const plan = await buildImportPlan(payload);
    const result = await applyImportPlan(plan);

    // Sanity: a task was created.
    expect(result.newTaskId).toBe(300);
    expect(createdTasks).toHaveLength(1);

    // No write call should target methods/unattached or carry an orphan filename.
    const orphanWrites = writeCalls.filter(
      (w) =>
        w.path.includes("orphan-method-7") ||
        w.path.includes("methods/unattached"),
    );
    expect(orphanWrites).toEqual([]);

    // Confirm the apply did write the legitimate method body — so the
    // pipeline isn't silently broken; it's specifically the orphans that drop.
    const methodBodyWrites = writeCalls.filter((w) =>
      w.path.endsWith(".md") && w.path.includes("methods/"),
    );
    expect(methodBodyWrites.length).toBeGreaterThanOrEqual(1);
  });

  it("round-trip behavior summary: orphan method files are LOSSY (behavior B)", async () => {
    // This test exists to document the answer to the audit question for
    // future readers. The defensive fallback in extract/raw.ts preserves the
    // bytes on the export side, but the receiver-side apply pipeline has
    // nowhere to land orphan method-origin attachments (no method id to
    // bind them to, no notes/results context). They are dropped at
    // `apply.ts:writeNotesResultsAttachments`, which only iterates the
    // notes/results branches.
    //
    // If the intent of B2's fallback was "preserve data through round-trip",
    // this is a partial gap: the export side preserves, but the import side
    // discards. Possible fixes:
    //   A. Apply.ts could write methods/unattached/{filename} into a
    //      receiver-side scratch directory (e.g. users/<u>/imported-orphans/)
    //      so the bytes survive.
    //   B. The conflict-resolution dialog could surface the orphan list and
    //      let the user opt in to importing them as standalone Files.
    //   C. Accept the drop as intentional and update the comment to say
    //      "drops, by design — orphans don't survive round-trip" so the
    //      contract is clear.
    //
    // Current behavior is B (the lossy drop). The test below pins it.
    const blob = await buildRawBundleWithUnattached();
    const payload = await parseImportBundle(blob);
    const plan = await buildImportPlan(payload);
    await applyImportPlan(plan);

    const orphanPersisted = writeCalls.some((w) =>
      w.path.includes("orphan-method-7"),
    );
    expect(orphanPersisted).toBe(false);
  });
});
