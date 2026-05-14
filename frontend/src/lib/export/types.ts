// frontend/src/lib/export/types.ts
//
// LOCKED type contract for the experiment export pipeline. Sub-bots B/C/D
// import from here; do not modify without manager sign-off. See
// EXPORT_REVAMP_PLAN.md §4 for the full spec.

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
  // Only set when origin === "methods": the Method.id this attachment was
  // pushed for. Lets format generators bind a PDF-method's bytes to its
  // entry without name-matching games.
  methodId?: number;
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
