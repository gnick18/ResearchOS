/**
 * Loro document schema for a single ResearchOS note.
 *
 * Layout (locked by Phase 1 design doc):
 *   root Map   "meta"    -- LWW scalars: title, description, is_running_log, created_at
 *   root Movable List  "entries"  -- each element is a child LoroMap holding entry fields,
 *                                    with a nested LoroText container keyed "content"
 *
 * One doc per note; entries are Movable so reordering is a first-class CRDT op.
 *
 * Marks (Peritext, chunk 3):
 *   Bold, italic, and link marks are stored as Loro text marks (NOT as markdown
 *   control characters inside the Text). listEntries() re-renders marks back to
 *   markdown so callers and the mirror always see plain markdown strings.
 *   setEntryContent() splits incoming markdown, replaces the plain text, and
 *   re-applies marks. getEntryContentText() returns the raw LoroText handle for
 *   the editor binding (chunk 5); the editor works with the Delta API directly.
 */

import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import type { Delta } from "loro-crdt";
import {
  renderMarkdownInline,
  splitMarkdownInline,
  configureTextStyles,
} from "./marks";
import type { InlineMark } from "./marks";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Public plain-object shapes (what read helpers return)
// ---------------------------------------------------------------------------

export interface NoteMetaPlain {
  title: string;
  description: string;
  is_running_log: boolean;
  created_at: string;
}

export interface NoteEntryPlain {
  id: string;
  title: string;
  date: string;
  created_at: string;
  updated_at: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Internal: extract InlineMark[] from a LoroText Delta
// ---------------------------------------------------------------------------

/**
 * Convert a toDelta() result back into InlineMark[] offsets into the plain text.
 *
 * toDelta() returns a Quill-style delta: an array of segments, each with
 * { insert: string, attributes?: { bold?: true, italic?: true, link?: string } }.
 * We walk the segments, track the plain-text cursor, and emit one InlineMark
 * per (attribute, contiguous span) pair.
 *
 * WHY we re-derive marks from the Delta instead of from the plain-text markdown:
 * After a real collaborative edit the Text may have been modified by mark()
 * calls from another peer without going through our markdown parser, so the
 * ground truth is always the Loro mark layer, not any markdown we might try
 * to parse from toString().
 */
function deltaToMarks(delta: Delta<string>[]): InlineMark[] {
  const marks: InlineMark[] = [];
  let cursor = 0;

  for (const seg of delta) {
    // Delta segments in a text toDelta() are always "insert" segments after
    // state read (delete/retain appear only in deltas that describe changes,
    // not the full state snapshot). Guard defensively anyway.
    if (!("insert" in seg) || typeof seg.insert !== "string") {
      // retain / delete segments do not contribute plain text characters.
      continue;
    }

    const segLen = seg.insert.length;
    const attrs = seg.attributes;

    if (attrs) {
      if (attrs["bold"] === true) {
        marks.push({ start: cursor, end: cursor + segLen, type: "bold" });
      }
      if (attrs["italic"] === true) {
        marks.push({ start: cursor, end: cursor + segLen, type: "italic" });
      }
      if (typeof attrs["link"] === "string") {
        marks.push({
          start: cursor,
          end: cursor + segLen,
          type: "link",
          url: attrs["link"] as string,
        });
      }
    }

    cursor += segLen;
  }

  return marks;
}

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

/**
 * Return the root meta Map. All scalars use LWW semantics (Loro map keys).
 * Writing is done directly on the returned LoroMap; no wrapper needed.
 */
export function getMetaMap(doc: LoroDoc): LoroMap {
  return doc.getMap("meta");
}

/**
 * Read all meta scalars out as a plain object.
 * Missing keys fall back to safe defaults so the caller never needs to
 * guard for undefined on every field.
 */
export function getMeta(doc: LoroDoc): NoteMetaPlain {
  const m = doc.getMap("meta");
  return {
    title:         (m.get("title")         as string)  ?? "",
    description:   (m.get("description")   as string)  ?? "",
    is_running_log:(m.get("is_running_log") as boolean) ?? false,
    created_at:    (m.get("created_at")    as string)  ?? "",
  };
}

// ---------------------------------------------------------------------------
// Entry helpers
// ---------------------------------------------------------------------------

/**
 * Return all entries as plain objects.
 *
 * The "content" field is the MARKDOWN string stored verbatim in the Loro Text
 * (the `**` / `*` / link syntax characters are IN the text, the same way the
 * live editor stores them). We read it directly with toString(); there is no
 * marks layer to re-render. See setEntryContent for why content is stored as
 * raw markdown rather than plain-text-plus-marks.
 */
export function listEntries(doc: LoroDoc): NoteEntryPlain[] {
  const list = doc.getMovableList("entries");
  const len = (list.toArray() as unknown[]).length;
  const results: NoteEntryPlain[] = [];

  for (let i = 0; i < len; i++) {
    const entryMap = list.get(i) as LoroMap;
    if (!entryMap) continue;

    // "content" is a nested LoroText; retrieve it via getOrCreateContainer
    // so the WASM boundary gives us the live container handle.
    const text = entryMap.getOrCreateContainer("content", new LoroText());

    results.push({
      id:         (entryMap.get("id")         as string) ?? "",
      title:      (entryMap.get("title")      as string) ?? "",
      date:       (entryMap.get("date")       as string) ?? "",
      created_at: (entryMap.get("created_at") as string) ?? "",
      updated_at: (entryMap.get("updated_at") as string) ?? "",
      content:    text.toString(),
    });
  }

  return results;
}

/**
 * Return the LoroText content container for the entry at the given list index.
 * Used by chunk 5's editor binding; caller must hold the doc open.
 *
 * Returns undefined if the index is out of range.
 */
export function getEntryContentText(
  doc: LoroDoc,
  index: number,
): LoroText | undefined {
  const list = doc.getMovableList("entries");
  const arr = list.toArray() as unknown[];
  if (index < 0 || index >= arr.length) return undefined;

  const entryMap = list.get(index) as LoroMap;
  if (!entryMap) return undefined;

  return entryMap.getOrCreateContainer("content", new LoroText());
}

/**
 * Set the full text content of an entry's content Text container.
 *
 * Stores the MARKDOWN string verbatim in the Loro Text (the `**` / `*` / link
 * syntax characters live IN the text). This matches how the live CodeMirror
 * editor stores content through loro-codemirror (the editor binds its markdown
 * document directly to the Loro Text), so every write path, seed, external
 * edit, restore, and live typing, agrees on one representation. We do NOT split
 * into plain-text-plus-Loro-marks: that produced a second, incompatible
 * representation (the editor re-seeds from text.toString(), which dropped the
 * marks, so a restore lost bold).
 */
export function setEntryContent(
  doc: LoroDoc,
  index: number,
  newContent: string,
): void {
  const text = getEntryContentText(doc, index);
  if (!text) return;
  // Replace the entire content in one operation (delete old + insert new),
  // keeping the markdown syntax characters in the text.
  text.update(newContent);
}

/**
 * Sync the note's NON-CONTENT metadata from the live Note into the CRDT doc.
 *
 * Phase 1 only binds the entry CONTENT text to the Loro editor; the note title,
 * description, is_running_log flag, and the per-entry title/date are still
 * edited through the legacy UI (the popup header, the entry tabs), not the Loro
 * editor. The CRDT was seeded with those values at creation and would otherwise
 * go stale, so projectToNote (which reads them from the doc) would overwrite a
 * legacy rename with the stale seeded value on the next content commit. Calling
 * this before each persist keeps the CRDT in step with those legacy edits.
 *
 * Entry CONTENT is owned by the editor binding and is deliberately NOT touched.
 * Writes are guarded so an unchanged field produces no redundant LWW op.
 *
 * Returns true if anything changed (so the caller can skip an empty commit).
 */
export function syncNoteMetadataToDoc(doc: LoroDoc, note: Note): boolean {
  let changed = false;
  const meta = doc.getMap("meta");

  const setMeta = (key: string, value: string | boolean) => {
    if (meta.get(key) !== value) {
      meta.set(key, value);
      changed = true;
    }
  };
  setMeta("title", note.title ?? "");
  setMeta("description", note.description ?? "");
  setMeta("is_running_log", note.is_running_log ?? false);

  const list = doc.getMovableList("entries");
  const len = (list.toArray() as unknown[]).length;
  const byId = new Map(note.entries.map((e) => [e.id, e]));
  for (let i = 0; i < len; i++) {
    const entryMap = list.get(i) as LoroMap;
    if (!entryMap) continue;
    const entry = byId.get(entryMap.get("id") as string);
    if (!entry) continue;
    const setEntry = (key: string, value: string) => {
      if (entryMap.get(key) !== value) {
        entryMap.set(key, value);
        changed = true;
      }
    };
    setEntry("title", entry.title ?? "");
    setEntry("date", entry.date ?? "");
    setEntry("updated_at", entry.updated_at ?? "");
  }

  return changed;
}

/**
 * Reconcile the doc's entries MovableList so it contains exactly the note's
 * entries (matched by id).
 *
 * Entry ADD / DELETE in a running-log note goes through the legacy UI, so a
 * newly-added entry is NOT in the Loro doc. The editor binds to an entry by
 * index, and binding to a missing entry crashes (getEntryContentText returns
 * undefined and the Loro sync plugin reads `.toString()` on it). This appends
 * any note entry missing from the doc (seeding its content from the note) and
 * removes any doc entry no longer in the note. Existing entries keep their Loro
 * Text + history. Reordering is not handled (running-log entries are append-
 * mostly); the editor binds by index, which stays aligned across append+delete.
 *
 * Returns true if the entry set changed (so the caller can skip an empty commit).
 */
export function syncEntrySet(doc: LoroDoc, note: Note): boolean {
  const list = doc.getMovableList("entries");
  const noteIds = new Set(note.entries.map((e) => e.id));
  let changed = false;

  // Remove doc entries no longer in the note. Walk backwards so deleting one
  // does not shift the indices we have yet to visit.
  for (let i = (list.toArray() as unknown[]).length - 1; i >= 0; i--) {
    const entryMap = list.get(i) as LoroMap;
    if (entryMap && !noteIds.has(entryMap.get("id") as string)) {
      list.delete(i, 1);
      changed = true;
    }
  }

  // Collect the ids the doc already has after the removal pass.
  const docIds = new Set<string>();
  const curLen = (list.toArray() as unknown[]).length;
  for (let i = 0; i < curLen; i++) {
    const entryMap = list.get(i) as LoroMap;
    if (entryMap) docIds.add(entryMap.get("id") as string);
  }

  // Append note entries the doc is missing, in note order, seeding content
  // (usually empty for a fresh entry) through the marks-aware path.
  for (const entry of note.entries) {
    if (docIds.has(entry.id)) continue;
    const idx = (list.toArray() as unknown[]).length;
    const entryMap = list.insertContainer(idx, new LoroMap());
    entryMap.set("id", entry.id);
    entryMap.set("title", entry.title ?? "");
    entryMap.set("date", entry.date ?? "");
    entryMap.set("created_at", entry.created_at ?? "");
    entryMap.set("updated_at", entry.updated_at ?? "");
    entryMap.setContainer("content", new LoroText());
    if (entry.content) {
      setEntryContent(doc, idx, entry.content);
    }
    changed = true;
  }

  return changed;
}
