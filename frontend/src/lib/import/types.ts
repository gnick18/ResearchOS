// frontend/src/lib/import/types.ts
//
// Type contract for the experiment-import pipeline. The receiver side of
// the Raw ResearchOS export format defined in EXPORT_REVAMP_PLAN.md §3.3.

import type {
  CellCultureSchedule,
  CodingWorkflowProtocol,
  LCGradientProtocol,
  Method,
  PCRProtocol,
  PlateProtocol,
  Project,
  QPCRAnalysisProtocol,
  Task,
} from "@/lib/types";

export interface ImportManifest {
  format: "researchos-experiment";
  version: 1;
  exported_at: string;
  exported_by: string;
  source_owner: string;
  task_id: number;
  task_key: string;
  project_id: number;
  method_ids: number[];
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

export interface ImportResult {
  newTaskId: number;
  newTaskOwner: string;
  newProjectId: number | null;
  // Map from source method id → receiver-side method id, for diagnostics.
  importedMethodIds: Record<number, number>;
}
