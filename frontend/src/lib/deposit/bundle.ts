// frontend/src/lib/deposit/bundle.ts
//
// Repository-deposit PHASE 1 (guided-deposit bot, 2026-05-28). Assembles the
// downloadable deposit bundle: the curated experiment (built by the EXISTING
// export pipeline) wrapped in a ZIP alongside the prefilled `datacite.json`
// metadata file.
//
// We REUSE the export pipeline (`buildRawZip` / `buildHtmlBundle` / `buildPdf`)
// and never reimplement bundling. The only deposit-specific work is wrapping
// the chosen format's result together with the metadata file so the user
// downloads ONE archive to drag into the repository.
//
// The metadata file is part of the DOWNLOADABLE bundle. It is NEVER written
// into the user's on-disk data folder (no new sidecar, no _deposits.json).
//
// No em-dashes, no emojis.

import JSZip from "jszip";
import { slugify } from "@/lib/export/slug";
import { buildRawZip } from "@/lib/export/raw";
import { buildHtmlBundle } from "@/lib/export/html";
import { buildPdf } from "@/lib/export/pdf";
import {
  buildCombinedPdf,
  type CombinedPdfItem,
  type CombinedPdfDeps,
} from "@/lib/export/combined-pdf";
import type {
  ExperimentExportPayload,
  ExportFormat,
  ExportResult,
} from "@/lib/export/types";
import type { Note } from "@/lib/types";
import {
  serializeDepositMetadata,
  type DepositMetadata,
} from "./datacite";

/** The metadata filename that lands at the top of the deposit bundle. */
export const DEPOSIT_METADATA_FILENAME = "datacite.json";

async function buildFormat(
  payload: ExperimentExportPayload,
  format: ExportFormat,
  baseFilename: string,
): Promise<ExportResult> {
  switch (format) {
    case "raw":
      return buildRawZip(payload, baseFilename);
    case "html":
      return buildHtmlBundle(payload, baseFilename);
    case "pdf":
      return buildPdf(payload, baseFilename);
  }
}

export interface DepositBundleResult extends ExportResult {
  // The serialized metadata JSON, also exposed separately so the handoff
  // panel can render / copy it without re-reading the zip.
  metadataJson: string;
}

/**
 * Build the deposit bundle for an already-curated payload. The chosen export
 * format's output (a single file for pdf, a zip for raw/html) is nested
 * inside a wrapper ZIP next to `datacite.json`, so the user gets one archive
 * that carries both the curated data and the prefilled metadata.
 *
 * Naming: `{slug}-deposit.zip`. Inside:
 *   - datacite.json
 *   - {slug}.pdf | {slug}.html (unwrapped) | {slug}-raw.zip
 *
 * For the HTML format we UNWRAP the inner zip into a `{slug}/` subfolder so
 * the deposit archive is directly browsable (mirrors how the multi-export
 * wrapper handles HTML).
 */
export async function buildDepositBundle(
  payload: ExperimentExportPayload,
  format: ExportFormat,
  metadata: DepositMetadata,
): Promise<DepositBundleResult> {
  const slug = slugify(payload.task.name);
  const inner = await buildFormat(payload, format, slug);
  const metadataJson = serializeDepositMetadata(metadata);

  const zip = new JSZip();
  zip.file(DEPOSIT_METADATA_FILENAME, metadataJson);

  if (format === "html") {
    // Unwrap the inner html zip into a browsable subfolder.
    const innerBytes = await inner.blob.arrayBuffer();
    const innerZip = await JSZip.loadAsync(innerBytes);
    const folder = zip.folder(slug);
    if (!folder) {
      throw new Error(`Could not create subfolder ${slug} in deposit zip`);
    }
    await Promise.all(
      Object.values(innerZip.files).map(async (entry) => {
        if (entry.dir) return;
        const data = await entry.async("uint8array");
        folder.file(entry.name, data);
      }),
    );
  } else {
    // pdf + raw: drop the format result in as a single top-level entry.
    zip.file(inner.filename, inner.blob);
  }

  // Deterministic mtimes (mirror the export pipeline's convention) so
  // re-building the same deposit is byte-stable at the zip-frame level.
  const stamp = new Date(payload.meta.exportedAt);
  for (const entry of Object.values(zip.files)) {
    entry.date = stamp;
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return {
    blob,
    filename: `${slug}-deposit.zip`,
    mimeType: "application/zip",
    metadataJson,
  };
}

// ---------------------------------------------------------------------------
// Project-level (multi-item) deposit bundle
// ---------------------------------------------------------------------------
//
// A project maps to ONE dataset / one DOI. The user multi-selects experiments
// and notes; this assembles ONE archive containing:
//
//   datacite.json                 the prefilled DataCite metadata
//   combined.pdf                  the single navigable mega-PDF across ALL
//                                 selected items (via buildCombinedPdf)
//   experiments/{slug}/...        each selected experiment exported INDIVIDUALLY
//                                 in the chosen presentation format (html
//                                 unwrapped to a browsable subfolder; pdf as a
//                                 single file)
//   notes/{slug}.md               each selected note rendered to markdown
//   raw/{slug}-raw.zip            the raw, re-importable export of each
//                                 experiment (for reusability)
//
// Everything is REUSED: experiment formats come from the existing export
// pipeline (buildHtmlBundle / buildPdf / buildRawZip), the mega-PDF from
// buildCombinedPdf, the metadata from datacite.ts. The only deposit-specific
// work is the folder layout. NOTHING is written to the user's data folder; the
// archive is downloadable only.

/** One curated experiment, already built into an export payload. */
export interface ProjectDepositExperiment {
  id: number;
  payload: ExperimentExportPayload;
}

/** One curated note, already resolved to its Note record. */
export interface ProjectDepositNote {
  id: number;
  note: Note;
}

export interface ProjectDepositBundleInput {
  // The dataset title (the project name); used to name the archive + the
  // combined PDF cover.
  title: string;
  // Selected experiments, each with its already-built (and curated) payload.
  experiments: ProjectDepositExperiment[];
  // Selected notes, each with its resolved Note record.
  notes: ProjectDepositNote[];
  // The presentation format for each INDIVIDUAL experiment export. Raw bundles
  // are ALWAYS included separately under raw/ regardless of this choice, so a
  // "raw" presentation does not duplicate; see the assembler below.
  format: ExportFormat;
  // The prefilled DataCite metadata for the whole dataset.
  metadata: DepositMetadata;
  // The current user, threaded into the combined-PDF cover owner line.
  currentUser: string | null;
}

/**
 * Render a single note to a self-contained markdown document: an H1 title, the
 * optional description, then each entry (sorted by date) as an H2 with its
 * date and markdown body. Notes are already markdown at heart, so this is the
 * most faithful, reusable individual-file form (the combined PDF renders the
 * same content visually for the navigable companion document). Pure; no I/O.
 */
export function noteToMarkdown(note: Note): string {
  const lines: string[] = [];
  const title = (note.title ?? "").trim() || `Note ${note.id}`;
  lines.push(`# ${title}`, "");

  const description = (note.description ?? "").trim();
  if (description) {
    lines.push(description, "");
  }

  const entries = [...(note.entries ?? [])].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  for (const entry of entries) {
    const entryTitle = (entry.title ?? "").trim() || "(untitled entry)";
    lines.push(`## ${entryTitle}`);
    if (entry.date) lines.push("", `*${entry.date}*`);
    const content = (entry.content ?? "").trim();
    if (content) lines.push("", content);
    lines.push("");
  }

  if (!description && entries.length === 0) {
    lines.push("_This note has no content._", "");
  }

  return lines.join("\n");
}

/**
 * Unwrap an inner export-result zip into a JSZip folder (used for the html
 * presentation + the raw/ subfolder). Mirrors the orchestrate / single-deposit
 * unwrap convention so a deposit archive is directly browsable.
 */
async function unwrapInto(
  folder: JSZip,
  innerBlob: Blob,
): Promise<void> {
  const innerBytes = await innerBlob.arrayBuffer();
  const innerZip = await JSZip.loadAsync(innerBytes);
  await Promise.all(
    Object.values(innerZip.files).map(async (entry) => {
      if (entry.dir) return;
      const data = await entry.async("uint8array");
      folder.file(entry.name, data);
    }),
  );
}

/**
 * Assemble the project-level deposit bundle from the selected experiments and
 * notes. Returns a single ZIP `DepositBundleResult` plus the metadata JSON.
 *
 * Layout (see the module header): datacite.json + combined.pdf at the top,
 * then experiments/, notes/, and raw/ subfolders. Experiment slugs are
 * de-duplicated by appending the task id when two names collide so two
 * experiments never overwrite each other; note slugs do the same with the
 * note id.
 *
 * `combinedPdfDeps` is injectable so unit tests can drive the combined-PDF
 * call without the real local-api / react-pdf stack; production omits it (the
 * builder wires the real deps from the selected items below).
 */
export async function buildProjectDepositBundle(
  input: ProjectDepositBundleInput,
  combinedPdfDeps?: CombinedPdfDeps,
): Promise<DepositBundleResult> {
  const projectSlug = slugify(input.title);
  const metadataJson = serializeDepositMetadata(input.metadata);

  const zip = new JSZip();
  zip.file(DEPOSIT_METADATA_FILENAME, metadataJson);

  // De-dupe experiment slugs by appending the id on collision so two
  // same-named experiments land in distinct subfolders.
  const expSlugCounts = new Map<string, number>();
  for (const exp of input.experiments) {
    const base = slugify(exp.payload.task.name);
    expSlugCounts.set(base, (expSlugCounts.get(base) ?? 0) + 1);
  }
  const expSlug = (exp: ProjectDepositExperiment): string => {
    const base = slugify(exp.payload.task.name);
    return (expSlugCounts.get(base) ?? 0) > 1 ? `${base}-${exp.id}` : base;
  };

  // 1. Each experiment, exported INDIVIDUALLY in the chosen presentation
  //    format under experiments/{slug}/ (html unwrapped) or as a single file.
  const expFolder = input.experiments.length > 0 ? zip.folder("experiments") : null;
  // 2. Each experiment's RAW re-importable bundle under raw/ for reusability.
  //    Skipped when the presentation format is already "raw" (the experiments/
  //    folder then already carries the raw bundle, so a separate raw/ copy
  //    would be byte-identical duplication).
  const rawFolder =
    input.experiments.length > 0 && input.format !== "raw"
      ? zip.folder("raw")
      : null;

  for (const exp of input.experiments) {
    const slug = expSlug(exp);

    // Presentation format. Inner ExportResults are read into ArrayBuffers
    // before being added to the outer zip: JSZip's blob ingestion is not
    // reliable across every runtime (notably non-browser test environments),
    // whereas ArrayBuffer/Uint8Array always is.
    if (input.format === "html") {
      const html = await buildHtmlBundle(exp.payload, slug);
      const sub = expFolder?.folder(slug);
      if (!sub) throw new Error(`Could not create experiments/${slug}`);
      await unwrapInto(sub, html.blob);
    } else if (input.format === "pdf") {
      const pdfResult = await buildPdf(exp.payload, slug);
      expFolder?.file(pdfResult.filename, await pdfResult.blob.arrayBuffer());
    } else {
      // raw presentation: nest the raw bundle as a single entry.
      const raw = await buildRawZip(exp.payload, slug);
      expFolder?.file(raw.filename, await raw.blob.arrayBuffer());
    }

    // Raw reusability copy (when the presentation format is not already raw).
    if (rawFolder) {
      const raw = await buildRawZip(exp.payload, slug);
      rawFolder.file(raw.filename, await raw.blob.arrayBuffer());
    }
  }

  // 3. Each note as an individual markdown file under notes/.
  const noteSlugCounts = new Map<string, number>();
  for (const n of input.notes) {
    const base = slugify(n.note.title);
    noteSlugCounts.set(base, (noteSlugCounts.get(base) ?? 0) + 1);
  }
  const noteFolder = input.notes.length > 0 ? zip.folder("notes") : null;
  for (const n of input.notes) {
    const base = slugify(n.note.title);
    const slug = (noteSlugCounts.get(base) ?? 0) > 1 ? `${base}-${n.id}` : base;
    noteFolder?.file(`${slug}.md`, noteToMarkdown(n.note));
  }

  // 4. The combined mega-PDF across ALL selected items (the single navigable
  //    companion document). Built via the existing combined-PDF pipeline.
  //
  //    We resolve the combined-PDF items from the payloads / notes ALREADY in
  //    hand rather than letting buildCombinedPdf re-read disk: that way the
  //    mega-PDF reflects the SAME curated experiment content that lands in the
  //    individual files (curation drops sections / attachments), and we avoid a
  //    redundant second read of every item. Tests may inject their own deps.
  const combinedItems: CombinedPdfItem[] = [
    ...input.experiments.map(
      (e): CombinedPdfItem => ({ kind: "experiment", id: e.id }),
    ),
    ...input.notes.map((n): CombinedPdfItem => ({ kind: "note", id: n.id })),
  ];
  if (combinedItems.length > 0) {
    const expById = new Map(input.experiments.map((e) => [e.id, e.payload]));
    const noteById = new Map(input.notes.map((n) => [n.id, n.note]));
    const deps: CombinedPdfDeps = combinedPdfDeps ?? {
      currentUser: input.currentUser,
      resolveExperiment: async (id) => expById.get(id) ?? null,
      resolveNote: async (id) => noteById.get(id) ?? null,
    };
    const combined = await buildCombinedPdf(
      { title: input.title, items: combinedItems },
      deps,
    );
    zip.file("combined.pdf", await combined.arrayBuffer());
  }

  // Deterministic mtimes (mirror the export pipeline's convention).
  const stamp = new Date(
    input.experiments[0]?.payload.meta.exportedAt ?? new Date().toISOString(),
  );
  for (const entry of Object.values(zip.files)) {
    entry.date = stamp;
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return {
    blob,
    filename: `${projectSlug}-deposit.zip`,
    mimeType: "application/zip",
    metadataJson,
  };
}

/**
 * Trigger a browser download for a blob with a chosen filename. Mirrors the
 * export pipeline's `downloadResult` revoke-after-click pattern so deposit
 * downloads behave identically (Safari-safe deferred revoke).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
