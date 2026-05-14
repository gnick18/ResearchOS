/**
 * Normalized output of any ELN-import adapter. Downstream task-generation,
 * bulk-sort UI, and re-import dedup all consume this shape — keep it stable.
 */
export interface ParsedNotebook {
  /** Origin ELN system, e.g. "labarchives-offline-zip". */
  source: string;
  /** Display name of the notebook root, e.g. "The FUNGI lab". */
  notebookName: string | null;
  /** Breadcrumb path from the notebook root to where this export started, e.g. ["Notebooks","postdocs"]. */
  rootBreadcrumb: string[];
  /** The user who generated the export, if known. */
  exportedBy: string | null;
  /** When the export was generated, ISO-8601 if parseable. */
  exportedAt: string | null;
  /** Hierarchical folder tree from notebook_home_page.html. Pages are leaves. */
  tree: ParsedNode[];
  /** Flat list of pages, each with its full tree path. */
  pages: ParsedPage[];
  /** Inline images referenced by Form B (online-only URL, NOT bundled in the ZIP). */
  missingInlineImages: MissingInlineImage[];
}

export interface ParsedNode {
  /** Tree id from <li id="n-..."> */
  treeNodeId: string;
  kind: "folder" | "page";
  name: string;
  /** For pages only: the {page_id}.html file. */
  pageFile?: string;
  /** For folders only: children. */
  children?: ParsedNode[];
}

export interface ParsedPage {
  pageId: string;
  pageFile: string;
  /** Path from notebook root to this page, including the page name as the last element. */
  treePath: string[];
  /** Page header metadata from <meta name="Description">. Best-effort. */
  pageCreator: string | null;
  pageCreatedAt: string | null;
  /** Decoded base64 dedup string from the top <div id="..."> of the page. */
  pageDedupRaw: string | null;
  /** Parsed components: revision | "{notebook_id}/{page_id}/Entry/{entry_full_id}" | version. */
  notebookId: string | null;
  entries: ParsedEntry[];
}

export type ParsedEntryType =
  | "text"
  | "attachment"
  | "heading"
  | "plain_text"
  | "unsupported";

export interface ParsedEntry {
  /** The entry-id from `dispatchSetEntry("454", ...)`. */
  entryId: string;
  /** Stable dedup key: `${notebookId}/${pageId}/Entry/${entryFullId}` when all parts are known; falls back to a synthesized key otherwise. */
  dedupKey: string;
  type: ParsedEntryType;
  /** Original EPT_* number (1, 2, 4, 5, 3, 6..12) for traceability / forensic UI. */
  rawTypeNumber: number;
  /** Author display name from `lastModifiedBy`, e.g. "Daniel Cerritos Garcia". */
  author: string | null;
  /** ISO-8601 with TZ from `updatedAt`, or null. */
  updatedAt: string | null;
  /**
   * Markdown body for the entry.
   *  - text:        Froala HTML converted to markdown (turndown)
   *  - heading:     "# {data}" (always H1; UI layer can demote if needed)
   *  - plain_text:  raw `data` (already markdown)
   *  - attachment:  null (use `attachments` instead)
   *  - unsupported: null
   */
  bodyMarkdown: string | null;
  /** Attachment files referenced by this entry (type=2 has exactly one; type=1 may have inline images). */
  attachments: ParsedAttachment[];
  /** Form B online-only inline images this entry references. */
  missingInlineImages: MissingInlineImage[];
  /** For type=unsupported only: original JSON payload for sidecar dump. */
  unsupportedRaw?: unknown;
  /** Original tags from the payload, passed through verbatim. */
  tags: string[];
}

export interface ParsedAttachment {
  /** Original filename, e.g. "Nov_RedesignedExperiments.md". */
  filename: string;
  fileSize: number;
  isImage: boolean;
  /** Where this attachment is used. "body" = type=2 attachment entry; "inline" = inline <img> inside a rich-text entry. */
  usage: "body" | "inline";
  /** Path inside the ZIP, e.g. "attachments/original/73-Nov_RedesignedExperiments.md". */
  zipPath: string;
  /** Lazy-read binary content. Call this when you need bytes — avoids holding 67 MB of files in memory until needed. */
  readBytes: () => Promise<ArrayBuffer>;
}

export interface MissingInlineImage {
  /** Synthesized "filename" to use in the placeholder, e.g. "1762884018545.jpg". */
  filename: string;
  /** Original online URL, e.g. "/attachments/inline_image/{...}?ep_id={...}&file_name=..." */
  originalUrl: string;
  /** Decoded ep_id components, when parseable. */
  notebookId?: string;
  pageId?: string;
  entryPartId?: string;
  revision?: string;
  version?: string;
}

// ─── Apply-pipeline contract ─────────────────────────────────────────────────
// Types below describe the plan/result shape consumed by the wizard UI and
// produced by `plan.ts` + `apply.ts`. Keep these stable; the wizard sub-bot
// reads them.

export type ELNProjectDecision = "use-existing" | "import-new" | "no-project";

export interface ELNProjectMapping {
  /**
   * Slash-joined tree-path key used to group pages into a single mapping
   * row, e.g. "Grant N/meetings". Built from the cleaned treePath (notebook
   * name and "Notebooks" stripped) so multiple pages with the same parent
   * folder share one mapping.
   */
  treePathKey: string;
  /** Derived from the path. May be null when the cleaned path is too short. */
  defaultProjectName: string | null;
  /** Default decision: "import-new" for any non-null name, "no-project" for null. */
  decision: ELNProjectDecision;
  /** When decision === "use-existing". */
  existingProjectId?: number;
  /** When decision === "import-new" (editable by the wizard UI). */
  newProjectName?: string;
  /** All page IDs that hit this mapping. */
  pageIds: string[];
}

export interface ELNImportPlan {
  source: "labarchives-offline-zip";
  parsed: ParsedNotebook;
  /** One mapping per unique cleaned-treePath key across all pages. */
  projectMappings: ELNProjectMapping[];
  /** Receiver-side user that will own the imported tasks. */
  receiver: string;
  /** ISO timestamp of when the import was kicked off. */
  startedAt: string;
}

export interface ELNAppliedTask {
  pageId: string;
  newTaskId: number;
  newProjectId: number | null;
  /** Dedup key — `ParsedPage.pageDedupRaw` when present, otherwise composed. */
  dedupKey: string;
  /** Count of attachments written for this task (body + inline + rehydrated). */
  attachmentsWritten: number;
  /** Form B online-only inline images STILL missing after the (optional)
   *  LabArchives image-fetch step. Zero when every Form-B URL was either
   *  rehydrated or never present. */
  missingInlineImages: number;
  /** Form B online-only inline images successfully rehydrated from
   *  LabArchives during this apply pass. Zero when the sign-in step was
   *  skipped. */
  rehydratedInlineImages: number;
  /** Original tree path from the notebook root. Used by bulk-sort UI to show "from X/Y" subtitle. */
  treePath: string[];
  /** Display name of the page, used by bulk-sort UI as the task title. */
  pageName: string;
}

/**
 * Progress callback shape used by the wizard UI to drive its progress bar.
 * Apply fires this at the project-creation loop and the page-apply loop.
 *
 * `total` is 0 if the phase has no work (e.g. all pages were dedup-skipped).
 */
export interface ELNApplyProgress {
  phase: "projects" | "tasks";
  current: number;
  total: number;
  /** Most recently-seen item label, e.g. project name or page name. */
  label?: string;
}

export interface ELNSkippedTask {
  pageId: string;
  existingTaskId: number;
  dedupKey: string;
}

export interface ELNCreatedProject {
  name: string;
  id: number;
}

export interface ELNImportWarning {
  pageId: string;
  message: string;
}

export interface ELNImportResult {
  tasksCreated: ELNAppliedTask[];
  tasksSkippedAsDuplicate: ELNSkippedTask[];
  projectsCreated: ELNCreatedProject[];
  /** Count of Form-B online-only images still unresolved after the import.
   *  Equals zero when every Form-B URL was rehydrated via LabArchives. */
  totalMissingInlineImages: number;
  /** Count of Form-B online-only images successfully rehydrated from
   *  LabArchives during this apply pass. Zero when the sign-in step was
   *  skipped. */
  totalRehydratedInlineImages: number;
  /** Per-page errors that did NOT halt the import (e.g. one page failed mid-way). */
  warnings: ELNImportWarning[];
}

/**
 * On-disk sidecar written to `<taskNotesBase>/_import_source.json` on first
 * import. Used to detect re-imports of the same notebook page on a second
 * apply pass.
 */
export interface ELNImportSidecar {
  source: "labarchives-offline-zip";
  imported_at: string;
  imported_by: string;
  dedupKey: string;
  notebookName: string | null;
  treePath: string[];
  pageId: string;
  entryCount: number;
  missingInlineImages: MissingInlineImage[];
}
