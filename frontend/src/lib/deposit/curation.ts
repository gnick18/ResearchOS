// frontend/src/lib/deposit/curation.ts
//
// Repository-deposit PHASE 1 (guided-deposit bot, 2026-05-28). The CURATION
// step: NIH wants a curated dataset, not the raw lab notebook. So before we
// reuse the export pipeline to build the bundle, the user chooses which
// sections (notes, results, methods) and which attachments to include.
//
// This module is PURE: it takes a fully-built `ExperimentExportPayload` (from
// `buildExperimentPayload`) plus a `CurationSelection` and returns a NEW,
// filtered payload that the existing format generators (`buildRawZip`,
// `buildHtmlBundle`, `buildPdf`) consume unchanged. We never reimplement
// bundling; we only narrow what the pipeline already produced.
//
// No I/O, no DOM, no network. No em-dashes, no emojis.

import { hasUserContent } from "@/lib/export/markdown";
import type {
  ExperimentAttachment,
  ExperimentExportPayload,
} from "@/lib/export/types";

/**
 * One toggleable attachment in the curation UI, plus the byte size we show
 * beside it. `key` is the stable `origin:filename` identity the selection
 * keys on (matches the de-dupe key the raw bundler already uses).
 */
export interface CurationAttachmentItem {
  key: string;
  filename: string;
  origin: ExperimentAttachment["origin"];
  byteLength: number;
  // Only set for method-bound attachments; lets the UI group them.
  methodId?: number;
}

/**
 * The full menu of curatable items for a payload, derived once so the dialog
 * can render checkboxes without re-walking the payload. Sections are present
 * in the menu only when the payload actually has that content.
 */
export interface CurationMenu {
  hasNotes: boolean;
  hasResults: boolean;
  hasMethods: boolean;
  attachments: CurationAttachmentItem[];
}

/**
 * The user's choices. `includeNotes / includeResults / includeMethods` gate
 * whole sections; `excludedAttachmentKeys` is a deny-list of
 * `origin:filename` keys (default = include everything that is present).
 * A deny-list (not an allow-list) keeps "include all" the zero-config
 * default, which matches the dialog opening fully selected.
 */
export interface CurationSelection {
  includeNotes: boolean;
  includeResults: boolean;
  includeMethods: boolean;
  excludedAttachmentKeys: Set<string>;
}

/** Stable identity for an attachment within a payload. */
export function attachmentKey(att: {
  origin: ExperimentAttachment["origin"];
  filename: string;
}): string {
  return `${att.origin}:${att.filename}`;
}

/**
 * Walk a payload and produce the curation menu. Notes / results count as
 * present only when they carry real user content (a header-only stub does
 * not). Methods count as present when the payload has at least one method.
 */
export function buildCurationMenu(
  payload: ExperimentExportPayload,
): CurationMenu {
  const attachments: CurationAttachmentItem[] = payload.attachments.map(
    (att) => ({
      key: attachmentKey(att),
      filename: att.filename,
      origin: att.origin,
      byteLength: att.bytes.byteLength,
      ...(att.methodId !== undefined ? { methodId: att.methodId } : {}),
    }),
  );
  return {
    hasNotes: hasUserContent(payload.notesMarkdown),
    hasResults: hasUserContent(payload.resultsMarkdown),
    hasMethods: payload.methods.length > 0,
    attachments,
  };
}

/**
 * The default selection for a freshly-opened dialog: everything that exists
 * is included. Built from the menu so absent sections start unchecked (and
 * stay disabled in the UI).
 */
export function defaultCurationSelection(
  menu: CurationMenu,
): CurationSelection {
  return {
    includeNotes: menu.hasNotes,
    includeResults: menu.hasResults,
    includeMethods: menu.hasMethods,
    excludedAttachmentKeys: new Set<string>(),
  };
}

/**
 * True when the selection would produce a non-empty bundle: at least one
 * section is on, OR at least one attachment survives the deny-list. The
 * dialog disables the handoff button when this is false so the user cannot
 * build an empty deposit.
 */
export function selectionHasContent(
  menu: CurationMenu,
  selection: CurationSelection,
): boolean {
  if (selection.includeNotes && menu.hasNotes) return true;
  if (selection.includeResults && menu.hasResults) return true;
  if (selection.includeMethods && menu.hasMethods) return true;
  const anyAttachmentKept = menu.attachments.some(
    (a) => !selection.excludedAttachmentKeys.has(a.key),
  );
  return anyAttachmentKept;
}

/**
 * Apply a curation selection to a payload, returning a NEW payload (the input
 * is never mutated). Dropped sections become `null` (notes/results) or `[]`
 * (methods). Attachments on the deny-list are removed; when a whole section
 * is dropped, that section's attachments are dropped too (so excluding the
 * Notes section also removes notes-origin images, matching user intent).
 *
 * Method-origin attachments follow the Methods section toggle. The format
 * generators already tolerate a payload with any subset of sections, so the
 * filtered payload flows straight into `buildOne`.
 */
export function applyCuration(
  payload: ExperimentExportPayload,
  selection: CurationSelection,
): ExperimentExportPayload {
  const keepNotes = selection.includeNotes;
  const keepResults = selection.includeResults;
  const keepMethods = selection.includeMethods;

  const attachments = payload.attachments.filter((att) => {
    // Section-level drop wins over the per-attachment deny-list.
    if (att.origin === "notes" && !keepNotes) return false;
    if (att.origin === "results" && !keepResults) return false;
    if (att.origin === "methods" && !keepMethods) return false;
    return !selection.excludedAttachmentKeys.has(attachmentKey(att));
  });

  const methods = keepMethods ? payload.methods : [];

  // Recompute the method-name list in `meta` so the title page reflects the
  // curated set (an empty methods section should not advertise method names).
  const meta: ExperimentExportPayload["meta"] = {
    ...payload.meta,
    methodNames: keepMethods ? payload.meta.methodNames : [],
  };

  return {
    ...payload,
    notesMarkdown: keepNotes ? payload.notesMarkdown : null,
    resultsMarkdown: keepResults ? payload.resultsMarkdown : null,
    methods,
    attachments,
    meta,
  };
}
