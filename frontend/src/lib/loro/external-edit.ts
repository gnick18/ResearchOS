/**
 * External-edit ingestion for the B-plus-graceful-C policy.
 *
 * Detection happens at open time (the file changed while the app was closed).
 * The live file-watcher path is Phase 4; nothing here is wired to fs.watch.
 *
 * The three entry-points the caller uses:
 *   classifyExternalEdit  -- compare sidecar projection to on-disk mirror
 *   ingestExternalEdit    -- apply the change as ONE commit to the doc
 *   writeConflictCopy     -- write the conflict copy when concurrent edits clash
 *   shouldConflictCopy    -- pure predicate for the conflict decision
 *
 * File ownership (Phase 1 parallel-chunk rule):
 *   This file owns ONLY external-edit.ts and its test.
 *   All content reads/writes go through note-doc.ts helpers (listEntries,
 *   setEntryContent, getMetaMap, getMeta). Structural ops (insert/delete whole
 *   entries) use LoroMovableList directly -- that is the sanctioned exception.
 */

import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { getMeta, getMetaMap, listEntries, setEntryContent } from "./note-doc";
import { projectToNote } from "./mirror";
import { fileService } from "@/lib/file-system/file-service";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * The result of comparing the sidecar's current projection against the
 * on-disk mirror (the readable .json file that was potentially edited
 * outside ResearchOS).
 *
 * "none"    -- tracked fields match; no external edit occurred.
 * "clean"   -- entry ids and set are identical, meta is unchanged; only
 *              one or more entry content/title/date values differ. A
 *              followable text change (normal diff across this boundary).
 * "unclean" -- entry ids differ (add, remove, or reorder) OR meta changed
 *              structurally. Not cleanly followable; we store a full-copy
 *              checkpoint and warn. This is the deliberate accepted limitation
 *              described in UNIFIED_DATA_MODEL.md section 3: we store a coarse
 *              boundary rather than risk silent corruption from reverse-
 *              engineering fine-grained ops under concurrency.
 *
 * Classification notes on ambiguous boundary cases:
 *   - Title-only change on an entry   -> "clean" (entry ids unchanged, only a
 *     scalar field in the entry map changed; we apply it as a normal update).
 *   - Date-only change on an entry    -> "clean" (same reasoning).
 *   - Meta title/description change   -> "unclean" (meta is treated as
 *     structural; a meta-level edit from outside ResearchOS is uncommon and
 *     the risk of a partial-match is higher than the cost of a coarse boundary).
 *   - Entry reorder with same ids     -> "unclean" (the order in the on-disk
 *     mirror is canonical, but we cannot reconstruct the CRDT move-op without
 *     knowing the original positions; treating it as unclean is safe).
 *
 * All of these decisions are recorded in the orchestrator's scope doc; the
 * classification boundary can be tightened later without changing the ingest
 * contract.
 */
export type ExternalEditKind = "none" | "clean" | "unclean";

/**
 * Compare the sidecar's projection to the on-disk mirror across TRACKED fields.
 *
 * Tracked fields (per mirror.ts):
 *   meta:    title, description, is_running_log, created_at
 *   entries: id, title, date, created_at, updated_at, content
 *
 * "clean" requires:
 *   - Exact same entry id list in the SAME ORDER.
 *   - Meta scalars unchanged.
 *   - At least one entry field (content, title, or date) differs.
 *
 * Everything else that differs is "unclean".
 */
export function classifyExternalEdit(
  sidecarDoc: LoroDoc,
  mirrorNote: Note,
): ExternalEditKind {
  const projection = projectToNote(sidecarDoc, mirrorNote);

  // Compare meta scalars.
  const projMeta = {
    title:          projection.title,
    description:    projection.description,
    is_running_log: projection.is_running_log,
    created_at:     projection.created_at,
  };
  const mirrorMeta = {
    title:          mirrorNote.title          ?? "",
    description:    mirrorNote.description    ?? "",
    is_running_log: mirrorNote.is_running_log ?? false,
    created_at:     mirrorNote.created_at     ?? "",
  };
  const metaChanged =
    projMeta.title          !== mirrorMeta.title         ||
    projMeta.description    !== mirrorMeta.description   ||
    projMeta.is_running_log !== mirrorMeta.is_running_log||
    projMeta.created_at     !== mirrorMeta.created_at;

  // Compare entry id lists (ordered).
  const projIds   = projection.entries.map((e) => e.id);
  const mirrorIds = mirrorNote.entries.map((e) => e.id);
  const idsMatch =
    projIds.length === mirrorIds.length &&
    projIds.every((id, i) => id === mirrorIds[i]);

  if (!idsMatch) return "unclean";
  if (metaChanged) return "unclean";

  // Id sets and order match, meta unchanged. Check per-entry tracked fields.
  let anyEntryFieldChanged = false;
  for (let i = 0; i < projection.entries.length; i++) {
    const pe = projection.entries[i];
    const me = mirrorNote.entries[i];
    if (
      pe.content    !== me.content    ||
      pe.title      !== me.title      ||
      pe.date       !== me.date       ||
      pe.created_at !== me.created_at ||
      pe.updated_at !== me.updated_at
    ) {
      anyEntryFieldChanged = true;
      break;
    }
  }

  return anyEntryFieldChanged ? "clean" : "none";
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/**
 * Apply the on-disk mirror as ONE commit to the Loro doc.
 *
 * clean branch:
 *   For every entry whose tracked scalar fields differ, update them in the
 *   doc via the note-doc helpers (content via setEntryContent, title/date/
 *   timestamps via direct map.set on the entry LoroMap). Then commit once
 *   with message "external-edit". The version tree shows a normal diff
 *   across this boundary.
 *
 * unclean branch:
 *   Bring the doc's entry list + meta wholesale into line with mirrorNote.
 *   This is the coarse full-copy checkpoint. A clean per-field diff across
 *   this boundary is NOT available -- that is the accepted limitation (design
 *   doc section 3): we prefer a known coarse boundary over silent corruption
 *   from reverse-engineering structural ops under concurrency. Commit with
 *   message "external-edit-uncleandiff".
 *
 * Timestamp: wall-clock seconds (this is a real edit event, not a seed).
 * Cross-device byte-determinism is NOT required for external-edit commits --
 * only ONE device ingests a given external edit and the resulting ops carry
 * that device's real Loro peer id and merge via the CRDT normally.
 */
export function ingestExternalEdit(
  doc: LoroDoc,
  mirrorNote: Note,
  kind: "clean" | "unclean",
): void {
  const timestamp = Math.floor(Date.now() / 1000);

  if (kind === "clean") {
    _ingestClean(doc, mirrorNote);
    doc.commit({ message: "external-edit", timestamp });
  } else {
    _ingestUnclean(doc, mirrorNote);
    doc.commit({ message: "external-edit-uncleandiff", timestamp });
  }
}

/**
 * Clean ingest: entry ids are unchanged; update any entry fields that differ.
 * Uses the note-doc helper for content and direct LoroMap.set for scalars.
 */
function _ingestClean(doc: LoroDoc, mirrorNote: Note): void {
  const entries = doc.getMovableList("entries");
  const currentEntries = listEntries(doc);

  for (let i = 0; i < mirrorNote.entries.length; i++) {
    const me = mirrorNote.entries[i];
    const ce = currentEntries[i];
    if (!ce) continue;

    const anyDiff =
      ce.content    !== me.content    ||
      ce.title      !== me.title      ||
      ce.date       !== me.date       ||
      ce.created_at !== me.created_at ||
      ce.updated_at !== me.updated_at;

    if (!anyDiff) continue;

    const entryMap = entries.get(i) as LoroMap;
    if (!entryMap) continue;

    // Scalar fields: direct set on the entry LoroMap.
    if (ce.title      !== me.title)      entryMap.set("title",      me.title      ?? "");
    if (ce.date       !== me.date)       entryMap.set("date",       me.date       ?? "");
    if (ce.created_at !== me.created_at) entryMap.set("created_at", me.created_at ?? "");
    if (ce.updated_at !== me.updated_at) entryMap.set("updated_at", me.updated_at ?? "");

    // Content: always go through the note-doc helper.
    if (ce.content !== me.content) {
      setEntryContent(doc, i, me.content ?? "");
    }
  }
}

/**
 * Unclean ingest: wholesale replace the doc's entries + meta with mirrorNote.
 *
 * Why coarse: we cannot reconstruct fine-grained CRDT ops (insert/delete/move)
 * from a diff of two JSON snapshots without risking corruption under concurrency.
 * Instead we clear and re-insert, producing a snapshot boundary. History before
 * and after remains granular; only this single boundary lacks a clean diff.
 * (Accepted limitation, UNIFIED_DATA_MODEL.md section 3.)
 */
function _ingestUnclean(doc: LoroDoc, mirrorNote: Note): void {
  // Update meta scalars from the mirror.
  const metaMap = getMetaMap(doc);
  metaMap.set("title",          mirrorNote.title          ?? "");
  metaMap.set("description",    mirrorNote.description    ?? "");
  metaMap.set("is_running_log", mirrorNote.is_running_log ?? false);
  metaMap.set("created_at",     mirrorNote.created_at     ?? "");

  // Replace the entries list. We delete from the end first to keep indices
  // stable, then insert new entries for any additions.
  const list = doc.getMovableList("entries");
  const currentLen = (list.toArray() as unknown[]).length;
  const mirrorLen  = mirrorNote.entries.length;

  // Build a map of current entry id -> index for quick lookup.
  const currentEntries = listEntries(doc);
  const currentIdToIndex = new Map<string, number>();
  for (let i = 0; i < currentEntries.length; i++) {
    currentIdToIndex.set(currentEntries[i].id, i);
  }

  // Determine which current entries to keep (those present in mirror, in mirror order).
  // Delete entries not in the mirror (from high to low index to preserve indices).
  const mirrorIdSet = new Set(mirrorNote.entries.map((e) => e.id));
  const toDelete: number[] = [];
  for (let i = 0; i < currentLen; i++) {
    if (!mirrorIdSet.has(currentEntries[i].id)) {
      toDelete.push(i);
    }
  }
  // Delete from highest index to lowest to keep indices valid.
  for (let di = toDelete.length - 1; di >= 0; di--) {
    list.delete(toDelete[di], 1);
  }

  // Now the doc has only entries that exist in the mirror, but possibly in a
  // different order and missing new ones. We rebuild in mirror order by clearing
  // whatever is left and inserting fresh, since structural reordering of existing
  // CRDT containers is complex and the unclean branch is explicitly a coarse boundary.
  const remainingLen = (list.toArray() as unknown[]).length;
  if (remainingLen > 0) {
    list.delete(0, remainingLen);
  }

  // Insert all mirror entries in order.
  for (let i = 0; i < mirrorNote.entries.length; i++) {
    const me = mirrorNote.entries[i];
    const entryMap = list.insertContainer(i, new LoroMap());
    entryMap.set("id",         me.id         ?? "");
    entryMap.set("title",      me.title      ?? "");
    entryMap.set("date",       me.date       ?? "");
    entryMap.set("created_at", me.created_at ?? "");
    entryMap.set("updated_at", me.updated_at ?? "");
    const text = entryMap.setContainer("content", new LoroText());
    if (me.content) {
      text.insert(0, me.content);
    }
  }
}

// ---------------------------------------------------------------------------
// Conflict copy
// ---------------------------------------------------------------------------

/**
 * Decide whether to write a conflict copy.
 *
 * Returns true when BOTH conditions hold:
 *   - The user has pending in-app edits that have not been flushed to the mirror.
 *   - An external edit was detected (kind is "clean" or "unclean").
 *
 * When this returns true, the caller should write the conflict copy and surface
 * a warning instead of silently merging. The detection trigger is wired in
 * chunk 5; this function is a pure predicate so it can be unit-tested without
 * any I/O.
 */
export function shouldConflictCopy(
  hasPendingInAppEdits: boolean,
  kind: ExternalEditKind,
): boolean {
  return hasPendingInAppEdits && kind !== "none";
}

/**
 * Write the external version as a conflict copy.
 *
 * Path: users/<owner>/notes/<id> (external edit).json
 * Locked naming, section 9, decision 3 of the Phase 1 design doc.
 *
 * This is called when shouldConflictCopy() returns true. The caller is
 * responsible for surfacing a warning to the user. We write the external
 * note payload verbatim; no CRDT merge is attempted.
 */
export async function writeConflictCopy(
  owner: string,
  base: Note,
  externalNote: Note,
): Promise<void> {
  const path = `users/${owner}/notes/${base.id} (external edit).json`;
  await fileService.writeJson<Note>(path, externalNote);
}
