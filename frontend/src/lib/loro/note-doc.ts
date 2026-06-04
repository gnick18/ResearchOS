/**
 * Loro document schema for a single ResearchOS note.
 *
 * Layout (locked by Phase 1 design doc):
 *   root Map   "meta"    -- LWW scalars: title, description, is_running_log, created_at
 *   root Movable List  "entries"  -- each element is a child LoroMap holding entry fields,
 *                                    with a nested LoroText container keyed "content"
 *
 * One doc per note; entries are Movable so reordering is a first-class CRDT op.
 */

import { LoroDoc, LoroMap, LoroText } from "loro-crdt";

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
 * Each list element is a LoroMap. The "content" key holds a nested LoroText
 * whose string value we unwrap here. All other fields are LWW scalars.
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
 * Replaces whatever is currently there in one update operation.
 * Exposed for chunk 5's editor binding; do not call from tests that
 * only need to read seeded content.
 */
export function setEntryContent(
  doc: LoroDoc,
  index: number,
  newContent: string,
): void {
  const text = getEntryContentText(doc, index);
  if (!text) return;
  text.update(newContent);
}
