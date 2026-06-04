// Bulk-select model for the /trash page (2026-06-04). Trash ids can
// COLLIDE across entity types, so every selectable row is keyed by a
// composite `${entity_type}:${id}` string. These helpers are pure so the
// selection logic stays unit-testable independent of React.

import type { TrashEntityType, TrashIndexEntry } from "@/lib/trash";

/** Composite selection key for a trashed entry. Ids alone are not unique
 *  across entity types, so we namespace by `entity_type`. */
export function selectionKey(
  entityType: TrashEntityType,
  id: string | number,
): string {
  return `${entityType}:${id}`;
}

/** Composite key for a full entry. */
export function entryKey(entry: TrashIndexEntry): string {
  return selectionKey(entry.entity_type, entry.id);
}

/** Toggle a single key in the selection set, returning a NEW set (the
 *  caller never mutates the previous state in place). */
export function toggleKey(selected: Set<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

/** Add every key to the selection (used by per-section select-all when
 *  the section is not already fully selected). */
export function addKeys(
  selected: Set<string>,
  keys: Iterable<string>,
): Set<string> {
  const next = new Set(selected);
  for (const k of keys) next.add(k);
  return next;
}

/** Remove every key from the selection (per-section deselect-all). */
export function removeKeys(
  selected: Set<string>,
  keys: Iterable<string>,
): Set<string> {
  const next = new Set(selected);
  for (const k of keys) next.delete(k);
  return next;
}

/** The tri-state of a section's select-all control given how many of its
 *  rows are currently selected. */
export type SectionSelectState = "none" | "some" | "all";

/** Compute the select-all state for one section. "some" maps to the
 *  checkbox indeterminate flag in the UI. An empty section reads "none". */
export function sectionSelectState(
  selected: Set<string>,
  sectionEntries: TrashIndexEntry[],
): SectionSelectState {
  if (sectionEntries.length === 0) return "none";
  let hit = 0;
  for (const entry of sectionEntries) {
    if (selected.has(entryKey(entry))) hit += 1;
  }
  if (hit === 0) return "none";
  if (hit === sectionEntries.length) return "all";
  return "some";
}

/** Flip a whole section: if every row is already selected, clear them;
 *  otherwise select them all. Returns a NEW set. */
export function toggleSection(
  selected: Set<string>,
  sectionEntries: TrashIndexEntry[],
): Set<string> {
  const keys = sectionEntries.map(entryKey);
  return sectionSelectState(selected, sectionEntries) === "all"
    ? removeKeys(selected, keys)
    : addKeys(selected, keys);
}

/** Drop any selected keys that no longer correspond to a live entry
 *  (after a bulk action removes rows). Keeps the selection set from
 *  retaining stale keys. */
export function pruneSelection(
  selected: Set<string>,
  liveEntries: TrashIndexEntry[],
): Set<string> {
  if (selected.size === 0) return selected;
  const live = new Set(liveEntries.map(entryKey));
  const next = new Set<string>();
  for (const k of selected) {
    if (live.has(k)) next.add(k);
  }
  return next;
}

/** Resolve the selected keys back into the entries they reference, in the
 *  order they appear in `entries`. Used to drive bulk restore / delete. */
export function selectedEntries(
  selected: Set<string>,
  entries: TrashIndexEntry[],
): TrashIndexEntry[] {
  return entries.filter((e) => selected.has(entryKey(e)));
}
