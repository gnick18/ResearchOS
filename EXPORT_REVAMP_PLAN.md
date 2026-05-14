# Export Revamp — Architecture & Sub-bot Briefing

**Manager bot:** elegant-curie-92d6da
**Pin commit:** `1b28b87c` (2026-05-13, wiki PNG capture + 3-orphan wiring merged)
**Status:** Plan locked. Sub-bots A–E spawning in parallel.

This doc is the single source of truth for the in-flight export rewrite. **Read it end-to-end before touching any export file.** The architecture, type contract, filename conventions, and section ordering below are locked. Don't relitigate them.

Delete this file after the master bot merges the rewrite.

---

## 1. What we're replacing

`frontend/src/lib/export-utils.ts` (622 lines) currently exposes:

- `exportSingleExperiment(data, options)` — called from `TaskExportButton` in `TaskDetailPopup.tsx:3087`.
- `exportMultipleExperiments(experiments, options)` — called from `/experiments/page.tsx` bulk-export flow (combines N experiments into ONE document with combined TOC — wrong shape per new spec).
- A markdown generator + zip-with-method-PDFs path. Salvageable concepts (stamp stripping, header detection); throwaway implementation.
- A PDF generator built on `html2canvas` + `jsPDF` — **deletes entire pipeline**. Output is rasterized images of a hidden DOM node; text is not selectable, no real nav, no bookmarks. This is the crud Grant wants gone.

**Why it's broken:**
1. PDF is rasterized, text-unselectable, no bookmarks. 
2. Multi-export combines into one doc instead of producing N self-contained per-experiment outputs.
3. No HTML format.
4. No "Raw ResearchOS" format (cross-instance sharing bundle).
5. Per-tab attachment isolation (Lab Notes vs Results) is not represented — attachments come from legacy `NotesPDFs/`, `ResultsPDFs/` (deprecated paths).
6. Multi-method tasks: hardcoded to `method_ids[0]`, ignores the rest. `method_attachments` per-method `variation_notes` and PCR data not exported.
7. File attachments (non-PDF) not handled at all.

## 2. Salvageable from existing code

Sub-bot A's audit should consider keeping these primitives (move to `lib/export/utils.ts` or fold into `extract.ts`):

- `parseContent` from `lib/stamp-utils.ts` (already exists, keep using).
- `hasUserContent(content: string): boolean` (export-utils.ts:54) — heuristic to detect "only a default header" no-content markdown. Useful.
- `extractUserContent(content: string): string` (export-utils.ts:74) — strips stamp metadata. Useful.
- The `referencedRelativeNames` helper from `lib/attachments/gc.ts` — already canonical, reuse for resolving markdown image/file refs to disk filenames.

**Throwaway:**

- All `loadPdfLibraries` / `html2canvas` / `jspdf` imports.
- `generatePdfFromHtml`, `createPdfRenderElement`, `cleanupPdfRenderElement`, `createPdfWithLinks`, `mergePdfs` (the html2canvas-rasterized pipeline).
- `generateExperimentMarkdown`, `generateCombinedMarkdown` (multi-doc combining is the wrong shape).
- `downloadMarkdown`, `downloadMarkdownWithAttachments`, `downloadPdf` (replaced by a single `downloadBlob(blob, filename)` helper or inlined into `orchestrate.ts`).
- `PdfAttachmentData` shape (replaced by `ExperimentAttachment`, see §4).
- `ExperimentExportData` shape (replaced by `ExperimentExportPayload`, see §4).
- `ExportOptions.includeLabNotes/Method/Results/Attachments` flags — locked spec says always include all sections (skip empty), no per-section toggles.
- `NotesPDFs/` and `ResultsPDFs/` listing — those folders are deprecated; per-tab isolation uses `notes/Files/` and `results/Files/`.

**Dependencies to add to `frontend/package.json`:**

- `@react-pdf/renderer` (Sub-bot D will add and pin a version — latest stable; pdf-lib stays for raw byte ops if anything needs it).
- `marked` (lightweight markdown→AST + markdown→HTML; ~30KB; used by both Sub-bot C and Sub-bot D so they share an AST source).

**Dependencies to remove (after Sub-bot A integrates the audit):**

- `html2canvas` — unused after the rasterized path goes away.
- `jspdf` — unused after the rasterized path goes away.
- `pdf-lib` — used to be needed for merging PDF method attachments. The new design doesn't merge PDFs into the export. **Keep if Sub-bot D needs it for low-level outline manipulation**; otherwise drop.

(Sub-bot A: don't delete the deps in your branch — just delete the imports. The master bot can run `npm prune`-style cleanup at integration time.)

---

## 3. Output contract — locked

### Per-format output

| Format | Single-experiment download | Multi-experiment download |
| --- | --- | --- |
| **PDF** | `{experiment-name}.pdf` — one bare PDF | `experiments-{YYYY-MM-DD}.zip` containing `{name1}.pdf`, `{name2}.pdf`, … (flat, no nested folders) |
| **HTML** | `{experiment-name}.zip` containing `{name}.html` + `attachments/Notes/...` + `attachments/Results/...` | `experiments-{YYYY-MM-DD}.zip` containing per-experiment subfolders, each with `{name}.html` + `attachments/...` |
| **Raw** | `{experiment-name}-raw.zip` (ResearchOS format, see §3.3) | `experiments-{YYYY-MM-DD}.zip` containing per-experiment `{name}-raw.zip` files (zip-of-zips — keep raw bundle integrity) |

**HTML is never a single bare file** because clickable inline file links need sibling files on disk. Images ARE base64-inlined in the HTML so the HTML alone renders correctly even without the attachments folder.

**Filename sanitation:** `slugify(experiment.name)` — lowercase, alphanumeric + dashes only, max 80 chars. Collision handling: if two experiments slugify to the same name in multi-export, append `-{taskKey}` (e.g. `cell-culture-self-3`).

### Section order — every format

Within a single experiment, sections appear in this order, top-to-bottom:

1. **Title page** (see §3.1)
2. **Navigation / table of contents** (see §3.2)
3. **Lab Notes** — rendered `notes.md` content, inline images + inline file links.
4. **Results** — rendered `results.md` content, same treatment.
5. **Methods** — one subsection per attached method (`method_ids[]` in order):
   - Method name + method body markdown (if `method_type === "markdown"` and `source_path` resolves) OR file link (if PDF method) OR PCR table (if `method_type === "pcr"` — render protocol summary).
   - Per-task variation notes from the matching `TaskMethodAttachment.variation_notes`.
6. **Sub-tasks** (only if `task.sub_tasks` non-empty): bulleted list with completion checkbox state.
7. **Deviation log** (only if `task.deviation_log` non-empty + non-whitespace): rendered as a markdown block.
8. **Files appendix** (PDF only) — see §3.4.

Sections 3-7 are skipped when empty (use `hasUserContent` for the markdown sections). Title page + nav are always present.

### 3.1 Title page

Layout (all formats — PDF/HTML use it directly, Raw includes the same metadata as `_export-manifest.json`):

```
{experiment.name}                          ← H1, large

Project:          {projectName}
Owner:            {owner}
Date range:       {start_date} → {end_date}
Duration:         {duration_days} day(s)
Status:           {is_complete ? "Complete" : "In Progress"}
Methods:          {names joined by ", "} (or "—" if none)

Generated:        {ISO date} by ResearchOS
```

PDF: Title page is its own page (`<Page break>` boundary after).
HTML: Title page is a `<header>` block at the top, scrollable.

### 3.2 Navigation

- **HTML:** A `<nav>` block of anchor links to every populated section. Sticky-positioned in the sidebar on wide screens, inline at the top on narrow screens. Heading: "Contents".
- **PDF:** A printed TOC page (after title page) listing every populated section with the page number. Use `@react-pdf/renderer`'s `<Link src="#section-id">` for clickable entries. PLUS: real PDF bookmarks via the `bookmark={{ title, fit: 'XYZ' }}` prop on each section's top-level `<View>`. Bookmarks appear in the PDF reader's outline pane.

### 3.3 Raw ResearchOS format (`{name}-raw.zip` layout)

```
{name}-raw.zip/
├── _export-manifest.json    ← see schema below
├── task.json                ← the full Task record (post-normalize, ready for re-import)
├── notes.md                 ← raw notes.md body (NOT stamp-stripped)
├── results.md               ← raw results.md body (may be missing if empty)
├── notes/
│   ├── Files/{filename}     ← all files referenced by notes.md
│   └── Images/{filename}    ← all images referenced by notes.md
├── results/
│   ├── Files/{filename}
│   └── Images/{filename}
├── methods/                 ← bundled methods (so the receiver doesn't need separate share)
│   └── method-{id}.json     ← the Method record
│   └── method-{id}-body.md  ← method body (if markdown) or original PDF/file
└── project.json             ← the Project record (so receiver knows the project context)
```

`_export-manifest.json` schema:

```json
{
  "format": "researchos-experiment",
  "version": 1,
  "exported_at": "2026-05-13T15:30:00Z",
  "exported_by": "ResearchOS",
  "source_owner": "alex",
  "task_id": 12,
  "task_key": "self:12",
  "project_id": 4,
  "method_ids": [3, 7]
}
```

**Important:** This format is for *cross-instance sharing*. The receiving side is **out of scope** for this rewrite — Sub-bot B should NOT build the import side. The bundle just needs to be structurally complete so a future importer can resolve it.

### 3.4 Files appendix (PDF only)

The last section of every PDF, regardless of file count. Each entry:

- File name (the `[label](Files/foo.pdf)` label text from the markdown).
- Origin tag: `from Lab Notes` or `from Results`.
- Method-attached files (PDF methods) tagged `from Methods`.

Each entry is just text (PDF inline links to external files don't work outside the zip — that's the whole reason for the appendix). The point is to make it obvious WHICH files the user needs and where they came from. The Raw or HTML export is the path for someone who actually wants the files.

Entry format example:

```
Files attached
──────────────

From Lab Notes:
  • protocol-v3.pdf
  • gel-image-raw.tiff

From Results:
  • western-blot.png        (this is an image referenced inline; included for completeness)
  • flow-cytometry-data.fcs

From Methods:
  • western-blot-protocol.pdf
```

---

## 4. Type contract — LOCKED, do not modify without manager sign-off

All sub-bots import from `frontend/src/lib/export/types.ts` (Sub-bot A creates this file).

```typescript
// frontend/src/lib/export/types.ts

import type { Task, Method, Project, TaskMethodAttachment } from "@/lib/types";

export type ExportFormat = "pdf" | "html" | "raw";

export type AttachmentOrigin = "notes" | "results" | "methods";

export interface ExperimentAttachment {
  // The basename, e.g. "protocol-v3.pdf". This is what markdown refs resolve to.
  filename: string;
  // The mime type (best-effort from extension). Used by HTML inlining + appendix.
  mimeType: string;
  // Raw bytes. For images this gets base64'd inline by the HTML generator.
  bytes: ArrayBuffer;
  // Where it came from. Drives the Files-appendix label + the in-zip path.
  origin: AttachmentOrigin;
  // The disk-relative ref as it appears in markdown (e.g. "Images/foo.png").
  // Used to rewrite markdown links to the in-zip path.
  diskRef: string;
}

export interface MethodPayload {
  method: Method;
  // For markdown methods: the body text. For PDF methods: null (the bytes
  // live in `attachments` with origin: "methods"). For PCR methods: null
  // (rendered from the Method record itself).
  bodyMarkdown: string | null;
  // The TaskMethodAttachment for THIS task — variation_notes, pcr_gradient,
  // pcr_ingredients. May be null if the task has no per-method overrides.
  attachment: TaskMethodAttachment | null;
}

export interface ExperimentExportPayload {
  // The full Task record (already normalized via the local-api read boundary).
  task: Task;
  // The Project record (for the title page + raw bundle).
  project: Project;
  // The task's resolved results-base path on disk (e.g. "users/alex/results/task-12").
  // Useful for diagnostics; not strictly required by generators.
  resolvedBase: string;

  // Section content
  notesMarkdown: string | null;     // raw notes.md (stamp metadata included)
  resultsMarkdown: string | null;   // raw results.md
  methods: MethodPayload[];          // one entry per task.method_ids, in order

  // Attachments, already deduplicated by origin+filename
  attachments: ExperimentAttachment[];

  // Title-page metadata pre-computed for convenience
  meta: {
    ownerLabel: string;     // for shared tasks this is `task.owner`
    durationDays: number;
    statusLabel: string;    // "Complete" or "In Progress"
    methodNames: string[];  // ordered names
    exportedAt: string;     // ISO timestamp
  };
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}
```

**Notes on the contract:**

- `notesMarkdown` and `resultsMarkdown` are RAW (with stamp metadata). Format generators call `extractUserContent` (from the salvaged utils) to strip stamps before rendering. The raw format keeps the stamps; HTML/PDF strip them.
- `attachments` is the union across origins. Generators filter by `origin` as needed.
- `methods[].bodyMarkdown` is the inline markdown body for `method_type === "markdown"` methods. PDF methods have their bytes in `attachments` with `origin: "methods"`; the generator renders a "PDF Method: X.pdf" link/heading instead of inlined content.
- `attachment.variation_notes` is per-task overrides; render under each method.

---

## 5. Module layout

```
frontend/src/lib/export/
├── types.ts              ← the type contract above (Sub-bot A)
├── slug.ts               ← slugify + filename collision handling (Sub-bot A)
├── markdown.ts           ← extractUserContent, hasUserContent, ref-rewriting (Sub-bot A)
├── extract.ts            ← buildExperimentPayload(task, projectsApi, methodsApi, …) → ExperimentExportPayload (Sub-bot A)
├── raw.ts                ← buildRawZip(payload) → ExportResult (Sub-bot B)
├── html.ts               ← buildHtmlBundle(payload) → ExportResult (Sub-bot C; returns a .zip)
├── pdf.ts                ← buildPdf(payload) → ExportResult (Sub-bot D; returns a .pdf)
├── orchestrate.ts        ← exportExperiments(tasks, format) → Blob/filename for download (Sub-bot A initially; refined by manager)
└── README.md             ← short note pointing to this plan doc (optional)
```

UI:

```
frontend/src/components/
├── ExportFormatDialog.tsx ← format-picker modal (Sub-bot E)
└── (TaskDetailPopup.tsx)  ← TaskExportButton rewired to call orchestrate (Sub-bot E)

frontend/src/app/search/
└── page.tsx               ← multi-select state + "Export selected" button (Sub-bot E)
```

`export-utils.ts` is **deleted** by Sub-bot A as part of the audit cleanup. Sub-bot E removes the call sites (`/experiments/page.tsx` keeps its bulk-export UI but routes to the new orchestrate layer, OR Sub-bot E removes the bulk-export UI from `/experiments` if the spec says only `/search` should multi-select — the locked spec says the new entry point is `/search`, so `/experiments` bulk export is **removed**; the per-card export still works via `TaskExportButton` on the task popup).

---

## 6. Cross-format conventions (every sub-bot must obey)

- **Sanitize filenames** through `slugify` from `lib/export/slug.ts`. Don't roll your own.
- **Always include all populated sections** in the order in §3. No per-section toggles.
- **Use `extractUserContent`** to strip stamp metadata before rendering Notes/Results/Methods/Deviation. Raw format is the exception — it includes the original stamped markdown verbatim.
- **Markdown ref resolution:** when you encounter `![alt](Images/foo.png)` or `[label](Files/foo.pdf)` in a markdown body, look up the filename in `payload.attachments` by `(origin, filename)`. The notes.md body's refs resolve to attachments with `origin: "notes"`; results.md → `origin: "results"`.
- **HTML inlining:** Images in HTML become `<img src="data:{mime};base64,…">`. Files become `<a href="attachments/Notes/{filename}">`.
- **PDF anchor IDs:** use `section-labnotes`, `section-results`, `section-methods-{methodId}`, `section-subtasks`, `section-deviation`, `section-files`. Sub-bot D owns these; Sub-bot C uses the same IDs for HTML so we can swap formats with consistent muscle memory.
- **No console errors or warnings in normal output paths.** Wrap optional reads in try/catch and log to console.warn for diagnostics only.
- **No bare `alert()` calls.** Throw real Errors; the orchestrate layer surfaces them via a toast (manager will wire this).

---

## 7. Verification gate (manager)

After all sub-bots report:

1. `cd frontend && npx tsc --noEmit` exits 0.
2. `cd frontend && npx next build` succeeds.
3. Live smoke test on `localhost:3000`:
   - Single-experiment via TaskExportButton → HTML → unzips, opens, nav works, images render, file links click through to sibling files.
   - Single → PDF → opens, text is selectable, TOC links jump, bookmarks present in outline pane, files appendix labeled correctly.
   - Single → Raw → unzips, structure matches §3.3, manifest valid.
   - Multi-select 3 on /search → PDF → outer zip with 3 .pdf files inside.
   - Per-tab isolation: an experiment with images in BOTH `notes/Images/` AND `results/Images/` — confirm both appear, correctly origin-tagged in the PDF appendix.

If smoke tests don't run for any reason, manager flags it in the final report.

---

## 8. Sub-bot status board (manager updates as bots land)

| Bot | Branch | Status | Notes |
| --- | --- | --- | --- |
| A — Data extraction + audit cleanup | (TBD) | spawned | Foundation; owns `types.ts`, `slug.ts`, `markdown.ts`, `extract.ts`, `orchestrate.ts` skeleton; deletes `export-utils.ts` |
| B — Raw format generator | (TBD) | spawned | Owns `raw.ts`; consumes ExperimentExportPayload; depends on Sub-bot A's types but not its impl |
| C — HTML format generator | (TBD) | spawned | Owns `html.ts`; adds `marked` dep; builds self-contained-HTML + attachments-folder bundle |
| D — PDF format generator | (TBD) | spawned | Owns `pdf.ts`; adds `@react-pdf/renderer` dep; PDF must be selectable + bookmarked |
| E — UI integration | (TBD) | spawned | Wires `/search` multi-select + `ExportFormatDialog` + rewires `TaskExportButton`; removes legacy `/experiments` bulk export |

