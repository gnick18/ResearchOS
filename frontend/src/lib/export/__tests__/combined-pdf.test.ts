// frontend/src/lib/export/__tests__/combined-pdf.test.ts
//
// Unit coverage for `buildCombinedPdf` (combined-pdf bot, 2026-05-28).
//
// The combined builder merges multiple experiments and notes into ONE
// navigable PDF. Internal-link rendering can't be asserted pixel-wise, so
// these tests assert on DOCUMENT STRUCTURE instead:
//   - the result is a real PDF Blob (%PDF- magic bytes),
//   - the outline/bookmark tree lists every included item,
//   - the index/"key" section is present,
//   - a NAMED DESTINATION exists for each item (`item-<kind>-<id>`) plus the
//     shared `combined-index` anchor every "Back to index" link targets,
//   - page count grows with item count,
//   - empty + single-item edge cases produce a valid document.
//
// Items are resolved through INJECTED deps so the test never touches the
// filesystem or local-api. Fonts: same `Font.register` shim as
// orchestrate.test.ts - register Inter with absolute on-disk paths, then spy
// the builder's own browser-relative register call to a no-op.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as path from "node:path";

import { buildCombinedPdf, type CombinedPdfDeps } from "../combined-pdf";
import type { ExperimentExportPayload } from "../types";
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

function makeExperimentPayload(
  task: Task,
  notesMarkdown: string,
): ExperimentExportPayload {
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
        content: "## Topics\n\n- Reviewed plate reader data\n- Ordered primers\n",
        created_at: FIXED_EXPORTED_AT,
        updated_at: FIXED_EXPORTED_AT,
      },
    ],
    updated_at: FIXED_EXPORTED_AT,
    username: "alex",
    ...overrides,
  };
}

// Build injected deps from in-memory maps. No filesystem, no local-api.
function makeDeps(opts: {
  experiments?: Record<number, ExperimentExportPayload>;
  notes?: Record<number, Note>;
  currentUser?: string | null;
}): CombinedPdfDeps {
  const experiments = opts.experiments ?? {};
  const notes = opts.notes ?? {};
  return {
    currentUser: opts.currentUser ?? "alex",
    resolveExperiment: async (id) => experiments[id] ?? null,
    resolveNote: async (id) => notes[id] ?? null,
  };
}

async function pdfText(blob: Blob): Promise<string> {
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab).toString("latin1");
}

// Count `/Type /Page` objects (excludes `/Pages`). react-pdf emits these
// uncompressed in the object stream so a regex count is reliable.
function pageCount(text: string): number {
  return (text.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

describe("buildCombinedPdf", () => {
  beforeEach(async () => {
    // Same Font shim as orchestrate.test.ts: register Inter with absolute
    // on-disk paths, then spy the builder's own `/fonts/...` register call to
    // a no-op so react-pdf doesn't ENOENT in Node.
    const ReactPDF: typeof import("@react-pdf/renderer") = await import(
      "@react-pdf/renderer"
    );
    const fontsDir = path.resolve(__dirname, "../../../../public/fonts");
    ReactPDF.Font.register({
      family: "Inter",
      fonts: [
        { src: path.join(fontsDir, "Inter-Regular.ttf") },
        { src: path.join(fontsDir, "Inter-Bold.ttf"), fontWeight: "bold" },
      ],
    });
    vi.spyOn(ReactPDF.Font, "register").mockImplementation(() => {
      // no-op: Inter already registered above with valid paths.
    });
  });

  it("returns a real PDF Blob with the expected magic bytes", async () => {
    const task = makeTask();
    const deps = makeDeps({
      experiments: { 42: makeExperimentPayload(task, "# Notes\n\nGrew well.\n") },
    });
    const blob = await buildCombinedPdf(
      { title: "Test selection", items: [{ kind: "experiment", id: 42 }] },
      deps,
    );
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/pdf");

    const ab = await blob.arrayBuffer();
    const head = String.fromCharCode(...new Uint8Array(ab).subarray(0, 5));
    expect(head).toBe("%PDF-");
  });

  it("lists every item in the outline/bookmark tree", async () => {
    const expA = makeExperimentPayload(
      makeTask({ id: 1, name: "Alpha assay" }),
      "# Notes\n\nAlpha body.\n",
    );
    const expB = makeExperimentPayload(
      makeTask({ id: 2, name: "Beta assay" }),
      "# Notes\n\nBeta body.\n",
    );
    const noteC = makeNote({ id: 3, title: "Gamma log" });
    const deps = makeDeps({
      experiments: { 1: expA, 2: expB },
      notes: { 3: noteC },
    });

    const blob = await buildCombinedPdf(
      {
        title: "Three items",
        items: [
          { kind: "experiment", id: 1 },
          { kind: "experiment", id: 2 },
          { kind: "note", id: 3 },
        ],
      },
      deps,
    );
    const text = await pdfText(blob);

    // Outline entries (the per-item bookmark titles) appear as plaintext.
    expect(text).toContain("Experiment: Alpha assay");
    expect(text).toContain("Experiment: Beta assay");
    expect(text).toContain("Note: Gamma log");
    // The index page itself is bookmarked too.
    expect(text).toContain("Index");
    // A PDF outline tree exists.
    expect(text).toContain("/Outlines");
  });

  it("emits a named destination for each item plus the index anchor", async () => {
    const expA = makeExperimentPayload(makeTask({ id: 11 }), "# Notes\n\nA.\n");
    const noteB = makeNote({ id: 22 });
    const deps = makeDeps({
      experiments: { 11: expA },
      notes: { 22: noteB },
    });

    const blob = await buildCombinedPdf(
      {
        title: "Dest test",
        items: [
          { kind: "experiment", id: 11 },
          { kind: "note", id: 22 },
        ],
      },
      deps,
    );
    const text = await pdfText(blob);

    // Named destinations are written verbatim into the PDF /Dests / /Names
    // dictionary. The cover/index + back-links reference these by name.
    expect(text).toContain("item-experiment-11");
    expect(text).toContain("item-note-22");
    expect(text).toContain("combined-index");
    // A named-destination dictionary exists at all.
    expect(/\/Dests|\/Names/.test(text)).toBe(true);
  });

  it("renders the index/key section anchored so item links have valid targets", async () => {
    // The index page's link LABELS + group headings render through the Inter
    // CID font and aren't grep-able from the byte stream (same limitation the
    // orchestrate.test.ts PDF block documents). What IS reliably plaintext:
    //   - the index page's own bookmark title ("Index"),
    //   - the named destination each index link points at (item-<kind>-<id>),
    //   - the shared back-to-index anchor (combined-index).
    // Their presence proves the index is rendered AND every link target
    // resolves to a real destination - the navigability contract.
    const expA = makeExperimentPayload(
      makeTask({ id: 1, name: "My experiment" }),
      "# Notes\n\nbody\n",
    );
    const noteB = makeNote({ id: 2, title: "My note" });
    const deps = makeDeps({ experiments: { 1: expA }, notes: { 2: noteB } });

    const blob = await buildCombinedPdf(
      {
        title: "Index render",
        items: [
          { kind: "experiment", id: 1 },
          { kind: "note", id: 2 },
        ],
      },
      deps,
    );
    const text = await pdfText(blob);

    expect(text).toContain("Index"); // index page bookmark
    expect(text).toContain("combined-index"); // back-to-index anchor target
    expect(text).toContain("item-experiment-1"); // experiment index-link target
    expect(text).toContain("item-note-2"); // note index-link target
  });

  it("grows page count with item count", async () => {
    const oneDeps = makeDeps({
      experiments: { 1: makeExperimentPayload(makeTask({ id: 1 }), "# N\n\nx\n") },
    });
    const onePdf = await buildCombinedPdf(
      { title: "One", items: [{ kind: "experiment", id: 1 }] },
      oneDeps,
    );
    const onePages = pageCount(await pdfText(onePdf));

    const threeDeps = makeDeps({
      experiments: {
        1: makeExperimentPayload(makeTask({ id: 1 }), "# N\n\nx\n"),
        2: makeExperimentPayload(makeTask({ id: 2 }), "# N\n\ny\n"),
        3: makeExperimentPayload(makeTask({ id: 3 }), "# N\n\nz\n"),
      },
    });
    const threePdf = await buildCombinedPdf(
      {
        title: "Three",
        items: [
          { kind: "experiment", id: 1 },
          { kind: "experiment", id: 2 },
          { kind: "experiment", id: 3 },
        ],
      },
      threeDeps,
    );
    const threePages = pageCount(await pdfText(threePdf));

    // cover + index + N item pages. More items ⇒ strictly more pages.
    expect(onePages).toBeGreaterThanOrEqual(3); // cover + index + 1 item
    expect(threePages).toBeGreaterThan(onePages);
  });

  it("handles a single experiment item", async () => {
    const deps = makeDeps({
      experiments: {
        5: makeExperimentPayload(
          makeTask({ id: 5, name: "Solo run" }),
          "# Notes\n\nlone body\n",
        ),
      },
    });
    const blob = await buildCombinedPdf(
      { title: "Solo run", items: [{ kind: "experiment", id: 5 }] },
      deps,
    );
    const text = await pdfText(blob);
    expect(text.slice(0, 5)).toBe("%PDF-");
    expect(text).toContain("Experiment: Solo run");
    expect(text).toContain("item-experiment-5");
    // Index + cover still rendered for a single item.
    expect(text).toContain("Index");
  });

  it("handles a single note item and renders its entries", async () => {
    const note = makeNote({
      id: 7,
      title: "Lab journal",
      entries: [
        {
          id: "x1",
          title: "Day one",
          date: "2026-05-01",
          content: "Set up the rig.\n",
          created_at: FIXED_EXPORTED_AT,
          updated_at: FIXED_EXPORTED_AT,
        },
      ],
    });
    const deps = makeDeps({ notes: { 7: note } });
    const blob = await buildCombinedPdf(
      { title: "Lab journal", items: [{ kind: "note", id: 7 }] },
      deps,
    );
    const text = await pdfText(blob);
    expect(text.slice(0, 5)).toBe("%PDF-");
    // Bookmark title + named destination are the reliable plaintext anchors
    // (body text renders through the Inter CID font and isn't grep-able).
    expect(text).toContain("Note: Lab journal");
    expect(text).toContain("item-note-7");
  });

  it("produces a valid (cover + index only) document for an empty selection", async () => {
    const deps = makeDeps({});
    const blob = await buildCombinedPdf({ title: "Nothing", items: [] }, deps);
    const text = await pdfText(blob);
    expect(text.slice(0, 5)).toBe("%PDF-");
    // Cover + index pages still render; the index page keeps its bookmark.
    // (The "No items to export." copy renders through Inter and isn't
    // grep-able, so we assert structure: bookmark + exact page count.)
    expect(text).toContain("Index");
    // Exactly the cover + index page (no item pages).
    expect(pageCount(text)).toBe(2);
  });

  it("skips items that fail to resolve without sinking the document", async () => {
    const expA = makeExperimentPayload(
      makeTask({ id: 1, name: "Present exp" }),
      "# N\n\nbody\n",
    );
    // id 2 is requested but not in the deps map ⇒ resolves to null ⇒ skipped.
    const deps = makeDeps({ experiments: { 1: expA } });
    const blob = await buildCombinedPdf(
      {
        title: "Partial",
        items: [
          { kind: "experiment", id: 1 },
          { kind: "experiment", id: 2 },
        ],
      },
      deps,
    );
    const text = await pdfText(blob);
    expect(text).toContain("Experiment: Present exp");
    expect(text).toContain("item-experiment-1");
    // The missing item has no destination.
    expect(text).not.toContain("item-experiment-2");
  });
});
