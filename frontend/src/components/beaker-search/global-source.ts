// sequence editor master (chunk 2 sub-bot). BeakerSearch global object search,
// chunk 2, the PURE ranking + grouping brain for the cross-app NAVIGATE source.
//
// rankGlobalEntries takes the flat GlobalIndexEntry[] from chunk 1, a query, the
// active user's clock (now), and the active page's own type, and returns the
// ranked, capped, per-type groups the provider feeds into the palette. It is
// pure, no React, no Date.now(), no DOM, so the ranking rule (decision 7), the
// caps, and the on-page de-dup are unit-tested without rendering (mirrors
// global-index.test.ts and editor-commands.ts).
//
// The score (decision 7), score = fuzzyScore(query, entry.haystack) + a per-type
// nudge (Task +3 > Project +2 > Sequence +1 > Method +0) + a recency boost
// +min(4, weeksFreshness) from entry.recencyAt. Entries fuzzyScore returns null
// for (no match) are dropped. The fuzzy score dominates; the nudges only break
// near-ties. Reuses the existing fuzzyScore, no second matcher.
//
// The caps (decision, doc 4.3), at most 5 per type, then at most 12 overall after
// ranking across all types. The on-page de-dup (doc 5.5), the group for the active
// page's own type is dropped (the page source already surfaces those records with
// richer rows). Empty query yields no groups (the MRU is chunk 4, not here).
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { fuzzyScore } from "@/components/sequences/editor-commands";
import type { GlobalIndexEntry } from "./global-index";

/** The object type a GlobalIndexEntry carries, the de-dup and grouping key. */
export type GlobalObjectType = GlobalIndexEntry["type"];

/** The per-type additive nudge on top of the raw fuzzy score (decision 7). Task
 *  +3 > Project +2 > Sequence +1 > Method +0, so for an otherwise equal name
 *  match the more-opened type wins. Tunable constants in one place. */
const TYPE_WEIGHT: Record<GlobalObjectType, number> = {
  task: 3,
  project: 2,
  sequence: 1,
  method: 0,
};

/** Per-type cap, at most 5 results of any one type, so one prolific type cannot
 *  crowd out the others (mirrors RECENT_RESULTS_CAP). */
export const GLOBAL_PER_TYPE_CAP = 5;

/** Overall cap, at most 12 global-object results across all types at once (the
 *  long tail is the "Search everything" handoff to /search, chunk 3). */
export const GLOBAL_OVERALL_CAP = 12;

/** Milliseconds in one week, for the recency boost. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The group order the four object types print in when none holds the top hit,
 *  matching the per-type weight (most-opened first). The provider can still lead
 *  with the group that holds the single best hit (the existing palette rule). */
export const GLOBAL_TYPE_ORDER: GlobalObjectType[] = [
  "task",
  "project",
  "sequence",
  "method",
];

/** The display heading for each object type's group. */
export const GLOBAL_TYPE_TITLE: Record<GlobalObjectType, string> = {
  task: "Tasks",
  project: "Projects",
  sequence: "Sequences",
  method: "Methods",
};

/** Map a route pathname to the object type the page hosts as its primary entity,
 *  so the global group for that type is suppressed (doc 5.5, on-page de-dup). The
 *  page source already surfaces those records with richer, action-bearing rows.
 *
 *  /methods -> method, /sequences -> sequence, the home page plus /workbench /
 *  /gantt / /purchases all host tasks (the openTask handler / task containers) ->
 *  task. /workbench/projects/<id> is a single project's page, so a project there
 *  is the page's own context -> project. Any other route hosts none of the four,
 *  so nothing is suppressed (returns null). */
export function activePageTypeForPath(
  pathname: string | null | undefined,
): GlobalObjectType | null {
  if (!pathname) return null;
  // Strip a trailing slash and the query / hash (defensive, pathname is path
  // only, but a caller passing a fuller string still resolves cleanly).
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/methods" || path.startsWith("/methods/")) return "method";
  if (path === "/sequences" || path.startsWith("/sequences/")) return "sequence";
  // A single project's page is project context; check it BEFORE the bare
  // /workbench task mapping so the deeper route wins.
  if (path.startsWith("/workbench/projects/")) return "project";
  if (path === "/" ) return "task";
  if (path === "/workbench" || path.startsWith("/workbench/")) return "task";
  if (path === "/gantt" || path.startsWith("/gantt/")) return "task";
  if (path === "/purchases" || path.startsWith("/purchases/")) return "task";
  return null;
}

/** The recency boost for an entry, +min(4, weeksFreshness) from entry.recencyAt
 *  against `now` (epoch ms). A record with no stamp (recencyAt 0) or a future
 *  stamp gets +0, capped at +4 so a freshly-touched record edges out a stale
 *  same-name one without letting recency override relevance. */
function recencyBoost(recencyAt: number, now: number): number {
  if (!recencyAt || recencyAt <= 0) return 0;
  const ageMs = now - recencyAt;
  if (ageMs <= 0) return 4; // touched at or after `now`, freshest possible.
  const weeksFreshness = Math.max(0, 4 - ageMs / WEEK_MS);
  return Math.min(4, weeksFreshness);
}

/** The full ranked score for one entry against the query at time `now`. The raw
 *  fuzzy score over the precomputed haystack, plus the type nudge, plus the
 *  recency boost. Returns null when fuzzyScore returns null (no match), so the
 *  caller drops it. Pure, takes `now` so it is testable without Date.now(). */
export function scoreGlobalEntry(
  query: string,
  entry: GlobalIndexEntry,
  now: number,
): number | null {
  const base = fuzzyScore(query, entry.haystack);
  if (base == null) return null;
  return base + TYPE_WEIGHT[entry.type] + recencyBoost(entry.recencyAt, now);
}

/** One ranked, capped group of object entries the palette renders under a single
 *  per-type heading. `type` is the de-dup / grouping key, `title` the heading,
 *  `entries` are best-first and already capped at GLOBAL_PER_TYPE_CAP. */
export interface GlobalObjectGroup {
  type: GlobalObjectType;
  title: string;
  entries: GlobalIndexEntry[];
}

/** Options for rankGlobalEntries. `now` is the live clock (the caller passes
 *  Date.now(); tests pass a fixed epoch). `activePageType` is the page's own
 *  type, whose group is suppressed (doc 5.5); null suppresses nothing. */
export interface RankGlobalOptions {
  now: number;
  activePageType: GlobalObjectType | null;
}

/** Rank the index against the query and return the per-type object groups.
 *
 *  Empty query => no groups at all (the global source contributes nothing to the
 *  empty view here; the Recent-records MRU is chunk 4). Non-empty query => every
 *  entry is scored, null-fuzzyScore entries are dropped, the survivors are sorted
 *  best-first, the active page's own type is dropped (doc 5.5), each type is
 *  capped at 5, then the whole set is capped at 12 overall while keeping the
 *  best-scored entries (so a 12-cut never silently keeps a weaker entry over a
 *  stronger one of another type). Groups print in GLOBAL_TYPE_ORDER; the provider
 *  applies the existing "lead with the top hit's group" rule on the merged list. */
export function rankGlobalEntries(
  entries: GlobalIndexEntry[],
  query: string,
  options: RankGlobalOptions,
): GlobalObjectGroup[] {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  const { now, activePageType } = options;

  // 1. Score + drop non-matches + drop the active page's own type.
  const scored: Array<{ entry: GlobalIndexEntry; score: number }> = [];
  for (const entry of entries) {
    if (activePageType != null && entry.type === activePageType) continue;
    const score = scoreGlobalEntry(trimmed, entry, now);
    if (score != null) scored.push({ entry, score });
  }

  // 2. Sort best-first globally so both caps keep the strongest entries.
  scored.sort((a, b) => b.score - a.score);

  // 3. Per-type cap (at most 5 of any one type) AND overall cap (at most 12),
  //    walking the globally-sorted list so the survivors are the top-scored set
  //    that still honors the per-type ceiling.
  const perTypeCount = new Map<GlobalObjectType, number>();
  const kept: Array<{ entry: GlobalIndexEntry; score: number }> = [];
  for (const s of scored) {
    if (kept.length >= GLOBAL_OVERALL_CAP) break;
    const count = perTypeCount.get(s.entry.type) ?? 0;
    if (count >= GLOBAL_PER_TYPE_CAP) continue;
    perTypeCount.set(s.entry.type, count + 1);
    kept.push(s);
  }

  // 4. Bucket the survivors by type, preserving the best-first order within each
  //    bucket, and print the buckets in GLOBAL_TYPE_ORDER (an empty type drops).
  const groups: GlobalObjectGroup[] = [];
  for (const type of GLOBAL_TYPE_ORDER) {
    const inType = kept.filter((s) => s.entry.type === type).map((s) => s.entry);
    if (inType.length > 0) {
      groups.push({ type, title: GLOBAL_TYPE_TITLE[type], entries: inType });
    }
  }
  return groups;
}
