// frontend/src/lib/import/project-import.test.ts
//
// Cross-boundary PROJECT sharing (v1) tests. These run the real
// parseProjectBundle -> applyProjectImportPlan pipeline against a synthetic
// `researchos-project` bundle whose inner per-experiment bundles are built with
// the SAME buildRawZip the experiment export uses (pure, no disk). Only the
// storage boundary (fileService + local-api + getCurrentUserCached) is mocked.
//
// Coverage:
//   1. Project bundle round-trip: a 2-experiment project parses into 2 inner
//      payloads + the stripped project record + the project-scoped dep union.
//   2. ALWAYS-NEW import: one fresh project is created, every task bound to it,
//      and an imported_from provenance stamp is written.
//   3. Multi-task dependency remap: an in-project link whose BOTH endpoints are
//      in the bundle is RECREATED (the payoff the single-experiment tier
//      deferred), not dropped.
//   4. Method dedup across experiments (design Q3): a method referenced by both
//      experiments is localized ONCE, both tasks point at the same new id.
//   5. notCarried aggregation: a link to a task NOT in the bundle is dropped +
//      reported once across the whole project.

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

// ── Mock surface (mirrors dependency-method-carry.test.ts) ──────────────────
const createdProjects: Array<{ id: number; name: string; imported_from?: unknown }> = [];
const createdMethods: Array<{ id: number; name: string }> = [];
const createdTasks: Array<{ id: number; name: string; project_id: number | null; method_ids: number[] }> = [];
const createdDeps: Array<{ parent_id: number; child_id: number; dep_type: string }> = [];

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    writeFileFromBlob: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/local-api", () => ({
  projectsApi: {
    list: vi.fn(async () => []),
    create: vi.fn(async ({ name, imported_from }: { name: string; imported_from?: unknown }) => {
      const id = createdProjects.length + 100;
      const project = { id, name, imported_from };
      createdProjects.push(project);
      return project;
    }),
  },
  methodsApi: {
    list: vi.fn(async () => []),
    create: vi.fn(async ({ name }: { name: string }) => {
      const id = createdMethods.length + 200;
      const method = { id, name };
      createdMethods.push(method);
      return method;
    }),
  },
  tasksApi: {
    create: vi.fn(
      async ({
        name,
        project_id,
        method_ids,
      }: {
        name: string;
        project_id: number | null;
        method_ids?: number[];
      }) => {
        const id = createdTasks.length + 300;
        const task = { id, name, project_id, method_ids: method_ids ?? [] };
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
import { buildRawZip } from "@/lib/export/raw";
import type { ExperimentExportPayload } from "@/lib/export/types";
import {
  PROJECT_BUNDLE_FORMAT,
  PROJECT_BUNDLE_VERSION,
  PROJECT_MANIFEST_FILE,
  type ProjectBundleManifest,
} from "@/lib/export/project-bundle";
import type { Dependency, Project, Task } from "@/lib/types";
import { parseProjectBundle } from "./project-parse";
import { applyProjectImportPlan } from "./project-apply";

beforeEach(() => {
  createdProjects.length = 0;
  createdMethods.length = 0;
  createdTasks.length = 0;
  createdDeps.length = 0;
});

const EXPORTED_AT = "2026-06-04T12:00:00.000Z";

function makeTask(id: number, methodIds: number[]): Task {
  return {
    id,
    project_id: 1,
    name: `Experiment ${id}`,
    start_date: "2026-06-04",
    duration_days: 1,
    end_date: "2026-06-04",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: methodIds,
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "morgan",
    shared_with: [],
  };
}

function makeMethodPayload(id: number) {
  return {
    method: {
      id,
      name: `Method ${id}`,
      source_path: `methods/method-${id}/method-${id}.md`,
      method_type: "markdown" as const,
      folder_path: null,
      parent_method_id: null,
      tags: null,
      is_public: false,
      created_by: "morgan",
      owner: "morgan",
      shared_with: [],
    },
    bodyMarkdown: `# Method ${id}\n\nBody.`,
    attachment: null,
  };
}

function makeProject(): Project {
  return {
    id: 1,
    name: "Photosynthesis assay",
    weekend_active: false,
    tags: ["plant"],
    color: "#22aa55",
    created_at: EXPORTED_AT,
    sort_order: 3,
    is_archived: false,
    archived_at: null,
    owner: "morgan",
    shared_with: [],
    // Overlay + grant fields that MUST NOT be carried in the share.
    is_shared_with_me: true,
    funding_account_id: 77,
  };
}

async function buildExperimentPayloadForTask(
  task: Task,
  deps: Dependency[],
): Promise<ExperimentExportPayload> {
  return {
    task,
    project: makeProject(),
    resolvedBase: "",
    notesMarkdown: `Notes for ${task.name}`,
    resultsMarkdown: null,
    methods: task.method_ids.map((id) => makeMethodPayload(id)),
    attachments: [],
    dependencies: deps,
    meta: {
      ownerLabel: "morgan",
      durationDays: 1,
      statusLabel: "In Progress",
      methodNames: task.method_ids.map((id) => `Method ${id}`),
      exportedAt: EXPORTED_AT,
    },
  };
}

/**
 * Build a synthetic researchos-project bundle. Inner per-experiment bundles are
 * built with the REAL buildRawZip (pure, no disk) so the parser exercises the
 * actual experiment-bundle shape. dependencies = the project-scoped deduped union.
 */
async function buildProjectBundleZip(opts: {
  tasks: Task[];
  perTaskDeps: Dependency[][];
  projectDeps: Dependency[];
}): Promise<Blob> {
  const zip = new JSZip();
  const experimentsIndex: ProjectBundleManifest["experiments"] = [];

  for (let i = 0; i < opts.tasks.length; i++) {
    const task = opts.tasks[i];
    const payload = await buildExperimentPayloadForTask(task, opts.perTaskDeps[i] ?? []);
    const result = await buildRawZip(payload, `experiment-${task.id}`);
    const path = `experiments/${result.filename}`;
    const innerBytes = await result.blob.arrayBuffer();
    zip.file(path, innerBytes);
    experimentsIndex.push({ task_id: task.id, name: task.name, path });
  }

  const project = makeProject();
  zip.file(
    "project.json",
    JSON.stringify(
      {
        id: project.id,
        name: project.name,
        weekend_active: project.weekend_active,
        tags: project.tags,
        color: project.color,
        created_at: project.created_at,
        sort_order: project.sort_order,
      },
      null,
      2,
    ),
  );
  if (opts.projectDeps.length > 0) {
    zip.file("dependencies.json", JSON.stringify(opts.projectDeps, null, 2));
  }

  const manifest: ProjectBundleManifest = {
    format: PROJECT_BUNDLE_FORMAT,
    version: PROJECT_BUNDLE_VERSION,
    kind: "project",
    exported_at: EXPORTED_AT,
    exported_by: "ResearchOS",
    source_owner: project.owner,
    project_id: project.id,
    project_name: project.name,
    experiments: experimentsIndex,
    dependency_ids: opts.projectDeps.map((d) => d.id),
    counts: { experiments: experimentsIndex.length, dependencies: opts.projectDeps.length },
  };
  zip.file(PROJECT_MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  const ab = await zip.generateAsync({ type: "arraybuffer" });
  return ab as unknown as Blob;
}

function dep(id: number, parent: number, child: number): Dependency {
  return { id, parent_id: parent, child_id: child, dep_type: "FS" };
}

describe("project bundle round-trip (parse)", () => {
  it("parses a 2-experiment project into payloads + stripped project + dep union", async () => {
    const tasks = [makeTask(5, [10]), makeTask(6, [11])];
    const blob = await buildProjectBundleZip({
      tasks,
      perTaskDeps: [[dep(900, 5, 6)], [dep(900, 5, 6)]],
      projectDeps: [dep(900, 5, 6)],
    });

    const parsed = await parseProjectBundle(blob);

    expect(parsed.manifest.kind).toBe("project");
    expect(parsed.experiments).toHaveLength(2);
    expect(parsed.project.name).toBe("Photosynthesis assay");
    // Overlay + grant fields must NOT be carried.
    expect((parsed.project as unknown as Record<string, unknown>).funding_account_id).toBeUndefined();
    expect((parsed.project as unknown as Record<string, unknown>).is_shared_with_me).toBeUndefined();
    // The dep union is present, deduped to one record.
    expect(parsed.dependencies).toHaveLength(1);
    expect(parsed.dependencies[0].id).toBe(900);
  });
});

describe("always-new project import", () => {
  it("creates ONE fresh project bound to every task, with an imported_from stamp", async () => {
    const tasks = [makeTask(5, [10]), makeTask(6, [11])];
    const blob = await buildProjectBundleZip({
      tasks,
      perTaskDeps: [[], []],
      projectDeps: [],
    });
    const parsed = await parseProjectBundle(blob);

    const result = await applyProjectImportPlan(parsed, { sender: "morgan@lab.edu" });

    expect(createdProjects).toHaveLength(1);
    expect(createdTasks).toHaveLength(2);
    for (const t of createdTasks) {
      expect(t.project_id).toBe(result.newProjectId);
    }
    // imported_from provenance stamp.
    const stamp = createdProjects[0].imported_from as {
      sender: string;
      source_project_name: string;
    };
    expect(stamp.sender).toBe("morgan@lab.edu");
    expect(stamp.source_project_name).toBe("Photosynthesis assay");
  });
});

describe("multi-task dependency remap", () => {
  it("RECREATES an in-project link when both endpoints are in the bundle", async () => {
    const tasks = [makeTask(5, [10]), makeTask(6, [11])];
    const blob = await buildProjectBundleZip({
      tasks,
      perTaskDeps: [[dep(900, 5, 6)], [dep(900, 5, 6)]],
      projectDeps: [dep(900, 5, 6)],
    });
    const parsed = await parseProjectBundle(blob);

    const result = await applyProjectImportPlan(parsed, { sender: "morgan@lab.edu" });

    // The link was recreated, not dropped.
    expect(createdDeps).toHaveLength(1);
    expect(result.notCarried.dependencies).toHaveLength(0);
    // Endpoints were remapped into the receiver's new task ids.
    const newIds = createdTasks.map((t) => t.id);
    expect(newIds).toContain(createdDeps[0].parent_id);
    expect(newIds).toContain(createdDeps[0].child_id);
    expect(createdDeps[0].parent_id).not.toBe(createdDeps[0].child_id);
  });

  it("DROPS + reports a link whose endpoint is not in the bundle", async () => {
    const tasks = [makeTask(5, [10])];
    // A link 5 -> 99, where 99 is not a carried task.
    const blob = await buildProjectBundleZip({
      tasks,
      perTaskDeps: [[dep(901, 5, 99)]],
      projectDeps: [dep(901, 5, 99)],
    });
    const parsed = await parseProjectBundle(blob);

    const result = await applyProjectImportPlan(parsed, { sender: "morgan@lab.edu" });

    expect(createdDeps).toHaveLength(0);
    expect(result.notCarried.dependencies).toHaveLength(1);
    expect(result.notCarried.dependencies[0].sourceChildId).toBe(99);
  });
});

describe("method dedup across experiments (design Q3)", () => {
  it("localizes a shared method ONCE; both tasks point at the same new id", async () => {
    // Both experiments reference method 10.
    const tasks = [makeTask(5, [10]), makeTask(6, [10])];
    const blob = await buildProjectBundleZip({
      tasks,
      perTaskDeps: [[], []],
      projectDeps: [],
    });
    const parsed = await parseProjectBundle(blob);

    await applyProjectImportPlan(parsed, { sender: "morgan@lab.edu" });

    // Method 10 localized exactly once.
    expect(createdMethods).toHaveLength(1);
    // Both tasks carry the same single localized method id.
    expect(createdTasks).toHaveLength(2);
    expect(createdTasks[0].method_ids).toEqual([createdMethods[0].id]);
    expect(createdTasks[1].method_ids).toEqual([createdMethods[0].id]);
  });
});
