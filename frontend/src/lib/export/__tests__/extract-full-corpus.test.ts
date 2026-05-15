// frontend/src/lib/export/__tests__/extract-full-corpus.test.ts
//
// Regression test for the export-bundle "full corpus" rule, post the GC
// removal (`390ef8e6`) and drop-behavior paradigm shift (`e0ffbefb`).
//
// Pre-shift, `buildExperimentPayload` ran `filterByBodyRefs` over the
// per-tab attachments so the export bundle only carried files that were
// inlined in the matching tab's markdown body. The orphan-GC was the
// rationale: a per-save sweep would delete unreferenced files anyway, so
// the export's filtered view matched the on-disk reality.
//
// Post-shift, "attached but not body-referenced" is an intentional user
// state. The user drops a file to keep it with the task without inlining
// it in the body. Filtering at the export boundary would silently lose
// that data — the Raw bundle is the cross-instance carrier, and the PDF
// Files-appendix exists precisely to surface non-inlined files.
//
// This test pins the rule: every on-disk attachment under the task's
// per-tab folders surfaces in `payload.attachments`, regardless of
// whether the body references it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@/lib/types";

// In-memory FS keyed by path. Files are stored as `Blob`s so the
// extractor's `readFileAsBlob` / `arrayBuffer` paths exercise real
// blob handling.
const memFiles = new Map<string, Blob>();
const memDirs = new Map<string, string[]>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readFileAsBlob: vi.fn(async (path: string) => {
      const blob = memFiles.get(path);
      return blob ?? null;
    }),
    listFiles: vi.fn(async (dirPath: string) => {
      return memDirs.get(dirPath) ?? [];
    }),
  },
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  taskResultsBase: (task: { id: number; owner: string | null }) =>
    `users/${task.owner}/results/task-${task.id}`,
  findExistingTaskResultsBase: vi.fn(async (task: { id: number; owner: string | null }) =>
    `users/${task.owner}/results/task-${task.id}`,
  ),
  tabScopedFolderHasContent: vi.fn(async (tabBase: string) => {
    // Mirror real implementation: non-empty if any non-dot files exist
    // under `${tabBase}/Files` or `${tabBase}/Images`.
    for (const sub of ["Files", "Images"]) {
      const names = memDirs.get(`${tabBase}/${sub}`) ?? [];
      if (names.some((n) => !n.startsWith("."))) return true;
    }
    return false;
  }),
}));

// Minimal local-api surface — the extractor pulls these for protocol /
// structured-method reads. We only exercise a markdown method here so
// the structured-method APIs are stubbed to empty.
vi.mock("@/lib/local-api", () => ({
  projectsApi: { get: vi.fn(async () => null) },
  methodsApi: { get: vi.fn(async () => null) },
  filesApi: { readFile: vi.fn(async () => ({ content: "" })) },
  pcrApi: { get: vi.fn(async () => null) },
  lcGradientApi: { get: vi.fn(async () => null) },
  plateApi: { get: vi.fn(async () => null) },
  cellCultureApi: { get: vi.fn(async () => null) },
}));

import { buildExperimentPayload } from "../extract";
import {
  projectsApi,
  methodsApi,
  filesApi,
} from "@/lib/local-api";

function makeTask(): Task {
  return {
    id: 42,
    project_id: 7,
    name: "Sample task",
    start_date: "2026-05-15",
    duration_days: 1,
    end_date: "2026-05-15",
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
}

describe("buildExperimentPayload — full-corpus attachment rule", () => {
  beforeEach(() => {
    memFiles.clear();
    memDirs.clear();
  });

  it("includes non-body-referenced images + files in payload.attachments", async () => {
    const task = makeTask();
    const base = `users/alex/results/task-42`;

    // notes.md inlines only `inlined.png` — `orphan.png` and `extra.pdf`
    // are attached but not body-referenced.
    memFiles.set(
      `${base}/notes.md`,
      new Blob(["# Notes\n\n![p](Images/inlined.png)\n"], {
        type: "text/markdown",
      }),
    );
    memDirs.set(`${base}/notes/Images`, ["inlined.png", "orphan.png"]);
    memDirs.set(`${base}/notes/Files`, ["extra.pdf"]);
    memFiles.set(
      `${base}/notes/Images/inlined.png`,
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    );
    memFiles.set(
      `${base}/notes/Images/orphan.png`,
      new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" }),
    );
    memFiles.set(
      `${base}/notes/Files/extra.pdf`,
      new Blob([new Uint8Array([7, 8, 9])], { type: "application/pdf" }),
    );

    const payload = await buildExperimentPayload(task, "alex", {
      projectsApi,
      methodsApi,
      filesApi,
    });

    const filenames = payload.attachments.map((a) => a.filename).sort();
    expect(filenames).toEqual(["extra.pdf", "inlined.png", "orphan.png"]);

    // Spot-check that origin is preserved on the non-referenced ones.
    const orphan = payload.attachments.find((a) => a.filename === "orphan.png");
    expect(orphan?.origin).toBe("notes");
    expect(orphan?.diskRef).toBe("Images/orphan.png");

    const extra = payload.attachments.find((a) => a.filename === "extra.pdf");
    expect(extra?.origin).toBe("notes");
    expect(extra?.diskRef).toBe("Files/extra.pdf");
  });

  it("carries attachments even when notes.md is missing entirely", async () => {
    // Edge case: a user drops files on the notes tab without ever writing
    // any markdown. Pre-shift this returned an empty list (no body =
    // nothing to match refs against); post-shift the attached files
    // should still surface.
    const task = makeTask();
    const base = `users/alex/results/task-42`;
    memDirs.set(`${base}/notes/Files`, ["only-attached.pdf"]);
    memFiles.set(
      `${base}/notes/Files/only-attached.pdf`,
      new Blob([new Uint8Array([1])], { type: "application/pdf" }),
    );

    const payload = await buildExperimentPayload(task, "alex", {
      projectsApi,
      methodsApi,
      filesApi,
    });

    expect(payload.attachments.map((a) => a.filename)).toEqual([
      "only-attached.pdf",
    ]);
    expect(payload.notesMarkdown).toBeNull();
  });
});
