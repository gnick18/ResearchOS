// frontend/src/lib/import/types.ts
//
// Type contract for the experiment-import pipeline. The receiver side of
// the Raw ResearchOS export format defined in EXPORT_REVAMP_PLAN.md §3.3.

import type {
  CellCultureSchedule,
  CodingWorkflowProtocol,
  Dependency,
  LCGradientProtocol,
  MassSpecProtocol,
  Method,
  PCRProtocol,
  PlateProtocol,
  Project,
  QPCRAnalysisProtocol,
  Task,
} from "@/lib/types";

export interface ImportManifest {
  format: "researchos-experiment";
  // v1 = pre-dependency bundles. v2 added the optional dependencies section
  // (Gap 1, 2026-06-04). The parser accepts both; a v1 bundle imports
  // unchanged because the dependencies section is treated as empty.
  version: 1 | 2;
  exported_at: string;
  exported_by: string;
  source_owner: string;
  // Standalone-method marker (cross-boundary sharing, methods tier). Set to
  // "method" on a single-method bundle, absent on an experiment bundle. The
  // bundle still uses the researchos-experiment envelope (a synthetic
  // envelope task carrying the one method), so parse + apply read it
  // unchanged; only the inbox sniff branches on this field. Optional and
  // additive, an experiment bundle that omits it parses as before.
  kind?: "method";
  task_id: number;
  task_key: string;
  project_id: number;
  method_ids: number[];
  // v2 only, optional even then: convenience index of bundled dependency ids.
  // The canonical content is the parsed `ImportPayload.dependencies`.
  dependency_ids?: number[];
}

export type ImportAttachmentOrigin = "notes" | "results" | "methods";

export interface ImportAttachment {
  origin: ImportAttachmentOrigin;
  // For notes/results: "Files" or "Images". For methods: null (the file
  // is the method's own body PDF, stored alongside method-{id}.json).
  sub: "Files" | "Images" | null;
  filename: string;
  bytes: ArrayBuffer;
  // Only set for `origin === "methods"`: the source-side method id this
  // file was attached to. Lets `apply.ts` rewrite the method record's
  // `source_path` to point at the receiver-side copy.
  methodId?: number;
}

export interface ImportMethodEntry {
  // The Method record exactly as written by the source's exporter.
  record: Method;
  // Markdown body for `method_type === "markdown"` methods. Null otherwise.
  bodyMarkdown: string | null;
  // PDF/binary bytes for `method_type === "pdf"` methods. Null otherwise.
  // (For PCR methods both fields are null; the body is rendered from the
  // Method record itself.)
  bytes: ArrayBuffer | null;
  // Original filename of the PDF body (e.g. "western-blot.pdf"). Used to
  // build the receiver-side source_path.
  pdfFilename: string | null;
  // The source-side PCRProtocol record, carried in the bundle as
  // `methods/method-{id}-pcr-protocol.json`. Only populated for PCR methods
  // whose protocol was bundled. When null on a PCR method, "import-new" is
  // not offered (the importer has nothing to recreate); only "use-existing"
  // or "skip" remain.
  pcrProtocol?: PCRProtocol | null;
  // The source-side LCGradientProtocol record, carried in the bundle as
  // `methods/method-{id}-lc-gradient-protocol.json`. Same import-new gating
  // semantics as pcrProtocol — when null on an lc_gradient method, only
  // "use-existing" or "skip" remain.
  lcGradientProtocol?: LCGradientProtocol | null;
  // The source-side PlateProtocol record, carried in the bundle as
  // `methods/method-{id}-plate-protocol.json`. Same import-new gating semantics
  // as pcrProtocol / lcGradientProtocol.
  plateProtocol?: PlateProtocol | null;
  // The source-side CellCultureSchedule record, carried in the bundle as
  // `methods/method-{id}-cell-culture-schedule.json`. Same import-new gating
  // semantics as pcrProtocol / lcGradientProtocol.
  cellCultureSchedule?: CellCultureSchedule | null;
  // The source-side MassSpecProtocol record, carried in the bundle as
  // `methods/method-{id}-mass-spec-protocol.json`. Same import-new gating
  // semantics as the other structured types.
  massSpecProtocol?: MassSpecProtocol | null;
  // The source-side CodingWorkflowProtocol record, carried in the bundle as
  // `methods/method-{id}-coding-workflow.json`. Same import-new gating
  // semantics as the other structured types.
  codingWorkflow?: CodingWorkflowProtocol | null;
  // The source-side QPCRAnalysisProtocol record, carried in the bundle as
  // `methods/method-{id}-qpcr-analysis-protocol.json`. Same import-new gating
  // semantics as pcrProtocol / lcGradientProtocol.
  qpcrAnalysisProtocol?: QPCRAnalysisProtocol | null;
}

export interface ImportPayload {
  manifest: ImportManifest;
  task: Task;
  project: Project;
  methods: ImportMethodEntry[];
  notesMarkdown: string | null;
  resultsMarkdown: string | null;
  attachments: ImportAttachment[];
  // Task-to-task dependency records carried in the bundle (Gap 1). The ids
  // are still in the SOURCE id-space; apply.ts remaps them. Empty array for
  // v1 bundles and for tasks that had no links.
  dependencies: Dependency[];
}

export type MethodDecision = "use-existing" | "import-new" | "skip";

export interface MethodResolution {
  sourceMethodId: number;
  sourceMethodName: string;
  sourceMethodType: Method["method_type"];
  decision: MethodDecision;
  // For "use-existing": the receiver-side method id that the task should
  // link to. For "import-new" / "skip": null.
  existingMethodId: number | null;
  // The candidate matches surfaced to the user — used to populate the
  // dropdown in the resolution UI.
  candidates: Array<{ id: number; name: string }>;
}

export type ProjectDecision = "use-existing" | "import-new" | "no-project";

export interface ProjectResolution {
  sourceProjectId: number;
  sourceProjectName: string;
  decision: ProjectDecision;
  existingProjectId: number | null;
  candidates: Array<{ id: number; name: string }>;
}

export interface ImportPlan {
  payload: ImportPayload;
  project: ProjectResolution;
  methods: MethodResolution[];
}

export interface ImportProgress {
  phase: "parsing" | "resolving" | "applying" | "done";
  // Human-readable status line for the dialog.
  message: string;
}

// A single dependency record that could not be recreated on the receiver
// side, with a human-readable reason a future UI can surface verbatim.
export interface NotCarriedDependency {
  // Source-side ids (the bundle's id-space). The receiver has no record with
  // these ids; they are reported for diagnostics only.
  sourceParentId: number;
  sourceChildId: number;
  depType: Dependency["dep_type"];
  reason: string;
}

// A method reference (from method_ids or a method_attachment) that could not
// be localized to a receiver-side method, so the reference was dropped rather
// than left dangling at an owner the recipient cannot resolve.
export interface NotCarriedMethodRef {
  sourceMethodId: number;
  // Best-effort name for the UI; may be empty if the bundle never carried the
  // record (the very case that forces the drop).
  sourceMethodName: string;
  reason: string;
}

// Structured report of everything the import deliberately dropped so the
// receiver is never left with a silently severed link or a dangling foreign
// reference. A future UI warns the user from this. Empty arrays = clean
// import (the normal local same-app case).
export interface ImportNotCarried {
  dependencies: NotCarriedDependency[];
  methodRefs: NotCarriedMethodRef[];
}

export interface ImportResult {
  // The receiver-side task id created by an experiment import. null for a
  // standalone-method import (cross-boundary method sharing), which lands only
  // the method and deliberately creates no envelope task. The success UI reads
  // null as the method-only marker.
  newTaskId: number | null;
  newTaskOwner: string;
  newProjectId: number | null;
  // Map from source method id → receiver-side method id, for diagnostics.
  importedMethodIds: Record<number, number>;
  // What the import could not carry over (dropped dependencies + dropped
  // method references), each with a reason. Always present; empty when the
  // import was lossless. Added 2026-06-04 (Gaps 1 + 2).
  notCarried: ImportNotCarried;
}
