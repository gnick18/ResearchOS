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
