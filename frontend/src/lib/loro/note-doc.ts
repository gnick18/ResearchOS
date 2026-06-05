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
 * The "content" field is returned as MARKDOWN (not plain text): marks stored
 * in the Loro Text are re-rendered back to bold/italic/link control characters
 * via renderMarkdownInline so callers and the readable mirror see standard
 * markdown strings.  Block-level markdown (headings, lists, fences) was never
 * stripped, so it round-trips transparently.
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

    // Read the rich-text delta to recover both the plain text and its marks.
    const delta = text.toDelta() as Delta<string>[];
    const plain = delta
      .filter((s): s is { insert: string } => "insert" in s && typeof s.insert === "string")
      .map((s) => s.insert)
      .join("");

    const marks = deltaToMarks(delta);
    const markdown = renderMarkdownInline(plain, marks);

    results.push({
      id:         (entryMap.get("id")         as string) ?? "",
      title:      (entryMap.get("title")      as string) ?? "",
      date:       (entryMap.get("date")       as string) ?? "",
      created_at: (entryMap.get("created_at") as string) ?? "",
      updated_at: (entryMap.get("updated_at") as string) ?? "",
      content:    markdown,
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
 * Accepts a MARKDOWN string. Splits the incoming markdown into plain text
 * and inline marks, clears the current Text content, inserts the plain text,
 * then re-applies marks as Loro text marks.
 *
 * The doc must have had configureTextStyles() called before any mark() call.
 * This function calls configureTextStyles() defensively so the caller does not
 * need to track whether it has been done.
 */
export function setEntryContent(
  doc: LoroDoc,
  index: number,
  newContent: string,
): void {
  const text = getEntryContentText(doc, index);
  if (!text) return;

  // Ensure mark styles are registered on this doc.
  configureTextStyles(doc);

  const { text: plain, marks } = splitMarkdownInline(newContent);

  // Replace the entire content in one operation: delete old + insert new.
  // LoroText.update() does this atomically (it diffed internally to minimize ops,
  // but for deterministic seeding we use it only on live edits, not in seed.ts).
  text.update(plain);

  // Remove any existing marks by unmarking the full range, then re-apply.
  // This handles the case where the caller sets content on a pre-marked Text.
  const currentLen = text.toString().length;
  if (currentLen > 0) {
    // Unmark the full span for each key we manage, so stale marks are cleared.
    // Loro unmark() is a no-op if no mark exists for that key.
    text.unmark({ start: 0, end: currentLen }, "bold");
    text.unmark({ start: 0, end: currentLen }, "italic");
    text.unmark({ start: 0, end: currentLen }, "link");
  }

  for (const mark of marks) {
    if (mark.type === "bold") {
      text.mark({ start: mark.start, end: mark.end }, "bold", true);
    } else if (mark.type === "italic") {
      text.mark({ start: mark.start, end: mark.end }, "italic", true);
    } else if (mark.type === "link") {
      text.mark({ start: mark.start, end: mark.end }, "link", mark.url ?? "");
    }
  }
}
