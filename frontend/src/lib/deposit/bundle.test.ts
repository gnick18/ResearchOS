// frontend/src/lib/deposit/bundle.test.ts
//
// Unit coverage for the PROJECT-LEVEL (multi-item) deposit bundle assembly
// (deposit-widening bot, 2026-05-29).
//
// `buildProjectDepositBundle` assembles ONE archive from N selected
// experiments + notes:
//   - each experiment exported INDIVIDUALLY (presentation format),
//   - each note rendered to an individual markdown file,
//   - the combined mega-PDF across ALL items (via buildCombinedPdf),
//   - the raw re-importable bundle of each experiment (reusability),
//   - the prefilled datacite.json metadata.
//
// We exercise the REAL export pipeline (buildHtmlBundle / buildRawZip) plus the
// REAL combined-PDF builder, with the same on-disk Inter font shim
// combined-pdf.test.ts uses so react-pdf does not ENOENT under Node. The
// combined-PDF resolver deps default to the in-hand payloads, so no filesystem
// or local-api is touched.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as path from "node:path";
import JSZip from "jszip";

import {
  buildProjectDepositBundle,
  noteToMarkdown,
  type ProjectDepositExperiment,
  type ProjectDepositNote,
} from "./bundle";
import {
  buildProjectDepositMetadata,
  type DepositMetadata,
} from "./datacite";
import type { ExperimentExportPayload } from "@/lib/export/types";
import type { Note, Task, Project } from "@/lib/types";

const FIXED_EXPORTED_AT = "2026-05-14T12:00:00.000Z";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 42,
    project_id: 7,
    name: "Cell culture growth",
    start_date: "2026-05-10",
    duration_days: 5,
    end_date: "2026-05-14",
    is_high_level: false,
    is_complete: true,
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
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 7,
    name: "Yeast metabolism",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alex",
    shared_with: [],
    ...overrides,
  };
}

function makePayload(task: Task, notesMarkdown: string): ExperimentExportPayload {
  return {
    task,
    project: makeProject(),
    resolvedBase: `users/alex/results/task-${task.id}`,
    notesMarkdown,
    resultsMarkdown: null,
    methods: [],
    attachments: [],
    meta: {
      ownerLabel: "alex",
      durationDays: task.duration_days ?? 1,
      statusLabel: "Complete",
      methodNames: [],
      exportedAt: FIXED_EXPORTED_AT,
    },
  };
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 99,
    title: "Weekly meeting",
    description: "Standing agenda for the lab meeting.",
    is_running_log: true,
    is_shared: false,
    entries: [
      {
        id: "e1",
        title: "2026-05-12 sync",
        date: "2026-05-12",
        content: "## Topics\n\n- Reviewed plate reader data\n",
        created_at: FIXED_EXPORTED_AT,
        updated_at: FIXED_EXPORTED_AT,
      },
    ],
    updated_at: FIXED_EXPORTED_AT,
    username: "alex",
    ...overrides,
  };
}

function bareMetadata(): DepositMetadata {
  return buildProjectDepositMetadata({
    project: makeProject(),
    ownerDisplayName: "Alex Rivera",
    licenseSpdxId: "CC-BY-4.0",
  });
}

/** Read every (non-directory) entry path out of a generated bundle blob. */
async function bundleEntryNames(blob: Blob): Promise<string[]> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return Object.values(zip.files)
    .filter((e) => !e.dir)
    .map((e) => e.name)
    .sort();
}

async function bundleEntry(blob: Blob, name: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entry = zip.file(name);
  return entry ? entry.async("string") : null;
}

describe("noteToMarkdown", () => {
  it("renders title, description, and each entry as markdown", () => {
    const md = noteToMarkdown(makeNote());
    expect(md).toContain("# Weekly meeting");
    expect(md).toContain("Standing agenda for the lab meeting.");
    expect(md).toContain("## 2026-05-12 sync");
    expect(md).toContain("Reviewed plate reader data");
  });

  it("emits an empty-content marker for a bare note", () => {
    const md = noteToMarkdown(
      makeNote({ description: "", entries: [], title: "Empty" }),
    );
    expect(md).toContain("# Empty");
    expect(md).toContain("_This note has no content._");
  });
});

describe("buildProjectDepositBundle", () => {
  beforeEach(async () => {
    // Inter font shim, identical to combined-pdf.test.ts: register the real
    // on-disk Inter then no-op the builder's browser-relative register call.
    const ReactPDF: typeof import("@react-pdf/renderer") = await import(
      "@react-pdf/renderer"
    );
    const fontsDir = path.resolve(__dirname, "../../../public/fonts");
    ReactPDF.Font.register({
      family: "Inter",
      fonts: [
        { src: path.join(fontsDir, "Inter-Regular.ttf") },
        { src: path.join(fontsDir, "Inter-Bold.ttf"), fontWeight: "bold" },
      ],
    });
    vi.spyOn(ReactPDF.Font, "register").mockImplementation(() => {
      // no-op: Inter already registered above.
    });
  });

  it("assembles individual files, the combined PDF, raw bundles, and datacite.json", async () => {
    const expA: ProjectDepositExperiment = {
      id: 1,
      payload: makePayload(
        makeTask({ id: 1, name: "Alpha assay" }),
        "# Notes\n\nAlpha grew well.\n",
      ),
    };
    const expB: ProjectDepositExperiment = {
      id: 2,
      payload: makePayload(
        makeTask({ id: 2, name: "Beta assay" }),
        "# Notes\n\nBeta grew well.\n",
      ),
    };
    const noteC: ProjectDepositNote = {
      id: 3,
      note: makeNote({ id: 3, title: "Gamma log" }),
    };

    const result = await buildProjectDepositBundle({
      title: "Yeast metabolism",
      experiments: [expA, expB],
      notes: [noteC],
      format: "html",
      metadata: bareMetadata(),
      currentUser: "alex",
    });

    expect(result.filename).toBe("yeast-metabolism-deposit.zip");
    expect(result.mimeType).toBe("application/zip");

    const names = await bundleEntryNames(result.blob);

    // Metadata file at the top.
    expect(names).toContain("datacite.json");
    // The single navigable companion document.
    expect(names).toContain("combined.pdf");
    // Each experiment exported individually under experiments/{slug}/ (html
    // unwrapped to a browsable subfolder).
    expect(names.some((n) => n.startsWith("experiments/alpha-assay/"))).toBe(true);
    expect(names.some((n) => n.startsWith("experiments/beta-assay/"))).toBe(true);
    // Each note as an individual markdown file under notes/.
    expect(names).toContain("notes/gamma-log.md");
    // The raw re-importable bundle of each experiment under raw/.
    expect(names).toContain("raw/alpha-assay-raw.zip");
    expect(names).toContain("raw/beta-assay-raw.zip");

    // combined.pdf is a real PDF.
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const combined = await zip.file("combined.pdf")!.async("uint8array");
    const head = String.fromCharCode(...combined.subarray(0, 5));
    expect(head).toBe("%PDF-");

    // The note file carries the note's markdown.
    const noteMd = await bundleEntry(result.blob, "notes/gamma-log.md");
    expect(noteMd).toContain("# Gamma log");

    // datacite.json round-trips to valid metadata.
    const dataciteJson = await bundleEntry(result.blob, "datacite.json");
    const parsed = JSON.parse(dataciteJson ?? "{}");
    expect(parsed.titles[0].title).toBe("Yeast metabolism");
    expect(parsed.types.resourceType).toBe("Collection");
  });

  it("does NOT duplicate the raw bundle when the presentation format is raw", async () => {
    const exp: ProjectDepositExperiment = {
      id: 1,
      payload: makePayload(makeTask({ id: 1, name: "Alpha assay" }), "# Notes\n\nbody\n"),
    };
    const result = await buildProjectDepositBundle({
      title: "Proj",
      experiments: [exp],
      notes: [],
      format: "raw",
      metadata: bareMetadata(),
      currentUser: "alex",
    });
    const names = await bundleEntryNames(result.blob);
    // The raw presentation lands under experiments/ ...
    expect(names.some((n) => n.startsWith("experiments/"))).toBe(true);
    // ... and there is NO separate raw/ folder (would be byte-identical).
    expect(names.some((n) => n.startsWith("raw/"))).toBe(false);
  });

  it("disambiguates two same-named experiments by id", async () => {
    const expA: ProjectDepositExperiment = {
      id: 10,
      payload: makePayload(makeTask({ id: 10, name: "Assay" }), "# Notes\n\nA\n"),
    };
    const expB: ProjectDepositExperiment = {
      id: 20,
      payload: makePayload(makeTask({ id: 20, name: "Assay" }), "# Notes\n\nB\n"),
    };
    const result = await buildProjectDepositBundle({
      title: "Proj",
      experiments: [expA, expB],
      notes: [],
      format: "pdf",
      metadata: bareMetadata(),
      currentUser: "alex",
    });
    const names = await bundleEntryNames(result.blob);
    // Slugs collide -> id-suffixed so neither overwrites the other.
    expect(names).toContain("experiments/assay-10.pdf");
    expect(names).toContain("experiments/assay-20.pdf");
  });

  it("handles a notes-only selection (no experiments, no raw/ folder)", async () => {
    const noteA: ProjectDepositNote = { id: 3, note: makeNote({ id: 3, title: "Log A" }) };
    const noteB: ProjectDepositNote = { id: 4, note: makeNote({ id: 4, title: "Log B" }) };
    const result = await buildProjectDepositBundle({
      title: "Notes only",
      experiments: [],
      notes: [noteA, noteB],
      format: "html",
      metadata: bareMetadata(),
      currentUser: "alex",
    });
    const names = await bundleEntryNames(result.blob);
    expect(names).toContain("notes/log-a.md");
    expect(names).toContain("notes/log-b.md");
    expect(names).toContain("combined.pdf");
    expect(names).toContain("datacite.json");
    expect(names.some((n) => n.startsWith("experiments/"))).toBe(false);
    expect(names.some((n) => n.startsWith("raw/"))).toBe(false);
  });

  it("resolves the combined PDF from the in-hand payloads (curation-respecting, no extra reads)", async () => {
    // The injected combinedPdfDeps path is exercised here: a spy deps object
    // confirms the bundle drives buildCombinedPdf through OUR resolvers, never
    // the real local-api.
    const exp: ProjectDepositExperiment = {
      id: 1,
      payload: makePayload(makeTask({ id: 1, name: "Alpha" }), "# Notes\n\nbody\n"),
    };
    const note: ProjectDepositNote = { id: 3, note: makeNote({ id: 3, title: "Log" }) };
    const resolveExperiment = vi.fn(async (id: number) =>
      id === 1 ? exp.payload : null,
    );
    const resolveNote = vi.fn(async (id: number) => (id === 3 ? note.note : null));

    const result = await buildProjectDepositBundle(
      {
        title: "Proj",
        experiments: [exp],
        notes: [note],
        format: "raw",
        metadata: bareMetadata(),
        currentUser: "alex",
      },
      { resolveExperiment, resolveNote, currentUser: "alex" },
    );

    expect(resolveExperiment).toHaveBeenCalledWith(1);
    expect(resolveNote).toHaveBeenCalledWith(3);
    const names = await bundleEntryNames(result.blob);
    expect(names).toContain("combined.pdf");
  });
});
