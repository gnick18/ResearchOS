// BeakerBot summarize_calculators tool (BeakerAI lane, 2026-06-16).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md), the
// custom-calculator analog of the other per-type summaries. A read-only tool that
// aggregates the user's CALCULATOR library (the build-your-own lab calculators) and
// hands the model a compact, structured tally so the model only narrates.
//
// THE HARD RULE: the TOOL computes every count and average DETERMINISTICALLY in
// TypeScript. The model NEVER counts a calculator or sums inputs. It relays the
// aggregate this tool returns and never interprets it.
//
// REAL FIELDS (verified against types.ts CustomCalculator):
//   field        -> optional grouping label (e.g. "Microbiology"); the by-field tally.
//   inputs       -> the input list; summed into totalInputs / avgInputs.
//   conditionals -> branching logic; presence drives "with logic".
//   owner        -> read-overlay owner (the per-user directory is the owner).
//   is_shared_with_me -> set by fetchAllCalculatorsIncludingShared for shared-in records.
//   updated_at   -> ISO; drives "recently edited".
// Sources: fetchAllCalculatorsIncludingShared (own plus everything shared with the user).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { fetchAllCalculatorsIncludingShared } from "@/lib/local-api";
import { attachSummaryUi, type RecordSetRow } from "@/lib/ai/record-set";
import { calculatorSummaryReport } from "@/lib/ai/summary-report";
import type { CustomCalculator } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam. A test stubs the loader with fixtures.
// ---------------------------------------------------------------------------

export type SummarizeCalculatorsDeps = {
  listCalculators: () => Promise<CustomCalculator[]>;
};

export const summarizeCalculatorsDeps: SummarizeCalculatorsDeps = {
  listCalculators: () => fetchAllCalculatorsIncludingShared(),
};

// ---------------------------------------------------------------------------
// Aggregate shape. The ENTIRE structured payload the model narrates from.
// ---------------------------------------------------------------------------

/** One calculator in a flagged list (recently edited), deep-linked to /calculators. */
export type CalculatorFlagItem = {
  id: string;
  name: string;
  field: string | null;
  owner: string | null;
  inputCount: number;
  hasLogic: boolean;
  updatedAt: string | null;
  deepLink: string;
};

export type CalculatorSummary = {
  /** Echoed scope so the user sees what was summarized. */
  filter: {
    owners: string[] | null;
    keywords: string | null;
    /** The "today" used to derive recency, YYYY-MM-DD. */
    asOf: string;
  };
  /** Total matched calculators (the tool's count). */
  count: number;
  /** Calculators with at least one conditional (branching logic). */
  withConditionalsCount: number;
  /** Calculators shared WITH the current user (is_shared_with_me). */
  sharedWithMeCount: number;
  /** Summed input count across matched calculators. */
  totalInputs: number;
  /** Mean input count, rounded, or null when there are no calculators. */
  avgInputs: number | null;
  /** Count per field (grouping label), descending. */
  byField: Array<{ field: string; count: number }>;
  /** Count per owner, descending. */
  byOwner: Array<{ owner: string; count: number }>;
  /** Most recently edited calculators. */
  recentlyEdited: CalculatorFlagItem[];
  /** True when the recently-edited list was capped. */
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing.
// ---------------------------------------------------------------------------

const DEFAULT_FLAG_CAP = 10;

function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function calcMatchesKeywords(c: CustomCalculator, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = [c.name, c.description, c.field]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function inputCount(c: CustomCalculator): number {
  return Array.isArray(c.inputs) ? c.inputs.length : 0;
}

function flagItem(c: CustomCalculator): CalculatorFlagItem {
  return {
    id: String(c.id),
    name: c.name || "Untitled calculator",
    field: c.field || null,
    owner: c.owner || null,
    inputCount: inputCount(c),
    hasLogic: Array.isArray(c.conditionals) && c.conditionals.length > 0,
    updatedAt: dayOf(c.updated_at),
    deepLink: "/calculators",
  };
}

function countDesc<T extends string>(map: Map<T, number>): Array<{ key: T; count: number }> {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

/**
 * Compute the calculator summary from calculators, a filter, and a fixed today.
 * Pure and deterministic, so a test passes fixtures and asserts the exact counts.
 */
export function aggregateCalculators(
  calculators: CustomCalculator[],
  filter: { owners?: string[] | null; keywords?: string },
  today: string,
  opts?: { flagCap?: number },
): CalculatorSummary {
  const flagCap = opts?.flagCap ?? DEFAULT_FLAG_CAP;
  const ownerSet =
    filter.owners && filter.owners.length > 0 ? new Set(filter.owners) : null;
  const keywordTokens = (filter.keywords ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  const matched = calculators.filter((c) => {
    if (ownerSet && (!c.owner || !ownerSet.has(c.owner))) return false;
    if (!calcMatchesKeywords(c, keywordTokens)) return false;
    return true;
  });

  const byField = new Map<string, number>();
  const byOwner = new Map<string, number>();
  let withConditionalsCount = 0;
  let sharedWithMeCount = 0;
  let totalInputs = 0;

  for (const c of matched) {
    const field = c.field?.trim() || "Ungrouped";
    byField.set(field, (byField.get(field) ?? 0) + 1);
    if (c.owner) byOwner.set(c.owner, (byOwner.get(c.owner) ?? 0) + 1);
    if (Array.isArray(c.conditionals) && c.conditionals.length > 0) withConditionalsCount += 1;
    if (c.is_shared_with_me === true) sharedWithMeCount += 1;
    totalInputs += inputCount(c);
  }

  const recentlyEdited = [...matched]
    .filter((c) => dayOf(c.updated_at) !== null)
    .sort((a, b) => (dayOf(b.updated_at) ?? "").localeCompare(dayOf(a.updated_at) ?? ""))
    .slice(0, flagCap)
    .map(flagItem);

  return {
    filter: {
      owners: filter.owners && filter.owners.length > 0 ? filter.owners : null,
      keywords: filter.keywords?.trim() || null,
      asOf: today,
    },
    count: matched.length,
    withConditionalsCount,
    sharedWithMeCount,
    totalInputs,
    avgInputs: matched.length > 0 ? Math.round((totalInputs / matched.length) * 10) / 10 : null,
    byField: countDesc(byField).map((r) => ({ field: r.key, count: r.count })),
    byOwner: countDesc(byOwner).map((r) => ({ owner: r.key, count: r.count })),
    recentlyEdited,
    truncated: matched.length > flagCap,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing + runtime today.
// ---------------------------------------------------------------------------

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const summarizeCalculatorsTool: AiTool = {
  name: "summarize_calculators",
  description:
    "Aggregate the user's custom calculator library and return a deterministic summary: the total count, how many carry branching logic (conditionals), how many are shared with the user, the average inputs per calculator, a by-field tally (the grouping label), a by-owner tally, and the most recently edited calculators. " +
    "Call this when the user asks about their calculators, for example \"summarize my calculators\", \"how many calculators do I have\", \"which calculators did I edit recently\", \"what calculators are shared with me\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count and average; you NEVER count a calculator or sum inputs yourself. You relay the numbers it returns and never interpret them. " +
    "Pass owners (usernames) to scope to members; the whole lab is the default (own plus everything shared with the user). Pass keywords for a free-text match on the calculator name, description, or field. " +
    "Returns { ok, summary } where summary echoes the scope and carries count, withConditionalsCount, sharedWithMeCount, avgInputs, byField, byOwner, and recentlyEdited. If nothing matches, count is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      owners: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Usernames of the lab members to scope to. Omit for the whole lab (own plus everything shared with the current user).",
      },
      keywords: {
        type: "string",
        description:
          "Optional free-text match on the calculator name, description, or field, for example \"dilution\" or \"molarity\".",
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

    const calculators = await summarizeCalculatorsDeps.listCalculators();
    const summary = aggregateCalculators(calculators, { owners, keywords }, todayString());

    // Widget rows are the recently-edited calculators. Calculators have no embed
    // route, so they render as a calm fallback card (the inventory pattern) with
    // "Open full" going to /calculators; the field / input count becomes the
    // subtitle.
    const rows: RecordSetRow[] = summary.recentlyEdited.map((c) => ({
      type: "calculator" as const,
      id: c.id,
      title: c.name,
      subtitle: [c.field, `${c.inputCount} ${c.inputCount === 1 ? "input" : "inputs"}`]
        .filter(Boolean)
        .join(", "),
      ...(c.updatedAt ? { date: c.updatedAt } : {}),
      ...(c.owner ? { meta: c.owner } : {}),
    }));

    return attachSummaryUi(
      { ok: true as const, summary },
      rows,
      calculatorSummaryReport(summary),
      { kind: "summarize_calculators", title: "Recently edited calculators", total: rows.length },
    );
  },
};
