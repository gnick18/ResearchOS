// BeakerBot summarize_notes tool (BeakerAI lane, 2026-06-12).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md). A
// read-only tool that aggregates ACROSS many notes and hands the model a compact,
// structured tally so it can write one grounded narrative.
//
// THE HARD RULE (the whole point of this tool): the TOOL computes every count,
// every group-by, and the month timeline DETERMINISTICALLY in TypeScript. The
// model NEVER counts records and never invents a date. It only narrates from the
// aggregate this tool returns.
//
// STRUCTURAL ONLY, FOREVER. A note summary reports STRUCTURE (counts, dates,
// titles, the first entry / heading), NEVER a model-extracted finding, result, or
// conclusion. v1 and onward stay structural by design, so the model can never
// fabricate "what the notes found". This is BeakerBot's global no-interpretation
// scope made concrete for the highest-risk type.
//
// Notes carry NO project linkage on the data model (Note has no project_id and no
// project_ids), so this tool intentionally exposes NO project filter or
// by-project tally, it would always be empty. Owner comes from note.username (the
// author stamp), which the own + shared loader back-fills as `owner`.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  noteToBrief,
  filterArtifacts,
  periodToDateRange,
  resolveOwnerRefsToUsernames,
  type ArtifactBrief,
  type ArtifactFilter,
} from "@/lib/ai/artifact-index";
import { fetchAllNotesIncludingShared, usersApi } from "@/lib/local-api";
import type { Note } from "@/lib/types";
import type { AiTool } from "./types";

// A note decorated with its owning member, the shape
// fetchAllNotesIncludingShared returns.
type OwnedNote = Note & { owner: string };

// ---------------------------------------------------------------------------
// Injectable deps seam. A test stubs listNotes with fixture notes and never
// touches a real folder.
// ---------------------------------------------------------------------------

export type SummarizeNotesDeps = {
  /** Load every note the current user may see (own + shared-in), each decorated
   *  with its owner. ACL-enforced upstream by fetchAllNotesIncludingShared. */
  listNotes: () => Promise<OwnedNote[]>;
  /** The lab member usernames, used to resolve owner NAMES to usernames. */
  listMemberUsernames: () => Promise<string[]>;
};

export const summarizeNotesDeps: SummarizeNotesDeps = {
  listNotes: () => fetchAllNotesIncludingShared(),
  listMemberUsernames: async () => {
    try {
      return (await usersApi.list()).users;
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Aggregate shape. The ENTIRE structured payload the model narrates from.
// ---------------------------------------------------------------------------

/** One matched note, capped + deep-linked, for the model to list / chip. The
 *  firstEntryTitle is the note's first entry title (its earliest heading), a
 *  STRUCTURAL label only, never a model reading of the content. */
export type NoteSummaryItem = {
  id: string;
  title: string;
  firstEntryTitle: string | null;
  entryCount: number;
  date: string | null;
  owner: string | null;
  deepLink: string;
};

export type NoteSummary = {
  /** The exact filter applied, echoed so the user sees the scope. */
  filter: ArtifactFilter;
  /** Total matched notes (the tool's count, never the model's). */
  total: number;
  /** Count per owning member (only owners with at least one match appear). */
  byOwner: Record<string, number>;
  /** Count per calendar month (YYYY-MM by the note's updated date), plus an
   *  "undated" bucket. Sorted ascending by key. */
  byMonth: Array<{ month: string; count: number }>;
  /** Total entries across all matched notes (a rough structural effort signal,
   *  NOT a content judgment). */
  totalEntries: number;
  /** Up to `cap` most-recent matched notes with deep links. */
  items: NoteSummaryItem[];
  /** True when more notes matched than `items` carries. */
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing.
// ---------------------------------------------------------------------------

const DEFAULT_ITEM_CAP = 15;

/** The YYYY-MM-DD day prefix of an ISO-ish string, or null. */
function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/**
 * Compute the note summary from a list of owned notes and a filter. Pure and
 * deterministic, so a test passes a fixture and asserts the exact counts. The
 * model never does this arithmetic.
 *
 * Notes lack a brief.owner on the shared noteToBrief converter, so the tool
 * decorates each brief with the owner from the OWNED note record before filtering,
 * which lets the "whose" filter scope by member without changing the shared
 * converter.
 */
export function aggregateNotes(
  notes: OwnedNote[],
  filter: ArtifactFilter,
  cap: number = DEFAULT_ITEM_CAP,
): NoteSummary {
  // Build owner-decorated briefs and keep a compound-key map (owner + ":" + id)
  // so notes from different owners that share the same per-user numeric id never
  // collide. Each brief carries the synthetic compound key in its id field so
  // filterArtifacts routes back to exactly one record. A plain-id map kept the
  // total count right but double-counted one owner's note and dropped the other
  // in the byOwner / month / entry breakdowns.
  const byCompoundKey = new Map<string, OwnedNote>();
  const briefs: ArtifactBrief[] = [];
  for (const note of notes) {
    const brief: ArtifactBrief = { ...noteToBrief(note), owner: note.owner || undefined };
    const compoundKey = `${note.owner ?? ""}:${brief.id}`;
    briefs.push({ ...brief, id: compoundKey });
    byCompoundKey.set(compoundKey, note);
  }

  const matched = filterArtifacts(briefs, filter)
    .map((b) => byCompoundKey.get(b.id))
    .filter((x): x is OwnedNote => x !== undefined);

  const byOwner: Record<string, number> = {};
  const monthCounts = new Map<string, number>();
  let totalEntries = 0;

  for (const note of matched) {
    const owner = note.owner || null;
    if (owner) byOwner[owner] = (byOwner[owner] ?? 0) + 1;

    const day = dayOf(note.updated_at);
    const monthKey = day ? day.slice(0, 7) : "undated";
    monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);

    totalEntries += note.entries?.length ?? 0;
  }

  const byMonth = Array.from(monthCounts.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Most-recent-first by updated date for the capped list.
  const sorted = [...matched].sort((a, b) => {
    const da = dayOf(a.updated_at) ?? "";
    const db = dayOf(b.updated_at) ?? "";
    return db.localeCompare(da);
  });

  const items: NoteSummaryItem[] = sorted.slice(0, cap).map((note) => {
    const firstEntry = note.entries && note.entries.length > 0 ? note.entries[0] : null;
    return {
      id: String(note.id),
      title: note.title || "Untitled note",
      firstEntryTitle: firstEntry?.title?.trim() || null,
      entryCount: note.entries?.length ?? 0,
      date: dayOf(note.updated_at),
      owner: note.owner || null,
      deepLink: noteToBrief(note).deepLink,
    };
  });

  return {
    filter,
    total: matched.length,
    byOwner,
    byMonth,
    totalEntries,
    items,
    truncated: matched.length > items.length,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing. Absolute YYYY-MM-DD dates only.
// ---------------------------------------------------------------------------

function parseFilter(args: Record<string, unknown>): ArtifactFilter {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined;
  return {
    types: ["note"],
    since: str(args.since),
    until: str(args.until),
    owners: strArr(args.owners),
    keywords: str(args.keywords),
  };
}

export const summarizeNotesTool: AiTool = {
  name: "summarize_notes",
  description:
    "Aggregate the user's notes across a filter and return a deterministic, STRUCTURAL summary (count, by-owner breakdown, a month timeline by last-edited date, the total entry count, and the most recent matches with deep links and their first entry title). " +
    "Call this when the user asks you to summarize, count, or review notes over a scope, for example \"summarize my notes this month\", \"how many notes did Kritika write in May\", \"what did I write up last week\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count; you NEVER count records or invent a date yourself, you only relay the numbers it returns. " +
    "STRUCTURAL ONLY, this tool and your narration report STRUCTURE (counts, dates, titles, the first entry heading), NEVER a finding, a result, or a conclusion the user did not write. If asked what the notes found or mean, decline warmly and offer the structural roll-up instead. " +
    "Pass absolute YYYY-MM-DD dates for since / until (the window and the month timeline use each note's last-edited date); resolve relative phrasing yourself using the current date in the context line first. " +
    "Pass owners (usernames) to scope to members; the whole lab is the default (own plus everything shared with the user, never a member's private notes). Pass keywords for a free-text match on the note title and entry titles. Notes carry no project link, so there is no project filter. " +
    "Returns { ok, summary } where summary echoes the filter and carries total, byOwner, byMonth, totalEntries, and a capped items list (flagged truncated). If nothing matches, summary.total is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description:
          "Optional inclusive lower bound as YYYY-MM-DD on the note's last-edited date. Resolve relative phrasing to an absolute date yourself first.",
      },
      until: {
        type: "string",
        description:
          "Optional inclusive upper bound as YYYY-MM-DD on the note's last-edited date.",
      },
      owners: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Lab members to scope to, by NAME or username (for example [\"Kritika\"]). The tool resolves names to usernames itself, tolerating case and small typos, so just pass what the user said; you do NOT need to call list_lab_members first. Omit for the whole lab (own plus everything shared with the current user). Never reaches a member's private notes, only what is shared.",
      },
      keywords: {
        type: "string",
        description:
          "Optional free-text match on the note title and entry titles, for example \"transformation\" or \"colony count\".",
      },
      period: {
        type: "string",
        description:
          "Optional relative date window the TOOL resolves to since/until for you, so you never compute dates yourself. One of: today, this_week, last_week, this_month, last_month, this_quarter, last_quarter, this_year, last_year, all_time. Prefer this over computing since/until by hand whenever the user says a relative window. An explicit since/until you also pass wins over the period for that bound.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const baseFilter = parseFilter(args);
    // Deterministic relative-window resolution (last_month, this_quarter, ...) so
    // the weak model never does date arithmetic; explicit since/until wins.
    const today = new Date().toISOString().slice(0, 10);
    const period = typeof args.period === "string" ? args.period : undefined;
    const range = periodToDateRange(period, today);
    const [notes, members] = await Promise.all([
      summarizeNotesDeps.listNotes(),
      summarizeNotesDeps.listMemberUsernames(),
    ]);
    // Resolve owner NAMES to usernames (keep raw if none resolve, never widen).
    const rawOwners = baseFilter.owners ?? [];
    const resolvedOwners = resolveOwnerRefsToUsernames(rawOwners, members);
    const filter: ArtifactFilter = {
      ...baseFilter,
      since: baseFilter.since ?? range.since,
      until: baseFilter.until ?? range.until,
      owners: rawOwners.length > 0 ? (resolvedOwners.length > 0 ? resolvedOwners : rawOwners) : undefined,
    };
    const summary = aggregateNotes(notes, filter);
    return { ok: true as const, summary };
  },
};
