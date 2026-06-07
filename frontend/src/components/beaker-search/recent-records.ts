// sequence editor master. BeakerSearch global object search, chunk 4, the PURE
// Recent-records MRU brain.
//
// The empty-query palette shows a short "Recent records" list, the last few core
// records the user opened through a global jump (decision 4). The list is a
// per-user localStorage MRU, client-only, survives reloads, never touches the
// data folder. This module is the pure list math (push + resolve); the React +
// localStorage wiring lives in the provider, so the dedup, the cap, and the
// stale-entry pruning are unit-tested without rendering (mirrors global-index.ts
// and global-source.ts).
//
// The MRU stores only a lightweight {type, key} REFERENCE, not a snapshot, so the
// rendered row re-resolves against the LIVE index every time, the label stays
// fresh after an edit, and a record that was deleted or unshared silently drops
// out (resolveRecentRefs returns only the refs still in the index).
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import type { GlobalIndexEntry } from "./global-index";
import type { GlobalObjectType } from "./global-source";

/** How many recent records the empty-query view shows (decision 4, the last ~5
 *  globally-opened core records). */
export const RECENT_RECORDS_CAP = 5;

/** The lightweight MRU reference, the composite identity of one core record. The
 *  pair re-resolves to a live GlobalIndexEntry; nothing else is persisted. */
export interface RecentRef {
  type: GlobalObjectType;
  key: string;
}

/** True when two refs point at the same record (same type and composite key). */
function sameRef(a: RecentRef, b: RecentRef): boolean {
  return a.type === b.type && a.key === b.key;
}

/** Push a just-opened record to the front of the MRU. The opened ref leads, any
 *  prior occurrence of the same record is removed (so a re-open promotes rather
 *  than duplicates), and the list is capped at `cap`. Pure, returns a new array,
 *  never mutates the input. */
export function pushRecentRef(
  list: RecentRef[],
  ref: RecentRef,
  cap: number = RECENT_RECORDS_CAP,
): RecentRef[] {
  const next = [ref, ...list.filter((r) => !sameRef(r, ref))];
  return next.slice(0, Math.max(0, cap));
}

/** Resolve the stored refs to LIVE index entries, dropping any no longer present
 *  (deleted, unshared, or not yet loaded), and preserving the MRU order. The
 *  index lookup is built once so a long MRU does not re-scan the index per ref. */
export function resolveRecentRefs(
  refs: RecentRef[],
  index: GlobalIndexEntry[],
): GlobalIndexEntry[] {
  const byComposite = new Map<string, GlobalIndexEntry>();
  for (const entry of index) byComposite.set(`${entry.type}:${entry.key}`, entry);
  const resolved: GlobalIndexEntry[] = [];
  for (const ref of refs) {
    const entry = byComposite.get(`${ref.type}:${ref.key}`);
    if (entry) resolved.push(entry);
  }
  return resolved;
}

/** Parse a persisted MRU blob into a clean RecentRef[], tolerating any malformed
 *  / legacy shape (a bad localStorage value yields an empty list, never a throw).
 *  Each entry must be an object with a string key and a known object type. */
export function parseRecentRefs(raw: string | null): RecentRef[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const known: ReadonlySet<string> = new Set([
    "task",
    "project",
    "method",
    "sequence",
  ]);
  const out: RecentRef[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { key?: unknown }).key === "string" &&
      typeof (item as { type?: unknown }).type === "string" &&
      known.has((item as { type: string }).type)
    ) {
      out.push({
        type: (item as { type: GlobalObjectType }).type,
        key: (item as { key: string }).key,
      });
    }
  }
  return out;
}
