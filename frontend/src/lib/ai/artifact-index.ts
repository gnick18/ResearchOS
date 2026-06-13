// BeakerBot cross-type artifact index (ai artifact-index bot, 2026-06-11).
//
// Layer 1 of the artifact-awareness stack. Builds a unified, in-memory index
// over ALL artifact types (notes, experiments, methods, sequences, Data Hub
// documents, projects, purchases, molecules) so BeakerBot can locate any piece
// of the user's work from a natural-language query. No index file is persisted,
// matching the Option A recommendation in the design doc: on every search the
// per-type list() APIs run concurrently, their results are mapped to compact
// ArtifactBriefs, and the resulting union is ranked and returned. That keeps
// the index always fresh, zero new storage, and zero write-path coupling.
//
// WHY on-demand union over a cached file: the per-type list() calls are already
// cheap metadata reads (no body deserialization). A flat list over all types
// stays fast at typical bench-science corpus sizes (hundreds, not millions, of
// notes and sequences). If a real user's corpus proves this too slow in
// practice, Option C (persisted file, lazy rebuild) is the documented upgrade
// path.
//
// WHY local scorer over embeddings: embeddings add a paid-tier dependency and
// a cloud round-trip for every search. A simple token-overlap scorer is
// instantaneous, free, and good enough for the "find my CRISPR cloning note"
// query that drives this feature. The design doc defers embeddings to the paid
// tier.
//
// Privacy note (from the design doc): only the small matched briefs (titles,
// ids, dates) reach the inference model, and only when a search runs. The
// corpus bodies never leave the device. The deepLink on each brief lets
// BeakerBot navigate or write a reference without further reads.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { objectDeepLink, methodRefId, type ObjectRefType } from "@/lib/references";
import { notesApi, methodsApi, sequencesApi, projectsApi, purchasesApi, fetchAllTasks } from "@/lib/local-api";
import { dataHubApi } from "@/lib/datahub/api";
import { moleculesApi } from "@/lib/chemistry/api";
import { phyloApi, type PhyloMeta } from "@/lib/phylo/api";
import type { Note } from "@/lib/types";
import type { Method } from "@/lib/types";
import type { SequenceRecord } from "@/lib/types";
import type { Project } from "@/lib/types";
import type { PurchaseItem } from "@/lib/types";
import type { Task } from "@/lib/types";
import { taskKey } from "@/lib/types";
import type { DataHubDocument } from "@/lib/datahub/model/types";
import type { Molecule } from "@/lib/chemistry/api";

// ---------------------------------------------------------------------------
// ArtifactBrief: the small, model-safe envelope for any artifact in the index.
// ---------------------------------------------------------------------------

/**
 * A small, model-safe envelope describing one artifact. The index holds
 * ONLY these briefs, never the artifact's body. The body is fetched lazily
 * by a Layer-2 read tool once the brief has been selected.
 *
 * type discriminants: "note" | "experiment" | "method" | "sequence" |
 *   "datahub" | "project" | "purchase" | "molecule"
 */
export type ArtifactBrief = {
  /** Discriminant for routing to the right Layer-2 read tool. */
  type: string;
  /** The artifact's stable id (numeric ids are stored as strings for uniformity). */
  id: string;
  /** The primary human-readable label shown in the index. */
  title: string;
  /** A short secondary label (project name, table type, vendor, ...). Optional. */
  subtitle?: string;
  /** ISO date string for the most recent edit or creation. Used for date-based ranking. */
  date?: string;
  /** Project ids this artifact belongs to (empty array when unlinked). */
  projectIds?: string[];
  /** The owning lab member's username, when the source record carries one (tasks,
   *  purchases). Set by the converters from the record's `owner` field so the
   *  per-member ("whose") summary filter can scope by owner WITHOUT re-reading the
   *  record. Absent on types with no owner concept (Data Hub tables, molecules in
   *  v1). The ACL is enforced upstream by the fetchAll*IncludingShared loaders, so
   *  an owner that appears here is one the current user is already allowed to see. */
  owner?: string;
  /** The in-app path that opens this artifact. Built by objectDeepLink where supported. */
  deepLink: string;
  /** Extra tokens beyond the title that improve search hit rate. Derived from a
   *  few salient fields, never from the full body. */
  keywords?: string[];
};

// ---------------------------------------------------------------------------
// Per-type adapters: pure functions that map a real API record to an ArtifactBrief.
// ---------------------------------------------------------------------------

/** Map one Note to an ArtifactBrief. Pure, no I/O. */
export function noteToBrief(note: Note): ArtifactBrief {
  const keywords: string[] = tokenize(note.title);
  if (note.description) keywords.push(...tokenize(note.description));
  // Surface entry titles as searchable keywords so "colony count" finds a note
  // whose ENTRY is titled "Colony count" even if the note itself is unnamed.
  for (const entry of note.entries ?? []) {
    keywords.push(...tokenize(entry.title));
  }
  return {
    type: "note",
    id: String(note.id),
    title: note.title || "Untitled note",
    date: note.updated_at,
    deepLink: objectDeepLink("note" as ObjectRefType, note.id),
    keywords: dedupe(keywords),
  };
}

/** Map one Task (experiment) to an ArtifactBrief. Pure, no I/O. */
export function experimentToBrief(task: Task): ArtifactBrief {
  const keywords: string[] = tokenize(task.name);
  if (task.tags) keywords.push(...task.tags.map((t) => t.toLowerCase()));
  // Use the composite taskKey as the deep-link id so shared experiments
  // resolve correctly in the popup host (same logic as the ?openTask= handler
  // on page.tsx). objectDeepLink("experiment", taskKey(task)) produces
  // /?openTask=<key>, which the root ObjectPopupHost resolves in place.
  return {
    type: "experiment",
    id: taskKey(task),
    title: task.name || "Untitled experiment",
    subtitle: task.is_complete ? "complete" : "active",
    date: task.start_date,
    projectIds: task.project_id ? [String(task.project_id)] : [],
    // Carry the owning member so the "whose" summary filter can scope to one
    // person. The shared-task loader backfills owner on every task it returns,
    // so this is the real owner the current user is allowed to see.
    owner: task.owner || undefined,
    deepLink: objectDeepLink("experiment", taskKey(task)),
    keywords: dedupe(keywords),
  };
}

/** Map one Method to an ArtifactBrief. Pure, no I/O. */
export function methodToBrief(method: Method): ArtifactBrief {
  const keywords: string[] = tokenize(method.name);
  if (method.tags) keywords.push(...method.tags.map((t) => t.toLowerCase()));
  if (method.method_type) keywords.push(method.method_type);
  if (method.excerpt) keywords.push(...tokenize(method.excerpt));
  // Public and private methods share a numeric id-space across separate stores,
  // so the deep link must mark the public scope (methodRefId prefixes "public:")
  // or a reference BeakerBot writes to a public method would resolve to a
  // same-id private one. The brief `id` stays the bare numeric id so the
  // read_method tool (which parses it as an integer) keeps working.
  return {
    type: "method",
    id: String(method.id),
    title: method.name || "Untitled method",
    subtitle: method.method_type ?? undefined,
    date: method.last_edited_at,
    deepLink: objectDeepLink("method" as ObjectRefType, methodRefId(method.id, !!method.is_public)),
    keywords: dedupe(keywords),
  };
}

/** Map one SequenceRecord to an ArtifactBrief. Pure, no I/O. */
export function sequenceToBrief(seq: SequenceRecord): ArtifactBrief {
  const keywords: string[] = tokenize(seq.display_name);
  if (seq.seq_type) keywords.push(seq.seq_type);
  if (seq.organism) keywords.push(...tokenize(seq.organism));
  if (seq.ncbi_accession) keywords.push(seq.ncbi_accession.toLowerCase());
  const circularLabel = seq.circular ? "circular" : "linear";
  keywords.push(circularLabel);
  return {
    type: "sequence",
    id: String(seq.id),
    title: seq.display_name || "Untitled sequence",
    subtitle: `${seq.seq_type} ${circularLabel} ${seq.length} bp`,
    date: seq.added_at,
    projectIds: seq.project_ids,
    deepLink: objectDeepLink("sequence" as ObjectRefType, seq.id),
    keywords: dedupe(keywords),
  };
}

/** Map one DataHubDocument to an ArtifactBrief. Pure, no I/O. */
export function dataHubToBrief(doc: DataHubDocument): ArtifactBrief {
  const keywords: string[] = tokenize(doc.name);
  if (doc.table_type) keywords.push(doc.table_type);
  return {
    type: "datahub",
    id: doc.id,
    title: doc.name || "Untitled table",
    subtitle: doc.table_type,
    date: doc.last_edited_at ?? doc.created_at,
    projectIds: doc.project_ids,
    deepLink: objectDeepLink("datahub" as ObjectRefType, doc.id),
    keywords: dedupe(keywords),
  };
}

/** Map one Project to an ArtifactBrief. Pure, no I/O. */
export function projectToBrief(project: Project): ArtifactBrief {
  const keywords: string[] = tokenize(project.name);
  if (project.tags) keywords.push(...project.tags.map((t) => t.toLowerCase()));
  if (project.color) keywords.push(project.color.toLowerCase());
  return {
    type: "project",
    id: String(project.id),
    title: project.name || "Untitled project",
    subtitle: project.is_archived ? "archived" : "active",
    date: project.last_edited_at ?? project.created_at,
    deepLink: objectDeepLink("project" as ObjectRefType, project.id),
    keywords: dedupe(keywords),
  };
}

/** Map one PurchaseItem to an ArtifactBrief. Pure, no I/O.
 *
 * The base PurchaseItem carries no `owner`, but the shared-view loader
 * (purchasesApi.listAllIncludingShared) decorates each item with `owner`, so the
 * parameter widens to accept that optional decoration and the brief carries the
 * owner through for the "whose" summary filter. */
export function purchaseToBrief(item: PurchaseItem & { owner?: string }): ArtifactBrief {
  const keywords: string[] = tokenize(item.item_name);
  if (item.vendor) keywords.push(...tokenize(item.vendor));
  if (item.category) keywords.push(...tokenize(item.category));
  if (item.cas) keywords.push(item.cas.toLowerCase());
  // Order status as a keyword so "ordered items" finds them.
  if (item.order_status) keywords.push(item.order_status);
  return {
    type: "purchase",
    id: String(item.id),
    title: item.item_name || "Untitled purchase",
    subtitle: item.vendor ?? item.category ?? undefined,
    // Purchase items have no purchase-date field, but they DO carry
    // last_edited_at once touched. Surface it as the brief date so a date-
    // windowed summary ("purchases this month") can place the item, and so the
    // search scorer has a real recency signal. A pre-feature purchase that was
    // never edited has no last_edited_at and stays dateless (so a date-bounded
    // search still drops it, the documented behavior).
    date: item.last_edited_at,
    owner: item.owner || undefined,
    deepLink: "/purchases",
    keywords: dedupe(keywords),
  };
}

/** Map one Molecule to an ArtifactBrief. Pure, no I/O. */
export function moleculeToBrief(mol: Molecule): ArtifactBrief {
  const keywords: string[] = tokenize(mol.name);
  if (mol.formula) keywords.push(mol.formula.toLowerCase());
  if (mol.inchikey) keywords.push(mol.inchikey.toLowerCase());
  if (mol.smiles) keywords.push(...tokenize(mol.smiles));
  if (mol.source) keywords.push(mol.source);
  return {
    type: "molecule",
    id: mol.id,
    title: mol.name || "Untitled molecule",
    subtitle: mol.formula ?? undefined,
    date: mol.added_at,
    projectIds: mol.project_ids,
    // The molecule deep-link is a real query-param route on /chemistry.
    // objectDeepLink("molecule", id) builds /chemistry?molecule=<id>.
    deepLink: objectDeepLink("molecule" as ObjectRefType, mol.id),
    keywords: dedupe(keywords),
  };
}

/** Map one saved phylogenetic tree (PhyloMeta) to an ArtifactBrief, so trees show
 *  up in search and the summaries like every other artifact. The deep link is the
 *  /phylo?doc=<id> Tree Studio route; the embed pipeline renders the card. Pure. */
export function phyloToBrief(meta: PhyloMeta): ArtifactBrief {
  const keywords: string[] = tokenize(meta.name);
  if (meta.format) keywords.push(String(meta.format).toLowerCase());
  return {
    type: "phylo",
    id: meta.id,
    title: meta.name || "Untitled tree",
    subtitle:
      typeof meta.tip_count === "number" ? `${meta.tip_count} tips` : undefined,
    date: meta.added_at,
    projectIds: meta.project_ids,
    deepLink: objectDeepLink("phylo" as ObjectRefType, meta.id),
    keywords: dedupe(keywords),
  };
}

// ---------------------------------------------------------------------------
// Helpers: tokenize and dedupe for keyword extraction.
// ---------------------------------------------------------------------------

/**
 * Split a string into lowercase word tokens for keyword extraction and scoring.
 * Strips punctuation, drops blanks, lowercases everything. Pure, no I/O.
 */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * The YYYY-MM-DD day prefix of a date-ish string, or null when it has no usable
 * leading ISO date. Used to compare a brief's date against a day-granular window
 * without timezone / time-of-day pitfalls. Pure, no I/O.
 */
export function dayPrefix(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Remove duplicate tokens while preserving order. Pure, no I/O. */
function dedupe(tokens: string[]): string[] {
  const seen = new Set<string>();
  return tokens.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Scorer: pure, local, token-overlap ranking.
// ---------------------------------------------------------------------------

/**
 * Score one brief against a set of query tokens. A higher number means a
 * better match. An empty token set returns 0 so all briefs rank equally and
 * the caller falls back to date ordering. Pure, no I/O.
 *
 * Weighting rationale (concept first):
 * - Title tokens carry the most signal. A brief whose title contains the
 *   exact query word is almost certainly what the user meant.
 * - Subtitle and keyword tokens are secondary. They let "colony count"
 *   surface a note whose ENTRY is titled "Colony count" even if the
 *   note-level title is "Week 3 growth assay".
 * - Each matched token contributes once (overlap count). We do not multiply
 *   by IDF because at bench-science corpus sizes the gain is not worth the
 *   complexity.
 */
export function scoreBrief(brief: ArtifactBrief, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;

  let score = 0;
  const titleTokens = tokenize(brief.title);
  const subtitleTokens = brief.subtitle ? tokenize(brief.subtitle) : [];
  const kwTokens = brief.keywords ?? [];

  for (const qt of queryTokens) {
    // Exact title token match (weight 4).
    if (titleTokens.includes(qt)) {
      score += 4;
      continue;
    }
    // Partial title token match (weight 2, e.g. "crispr" matches "crispr-cas9").
    if (titleTokens.some((tt) => tt.includes(qt) || qt.includes(tt))) {
      score += 2;
      continue;
    }
    // Subtitle or keyword match (weight 1).
    if (
      subtitleTokens.includes(qt) ||
      kwTokens.includes(qt) ||
      kwTokens.some((k) => k.includes(qt) || qt.includes(k))
    ) {
      score += 1;
    }
  }
  return score;
}

// ---------------------------------------------------------------------------
// Injectable deps seam (mirrors datahubAnalysisDeps in datahub-analysis.ts).
// ---------------------------------------------------------------------------

/**
 * The data-layer list functions the index depends on, injected so a test can
 * stub each type's list() with fixture records and never needs a real folder.
 * Production wires the real APIs via artifactIndexDeps below.
 */
export type ArtifactIndexDeps = {
  listNotes: () => Promise<Note[]>;
  listMethods: () => Promise<Method[]>;
  listSequences: () => Promise<SequenceRecord[]>;
  listDataHub: () => Promise<DataHubDocument[]>;
  listProjects: () => Promise<Project[]>;
  listPurchases: () => Promise<PurchaseItem[]>;
  listExperiments: () => Promise<Task[]>;
  listMolecules: () => Promise<Molecule[]>;
  listPhylo: () => Promise<PhyloMeta[]>;
};

export const artifactIndexDeps: ArtifactIndexDeps = {
  listNotes: () => notesApi.list(),
  listMethods: () => methodsApi.list(),
  listSequences: () => sequencesApi.list(),
  listDataHub: () => dataHubApi.list(),
  listProjects: () => projectsApi.list(),
  // purchasesApi has listAll (returns the current user's items). Experiments
  // are tasks with task_type "experiment", there is no dedicated experiments
  // API, so we read the full task list and filter.
  listPurchases: () => purchasesApi.listAll(),
  listExperiments: async () => {
    const all = await fetchAllTasks();
    return all.filter((t) => t.task_type === "experiment");
  },
  listMolecules: () => moleculesApi.list(),
  listPhylo: () => phyloApi.list(),
};

// ---------------------------------------------------------------------------
// searchMyWork: the main entry point for BeakerBot.
// ---------------------------------------------------------------------------

/**
 * Search the user's work across all artifact types, returning a ranked list of
 * ArtifactBriefs. BeakerBot calls this when the user refers to an artifact by
 * name and it is not already in the context line.
 *
 * How it works (concept first):
 * - All per-type list() calls run concurrently (Promise.allSettled). If one
 *   type's list() throws (a missing folder, a store error) that type's results
 *   are simply omitted so one failure cannot kill the whole search.
 * - Each result set is mapped to briefs via the per-type adapters above.
 * - Each brief is scored against the query tokens by scoreBrief.
 * - Briefs with score > 0 are sorted descending by score. Ties break on date
 *   (most-recent first). A blank query returns briefs sorted by date alone
 *   (a "what do I have?" list).
 * - Only the top `limit` briefs are returned (default 12). Small results protect
 *   the context window.
 *
 * @param query - Natural-language search string (e.g. "CRISPR cloning note").
 * @param opts.types - Optional filter to a subset of type discriminants.
 * @param opts.limit - Maximum number of results (default 12).
 * @param opts.since - Optional inclusive lower date bound (YYYY-MM-DD), day-
 *   granular; drops briefs edited / created before it and briefs with no date.
 * @param opts.until - Optional inclusive upper date bound (YYYY-MM-DD), day-
 *   granular; drops briefs after it and briefs with no date.
 * @param deps - Injectable seam for testing without a real folder.
 */
export async function searchMyWork(
  query: string,
  opts?: { types?: string[]; limit?: number; since?: string; until?: string },
  deps: ArtifactIndexDeps = artifactIndexDeps,
): Promise<ArtifactBrief[]> {
  const queryTokens = tokenize(query);
  const limit = opts?.limit ?? 12;
  const typeFilter = opts?.types && opts.types.length > 0 ? new Set(opts.types) : null;
  // Day-granular date window. Compare YYYY-MM-DD prefixes so a full ISO
  // timestamp ("2026-06-10T15:00:00Z") and a date-only value compare on the
  // same day, sidestepping timezone / time-of-day edge cases.
  const sinceDay = dayPrefix(opts?.since);
  const untilDay = dayPrefix(opts?.until);
  const hasDateBound = sinceDay !== null || untilDay !== null;
  const inDateWindow = (brief: ArtifactBrief): boolean => {
    if (!hasDateBound) return true;
    const day = dayPrefix(brief.date);
    // A brief with no usable date cannot be placed in a window, so a date-
    // bounded search excludes it rather than guessing.
    if (day === null) return false;
    if (sinceDay !== null && day < sinceDay) return false;
    if (untilDay !== null && day > untilDay) return false;
    return true;
  };

  // Run all list() calls concurrently. Per-type failure is silently skipped.
  const [
    notesResult,
    methodsResult,
    sequencesResult,
    dataHubResult,
    projectsResult,
    purchasesResult,
    experimentsResult,
    moleculesResult,
    phyloResult,
  ] = await Promise.allSettled([
    deps.listNotes(),
    deps.listMethods(),
    deps.listSequences(),
    deps.listDataHub(),
    deps.listProjects(),
    deps.listPurchases(),
    deps.listExperiments(),
    deps.listMolecules(),
    deps.listPhylo(),
  ]);

  // Collect all briefs from settled (fulfilled) results.
  const allBriefs: ArtifactBrief[] = [];

  function addBriefs<T>(
    result: PromiseSettledResult<T[]>,
    toBrief: (item: T) => ArtifactBrief,
    typeName: string,
  ): void {
    if (result.status === "rejected") {
      // One type's failure is silently skipped. The search continues with the
      // remaining types so a missing molecule store does not break note search.
      return;
    }
    const filtered =
      typeFilter && !typeFilter.has(typeName)
        ? []
        : result.value;
    for (const item of filtered) {
      try {
        allBriefs.push(toBrief(item));
      } catch {
        // Adapter failure on one record is skipped so a corrupt record does
        // not block the rest of the type.
      }
    }
  }

  addBriefs(notesResult, noteToBrief, "note");
  addBriefs(methodsResult, methodToBrief, "method");
  addBriefs(sequencesResult, sequenceToBrief, "sequence");
  addBriefs(dataHubResult, dataHubToBrief, "datahub");
  addBriefs(projectsResult, projectToBrief, "project");
  addBriefs(purchasesResult, purchaseToBrief, "purchase");
  addBriefs(experimentsResult, experimentToBrief, "experiment");
  addBriefs(moleculesResult, moleculeToBrief, "molecule");
  addBriefs(phyloResult, phyloToBrief, "phylo");

  // Apply the optional date window before scoring, so a "from last week" search
  // ranks only the in-window briefs (and never spends a result slot on one that
  // falls outside it).
  const windowed = hasDateBound ? allBriefs.filter(inDateWindow) : allBriefs;

  // Score and sort. An empty query returns all briefs sorted by date (most
  // recent first), so the model can answer "what do I have?" cheaply.
  const scored = windowed.map((brief) => ({
    brief,
    score: scoreBrief(brief, queryTokens),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Break ties by most-recent date.
    const da = a.brief.date ?? "";
    const db = b.brief.date ?? "";
    return db.localeCompare(da);
  });

  return scored.slice(0, limit).map((s) => s.brief);
}

// ---------------------------------------------------------------------------
// filterArtifacts (Layer 1 of the summary suite): a pure, shared filter over
// ArtifactBriefs. The summary tools convert their records to briefs, run this
// filter, then aggregate the survivors deterministically. The cross-type index
// work (project_beakerbot_context_index Layers 1+2) reuses the same filter, so
// it is built once here.
// ---------------------------------------------------------------------------

/**
 * The shared filter the summary tools (and the future cross-type index) apply
 * to a list of ArtifactBriefs. Every field is optional and ANDs with the rest,
 * so an empty filter keeps everything. A field with an empty array also keeps
 * everything for that dimension (an empty `types: []` is "no type restriction",
 * not "match nothing"), so a caller never has to special-case the empty case.
 *
 * - `types`: which artifact kinds to keep (the brief.type discriminants).
 * - `since` / `until`: inclusive, day-granular date window (compared with
 *   dayPrefix, exactly like searchMyWork). A brief with no usable date is
 *   dropped by a date-bounded filter, because it cannot be placed in the window.
 * - `owners`: which lab members to keep, matched on brief.owner. A brief with
 *   no owner is dropped when an owners filter is present. The owners themselves
 *   come from records the current user is already allowed to see (the
 *   fetchAll*IncludingShared loaders enforce the ACL upstream), so this never
 *   widens access, it only narrows an already-permitted set.
 * - `projectIds`: which projects to keep, matched on brief.projectIds (a brief
 *   in ANY of the listed projects survives). A brief with no projectIds is
 *   dropped when a project filter is present.
 * - `status`: a per-type status label to keep. v1 understands the experiment
 *   statuses ("complete" / "active") that experimentToBrief writes into
 *   brief.subtitle; an unrecognized status simply matches the subtitle string.
 *   The summarize tools own the richer overdue / upcoming derivation against the
 *   real Date, so the filter stays simple here.
 * - `keywords`: a free-text token query scored by the existing scoreBrief. A
 *   brief survives when it scores above zero. An empty / whitespace keyword
 *   string is treated as no keyword restriction.
 */
export type ArtifactFilter = {
  types?: string[];
  since?: string;
  until?: string;
  owners?: string[];
  projectIds?: string[];
  status?: string;
  keywords?: string;
};

/**
 * Apply an ArtifactFilter to a list of briefs. Pure, no I/O, fully deterministic.
 * Returns a NEW array of the briefs that pass every active dimension. The order
 * of the input is preserved (the summary tools re-sort by date themselves).
 *
 * This is the single source of truth for "which records are in scope" across the
 * summary tools. The tools then COUNT and TOTAL the survivors, never the model.
 */
export function filterArtifacts(
  items: ArtifactBrief[],
  filter: ArtifactFilter,
): ArtifactBrief[] {
  const typeSet =
    filter.types && filter.types.length > 0 ? new Set(filter.types) : null;
  const ownerSet =
    filter.owners && filter.owners.length > 0 ? new Set(filter.owners) : null;
  const projectSet =
    filter.projectIds && filter.projectIds.length > 0
      ? new Set(filter.projectIds.map((p) => String(p)))
      : null;
  const sinceDay = dayPrefix(filter.since);
  const untilDay = dayPrefix(filter.until);
  const hasDateBound = sinceDay !== null || untilDay !== null;
  const statusWanted = filter.status?.trim().toLowerCase() || null;
  const keywordTokens = tokenize(filter.keywords);
  const hasKeywords = keywordTokens.length > 0;

  return items.filter((brief) => {
    // Type.
    if (typeSet && !typeSet.has(brief.type)) return false;

    // Owner. A brief with no owner cannot satisfy a member filter.
    if (ownerSet) {
      if (!brief.owner || !ownerSet.has(brief.owner)) return false;
    }

    // Project. The brief survives when it is in ANY of the requested projects.
    if (projectSet) {
      const ids = brief.projectIds ?? [];
      if (ids.length === 0) return false;
      if (!ids.some((id) => projectSet.has(String(id)))) return false;
    }

    // Date window. Day-granular, inclusive. A brief with no usable date is
    // excluded by a date-bounded filter rather than guessed into the window.
    if (hasDateBound) {
      const day = dayPrefix(brief.date);
      if (day === null) return false;
      if (sinceDay !== null && day < sinceDay) return false;
      if (untilDay !== null && day > untilDay) return false;
    }

    // Status. Matched against the brief's subtitle string (where
    // experimentToBrief writes "complete" / "active"). Case-insensitive.
    if (statusWanted) {
      const sub = (brief.subtitle ?? "").toLowerCase();
      if (!sub.includes(statusWanted)) return false;
    }

    // Keywords. Token-overlap via the shared scorer; survives when score > 0.
    if (hasKeywords) {
      if (scoreBrief(brief, keywordTokens) <= 0) return false;
    }

    return true;
  });
}
