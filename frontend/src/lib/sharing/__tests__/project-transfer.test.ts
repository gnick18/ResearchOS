// Tests for the project transfer adapter + the project case of the inbox sniff.
//
//   - sniffSharePayload classifies a researchos-project bundle as "project" and
//     never confuses it with an experiment/method bundle (the disjoint marker
//     file _project-manifest.json).
//   - projectPayloadToFile wraps decrypted bytes as a .zip File the project
//     import dialog can drive.
//   - buildProjectBundle (export side) produces a bundle that sniffs as
//     "project" and round-trips through parseProjectBundle.
//
// The single-blob transport itself (sendRawShare) is exercised by the relay
// tests; here we pin the classification + wrapping the inbox dispatch depends on.

import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";

import { sniffSharePayload } from "@/lib/sharing/experiment-transfer";
import { projectPayloadToFile } from "@/lib/sharing/project-transfer";
import {
  PROJECT_BUNDLE_FORMAT,
  PROJECT_BUNDLE_VERSION,
  PROJECT_MANIFEST_FILE,
} from "@/lib/export/project-bundle";

async function makeProjectZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  // The minimum the sniffer keys on, the disjoint project marker file.
  zip.file(
    PROJECT_MANIFEST_FILE,
    JSON.stringify({
      format: PROJECT_BUNDLE_FORMAT,
      version: PROJECT_BUNDLE_VERSION,
      kind: "project",
      project_id: 1,
      experiments: [],
    }),
  );
  // A project bundle nests per-experiment bundles, but those live UNDER
  // experiments/ and never as a TOP-LEVEL _export-manifest.json, so the sniff
  // must not classify on the nested one.
  zip.file(
    "experiments/exp-raw.zip",
    JSON.stringify({ note: "an inner experiment bundle would be here" }),
  );
  return zip.generateAsync({ type: "uint8array" });
}

async function makeExperimentZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "_export-manifest.json",
    JSON.stringify({ format: "researchos-experiment", version: 2 }),
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("sniffSharePayload (project)", () => {
  it("classifies a researchos-project bundle as 'project'", async () => {
    expect(await sniffSharePayload(await makeProjectZip())).toBe("project");
  });

  it("does not classify a project bundle as 'experiment'", async () => {
    expect(await sniffSharePayload(await makeProjectZip())).not.toBe("experiment");
  });

  it("still classifies a plain experiment bundle as 'experiment' (no regression)", async () => {
    expect(await sniffSharePayload(await makeExperimentZip())).toBe("experiment");
  });
});

describe("projectPayloadToFile", () => {
  it("wraps bytes as a .zip File", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = projectPayloadToFile(bytes, "demo");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("demo.zip");
    expect(file.type).toBe("application/zip");
    expect(file.size).toBe(4);
  });
});

// ── Exporter integration: buildProjectBundle via mocked extract (no disk) ─────

// buildProjectBundle now also gathers the project's sequences (v2). Stub the
// sequences read so the export side does not touch disk; this test pins the
// experiment + sniff path, not the sequence carry (that lives in the project
// import round-trip test). An empty list keeps the bundle sequence-free.
vi.mock("@/lib/local-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/local-api")>("@/lib/local-api");
  return {
    ...actual,
    sequencesApi: {
      ...actual.sequencesApi,
      listByProject: vi.fn(async () => []),
      get: vi.fn(async () => null),
    },
  };
});

vi.mock("@/lib/export/extract", async () => {
  const actual = await vi.importActual<typeof import("@/lib/export/extract")>(
    "@/lib/export/extract",
  );
  return {
    ...actual,
    // Stub the disk-reading payload builder; the rest of the export
    // (buildRawZip wrapping) runs for real.
    buildExperimentPayload: vi.fn(async (task: { id: number; name: string }) => ({
      task: {
        id: task.id,
        project_id: 1,
        name: task.name,
        start_date: "2026-06-04",
        duration_days: 1,
        end_date: "2026-06-04",
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
        owner: "morgan",
        shared_with: [],
      },
      project: {
        id: 1,
        name: "Proj",
        weekend_active: false,
        tags: null,
        color: null,
        created_at: "2026-06-04T00:00:00.000Z",
        sort_order: 0,
        is_archived: false,
        archived_at: null,
        owner: "morgan",
        shared_with: [],
      },
      resolvedBase: "",
      notesMarkdown: "Notes",
      resultsMarkdown: null,
      methods: [],
      attachments: [],
      dependencies: [],
      meta: {
        ownerLabel: "morgan",
        durationDays: 1,
        statusLabel: "In Progress",
        methodNames: [],
        exportedAt: "2026-06-04T00:00:00.000Z",
      },
    })),
  };
});

describe("buildProjectBundle (export)", () => {
  it("produces a bundle that sniffs as 'project' and parses", async () => {
    const { buildProjectBundle } = await import("@/lib/export/project-bundle");
    const { parseProjectBundle } = await import("@/lib/import/project-parse");

    const project = {
      id: 1,
      name: "Proj",
      weekend_active: false,
      tags: null,
      color: null,
      created_at: "2026-06-04T00:00:00.000Z",
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "morgan",
      shared_with: [],
    };
    const tasks = [
      { id: 5, name: "Exp A" },
      { id: 6, name: "Exp B" },
    ];

    const bytes = await buildProjectBundle(
      project as never,
      tasks as never,
      "morgan",
    );

    expect(await sniffSharePayload(bytes)).toBe("project");

    const parsed = await parseProjectBundle(bytes as unknown as Blob);
    expect(parsed.experiments).toHaveLength(2);
    expect(parsed.manifest.counts.experiments).toBe(2);
  });
});
