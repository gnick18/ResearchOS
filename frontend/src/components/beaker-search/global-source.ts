// sequence editor master (chunk 2 sub-bot). BeakerSearch global object search,
// chunk 2, the PURE ranking + grouping brain for the cross-app NAVIGATE source.
//
// rankGlobalEntries takes the flat GlobalIndexEntry[] from chunk 1, a query,
// and the active user's clock (now), and returns the ranked, capped, per-type
// groups the provider feeds into the palette. It is pure, no React, no
// Date.now(), no DOM, so the ranking rule (decision 7), the caps, and the type
// weights are unit-tested without rendering (mirrors global-index.test.ts and
// editor-commands.ts).
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

import MiniSearch from "minisearch";
import { fuzzyScore } from "@/components/sequences/editor-commands";
import type { GlobalIndexEntry } from "./global-index";

/** The object type a GlobalIndexEntry carries, the de-dup and grouping key. */
export type GlobalObjectType = GlobalIndexEntry["type"];

/** The per-type additive nudge on top of the raw fuzzy score (decision 7). Task
 *  +3 > Project +2 > Sequence +1 > Method +0 > Inventory +0. New coverage-gap
 *  types (Data Hub, Molecules, Purchases) get a low nudge (0) so they appear
 *  alongside Methods and Inventory rather than crowding core types. Tunable. */
const TYPE_WEIGHT: Record<GlobalObjectType, number> = {
  task: 3,
  project: 2,
  note: 1,
  sequence: 1,
  method: 0,
  inventory: 0,
  datahub: 0,
  molecule: 0,
  purchase: 0,
  phylo: 0,
};

/** Per-type cap, at most 5 results of any one type, so one prolific type cannot
 *  crowd out the others (mirrors RECENT_RESULTS_CAP). */
export const GLOBAL_PER_TYPE_CAP = 5;

/** Overall cap, at most 12 global-object results across all types at once. The
 *  palette is now the full search surface (the old "Search everything" handoff
 *  to the retired /search page is gone), so the per-type + overall caps keep
 *  the inline list tight; the per-type "show all of this kind" affordance picks
 *  up any long tail. */
export const GLOBAL_OVERALL_CAP = 12;

/** Milliseconds in one week, for the recency boost. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The group order the object types print in when none holds the top hit,
 *  matching the per-type weight (most-opened first). The provider can still lead
 *  with the group that holds the single best hit (the existing palette rule).
 *  New coverage-gap types trail the core six. */
export const GLOBAL_TYPE_ORDER: GlobalObjectType[] = [
  "task",
  "project",
  "note",
  "sequence",
  "method",
  "inventory",
  "datahub",
  "molecule",
  "purchase",
  "phylo",
];

/** The display heading for each object type's group. */
export const GLOBAL_TYPE_TITLE: Record<GlobalObjectType, string> = {
  task: "Tasks",
  project: "Projects",
  note: "Notes",
  sequence: "Sequences",
  method: "Methods",
  inventory: "Inventory",
  datahub: "Data Hub",
  molecule: "Molecules",
  purchase: "Purchases",
  phylo: "Trees",
};

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

/** A globally-unique index id for an entry. The entry `key` is unique only
 *  within a type (a task and a method could share an "{owner}:{id}" key), so the
 *  MiniSearch id folds the type in. */
function iidOf(entry: GlobalIndexEntry): string {
  return `${entry.type}::${entry.key}`;
}

// ── Additive fuzzy pass (typo + OCR tolerance) ───────────────────────────────
// A MiniSearch inverted index gives genuine edit-distance + prefix matching the
// strict subsequence pass cannot. It runs as a SECOND tier ranked below every
// strict hit (see rankGlobalEntries), so existing results never move, only extra
// typo/OCR matches are appended. The index is memoized by the entries array
// identity, so it rebuilds on a data change, not per keystroke. Module-level
// cache in an otherwise-pure file, a deterministic perf cache keyed by identity.
let cachedEntries: GlobalIndexEntry[] | null = null;
let cachedIndex: MiniSearch | null = null;
let cachedByIid: Map<string, GlobalIndexEntry> | null = null;

function getFuzzyIndex(entries: GlobalIndexEntry[]): MiniSearch | null {
  if (cachedEntries === entries && cachedIndex) return cachedIndex;
  try {
    const byIid = new Map<string, GlobalIndexEntry>();
    const docs = entries.map((e) => {
      const iid = iidOf(e);
      byIid.set(iid, e);
      // `ocr` is the scanned-handwriting text (present once notes join the
      // index); absent on the core record types, indexed as empty.
      return {
        iid,
        label: e.label,
        haystack: e.haystack,
        ocr: (e as { ocr?: string }).ocr ?? "",
      };
    });
    const ms = new MiniSearch({
      idField: "iid",
      fields: ["label", "haystack", "ocr"],
      // fuzzy 0.3 catches ~2-edit OCR garble (cyels -> cycles) without flagging
      // short words; prefix matches partial typing; the name field is boosted so
      // a name hit outranks a body/ocr hit within the fuzzy tier.
      searchOptions: { fuzzy: 0.3, prefix: true, boost: { label: 3, haystack: 1, ocr: 1 } },
    });
    ms.addAll(docs);
    cachedEntries = entries;
    cachedIndex = ms;
    cachedByIid = byIid;
    return ms;
  } catch {
    cachedEntries = null;
    cachedIndex = null;
    cachedByIid = null;
    return null;
  }
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
 *  Date.now(); tests pass a fixed epoch). */
export interface RankGlobalOptions {
  now: number;
}

/** Rank the index against the query and return the per-type object groups.
 *
 *  Empty query => no groups at all (the global source contributes nothing to the
 *  empty view here; the Recent-records MRU is chunk 4). Non-empty query => every
 *  entry is scored, null-fuzzyScore entries are dropped, the survivors are sorted
 *  best-first, each type is capped at 5, then the whole set is capped at 12
 *  overall while keeping the best-scored entries. Groups print in
 *  GLOBAL_TYPE_ORDER; the provider applies the existing "lead with the top hit's
 *  group" rule on the merged list. */
export function rankGlobalEntries(
  entries: GlobalIndexEntry[],
  query: string,
  options: RankGlobalOptions,
): GlobalObjectGroup[] {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  const { now } = options;

  // 1. Score + drop non-matches. These are the STRICT (subsequence) matches.
  const scored: Array<{ entry: GlobalIndexEntry; score: number; strict: boolean }> = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const score = scoreGlobalEntry(trimmed, entry, now);
    if (score != null) {
      scored.push({ entry, score, strict: true });
      seen.add(iidOf(entry));
    }
  }

  // 1b. Additive fuzzy pass. MiniSearch contributes the edit-distance / prefix
  //     matches the strict pass missed (typos, OCR garble), each only if not
  //     already a strict hit. Tagged strict:false so they rank as a tier BELOW
  //     every strict hit. Wrapped so a failure leaves the strict-only result
  //     exactly as before.
  const fuzzy = getFuzzyIndex(entries);
  if (fuzzy && cachedByIid) {
    try {
      for (const hit of fuzzy.search(trimmed)) {
        const entry = cachedByIid.get(hit.id as string);
        if (!entry) continue;
        const iid = iidOf(entry);
        if (seen.has(iid)) continue;
        scored.push({ entry, score: hit.score, strict: false });
        seen.add(iid);
      }
    } catch {
      // keep the strict-only result
    }
  }

  // 2. Sort: strict tier first (existing best-first order preserved exactly),
  //    fuzzy tier below it (best-first by MiniSearch score). Keeping the tiers
  //    separate means a typo match can never outrank an exact match.
  scored.sort((a, b) => {
    if (a.strict !== b.strict) return a.strict ? -1 : 1;
    return b.score - a.score;
  });

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
