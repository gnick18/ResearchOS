// frontend/src/lib/export/__tests__/orchestrate.test.ts
//
// Happy-path unit coverage for the three format generators in
// `lib/export/`: `buildRawZip` (raw), `buildHtmlBundle` (html), and
// `buildPdf` (pdf). Closes the §8 backlog item flagged 2026-05-14: "No
// unit tests for `lib/export/` or `lib/import/`" — Batch D, Tier-3 audit.
//
// Each format gets a self-contained describe block; a shared fixture
// helper (`buildTestPayload`) keeps setup compact. The Raw and HTML
// formats are inspected by unzipping the result Blob and asserting on
// in-zip entry names / contents / mtimes. The PDF format is inspected by
// magic-bytes + a grep across the rendered PDF text stream (which is
// fine for ASCII; we'd need a full PDF parser to verify visually styled
// content but `keywords` and section titles are reliable as plain text).
//
// Mocks: `@react-pdf/renderer`'s `Font.register` is spy-replaced before
// each PDF test so the relative `/fonts/Inter-*.ttf` paths in `pdf.ts`
// (intended for the browser's public/ static-assets server) don't try
// to resolve against the test runner's filesystem.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as path from "node:path";
import JSZip from "jszip";

import { buildRawZip } from "../raw";
import { buildHtmlBundle } from "../html";
import { buildPdf } from "../pdf";
import type {
  ExperimentExportPayload,
  RawManifest,
  HtmlManifest,
  PdfManifest,
} from "../types";
import type {
  Task,
  Method,
  Project,
} from "@/lib/types";

// ── Fixtures ────────────────────────────────────────────────────────────────

// Minimal 1×1 transparent PNG, hand-rolled so we don't need any decoder
// in test scope. Crafted in 2026-05-14 for this suite — the export
// pipeline only cares about byte identity, not PNG validity.
const TINY_PNG: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, // IHDR length
  0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, // width  = 1
  0x00, 0x00, 0x00, 0x01, // height = 1
  0x08, 0x06, 0x00, 0x00, 0x00, // 8-bit RGBA
  0x1f, 0x15, 0xc4, 0x89, // IHDR CRC
  0x00, 0x00, 0x00, 0x0a, // IDAT length
  0x49, 0x44, 0x41, 0x54, // IDAT
  0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, // IDAT CRC
  0x00, 0x00, 0x00, 0x00, // IEND length
  0x49, 0x45, 0x4e, 0x44, // IEND
  0xae, 0x42, 0x60, 0x82, // IEND CRC
]);

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
    method_ids: [101],
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

function makeMethod(overrides: Partial<Method> = {}): Method {
  return {
    id: 101,
    name: "Western blot",
    source_path: "users/alex/methods/western-blot.md",
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: "alex",
    owner: "alex",
    shared_with: [],
    ...overrides,
  };
}

// Build a complete payload with one task, one markdown method, one image
// attachment. The `meta.exportedAt` is FIXED so deterministic-mtime
// assertions don't flap on re-runs.
function buildTestPayload(
  overrides: Partial<ExperimentExportPayload> = {},
): ExperimentExportPayload {
  const task = overrides.task ?? makeTask();
  const project = overrides.project ?? makeProject();
  const method = makeMethod();
  return {
    task,
    project,
    resolvedBase: "users/alex/results/task-42",
    notesMarkdown:
      "# Lab Notes: Cell culture\n\n2026-05-10: Started colony.\n\n![Plate](Images/plate-1.png)\n",
    resultsMarkdown:
      "# Results\n\nFinal optical density 0.85 at 600 nm.\n",
    methods: [
      {
        method,
        bodyMarkdown:
          "# Western blot\n\n1. Transfer protein\n2. Block membrane\n",
        attachment: null,
      },
    ],
    attachments: [
      {
        filename: "plate-1.png",
        mimeType: "image/png",
        // Slice out a standalone ArrayBuffer copy. Uint8Array.buffer on a
        // fresh `new Uint8Array(literal)` returns ArrayBuffer at runtime
        // but TS widens to ArrayBuffer | SharedArrayBuffer; the slice
        // narrows back to ArrayBuffer.
        bytes: new Uint8Array(TINY_PNG).buffer as ArrayBuffer,
        origin: "notes",
        diskRef: "Images/plate-1.png",
      },
    ],
    meta: {
      ownerLabel: "alex",
      durationDays: 5,
      statusLabel: "Complete",
      methodNames: ["Western blot"],
      exportedAt: FIXED_EXPORTED_AT,
    },
    ...overrides,
  };
}

async function unzip(blob: Blob): Promise<JSZip> {
  // JSZip's loadAsync rejects a Node Blob (the FileReader path isn't
  // present); take the underlying ArrayBuffer first.
  const ab = await blob.arrayBuffer();
  return JSZip.loadAsync(ab);
}

// ── Raw format ──────────────────────────────────────────────────────────────

describe("buildRawZip — happy path", () => {
  it("returns a Blob with the expected zip layout + manifest", async () => {
    const payload = buildTestPayload();
    const result = await buildRawZip(payload);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.mimeType).toBe("application/zip");
    expect(result.filename).toBe("cell-culture-growth-raw.zip");

    const zip = await unzip(result.blob);
    const names = Object.keys(zip.files).sort();

    // Top-level: manifest + task.json + project.json + notes.md + results.md
    expect(names).toContain("_export-manifest.json");
    expect(names).toContain("task.json");
    expect(names).toContain("project.json");
    expect(names).toContain("notes.md");
    expect(names).toContain("results.md");

    // Methods folder: per-method JSON + body.md (markdown method)
    expect(names).toContain("methods/method-101.json");
    expect(names).toContain("methods/method-101-body.md");

    // Notes-origin image landed under notes/Images/
    expect(names).toContain("notes/Images/plate-1.png");

    const manifest = JSON.parse(
      await zip.file("_export-manifest.json")!.async("string"),
    ) as RawManifest;
    expect(manifest.format).toBe("researchos-experiment");
    expect(manifest.version).toBe(1);
    expect(manifest.task_id).toBe(42);
    expect(manifest.project_id).toBe(7);
    expect(manifest.method_ids).toEqual([101]);
    expect(manifest.exported_at).toBe(FIXED_EXPORTED_AT);
    expect(manifest.task_key).toBe("self:42"); // not is_shared_with_me
  });

  it("stamps every entry's mtime with payload.meta.exportedAt (deterministic bytes)", async () => {
    const payload = buildTestPayload();
    const result = await buildRawZip(payload);
    const zip = await unzip(result.blob);

    const expected = new Date(FIXED_EXPORTED_AT);
    // JSZip's load round-trip carries the entry date through; assert it
    // matches the override. (raw.ts mutates every `entry.date` after add.)
    for (const entry of Object.values(zip.files)) {
      expect(entry.date.getTime()).toBe(expected.getTime());
    }
  });

  it("emits source_instance: <ownerLabel>@<YYYY-MM-DD>", async () => {
    const payload = buildTestPayload();
    const result = await buildRawZip(payload);
    const zip = await unzip(result.blob);
    const manifest = JSON.parse(
      await zip.file("_export-manifest.json")!.async("string"),
    ) as RawManifest;
    expect(manifest.source_instance).toBe("alex@2026-05-14");
  });

  it("preserves method_ids declaration order", async () => {
    const task = makeTask({ method_ids: [5, 3, 9, 1] });
    const payload = buildTestPayload({ task });
    const result = await buildRawZip(payload);
    const zip = await unzip(result.blob);
    const manifest = JSON.parse(
      await zip.file("_export-manifest.json")!.async("string"),
    ) as RawManifest;
    expect(manifest.method_ids).toEqual([5, 3, 9, 1]);
  });
});

// ── HTML format ─────────────────────────────────────────────────────────────

describe("buildHtmlBundle — happy path", () => {
  it("returns a Blob with index html + manifest", async () => {
    const payload = buildTestPayload();
    const result = await buildHtmlBundle(payload);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.mimeType).toBe("application/zip");
    expect(result.filename).toBe("cell-culture-growth.zip");

    const zip = await unzip(result.blob);
    expect(zip.file("cell-culture-growth.html")).not.toBeNull();
    expect(zip.file("_export-manifest.json")).not.toBeNull();

    const html = await zip.file("cell-culture-growth.html")!.async("string");
    expect(html).toContain("Cell culture growth"); // task title
    expect(html).toContain("Lab Notes"); // section heading
    expect(html).toContain("Results"); // section heading
    expect(html).toContain("Western blot"); // method name
    // Method body content shows up — the H1 "Western blot" inside the
    // body gets demoted by demoteHeadings + then rendered.
    expect(html).toContain("Transfer protein");

    // Image was inlined as a base64 data URI under the notes section
    // (notes/Images/plate-1.png → <img src="data:image/png;base64,...">).
    expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  });

  it("conforms to HtmlManifest shape", async () => {
    const payload = buildTestPayload();
    const result = await buildHtmlBundle(payload);
    const zip = await unzip(result.blob);
    const manifest = JSON.parse(
      await zip.file("_export-manifest.json")!.async("string"),
    ) as HtmlManifest;
    expect(manifest.format).toBe("html");
    expect(manifest.version).toBe(1);
    expect(manifest.task_id).toBe(42);
    expect(manifest.exported_at).toBe(FIXED_EXPORTED_AT);
    expect(manifest.source_instance).toBe("alex@2026-05-14");
  });

  it("demotes method H1 to H2 so the section outline is correct", async () => {
    // The method body starts with "# Western blot". The wrapper section
    // emits an H3 "Western blot" with the method name; if `demoteHeadings`
    // didn't run on the body, the body's H1 would also render as `<h1>`
    // in the document, which is wrong (the document title is the only H1).
    const payload = buildTestPayload();
    const result = await buildHtmlBundle(payload);
    const zip = await unzip(result.blob);
    const html = await zip.file("cell-culture-growth.html")!.async("string");

    // The task title is the only <h1> in the body.
    const h1Count = (html.match(/<h1[> ]/g) ?? []).length;
    expect(h1Count).toBe(1);

    // The body's H1 should appear as <h2> after demotion. (The method
    // wrapper section uses <h3>, so the demoted body-H1 → <h2> is
    // unambiguously the body-heading, not the wrapper.)
    expect(html).toMatch(/<h2[^>]*>Western blot/);
  });

  it("stamps every entry's mtime with payload.meta.exportedAt", async () => {
    const payload = buildTestPayload();
    const result = await buildHtmlBundle(payload);
    const zip = await unzip(result.blob);
    const expected = new Date(FIXED_EXPORTED_AT);
    for (const entry of Object.values(zip.files)) {
      expect(entry.date.getTime()).toBe(expected.getTime());
    }
  });
});

// ── PDF format ──────────────────────────────────────────────────────────────

describe("buildPdf — happy path", () => {
  beforeEach(async () => {
    // pdf.ts calls Font.register({ family: "Inter", fonts: [{ src:
    // "/fonts/Inter-Regular.ttf" }, ...] }) with browser-relative paths
    // intended for Next.js's static-asset server (`frontend/public/`). In
    // Node, those resolve against the filesystem root and ENOENT. Spy on
    // Font.register and rewrite the absolute-from-public paths to point at
    // the real font files on disk so the renderer can load them. We can't
    // mock Font.register to a no-op because pdf.ts's StyleSheet declares
    // `fontFamily: "Inter"` and the layout engine throws if the family
    // isn't registered.
    const ReactPDF: typeof import("@react-pdf/renderer") = await import(
      "@react-pdf/renderer"
    );
    const fontsDir = path.resolve(__dirname, "../../../../public/fonts");
    // Do NOT call Font.clear() — that wipes the built-in Helvetica family
    // that the FontStore registers at construction, which react-pdf falls
    // back to for any Text node lacking a fontFamily. Just register Inter
    // with absolute paths; this is idempotent so it's safe to call before
    // every test even though pdf.ts memoizes the FIRST call via its own
    // module-level `fontsRegistered` flag.
    ReactPDF.Font.register({
      family: "Inter",
      fonts: [
        { src: path.join(fontsDir, "Inter-Regular.ttf") },
        {
          src: path.join(fontsDir, "Inter-Bold.ttf"),
          fontWeight: "bold",
        },
      ],
    });
    // Spy on Font.register to swallow pdf.ts's own browser-relative call.
    // That call would otherwise ENOENT in Node when react-pdf tries to
    // open `/fonts/Inter-Regular.ttf` as a filesystem path. pdf.ts's
    // module-level `fontsRegistered` flag only no-ops after a successful
    // call, so a failed attempt would loop on every subsequent test.
    vi.spyOn(ReactPDF.Font, "register").mockImplementation(() => {
      // no-op: Inter is already registered above with valid paths.
    });
  });

  it("returns a real PDF Blob with the expected magic bytes", async () => {
    const payload = buildTestPayload();
    const result = await buildPdf(payload);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.mimeType).toBe("application/pdf");
    expect(result.filename).toBe("cell-culture-growth.pdf");

    const ab = await result.blob.arrayBuffer();
    const head = String.fromCharCode(...new Uint8Array(ab).subarray(0, 5));
    expect(head).toBe("%PDF-");
  });

  it("embeds a PdfManifest in the Document `keywords` field", async () => {
    const payload = buildTestPayload();
    const result = await buildPdf(payload);
    const ab = await result.blob.arrayBuffer();
    // The `keywords` metadata is written as a PDF string in the Info
    // dictionary. JSON-stringified manifest is ASCII, so a simple
    // text-search across the raw bytes finds it (pdfkit ASCII-escapes
    // non-ASCII chars but ASCII strings pass through). This is what
    // EXPORT_REVAMP_PLAN.md §4 means by "embed the manifest as keywords".
    const text = Buffer.from(ab).toString("latin1");

    // Reconstruct what the manifest should JSON.stringify to.
    const expected: PdfManifest = {
      format: "pdf",
      version: 1,
      exported_at: FIXED_EXPORTED_AT,
      source_owner: "alex",
      source_instance: "alex@2026-05-14",
      task_id: 42,
    };
    // pdfkit escapes parens/backslashes in strings; the unescaped form
    // suffices for the format / version / task_id / source_instance
    // checks since they have no special chars.
    expect(text).toContain('"format":"pdf"');
    expect(text).toContain('"version":1');
    expect(text).toContain('"task_id":42');
    expect(text).toContain(`"source_instance":"${expected.source_instance}"`);
    expect(text).toContain(`"exported_at":"${expected.exported_at}"`);
  });

  it("includes Contents (TOC) page and section bookmarks", async () => {
    const payload = buildTestPayload();
    const result = await buildPdf(payload);
    const ab = await result.blob.arrayBuffer();
    const text = Buffer.from(ab).toString("latin1");

    // The TOC page has a static "Contents" heading and a link per section.
    // PDF text streams render strings either literally (single-byte
    // encoding) or through hex strings depending on the font. With
    // Font.register mocked out, react-pdf falls back to Helvetica which
    // emits literal strings — `Contents` shows up as plaintext.
    expect(text).toContain("Contents");
    // The section bookmarks land in the PDF outline tree as plaintext too.
    expect(text).toContain("Lab Notes");
    expect(text).toContain("Results");
    // The method gets a "Method: <name>" entry in the outline.
    expect(text).toContain("Method: Western blot");
  });

  it("sets Document title / author / subject from payload", async () => {
    const payload = buildTestPayload();
    const result = await buildPdf(payload);
    const ab = await result.blob.arrayBuffer();
    const text = Buffer.from(ab).toString("latin1");
    // pdfkit serializes Info dictionary fields like:
    //   /Title (Cell culture growth)
    //   /Author (alex)
    //   /Subject (Yeast metabolism)
    expect(text).toContain("Cell culture growth"); // title (also in page body)
    expect(text).toContain("Yeast metabolism"); // project name → subject
  });
});

// ── Streaming output (lib/export/stream-output.ts) ──────────────────────────

describe("packZipStreaming — multi-experiment output via generateInternalStream", () => {
  it("produces a valid zip Blob whose entries match what generateAsync would emit", async () => {
    // Same archive built two ways:
    //   1. The OLD path: zip.generateAsync({ type: "blob" }).
    //   2. The NEW path: zip.generateInternalStream() → Blob[] → new Blob.
    // The unzipped contents must be byte-identical for both — JSZip's
    // streaming output is supposed to be just a different way of
    // serializing the same zip. This guards against accidentally losing
    // entries or breaking the streamed path's wiring.
    const JSZip = (await import("jszip")).default;
    const { packZipStreaming } = await import("../stream-output");

    const a = new JSZip();
    a.file("hello.txt", "world");
    a.file("nested/data.json", JSON.stringify({ k: 1 }));
    const bufferedBlob = await a.generateAsync({ type: "blob" });

    const b = new JSZip();
    b.file("hello.txt", "world");
    b.file("nested/data.json", JSON.stringify({ k: 1 }));
    const streamedBlob = await packZipStreaming(b);

    expect(streamedBlob).toBeInstanceOf(Blob);
    expect(streamedBlob.type).toBe("application/zip");

    // Unzip both and compare logical entry contents (compressed bytes
    // may differ run-to-run due to internal buffering choices, but the
    // logical file contents are stable).
    const bufferedZip = await JSZip.loadAsync(await bufferedBlob.arrayBuffer());
    const streamedZip = await JSZip.loadAsync(await streamedBlob.arrayBuffer());
    // Compare file entries only (JSZip surfaces directory entries via
    // `files` too — those have no `.file()` content and trip the test
    // for nested paths like "nested/data.json").
    const bufferedNames = Object.keys(bufferedZip.files)
      .filter((n) => !bufferedZip.files[n].dir)
      .sort();
    const streamedNames = Object.keys(streamedZip.files)
      .filter((n) => !streamedZip.files[n].dir)
      .sort();
    expect(streamedNames).toEqual(bufferedNames);
    for (const name of bufferedNames) {
      const ba = await bufferedZip.file(name)!.async("string");
      const sa = await streamedZip.file(name)!.async("string");
      expect(sa).toBe(ba);
    }
  });

  it("reports progress percentages monotonically through the stream", async () => {
    const JSZip = (await import("jszip")).default;
    const { packZipStreaming } = await import("../stream-output");
    const zip = new JSZip();
    // Add enough entries that JSZip emits multiple data events.
    for (let i = 0; i < 20; i++) {
      zip.file(`entry-${i}.txt`, "x".repeat(2048));
    }
    const percents: number[] = [];
    await packZipStreaming(zip, (p) => percents.push(p));
    expect(percents.length).toBeGreaterThan(0);
    // Final percent should reach (or be very close to) 100 — JSZip emits
    // it as the last event before "end".
    expect(percents[percents.length - 1]).toBeCloseTo(100, 0);
    // Sequence is non-decreasing.
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
  });
});

describe("isLargeExport — soft-warning threshold", () => {
  it("flags at 50+ tasks regardless of size", async () => {
    const { isLargeExport } = await import("../stream-output");
    expect(
      isLargeExport(50, {
        attachmentCount: 0,
        totalBytes: 0,
        perTaskBytes: [],
      }),
    ).toBe(true);
    expect(
      isLargeExport(49, {
        attachmentCount: 0,
        totalBytes: 0,
        perTaskBytes: [],
      }),
    ).toBe(false);
  });

  it("flags at >500 MB total bytes regardless of task count", async () => {
    const { isLargeExport } = await import("../stream-output");
    const mb = 1024 * 1024;
    expect(
      isLargeExport(2, {
        attachmentCount: 100,
        totalBytes: 600 * mb,
        perTaskBytes: [],
      }),
    ).toBe(true);
    expect(
      isLargeExport(2, {
        attachmentCount: 100,
        totalBytes: 100 * mb,
        perTaskBytes: [],
      }),
    ).toBe(false);
  });
});

describe("formatBytes — UI helper", () => {
  it("formats across B / KB / MB / GB ranges", async () => {
    const { formatBytes } = await import("../stream-output");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
  });
});
