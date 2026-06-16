// BeakerBot summarize_methods tool (BeakerAI lane, 2026-06-16).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md), the
// protocol-library analog of summarize_experiments / summarize_inventory. A
// read-only tool that aggregates the user's METHOD library (the protocols, PCR /
// LC / plate / qPCR-analysis / compound recipes, and markdown / PDF write-ups) and
// hands the model a compact, structured tally so the model only narrates.
//
// THE HARD RULE: the TOOL computes every count and every bucket DETERMINISTICALLY
// in TypeScript. The model NEVER counts a method or decides a type. It only relays
// the aggregate this tool returns and never interprets it into a claim.
//
// REAL FIELDS (verified against types.ts Method):
//   method_type        -> the structured kind, or null for an untyped record.
//   tags               -> free tags, flattened into the by-tag tally.
//   owner              -> the owning member (methods carry a real owner + ACL).
//   is_shared_with_me  -> read-overlay flag set by fetchAllMethodsIncludingShared.
//   parent_method_id   -> set when forked from another method (a derived copy).
//   received_from      -> set only on a cross-boundary shared import.
//   last_edited_at     -> ISO, optional (R3+ records); drives "recently edited".
// Sources: fetchAllMethodsIncludingShared (own plus everything shared with the user).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { fetchAllMethodsIncludingShared } from "@/lib/local-api";
import { attachSummaryUi, type RecordSetRow } from "@/lib/ai/record-set";
import { methodSummaryReport } from "@/lib/ai/summary-report";
import type { Method } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam. A test stubs the loader with fixtures.
// ---------------------------------------------------------------------------

export type SummarizeMethodsDeps = {
  listMethods: () => Promise<Method[]>;
};

export const summarizeMethodsDeps: SummarizeMethodsDeps = {
  listMethods: () => fetchAllMethodsIncludingShared(),
};

// ---------------------------------------------------------------------------
// Aggregate shape. The ENTIRE structured payload the model narrates from.
// ---------------------------------------------------------------------------

/** Readable label for each method_type (and null). */
const TYPE_LABEL: Record<string, string> = {
  markdown: "Markdown",
  pdf: "PDF",
  pcr: "PCR",
  lc_gradient: "LC gradient",
  plate: "Plate",
  cell_culture: "Cell culture",
  mass_spec: "Mass spec",
  compound: "Compound",
  coding_workflow: "Coding workflow",
  qpcr_analysis: "qPCR analysis",
  untyped: "Untyped",
};

/** A method_type that is a structured protocol (not a freeform write-up). */
const STRUCTURED_TYPES = new Set([
  "pcr",
  "lc_gradient",
  "plate",
  "cell_culture",
  "mass_spec",
  "compound",
  "coding_workflow",
  "qpcr_analysis",
]);

/** One method in a flagged list (recently edited), deep-linked to /methods. */
export type MethodFlagItem = {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  owner: string | null;
  lastEditedAt: string | null;
  deepLink: string;
};

export type MethodSummary = {
  /** Echoed scope so the user sees what was summarized. */
  filter: {
    owners: string[] | null;
    keywords: string | null;
    /** The "today" used to derive recency, YYYY-MM-DD. */
    asOf: string;
  };
  /** Total matched methods (the tool's count). */
  count: number;
  /** Methods with a structured protocol type (PCR, LC, plate, ...). */
  structuredCount: number;
  /** Compound methods (a recipe made of child methods). */
  compoundCount: number;
  /** Methods forked from another method (parent_method_id set). */
  forkedCount: number;
  /** Methods that arrived through a cross-boundary share (received_from set). */
  importedCount: number;
  /** Methods shared WITH the current user (is_shared_with_me). */
  sharedWithMeCount: number;
  /** Count per method_type (label), descending. */
  byType: Array<{ type: string; label: string; count: number }>;
  /** Count per owner, descending. */
  byOwner: Array<{ owner: string; count: number }>;
  /** Count per tag, descending (top tags). */
  byTag: Array<{ tag: string; count: number }>;
  /** Most recently edited methods (only those carrying last_edited_at). */
  recentlyEdited: MethodFlagItem[];
  /** True when a flag list was capped. */
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing.
// ---------------------------------------------------------------------------

const DEFAULT_FLAG_CAP = 10;
const DEFAULT_TAG_CAP = 12;

/** The YYYY-MM-DD day prefix of an ISO-ish string, or null. */
function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function typeKey(m: Method): string {
  return m.method_type ?? "untyped";
}

/** Lowercase keyword tokens that appear in a method's searchable fields. */
function methodMatchesKeywords(m: Method, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = [m.name, typeKey(m), ...(Array.isArray(m.tags) ? m.tags : [])]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function flagItem(m: Method): MethodFlagItem {
  const key = typeKey(m);
  return {
    id: String(m.id),
    name: m.name || "Untitled method",
    type: key,
    typeLabel: TYPE_LABEL[key] ?? key,
    owner: m.owner || null,
    lastEditedAt: dayOf(m.last_edited_at),
    deepLink: "/methods",
  };
}

function countDesc<T extends string>(map: Map<T, number>): Array<{ key: T; count: number }> {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

/**
 * Compute the method summary from methods, a filter, and a fixed today. Pure and
 * deterministic, so a test passes fixtures and a frozen today and asserts the exact
 * counts and buckets.
 */
export function aggregateMethods(
  methods: Method[],
  filter: { owners?: string[] | null; keywords?: string },
  today: string,
  opts?: { flagCap?: number; tagCap?: number },
): MethodSummary {
  const flagCap = opts?.flagCap ?? DEFAULT_FLAG_CAP;
  const tagCap = opts?.tagCap ?? DEFAULT_TAG_CAP;

  const ownerSet =
    filter.owners && filter.owners.length > 0 ? new Set(filter.owners) : null;
  const keywordTokens = (filter.keywords ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  const matched = methods.filter((m) => {
    if (ownerSet && (!m.owner || !ownerSet.has(m.owner))) return false;
    if (!methodMatchesKeywords(m, keywordTokens)) return false;
    return true;
  });

  const byType = new Map<string, number>();
  const byOwner = new Map<string, number>();
  const byTag = new Map<string, number>();

  let structuredCount = 0;
  let compoundCount = 0;
  let forkedCount = 0;
  let importedCount = 0;
  let sharedWithMeCount = 0;

  for (const m of matched) {
    const key = typeKey(m);
    byType.set(key, (byType.get(key) ?? 0) + 1);
    if (m.owner) byOwner.set(m.owner, (byOwner.get(m.owner) ?? 0) + 1);
    for (const tag of Array.isArray(m.tags) ? m.tags : []) {
      if (typeof tag === "string" && tag.trim()) {
        byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
      }
    }
    if (STRUCTURED_TYPES.has(key)) structuredCount += 1;
    if (key === "compound") compoundCount += 1;
    if (m.parent_method_id != null) forkedCount += 1;
    if (m.received_from) importedCount += 1;
    if (m.is_shared_with_me === true) sharedWithMeCount += 1;
  }

  const recentlyEdited = [...matched]
    .filter((m) => dayOf(m.last_edited_at) !== null)
    .sort((a, b) => (dayOf(b.last_edited_at) ?? "").localeCompare(dayOf(a.last_edited_at) ?? ""))
    .slice(0, flagCap)
    .map(flagItem);

  return {
    filter: {
      owners: filter.owners && filter.owners.length > 0 ? filter.owners : null,
      keywords: filter.keywords?.trim() || null,
      asOf: today,
    },
    count: matched.length,
    structuredCount,
    compoundCount,
    forkedCount,
    importedCount,
    sharedWithMeCount,
    byType: countDesc(byType).map((r) => ({
      type: r.key,
      label: TYPE_LABEL[r.key] ?? r.key,
      count: r.count,
    })),
    byOwner: countDesc(byOwner).map((r) => ({ owner: r.key, count: r.count })),
    byTag: countDesc(byTag).slice(0, tagCap).map((r) => ({ tag: r.key, count: r.count })),
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

export const summarizeMethodsTool: AiTool = {
  name: "summarize_methods",
  description:
    "Aggregate the user's method library (protocols and write-ups) and return a deterministic summary: the total count, how many are structured protocols (PCR, LC, plate, qPCR analysis, ...), how many are compound recipes, how many were forked from another method, how many were imported from a share, how many are shared WITH the user, a by-type tally, a by-owner tally, a by-tag tally, and the most recently edited methods. " +
    "Call this when the user asks about their methods, for example \"summarize my methods\", \"how many PCR protocols do I have\", \"what method types do I use most\", \"which methods did I edit recently\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count and bucket; you NEVER count a method or decide a type yourself. You relay the numbers it returns and never interpret them. " +
    "Pass owners (usernames) to scope to members; the whole lab is the default (own plus everything shared with the user, never a member's private methods). Pass keywords for a free-text match on the method name, type, or tags. " +
    "Returns { ok, summary } where summary echoes the scope and carries count, structuredCount, compoundCount, forkedCount, importedCount, sharedWithMeCount, byType, byOwner, byTag, and recentlyEdited. If nothing matches, count is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      owners: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Usernames of the lab members to scope to. Omit for the whole lab (own plus everything shared with the current user). Never reaches a member's private methods, only what is shared.",
      },
      keywords: {
        type: "string",
        description:
          "Optional free-text match on the method name, type, or tags, for example \"miniprep\" or \"qPCR\".",
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

    const methods = await summarizeMethodsDeps.listMethods();
    const summary = aggregateMethods(methods, { owners, keywords }, todayString());

    // Widget rows are the recently-edited methods, with the type the tool computed
    // as the subtitle. Methods embed by type + id, so the inline browser shows a
    // real preview.
    const rows: RecordSetRow[] = summary.recentlyEdited.map((m) => ({
      type: "method" as const,
      id: m.id,
      title: m.name,
      subtitle: m.typeLabel,
      ...(m.lastEditedAt ? { date: m.lastEditedAt } : {}),
      ...(m.owner ? { meta: m.owner } : {}),
    }));

    return attachSummaryUi(
      { ok: true as const, summary },
      rows,
      methodSummaryReport(summary),
      { kind: "summarize_methods", title: "Recently edited methods", total: rows.length },
    );
  },
};
