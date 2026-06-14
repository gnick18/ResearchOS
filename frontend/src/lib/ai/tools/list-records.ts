// BeakerBot list_records tool (ai summary-robustness bot, 2026-06-14).
//
// The deterministic top-N / sorted-list resolver. The user asks for "my 5 most
// recent experiments", "the oldest open tasks", "notes alphabetically", and the
// TOOL builds the briefs, filters them, sorts by the chosen field, and slices the
// top N. The model NEVER reads a pile of records and eyeballs which are newest or
// which come first; it states a structured query and relays the ordered result.
//
// Reuses the summary-suite resolvers so the same NL conveniences apply: a relative
// "period" token, project + member names (typo-tolerant), all resolved in-tool.
// Read-only, briefs only (titles / dates / deep links), never a body.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  listArtifacts,
  periodToDateRange,
  resolveOwnerRefsToUsernames,
  resolveProjectRefsToIds,
  type ArtifactBrief,
  type ArtifactFilter,
  type ListOrder,
  type ListSortBy,
} from "@/lib/ai/artifact-index";
import { fetchAllProjectsIncludingShared, usersApi } from "@/lib/local-api";
import { attachRecordSetIfBig, briefToRow } from "@/lib/ai/record-set";
import type { Project } from "@/lib/types";
import type { AiTool } from "./types";

const VALID_TYPES = new Set([
  "note",
  "experiment",
  "method",
  "sequence",
  "datahub",
  "project",
  "purchase",
  "molecule",
  "phylo",
]);

export type ListRecordsDeps = {
  list: (opts: {
    filter?: ArtifactFilter;
    sortBy?: ListSortBy;
    order?: ListOrder;
    limit?: number;
  }) => Promise<{ total: number; items: ArtifactBrief[] }>;
  listMemberUsernames: () => Promise<string[]>;
  listProjects: () => Promise<Project[]>;
};

export const listRecordsDeps: ListRecordsDeps = {
  list: (opts) => listArtifacts(opts),
  listMemberUsernames: async () => {
    try {
      return (await usersApi.list()).users;
    } catch {
      return [];
    }
  },
  listProjects: () => fetchAllProjectsIncludingShared(),
};

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

export const listRecordsTool: AiTool = {
  name: "list_records",
  description:
    "List the user's records sorted and capped DETERMINISTICALLY, for requests like \"my 5 most recent experiments\", \"the oldest open tasks\", \"my notes alphabetically\", \"what did the lab edit most recently\". The TOOL does the sorting and the top-N cut; you never read records and decide yourself which are newest or first. " +
    "Read-only, runs straight away. Scope it: types (note / experiment / method / sequence / datahub / project / purchase / molecule / phylo), sortBy (date or title), order (desc = newest or Z-A, asc = oldest or A-Z), limit (default 10). " +
    "Filter with period (today / this_week / last_week / this_month / last_month / this_quarter / last_quarter / this_year / last_year / all_time, the tool turns it into dates), owners (member NAMES or usernames, resolved in-tool), projects (NAMES or ids, resolved in-tool), status, and keywords. " +
    "Returns { ok, total, count, items } where each item is a brief with type, id, title, subtitle, date, and deepLink. total is the full match count before the cap, so say \"showing 10 of 42\" when count < total. Relay the list, never interpret it.",
  parameters: {
    type: "object",
    properties: {
      types: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Record types to include: note, experiment, method, sequence, datahub, project, purchase, molecule, phylo. Omit for all types.",
      },
      sortBy: {
        type: "string",
        description: "Sort field: \"date\" (most/least recently edited, the default) or \"title\" (alphabetical).",
      },
      order: {
        type: "string",
        description: "\"desc\" (newest first, or Z-A) is the default; \"asc\" gives oldest first, or A-Z.",
      },
      limit: {
        type: "number",
        description: "How many to return. Default 10, max 50.",
      },
      period: {
        type: "string",
        description:
          "Optional relative date window the tool resolves to a date range: today, this_week, last_week, this_month, last_month, this_quarter, last_quarter, this_year, last_year, all_time.",
      },
      since: { type: "string", description: "Optional inclusive lower date bound YYYY-MM-DD (for a custom range; period is easier)." },
      until: { type: "string", description: "Optional inclusive upper date bound YYYY-MM-DD." },
      owners: {
        type: "array",
        items: { type: "string" },
        description: "Optional. Members to scope to, by NAME or username; resolved in-tool, tolerating typos. Omit for the whole lab.",
      },
      projects: {
        type: "array",
        items: { type: "string" },
        description: "Optional. Projects to scope to, by NAME or id; resolved in-tool. An item in any listed project is kept.",
      },
      status: { type: "string", description: "Optional per-type status, e.g. \"complete\" or \"active\" for experiments." },
      keywords: { type: "string", description: "Optional free-text match on titles, headings, tags, descriptions (NOT deep bodies, use search_full_text for that)." },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const today = new Date().toISOString().slice(0, 10);
    const period = typeof args.period === "string" ? args.period : undefined;
    const range = periodToDateRange(period, today);

    const [members, projects] = await Promise.all([
      listRecordsDeps.listMemberUsernames(),
      listRecordsDeps.listProjects(),
    ]);

    const types = strArr(args.types).filter((t) => VALID_TYPES.has(t));
    const rawOwners = strArr(args.owners);
    const resolvedOwners = resolveOwnerRefsToUsernames(rawOwners, members);
    // Check 4 (live-verify 2026-06-14): owner(s) named but NONE resolved to a real
    // member. Signal the miss rather than filtering by the raw unmatched name and
    // returning an empty list that looks like a real-but-empty member. Guarded on a
    // known roster: an empty members list (solo user / roster API empty) cannot tell
    // a typo from a valid owner, so it keeps the raw filter as before.
    if (members.length > 0 && rawOwners.length > 0 && resolvedOwners.length === 0) {
      return {
        ok: false as const,
        error: `No lab member matched ${rawOwners.map((o) => `"${o}"`).join(", ")}. Ask the user who they mean, or call list_lab_members for the real names, instead of listing an empty set.`,
      };
    }
    const resolvedProjectIds = resolveProjectRefsToIds(strArr(args.projects), projects);

    const filter: ArtifactFilter = {
      types: types.length > 0 ? types : undefined,
      since: (typeof args.since === "string" && args.since.trim()) || range.since || undefined,
      until: (typeof args.until === "string" && args.until.trim()) || range.until || undefined,
      owners: rawOwners.length > 0 ? (resolvedOwners.length > 0 ? resolvedOwners : rawOwners) : undefined,
      projectIds: resolvedProjectIds.length > 0 ? resolvedProjectIds : undefined,
      status: typeof args.status === "string" && args.status.trim() ? args.status.trim() : undefined,
      keywords: typeof args.keywords === "string" && args.keywords.trim() ? args.keywords.trim() : undefined,
    };

    const sortBy: ListSortBy = args.sortBy === "title" ? "title" : "date";
    const order: ListOrder = args.order === "asc" ? "asc" : "desc";
    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 50) : 10;

    // list_records is a deterministic TOP-N: the requested `limit` IS the answer, so
    // the widget shows exactly what was asked for, never the whole table. (Unlike a
    // search or summary, where the widget carries the full match set.) Fetch `limit`
    // once and feed the SAME items to both the model and the widget. _ui.total is the
    // shown count so the widget header reads "3 matches", not "3 of 13"; the model
    // still gets the real `total` for its narration ("showing 3 of 13").
    const { total, items } = await listRecordsDeps.list({ filter, sortBy, order, limit });

    // attachRecordSetIfBig gates on the set floor, so a single result returns the
    // result unchanged (a lone inline chip) and 2+ render the widget.
    const rows = items.map(briefToRow);
    return attachRecordSetIfBig(
      { ok: true as const, total, count: items.length, sortBy, order, items },
      rows,
      { kind: "list_records", title: "Records", total: items.length },
    );
  },
};
