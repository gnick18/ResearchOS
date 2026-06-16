// BeakerBot summarize_chemistry tool (BeakerAI lane, 2026-06-16).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md), the
// molecule-library analog of summarize_sequences. A read-only tool that aggregates
// the user's CHEMISTRY library (the drawn, imported, and PubChem molecules) and
// hands the model a compact, structured tally so the model only narrates.
//
// THE HARD RULE: the TOOL computes every count, total, and average DETERMINISTICALLY
// in TypeScript. The model NEVER counts a molecule, sums a weight, or decides a
// source. It only relays the aggregate this tool returns and never interprets it
// into a chemical claim.
//
// REAL FIELDS (verified against lib/chemistry/api.ts MoleculeMeta):
//   source        -> "drawn" | "imported" | "pubchem" (the by-source tally).
//   mol_weight    -> average molecular weight g/mol; summed + binned (when present).
//   formula       -> Hill formula; presence drives "with a formula".
//   smiles        -> canonical SMILES; presence drives "with a structure".
//   project_ids   -> collection links; no link = Unfiled.
//   added_at      -> ISO; drives "recently added".
//   starred_papers-> literature starred per molecule; summed into the lit count.
// Molecules are per-user namespaced (no owner field), so the scope is the current
// user's own library. Source: moleculesApi.list().
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { moleculesApi, type Molecule } from "@/lib/chemistry/api";
import { fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { attachSummaryUi, type RecordSetRow } from "@/lib/ai/record-set";
import { chemistrySummaryReport } from "@/lib/ai/summary-report";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam. A test stubs the loaders with fixtures.
// ---------------------------------------------------------------------------

export type SummarizeChemistryDeps = {
  listMolecules: () => Promise<Molecule[]>;
  listProjects: () => Promise<Array<{ id: number | string; name: string }>>;
};

export const summarizeChemistryDeps: SummarizeChemistryDeps = {
  listMolecules: () => moleculesApi.list(),
  listProjects: () => fetchAllProjectsIncludingShared(),
};

// ---------------------------------------------------------------------------
// Aggregate shape. The ENTIRE structured payload the model narrates from.
// ---------------------------------------------------------------------------

/** One molecule in a flagged list (heaviest / recently added), deep-linked. */
export type MoleculeFlagItem = {
  id: string;
  name: string;
  formula: string | null;
  molWeight: number | null;
  source: string | null;
  addedAt: string | null;
  deepLink: string;
};

export type ChemistrySummary = {
  /** Echoed scope so the user sees what was summarized. */
  filter: {
    keywords: string | null;
    project: string | null;
    /** The "today" used to derive recency, YYYY-MM-DD. */
    asOf: string;
  };
  /** Total matched molecules (the tool's count). */
  count: number;
  /** Molecules with a canonical SMILES structure. */
  withStructureCount: number;
  /** Molecules with a Hill formula. */
  withFormulaCount: number;
  /** Molecules with no project link. */
  unfiledCount: number;
  /** Summed molecular weight across molecules that carry one. */
  totalWeight: number;
  /** Mean molecular weight across molecules that carry one, rounded, or null. */
  avgWeight: number | null;
  /** Count of molecules that carry a mol_weight (the avg's denominator). */
  weightedCount: number;
  /** Total starred papers + patents across all matched molecules. */
  starredLiteratureCount: number;
  /** Count per source (drawn / imported / pubchem), descending. */
  bySource: Array<{ source: string; count: number }>;
  /** Count per project (collection), resolved name, descending. */
  byProject: Array<{ projectId: string; projectName: string; count: number }>;
  /** Molecular-weight distribution as fixed bins (the histogram). */
  weightBins: Array<{ label: string; count: number }>;
  /** The heaviest molecules, descending by mol_weight. */
  heaviest: MoleculeFlagItem[];
  /** The most recently added molecules, descending by added_at. */
  recentlyAdded: MoleculeFlagItem[];
  /** True when a flag list was capped. */
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing.
// ---------------------------------------------------------------------------

const DEFAULT_FLAG_CAP = 10;

/** Fixed molecular-weight bins (g/mol), smallest first. The last is open-ended. */
const WEIGHT_BINS: Array<{ label: string; max: number }> = [
  { label: "< 150", max: 150 },
  { label: "150 to 300", max: 300 },
  { label: "300 to 500", max: 500 },
  { label: "500 to 800", max: 800 },
  { label: "> 800", max: Infinity },
];

/** The YYYY-MM-DD day prefix of an ISO-ish string, or null. */
function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Lowercase keyword tokens that appear in a molecule's searchable fields. */
function moleculeMatchesKeywords(mol: Molecule, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = [mol.name, mol.formula, mol.inchikey, mol.smiles, mol.source]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function flagItem(mol: Molecule): MoleculeFlagItem {
  return {
    id: String(mol.id),
    name: mol.name || "Untitled molecule",
    formula: mol.formula ?? null,
    molWeight: typeof mol.mol_weight === "number" ? mol.mol_weight : null,
    source: mol.source ?? null,
    addedAt: dayOf(mol.added_at),
    deepLink: "/chemistry",
  };
}

function countDesc<T extends string>(map: Map<T, number>): Array<{ key: T; count: number }> {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

/**
 * Compute the chemistry summary from molecules, a filter, a project-name map, and a
 * fixed today. Pure and deterministic, so a test passes fixtures and a frozen today
 * and asserts the exact counts, totals, and buckets.
 */
export function aggregateChemistry(
  molecules: Molecule[],
  filter: { keywords?: string; project?: string },
  projectNames: Map<string, string>,
  today: string,
  opts?: { flagCap?: number },
): ChemistrySummary {
  const flagCap = opts?.flagCap ?? DEFAULT_FLAG_CAP;
  const keywordTokens = (filter.keywords ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const projectFilter = filter.project?.trim().toLowerCase() || null;

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

  const matched = molecules.filter((mol) => {
    if (!moleculeMatchesKeywords(mol, keywordTokens)) return false;
    if (projectIdFilter) {
      const ids = Array.isArray(mol.project_ids) ? mol.project_ids.map(String) : [];
      if (!ids.some((id) => projectIdFilter!.has(id))) return false;
    }
    return true;
  });

  const bySource = new Map<string, number>();
  const byProject = new Map<string, number>();
  const binCounts = new Array(WEIGHT_BINS.length).fill(0);

  let withStructureCount = 0;
  let withFormulaCount = 0;
  let unfiledCount = 0;
  let totalWeight = 0;
  let weightedCount = 0;
  let starredLiteratureCount = 0;

  for (const mol of matched) {
    const source = mol.source ?? "drawn";
    bySource.set(source, (bySource.get(source) ?? 0) + 1);

    if (typeof mol.smiles === "string" && mol.smiles.length > 0) withStructureCount += 1;
    if (typeof mol.formula === "string" && mol.formula.length > 0) withFormulaCount += 1;

    const ids = Array.isArray(mol.project_ids) ? mol.project_ids.map(String) : [];
    if (ids.length === 0) unfiledCount += 1;
    for (const id of ids) byProject.set(id, (byProject.get(id) ?? 0) + 1);

    if (Array.isArray(mol.starred_papers)) starredLiteratureCount += mol.starred_papers.length;

    if (typeof mol.mol_weight === "number" && mol.mol_weight > 0) {
      totalWeight += mol.mol_weight;
      weightedCount += 1;
      let placed = false;
      for (let i = 0; i < WEIGHT_BINS.length; i++) {
        if (mol.mol_weight < WEIGHT_BINS[i].max) {
          binCounts[i] += 1;
          placed = true;
          break;
        }
      }
      if (!placed) binCounts[WEIGHT_BINS.length - 1] += 1;
    }
  }

  const heaviest = [...matched]
    .filter((m) => typeof m.mol_weight === "number")
    .sort((a, b) => (b.mol_weight ?? 0) - (a.mol_weight ?? 0) || a.name.localeCompare(b.name))
    .slice(0, flagCap)
    .map(flagItem);

  const recentlyAdded = [...matched]
    .filter((m) => dayOf(m.added_at) !== null)
    .sort((a, b) => (dayOf(b.added_at) ?? "").localeCompare(dayOf(a.added_at) ?? ""))
    .slice(0, flagCap)
    .map(flagItem);

  return {
    filter: {
      keywords: filter.keywords?.trim() || null,
      project: filter.project?.trim() || null,
      asOf: today,
    },
    count: matched.length,
    withStructureCount,
    withFormulaCount,
    unfiledCount,
    totalWeight: Math.round(totalWeight * 100) / 100,
    avgWeight: weightedCount > 0 ? Math.round((totalWeight / weightedCount) * 100) / 100 : null,
    weightedCount,
    starredLiteratureCount,
    bySource: countDesc(bySource).map((r) => ({ source: r.key, count: r.count })),
    byProject: countDesc(byProject).map((r) => ({
      projectId: r.key,
      projectName: projectNames.get(r.key) ?? `Project ${r.key}`,
      count: r.count,
    })),
    weightBins: WEIGHT_BINS.map((b, i) => ({ label: b.label, count: binCounts[i] })),
    heaviest,
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

export const summarizeChemistryTool: AiTool = {
  name: "summarize_chemistry",
  description:
    "Aggregate the user's chemistry library (drawn, imported, and PubChem molecules) and return a deterministic summary: the total count, how many have a structure (SMILES) and a formula, the by-source tally (drawn / imported / pubchem), a by-project tally, the average and total molecular weight, a molecular-weight distribution, the count of starred papers, the heaviest molecules, and the most recently added. " +
    "Call this when the user asks about their molecules, for example \"summarize my chemistry\", \"how many compounds do I have\", \"what is my heaviest molecule\", \"how many came from PubChem\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count, total, and average; you NEVER count a molecule, sum a weight, or decide a source yourself. You relay the numbers it returns and never interpret them into a chemical claim. " +
    "The scope is your own molecule library (molecules are per-user). Pass keywords for a free-text match on the name, formula, InChIKey, SMILES, or source. Pass project to scope to one collection by name or id. " +
    "Returns { ok, summary } where summary echoes the scope and carries count, withStructureCount, bySource, byProject, avgWeight, totalWeight, weightBins, heaviest, and recentlyAdded. If nothing matches, count is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      keywords: {
        type: "string",
        description:
          "Optional free-text match on the molecule name, formula, InChIKey, SMILES, or source, for example \"caffeine\" or \"C8H10N4O2\".",
      },
      project: {
        type: "string",
        description:
          "Optional. Scope to one project (collection) by name or id. A molecule matches when it is linked to that project.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const keywords =
      typeof args.keywords === "string" && args.keywords.trim() ? args.keywords.trim() : undefined;
    const project =
      typeof args.project === "string" && args.project.trim() ? args.project.trim() : undefined;

    const molecules = await summarizeChemistryDeps.listMolecules();
    const projects = await summarizeChemistryDeps.listProjects();
    const projectNames = new Map(projects.map((p) => [String(p.id), p.name]));

    const summary = aggregateChemistry(molecules, { keywords, project }, projectNames, todayString());

    // Widget rows are the heaviest molecules, with the formula + weight the tool
    // already computed as the subtitle. Molecules embed by type + id.
    const rows: RecordSetRow[] = summary.heaviest.map((m) => ({
      type: "molecule" as const,
      id: m.id,
      title: m.name,
      subtitle: [m.formula, m.molWeight != null ? `${m.molWeight} g/mol` : null]
        .filter(Boolean)
        .join(", "),
      ...(m.addedAt ? { date: m.addedAt } : {}),
      ...(m.source ? { meta: m.source } : {}),
    }));

    return attachSummaryUi(
      { ok: true as const, summary },
      rows,
      chemistrySummaryReport(summary),
      { kind: "summarize_chemistry", title: "Heaviest molecules", total: rows.length },
    );
  },
};
