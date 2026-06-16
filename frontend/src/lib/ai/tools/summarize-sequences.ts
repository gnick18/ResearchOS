// BeakerBot summarize_sequences tool (BeakerAI lane, 2026-06-16).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md), the
// sequence-library analog of summarize_experiments / summarize_inventory. A
// read-only tool that aggregates the user's SEQUENCE LIBRARY (the plasmids,
// primers, genomic, and protein records) and hands the model a compact, structured
// tally, so the model can write one grounded "state of the cloning bench" narrative.
//
// THE HARD RULE: the TOOL computes every count, every total, and every bucket
// DETERMINISTICALLY in TypeScript. The model NEVER counts a sequence, sums bases,
// or decides a type. It only relays the aggregate this tool returns and never
// interprets it into a scientific claim.
//
// REAL FIELDS (verified against types.ts SequenceRecord):
//   seq_type      -> "dna" | "rna" | "protein" (the by-type tally).
//   circular      -> circular dna is a plasmid; linear is everything else.
//   length        -> bases (or residues for protein); drives totals + the histogram.
//   feature_count -> annotated features; summed into totalFeatures.
//   project_ids   -> collection links (PROJECTS ARE COLLECTIONS); no link = Unfiled.
//   added_at      -> ISO; drives "recently added".
//   organism      -> NCBI source organism (set only on NCBI-downloaded records).
//   source        -> "ncbi-datasets" | "ncbi-efetch" on NCBI imports.
//   received_from -> set only on a cross-boundary shared import.
// Sequences are per-user namespaced (no owner field on the record), so the scope is
// the current user's own library by default; pass owners to fold in specific
// members' libraries (each loaded via the cross-user read and tagged here).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { sequencesApi, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { attachSummaryUi, type RecordSetRow } from "@/lib/ai/record-set";
import { sequenceSummaryReport } from "@/lib/ai/summary-report";
import type { SequenceRecord } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam. A test stubs the loaders with fixtures.
// ---------------------------------------------------------------------------

export type SummarizeSequencesDeps = {
  currentUser: () => Promise<string>;
  listForUser: (username: string) => Promise<SequenceRecord[]>;
  listProjects: () => Promise<Array<{ id: number | string; name: string }>>;
};

export const summarizeSequencesDeps: SummarizeSequencesDeps = {
  currentUser: () => getCurrentUserCached(),
  listForUser: (username) => sequencesApi.getForUser(username),
  listProjects: () => fetchAllProjectsIncludingShared(),
};

// ---------------------------------------------------------------------------
// Aggregate shape. The ENTIRE structured payload the model narrates from.
// ---------------------------------------------------------------------------

/** One sequence record in a flagged list (longest / recently added), deep-linked. */
export type SequenceFlagItem = {
  id: string;
  name: string;
  seqType: string;
  topology: "circular" | "linear";
  length: number;
  featureCount: number;
  owner: string | null;
  addedAt: string | null;
  organism: string | null;
  deepLink: string;
};

export type SequenceSummary = {
  /** Echoed scope so the user sees what was summarized. */
  filter: {
    owners: string[] | null;
    keywords: string | null;
    project: string | null;
    /** The "today" used to derive recency, YYYY-MM-DD. */
    asOf: string;
  };
  /** Total matched sequences (the tool's count). */
  count: number;
  /** Summed length across matched sequences (bases, residues for protein). */
  totalBases: number;
  /** Summed feature_count across matched sequences. */
  totalFeatures: number;
  /** Circular DNA records (plasmids). */
  plasmidCount: number;
  /** Records with no project link. */
  unfiledCount: number;
  /** Records that arrived through a cross-boundary share (received_from set). */
  importedCount: number;
  /** Records downloaded from NCBI (source set). */
  ncbiCount: number;
  /** Count per seq_type, descending. */
  byType: Array<{ type: string; count: number }>;
  /** Count per topology (circular vs linear), descending. */
  byTopology: Array<{ topology: string; count: number }>;
  /** Count per project (collection), resolved name, descending. */
  byProject: Array<{ projectId: string; projectName: string; count: number }>;
  /** Count per NCBI organism, descending (only NCBI-sourced records carry one). */
  byOrganism: Array<{ organism: string; count: number }>;
  /** Count per owner, descending. Present only when more than one owner is scoped. */
  byOwner: Array<{ owner: string; count: number }>;
  /** Length distribution as fixed bins (the histogram). */
  lengthBins: Array<{ label: string; count: number }>;
  /** The longest records, descending by length. */
  longest: SequenceFlagItem[];
  /** The most recently added records, descending by added_at. */
  recentlyAdded: SequenceFlagItem[];
  /** True when a flag list was capped. */
  truncated: boolean;
};

// A loaded record tagged with the owner whose library it came from (sequences are
// per-user namespaced, so the owner is the library, not a field on the record).
export type OwnedSequence = SequenceRecord & { owner: string };

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing.
// ---------------------------------------------------------------------------

const DEFAULT_FLAG_CAP = 10;

/** Fixed length bins, smallest first. The last bin is open-ended. */
const LENGTH_BINS: Array<{ label: string; max: number }> = [
  { label: "< 1 kb", max: 1_000 },
  { label: "1 to 3 kb", max: 3_000 },
  { label: "3 to 6 kb", max: 6_000 },
  { label: "6 to 10 kb", max: 10_000 },
  { label: "> 10 kb", max: Infinity },
];

/** The YYYY-MM-DD day prefix of an ISO-ish string, or null. */
function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Lowercase keyword tokens that appear in a sequence's searchable fields. */
function seqMatchesKeywords(rec: OwnedSequence, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = [rec.display_name, rec.organism, rec.ncbi_accession, rec.seq_type]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function flagItem(rec: OwnedSequence): SequenceFlagItem {
  return {
    id: String(rec.id),
    name: rec.display_name || "Untitled sequence",
    seqType: rec.seq_type,
    topology: rec.circular ? "circular" : "linear",
    length: typeof rec.length === "number" ? rec.length : 0,
    featureCount: typeof rec.feature_count === "number" ? rec.feature_count : 0,
    owner: rec.owner || null,
    addedAt: dayOf(rec.added_at),
    organism: rec.organism || null,
    deepLink: "/sequences",
  };
}

function countDesc<T extends string>(map: Map<T, number>): Array<{ key: T; count: number }> {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

/**
 * Compute the sequence summary from owner-tagged records, a filter, a project-name
 * map, and a fixed today. Pure and deterministic, so a test passes fixtures and a
 * frozen today and asserts the exact counts, totals, and buckets.
 */
export function aggregateSequences(
  records: OwnedSequence[],
  filter: { owners?: string[] | null; keywords?: string; project?: string },
  projectNames: Map<string, string>,
  today: string,
  opts?: { flagCap?: number },
): SequenceSummary {
  const flagCap = opts?.flagCap ?? DEFAULT_FLAG_CAP;
  const keywordTokens = (filter.keywords ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const projectFilter = filter.project?.trim().toLowerCase() || null;

  // Resolve a project filter (by name or id) to a set of matching project ids.
  let projectIdFilter: Set<string> | null = null;
  if (projectFilter) {
    projectIdFilter = new Set(
      Array.from(projectNames.entries())
        .filter(
          ([id, name]) =>
            id.toLowerCase() === projectFilter ||
            (name ?? "").toLowerCase().includes(projectFilter),
        )
        .map(([id]) => id),
    );
  }

  const matched = records.filter((rec) => {
    if (!seqMatchesKeywords(rec, keywordTokens)) return false;
    if (projectIdFilter) {
      const ids = Array.isArray(rec.project_ids) ? rec.project_ids.map(String) : [];
      if (!ids.some((id) => projectIdFilter!.has(id))) return false;
    }
    return true;
  });

  const byType = new Map<string, number>();
  const byTopology = new Map<string, number>();
  const byProject = new Map<string, number>();
  const byOrganism = new Map<string, number>();
  const byOwner = new Map<string, number>();
  const binCounts = new Array(LENGTH_BINS.length).fill(0);

  let totalBases = 0;
  let totalFeatures = 0;
  let plasmidCount = 0;
  let unfiledCount = 0;
  let importedCount = 0;
  let ncbiCount = 0;

  for (const rec of matched) {
    const len = typeof rec.length === "number" ? rec.length : 0;
    const features = typeof rec.feature_count === "number" ? rec.feature_count : 0;
    totalBases += len;
    totalFeatures += features;

    byType.set(rec.seq_type, (byType.get(rec.seq_type) ?? 0) + 1);
    const topology = rec.circular ? "circular" : "linear";
    byTopology.set(topology, (byTopology.get(topology) ?? 0) + 1);
    if (rec.circular && rec.seq_type === "dna") plasmidCount += 1;

    const ids = Array.isArray(rec.project_ids) ? rec.project_ids.map(String) : [];
    if (ids.length === 0) unfiledCount += 1;
    for (const id of ids) byProject.set(id, (byProject.get(id) ?? 0) + 1);

    if (rec.organism) byOrganism.set(rec.organism, (byOrganism.get(rec.organism) ?? 0) + 1);
    if (rec.received_from) importedCount += 1;
    if (rec.source) ncbiCount += 1;

    byOwner.set(rec.owner, (byOwner.get(rec.owner) ?? 0) + 1);

    let placed = false;
    for (let i = 0; i < LENGTH_BINS.length; i++) {
      if (len < LENGTH_BINS[i].max) {
        binCounts[i] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) binCounts[LENGTH_BINS.length - 1] += 1;
  }

  const sorted = [...matched].sort(
    (a, b) => (b.length ?? 0) - (a.length ?? 0) || a.display_name.localeCompare(b.display_name),
  );
  const longest = sorted.slice(0, flagCap).map(flagItem);

  const recentlyAdded = [...matched]
    .filter((r) => dayOf(r.added_at) !== null)
    .sort((a, b) => (dayOf(b.added_at) ?? "").localeCompare(dayOf(a.added_at) ?? ""))
    .slice(0, flagCap)
    .map(flagItem);

  const ownerRows = countDesc(byOwner);

  return {
    filter: {
      owners: filter.owners && filter.owners.length > 0 ? filter.owners : null,
      keywords: filter.keywords?.trim() || null,
      project: filter.project?.trim() || null,
      asOf: today,
    },
    count: matched.length,
    totalBases,
    totalFeatures,
    plasmidCount,
    unfiledCount,
    importedCount,
    ncbiCount,
    byType: countDesc(byType).map((r) => ({ type: r.key, count: r.count })),
    byTopology: countDesc(byTopology).map((r) => ({ topology: r.key, count: r.count })),
    byProject: countDesc(byProject).map((r) => ({
      projectId: r.key,
      projectName: projectNames.get(r.key) ?? `Project ${r.key}`,
      count: r.count,
    })),
    byOrganism: countDesc(byOrganism).map((r) => ({ organism: r.key, count: r.count })),
    byOwner: ownerRows.length > 1 ? ownerRows.map((r) => ({ owner: r.key, count: r.count })) : [],
    lengthBins: LENGTH_BINS.map((b, i) => ({ label: b.label, count: binCounts[i] })),
    longest,
    recentlyAdded,
    truncated: matched.length > flagCap,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing + runtime today.
// ---------------------------------------------------------------------------

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const summarizeSequencesTool: AiTool = {
  name: "summarize_sequences",
  description:
    "Aggregate the user's sequence library (plasmids, primers, genomic, and protein records) and return a deterministic summary: the total count, total bases, total annotated features, the plasmid count, a by-type tally (dna / rna / protein), a by-topology tally (circular vs linear), a by-project tally, a by-organism tally for NCBI-sourced records, a length distribution, the longest records, and the most recently added. " +
    "Call this when the user asks about their sequences, for example \"summarize my sequences\", \"how many plasmids do I have\", \"what is my biggest construct\", \"how many sequences are unfiled\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count, total, and bucket; you NEVER count a sequence, sum bases, or decide a type yourself. You relay the numbers it returns and never interpret them into a scientific claim. " +
    "Scope is the current user's own library by default; pass owners (usernames) to fold in specific members' libraries. Pass keywords for a free-text match on the name, organism, accession, or type. Pass project to scope to one collection by name or id. " +
    "Returns { ok, summary } where summary echoes the scope and carries count, totalBases, totalFeatures, plasmidCount, unfiledCount, byType, byTopology, byProject, byOrganism, lengthBins, longest, and recentlyAdded. If nothing matches, count is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      owners: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Usernames whose libraries to fold in alongside your own. Omit for just your own library. Sequences are per-user, so this reads the named members' libraries, never anything private the user cannot already see.",
      },
      keywords: {
        type: "string",
        description:
          "Optional free-text match on the sequence name, NCBI organism, accession, or type, for example \"pUC\" or \"GFP\".",
      },
      project: {
        type: "string",
        description:
          "Optional. Scope to one project (collection) by name or id. A sequence matches when it is linked to that project.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const owners = Array.isArray(args.owners)
      ? args.owners.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined;
    const keywords =
      typeof args.keywords === "string" && args.keywords.trim() ? args.keywords.trim() : undefined;
    const project =
      typeof args.project === "string" && args.project.trim() ? args.project.trim() : undefined;

    // Load own library by default, or the named members' libraries, tagging each
    // record with the owner it came from (sequences carry no owner field).
    const me = await summarizeSequencesDeps.currentUser();
    const targetUsers = owners && owners.length > 0 ? owners : [me];
    const lists = await Promise.all(
      targetUsers.map((u) =>
        summarizeSequencesDeps.listForUser(u).then((recs) =>
          recs.map((r): OwnedSequence => ({ ...r, owner: u })),
        ),
      ),
    );
    const records = lists.flat();

    const projects = await summarizeSequencesDeps.listProjects();
    const projectNames = new Map(projects.map((p) => [String(p.id), p.name]));

    const summary = aggregateSequences(
      records,
      { owners: owners ?? null, keywords, project },
      projectNames,
      todayString(),
    );

    // Widget rows are the longest records the user is most likely to act on, with
    // the type / length the tool already computed as the subtitle. Sequences embed
    // by type + id, so the inline browser shows a real preview.
    const rows: RecordSetRow[] = summary.longest.map((s) => ({
      type: "sequence" as const,
      id: s.id,
      title: s.name,
      subtitle: `${s.topology} ${s.seqType}, ${s.length.toLocaleString()} ${
        s.seqType === "protein" ? "aa" : "bp"
      }`,
      ...(s.addedAt ? { date: s.addedAt } : {}),
      ...(s.featureCount > 0
        ? { meta: `${s.featureCount} ${s.featureCount === 1 ? "feature" : "features"}` }
        : {}),
    }));

    return attachSummaryUi(
      { ok: true as const, summary },
      rows,
      sequenceSummaryReport(summary),
      { kind: "summarize_sequences", title: "Longest sequences", total: rows.length },
    );
  },
};
