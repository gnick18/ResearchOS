// frontend/src/lib/export/types.ts
//
// LOCKED type contract for the experiment export pipeline. Sub-bots B/C/D
// import from here; do not modify without manager sign-off. See
// EXPORT_REVAMP_PLAN.md §4 for the full spec.

import type {
  Task,
  Method,
  Project,
  TaskMethodAttachment,
  PCRProtocol,
  LCGradientProtocol,
  PlateProtocol,
} from "@/lib/types";

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
  // Only set when origin === "methods": the Method.id this attachment was
  // pushed for. Lets format generators bind a PDF-method's bytes to its
  // entry without name-matching games.
  methodId?: number;
}

export interface MethodPayload {
  method: Method;
  // For markdown methods: the body text. For PDF methods: null (the bytes
  // live in `attachments` with origin: "methods"). For PCR methods: null
  // (rendered from `pcrProtocol` below plus any per-task overrides on
  // `attachment.pcr_gradient` / `.pcr_ingredients`).
  bodyMarkdown: string | null;
  // The TaskMethodAttachment for THIS task — variation_notes, pcr_gradient,
  // pcr_ingredients. May be null if the task has no per-method overrides.
  attachment: TaskMethodAttachment | null;
  // Only populated for `method.method_type === "pcr"`. The canonical PCRProtocol
  // record (referenced by `method.source_path === "pcr://protocol/{id}"`),
  // pre-fetched by the extractor so format generators don't need async lookups.
  // `null` when the protocol couldn't be loaded (e.g. shared-task PCR pointing
  // at a private protocol in another user's namespace).
  pcrProtocol?: PCRProtocol | null;
  // Only populated for `method.method_type === "lc_gradient"`. Pre-fetched
  // mirror of `pcrProtocol` for the LC type — referenced by
  // `method.source_path === "lc_gradient://protocol/{id}"`. `null` when the
  // protocol couldn't be loaded across owner namespaces.
  lcGradientProtocol?: LCGradientProtocol | null;
  // Only populated for `method.method_type === "plate"`. Mirrors lcGradient
  // / pcrProtocol — referenced by `plate://protocol/{id}`. `null` when the
  // protocol couldn't be loaded across owner namespaces.
  plateProtocol?: PlateProtocol | null;
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

// Manifest shapes emitted alongside each format. Kept in sync across raw /
// html / pdf so downstream tooling can rely on the same field names regardless
// of which format it ingests. The raw bundle writes this as a sidecar
// `_export-manifest.json`; html does the same; pdf JSON-stringifies it into
// the Document `keywords` field (pdfs have no sidecar story).
//
// `source_instance` is an OPTIONAL free-text lineage hint added 2026-05-14 to
// disambiguate exports of the same task across machines / folders. v1
// manifests without it remain valid — receivers must treat it as optional.
// Current format: `<ownerLabel>@<YYYY-MM-DD>` (e.g. "alex@2026-05-14"). The
// scheme is intentionally free-text so future iterations can fold in
// hostname or folder-display-name without bumping `version`.

export interface RawManifest {
  format: "researchos-experiment";
  version: 1;
  exported_at: string;
  exported_by: string;
  source_owner: string;
  source_instance?: string;
  task_id: number;
  task_key: string;
  project_id: number;
  method_ids: number[];
}

export interface HtmlManifest {
  format: "html";
  version: 1;
  exported_at: string;
  source_owner: string;
  source_instance?: string;
  task_id: number;
}

export interface PdfManifest {
  format: "pdf";
  version: 1;
  exported_at: string;
  source_owner: string;
  source_instance?: string;
  task_id: number;
}

// Build the `source_instance` lineage hint from the available `meta` fields.
// Centralized so raw / html / pdf all emit the same value for a given
// payload — re-export determinism + audit consistency both rely on this.
export function buildSourceInstance(
  ownerLabel: string,
  exportedAtIso: string,
): string {
  return `${ownerLabel}@${exportedAtIso.slice(0, 10)}`;
}
