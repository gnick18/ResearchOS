// BeakerBot save_summary_as_note tool (BeakerAI lane, 2026-06-13).
//
// Layer 3 of the summary suite (docs/proposals/beakerbot-summary-suite.md,
// "summaries as artifacts" section). This tool assembles a structured note from
// a summary result the model passes in, then writes it via the existing write_note
// path (gated, action: true). It never recomputes anything. Every count, total,
// and display string MUST come verbatim from the summary result the model supplies;
// this tool only arranges them into sections.
//
// The assembled note contains:
//   1. A narration paragraph (the model's own prose, passed in via the
//      `narration` argument, written AFTER the summary tool returned its
//      deterministic aggregate).
//   2. A structured overview section: a timeline table (byMonth or byWeek if
//      available) and a breakdown table (byStatus / byVendor / byCategory / etc.
//      depending on type), with all numbers copied verbatim from the summary.
//   3. Inline drill-down chips for each item in the capped items list, emitted via
//      objectReferenceMarkdown from @/lib/references (inline mention form). Block
//      embeds are only emitted when the summary carries a plot-ready datahub id
//      (summary.plotDocId), otherwise the chart section is skipped entirely.
//
// The write path is identical to write_note (notesApi.create / notesApi.addEntry,
// same Loro-backed store, same version-control, same draft-preview gate). The
// describeAction returns a `draft` payload so the loop raises a "draft" approval
// (the content preview) rather than a one-line confirm, exactly like write_note.
//
// THE NUMBERS RULE: this file NEVER adds, sums, rounds, or recomputes any number.
// If a display string (totalSpendDisplay, spendDisplay, totalPriceDisplay) is
// present, it echoes that string verbatim. If only a numeric field is present, it
// calls String(value) and does nothing more. The model supplies the narration
// paragraph; the tool only slots the numbers into markdown templates.
//
// EMBED RULE: block embeds (alone on their own line) are emitted only when the
// summary carries a real plotDocId. objectReferenceMarkdown (inline chip form) is
// used for every drill-down item link, never objectEmbedMarkdown, because items
// appear inside a list bullet (mid-line, not alone).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { objectReferenceMarkdown, objectEmbedMarkdown } from "@/lib/references";
import type { ObjectRefType } from "@/lib/references";
import { writeNoteDeps, localTodayIso, parseWriteNoteArgs } from "./write-note";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Summary input type: a union of all per-type summary shapes this tool accepts.
// The model calls a summary tool first, then passes the returned summary as
// the `summary` argument here. The discriminant is `summaryType`.
// ---------------------------------------------------------------------------

/** The minimal fields every per-type summary result shares. */
type BaseSummaryInput = {
  /** Total matched records. The tool echoes this; the model never recomputes it. */
  total?: number;
  /** Whether the items list was truncated. */
  truncated?: boolean;
};

/**
 * A timeline row (by month or by week). Mirrors the byMonth shape in the per-type
 * summary tools. Either a `month` or `week` key is present. The `count` is the
 * record count for that bucket. A `spend` number + `spendDisplay` string are
 * present on purchase-type summaries; all others omit them.
 */
type TimelineRow = {
  month?: string;
  week?: string;
  key?: string;
  count: number;
  spend?: number;
  spendDisplay?: string;
};

/**
 * One item in the capped items list. Every per-type summary tool uses a slightly
 * different shape; this union covers the fields the note-builder needs. Unused
 * fields are ignored via optional typing.
 */
type SummaryItem = {
  id: string;
  /** The human-visible title / name. */
  title?: string;
  name?: string;
  /** Optional deep link from the artifact index. When present, the tool emits a
   *  drill-down chip. When absent, it prints a plain name with no link. */
  deepLink?: string;
  /** Status label for experiment / task items. */
  status?: string;
  /** Date string (start date, updated date, etc.), displayed structurally. */
  startDate?: string;
  date?: string;
  /** Display-formatted price for purchase items. Echo verbatim. */
  totalPriceDisplay?: string;
  /** Owner username, displayed as "by <owner>" when present. */
  owner?: string;
};

/**
 * The complete summary input the model passes into this tool. It mirrors the union
 * of shapes the per-type summary tools return. Unknown extra fields are ignored;
 * the tool only reads what it knows.
 */
type SummaryInput = BaseSummaryInput & {
  /** Discriminant: which summary tool produced this result. */
  summaryType: "experiments" | "notes" | "projects" | "purchases" | "inventory" | "digest";
  /** The filter the summary tool applied, echoed so the note records the scope. */
  filter?: {
    since?: string;
    until?: string;
    owners?: string[];
    keywords?: string;
    status?: string;
  };
  /** Window for lab_digest (slightly different shape from filter). */
  window?: {
    since?: string | null;
    until?: string | null;
    owners?: string[] | null;
    asOf?: string;
  };
  /** Per-type status tally (experiments). */
  byStatus?: Record<string, number>;
  /** Per-owner count. */
  byOwner?: Record<string, number>;
  /** Timeline by month or by key (purchases use key for month bucket). */
  byMonth?: TimelineRow[];
  /** Per-vendor spend buckets (purchases only). */
  byVendor?: Array<{ key: string; count: number; spend?: number; spendDisplay?: string }>;
  /** Per-category spend buckets (purchases only). */
  byCategory?: Array<{ key: string; count: number; spend?: number; spendDisplay?: string }>;
  /** Per-project bucket (experiments). */
  byProject?: Array<{ projectId: string; projectName: string; count: number }>;
  /** Inventory flags. */
  low?: Array<SummaryItem & { reorderThreshold?: number; totalContainers?: number }>;
  out?: SummaryItem[];
  expiringSoon?: SummaryItem[];
  /** Total spend (purchases). */
  totalSpend?: number;
  /** Pre-formatted total spend string. Echo verbatim. */
  totalSpendDisplay?: string;
  /** Total item / record count (purchases uses `count` rather than `total`). */
  count?: number;
  /** Total entry count (notes). */
  totalEntries?: number;
  /** The experiments finishing this week signal. */
  finishingThisWeek?: number;
  /** As-of date. */
  asOf?: string;
  /** Projects summary block. */
  projects?: Array<{
    id: string;
    name: string;
    totalTasks: number;
    percentComplete: number;
    overdue: boolean;
    nextDueDate?: string | null;
    deepLink?: string;
  }>;
  /** Experiments sub-block inside a digest. */
  experiments?: {
    run?: number;
    finished?: number;
    overdue?: number;
    finishingThisWeek?: number;
  };
  /** Notes sub-block inside a digest. */
  notes?: { written?: number; entries?: number };
  /** Purchases sub-block inside a digest. */
  purchases?: {
    made?: number;
    totalSpend?: number;
    totalSpendDisplay?: string;
    pending?: number;
  };
  /** Scheduled sub-block inside a digest. */
  scheduled?: { projectsWithOverdue?: number; nextUpcomingStart?: string | null };
  /** Capped items list. Experiments, notes, and purchases each call this `items`
   *  or `largestItems`. */
  items?: SummaryItem[];
  largestItems?: SummaryItem[];
  /** Optional Data Hub document id when the summary tool provides a plot-ready
   *  document. When present this tool emits a block embed for the figure. When
   *  absent (the common case for all current summary tools) the chart section is
   *  skipped. */
  plotDocId?: string;
  /** Optional plot spec id within the document (for `#ros=plot&plot=<id>`). */
  plotSpecId?: string;
};

// ---------------------------------------------------------------------------
// Deps seam (mirrors write-note's pattern). Tests stub createNote /
// appendEntry with no real folder or Loro store.
// ---------------------------------------------------------------------------

export type SummaryArtifactDeps = {
  createNote: (data: {
    title: string;
    entryTitle: string;
    date: string;
    content: string;
  }) => Promise<{ id: number; title: string }>;
  appendEntry: (
    noteId: number,
    data: { title: string; date: string; content: string },
  ) => Promise<{ id: number; title: string } | null>;
};

export const summaryArtifactDeps: SummaryArtifactDeps = {
  createNote: writeNoteDeps.createNote,
  appendEntry: writeNoteDeps.appendEntry,
};

// ---------------------------------------------------------------------------
// Markdown assembly helpers. All helpers are pure and exported for testing.
// None recomputes any number; they only format what they are given.
// ---------------------------------------------------------------------------

/** Determine the object type for a drill-down chip from the summaryType
 *  discriminant. "experiment" is the correct type for experiment-type Tasks. */
function refTypeForSummary(
  summaryType: SummaryInput["summaryType"],
): ObjectRefType {
  switch (summaryType) {
    case "experiments":
      return "experiment";
    case "notes":
      return "note";
    case "projects":
      return "project";
    case "purchases":
      return "task";
    case "inventory":
      // Inventory items have no single object-type deep link in the catalog.
      // Fall back to "task" (best available) but items with no deepLink skip the chip.
      return "task";
    case "digest":
      return "note";
    default:
      return "note";
  }
}

/**
 * Emit one drill-down chip for a summary item. Uses the inline reference form
 * (objectReferenceMarkdown) because items appear inside list bullets, not alone on
 * their own line. When no deepLink is available, returns a plain name string.
 * The id in deepLink already carries the correct compound key from the artifact
 * index; extract it via a best-effort parse rather than the full parseObjectEmbed
 * import (we only need the label here, the link itself IS the deepLink).
 */
export function itemChip(
  item: SummaryItem,
  summaryType: SummaryInput["summaryType"],
): string {
  const label = (item.title ?? item.name ?? item.id ?? "Unknown").trim();
  if (!item.deepLink) {
    return label;
  }
  // objectReferenceMarkdown builds the correct inline chip string. The type is
  // used for context only (the chip renderer reads it from the href, not the
  // text), but passing the right type keeps any future type-gating correct.
  const refType = refTypeForSummary(summaryType);
  return objectReferenceMarkdown(refType, item.id, label);
}

/**
 * Build the timeline table section from the byMonth (or byKey) rows. Returns an
 * empty string when there are no rows. The table is a simple markdown table with
 * Month and Count columns, plus a Spend column for purchase summaries that carry
 * spendDisplay.
 *
 * All values are echoed verbatim from the input row. The function never adds,
 * rounds, or formats a number.
 */
export function buildTimelineTable(rows: TimelineRow[]): string {
  if (!rows || rows.length === 0) return "";
  const hasMoney = rows.some((r) => r.spendDisplay !== undefined);

  const header = hasMoney
    ? "| Month | Count | Spend |\n| --- | --- | --- |"
    : "| Month | Count |\n| --- | --- |";

  const body = rows
    .map((r) => {
      const label = r.month ?? r.week ?? r.key ?? "Unknown";
      const count = String(r.count);
      return hasMoney
        ? `| ${label} | ${count} | ${r.spendDisplay ?? ""} |`
        : `| ${label} | ${count} |`;
    })
    .join("\n");

  return `${header}\n${body}`;
}

/**
 * Build the breakdown table. For experiments it shows status counts; for
 * purchases it shows the top vendor buckets; for notes it shows byOwner counts;
 * for projects it shows per-project percent-complete; for inventory it shows the
 * low / out / expiring flags. Returns an empty string when there is nothing to
 * show.
 */
export function buildBreakdownSection(summary: SummaryInput): string {
  const parts: string[] = [];

  switch (summary.summaryType) {
    case "experiments": {
      const s = summary.byStatus;
      if (s && Object.keys(s).length > 0) {
        parts.push("**Status breakdown**");
        parts.push("| Status | Count |\n| --- | --- |");
        for (const [key, val] of Object.entries(s)) {
          parts.push(`| ${key} | ${String(val)} |`);
        }
      }
      if (summary.byProject && summary.byProject.length > 0) {
        parts.push("\n**By project**");
        parts.push("| Project | Count |\n| --- | --- |");
        for (const row of summary.byProject) {
          parts.push(`| ${row.projectName} | ${String(row.count)} |`);
        }
      }
      break;
    }

    case "purchases": {
      // Total spend headline. Echo the pre-formatted display string verbatim.
      // When both count and totalSpend are present this gives the model-narrated
      // line an exact match to cross-verify; the tool never re-types the number.
      const totalCount = summary.count ?? summary.total;
      if (totalCount !== undefined || summary.totalSpendDisplay !== undefined) {
        parts.push("**Overview**");
        parts.push("| Metric | Value |\n| --- | --- |");
        if (totalCount !== undefined) parts.push(`| Items | ${String(totalCount)} |`);
        if (summary.totalSpendDisplay !== undefined) {
          parts.push(`| Total spend | ${summary.totalSpendDisplay} |`);
        } else if (summary.totalSpend !== undefined) {
          parts.push(`| Total spend | ${String(summary.totalSpend)} |`);
        }
      }
      if (summary.byVendor && summary.byVendor.length > 0) {
        parts.push("\n**By vendor**");
        parts.push("| Vendor | Count | Spend |\n| --- | --- | --- |");
        for (const row of summary.byVendor) {
          parts.push(`| ${row.key} | ${String(row.count)} | ${row.spendDisplay ?? ""} |`);
        }
      }
      if (summary.byCategory && summary.byCategory.length > 0) {
        parts.push("\n**By category**");
        parts.push("| Category | Count | Spend |\n| --- | --- | --- |");
        for (const row of summary.byCategory) {
          parts.push(`| ${row.key} | ${String(row.count)} | ${row.spendDisplay ?? ""} |`);
        }
      }
      break;
    }

    case "notes": {
      if (summary.byOwner && Object.keys(summary.byOwner).length > 0) {
        parts.push("**By author**");
        parts.push("| Author | Count |\n| --- | --- |");
        for (const [owner, count] of Object.entries(summary.byOwner)) {
          parts.push(`| ${owner} | ${String(count)} |`);
        }
      }
      break;
    }

    case "projects": {
      if (summary.projects && summary.projects.length > 0) {
        parts.push("**Project progress**");
        parts.push("| Project | Tasks | Complete | Overdue | Next due |\n| --- | --- | --- | --- | --- |");
        for (const p of summary.projects) {
          const nextDue = p.nextDueDate ?? "none";
          const overdueFlag = p.overdue ? "yes" : "no";
          parts.push(
            `| ${p.name} | ${String(p.totalTasks)} | ${String(p.percentComplete)}% | ${overdueFlag} | ${nextDue} |`,
          );
        }
      }
      break;
    }

    case "inventory": {
      if (summary.low && summary.low.length > 0) {
        parts.push("**Low stock**");
        parts.push("| Item | On hand | Reorder at |\n| --- | --- | --- |");
        for (const item of summary.low) {
          const name = item.title ?? item.name ?? item.id ?? "Unknown";
          parts.push(
            `| ${name} | ${String(item.totalContainers ?? 0)} | ${String(item.reorderThreshold ?? 0)} |`,
          );
        }
      }
      if (summary.out && summary.out.length > 0) {
        parts.push("\n**Out of stock**");
        parts.push("| Item |\n| --- |");
        for (const item of summary.out) {
          parts.push(`| ${item.title ?? item.name ?? item.id ?? "Unknown"} |`);
        }
      }
      if (summary.expiringSoon && summary.expiringSoon.length > 0) {
        parts.push("\n**Expiring soon**");
        parts.push("| Item |\n| --- |");
        for (const item of summary.expiringSoon) {
          parts.push(`| ${item.title ?? item.name ?? item.id ?? "Unknown"} |`);
        }
      }
      break;
    }

    case "digest": {
      const exp = summary.experiments;
      const pur = summary.purchases;
      if (exp) {
        parts.push("**Experiments**");
        parts.push("| Metric | Value |\n| --- | --- |");
        if (exp.run !== undefined) parts.push(`| Run | ${String(exp.run)} |`);
        if (exp.finished !== undefined) parts.push(`| Finished | ${String(exp.finished)} |`);
        if (exp.overdue !== undefined) parts.push(`| Overdue | ${String(exp.overdue)} |`);
        if (exp.finishingThisWeek !== undefined)
          parts.push(`| Finishing this week | ${String(exp.finishingThisWeek)} |`);
      }
      if (pur) {
        parts.push("\n**Purchases**");
        parts.push("| Metric | Value |\n| --- | --- |");
        if (pur.made !== undefined) parts.push(`| Items made | ${String(pur.made)} |`);
        if (pur.totalSpendDisplay !== undefined)
          parts.push(`| Total spend | ${pur.totalSpendDisplay} |`);
        else if (pur.totalSpend !== undefined)
          parts.push(`| Total spend | ${String(pur.totalSpend)} |`);
        if (pur.pending !== undefined) parts.push(`| Pending | ${String(pur.pending)} |`);
      }
      break;
    }
  }

  return parts.join("\n");
}

/**
 * Build the drill-down chips section from the items list. Returns an empty string
 * when there are no items. Emits a short bullet list, one chip per item, each with
 * an inline chip link, a status tag (experiments), or a price (purchases).
 *
 * All values are echoed verbatim. The function never invents a label or a number.
 */
export function buildItemsList(
  items: SummaryItem[],
  summaryType: SummaryInput["summaryType"],
  truncated: boolean,
): string {
  if (!items || items.length === 0) return "";

  const bullets = items.map((item) => {
    const chip = itemChip(item, summaryType);
    const extras: string[] = [];
    if (item.status) extras.push(item.status);
    if (item.startDate) extras.push(item.startDate);
    if (item.date) extras.push(item.date);
    if (item.totalPriceDisplay) extras.push(item.totalPriceDisplay);
    if (item.owner) extras.push(`by ${item.owner}`);
    return extras.length > 0 ? `- ${chip} (${extras.join(", ")})` : `- ${chip}`;
  });

  const truncNote = truncated ? "\n_(more records not shown)_" : "";
  return `${bullets.join("\n")}${truncNote}`;
}

/**
 * Compose the full note markdown from the summary input and narration text. Pure
 * and deterministic given the inputs. Exported for unit testing.
 *
 * The composed note has the following sections:
 *   1. Narration paragraph (the model's prose, passed in).
 *   2. Timeline section (timeline table from byMonth / byKey rows).
 *   3. Breakdown section (status / vendor / category / project / flag tables).
 *   4. Optional block-embed chart (only when plotDocId is present).
 *   5. Drill-down links (bullet list of capped items with inline chips).
 *
 * All counts and display strings are copied verbatim from summaryInput. This
 * function never computes, sums, or formats a number itself.
 */
export function composeSummaryNote(
  summaryInput: SummaryInput,
  narration: string,
  noteTitle: string,
  today: string,
): string {
  const sections: string[] = [];

  // 1. Header + narration.
  sections.push(`# ${noteTitle}\n\n_Generated on ${today}_`);
  if (narration.trim()) {
    sections.push(narration.trim());
  }

  // 2. Scope line (filter / window echoed so the note records its scope).
  const scope = buildScopeLine(summaryInput);
  if (scope) {
    sections.push(`**Scope:** ${scope}`);
  }

  // 3. Timeline table.
  const timelineRows: TimelineRow[] = summaryInput.byMonth ?? [];
  const timeline = buildTimelineTable(timelineRows);
  if (timeline) {
    sections.push(`### Timeline\n\n${timeline}`);
  }

  // 4. Breakdown section.
  const breakdown = buildBreakdownSection(summaryInput);
  if (breakdown) {
    sections.push(`### Breakdown\n\n${breakdown}`);
  }

  // 5. Chart embed (only when the summary provides a real plotDocId).
  if (summaryInput.plotDocId) {
    const plotCaption = `${noteTitle} chart`;
    const plotOpts = summaryInput.plotSpecId
      ? { view: "plot", plot: summaryInput.plotSpecId }
      : { view: "table" };
    const embed = objectEmbedMarkdown("datahub", summaryInput.plotDocId, plotCaption, plotOpts);
    sections.push(`### Chart\n\n${embed}`);
  }

  // 6. Items list with drill-down chips.
  const items = summaryInput.items ?? summaryInput.largestItems ?? [];
  const truncated = summaryInput.truncated ?? false;
  const itemsSection = buildItemsList(items, summaryInput.summaryType, truncated);
  if (itemsSection) {
    const sectionLabel = summaryInput.summaryType === "purchases" ? "### Top items" : "### Records";
    sections.push(`${sectionLabel}\n\n${itemsSection}`);
  }

  return sections.join("\n\n");
}

/**
 * Build a human-readable scope description from the filter or window. Pure.
 * Never invents information; omits fields that are absent.
 */
export function buildScopeLine(summaryInput: SummaryInput): string {
  const filter = summaryInput.filter ?? {};
  const window = summaryInput.window ?? {};
  const parts: string[] = [];

  const since = filter.since ?? (window.since ?? undefined) ?? undefined;
  const until = filter.until ?? (window.until ?? undefined) ?? undefined;
  const owners: string[] | undefined =
    filter.owners?.length
      ? filter.owners
      : window.owners?.length
        ? (window.owners as string[])
        : undefined;
  const keywords = filter.keywords;
  const status = filter.status;

  if (since && until) {
    parts.push(`${since} to ${until}`);
  } else if (since) {
    parts.push(`from ${since}`);
  } else if (until) {
    parts.push(`until ${until}`);
  }
  if (owners && owners.length > 0) {
    parts.push(`owner(s): ${owners.join(", ")}`);
  }
  if (keywords) {
    parts.push(`keywords: ${keywords}`);
  }
  if (status) {
    parts.push(`status: ${status}`);
  }

  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Argument parsing.
// ---------------------------------------------------------------------------

type ParsedSummaryArtifactArgs = {
  /** Raw summary object from the model. Must carry summaryType. */
  summary: SummaryInput;
  /** The model's narration paragraph. Required (must be non-empty). */
  narration: string;
  /** Title for the new note. Falls back to a generated label. */
  noteTitle: string;
  /** "new" to create, or a numeric note id string to append to. */
  target: string;
  /** Note id for append mode, or null. */
  noteId: number | null;
  /** Derived mode. */
  mode: "create" | "append";
};

function parseSummaryArtifactArgs(
  args: Record<string, unknown>,
): ParsedSummaryArtifactArgs {
  const rawSummary = args.summary && typeof args.summary === "object" ? args.summary : {};
  const summary = rawSummary as SummaryInput;

  const narration = typeof args.narration === "string" ? args.narration.trim() : "";

  // Default note title based on the summary type.
  const defaultTitle =
    summary.summaryType
      ? `${summary.summaryType.charAt(0).toUpperCase()}${summary.summaryType.slice(1)} summary`
      : "Summary note";
  const noteTitle =
    typeof args.noteTitle === "string" && args.noteTitle.trim()
      ? args.noteTitle.trim()
      : defaultTitle;

  // Reuse the write-note target parser for the target / mode / noteId derivation.
  const parsed = parseWriteNoteArgs({ target: args.target ?? "new", mode: args.mode });
  return {
    summary,
    narration,
    noteTitle,
    target: parsed.target,
    noteId: parsed.noteId,
    mode: parsed.mode,
  };
}

// ---------------------------------------------------------------------------
// The tool itself.
// ---------------------------------------------------------------------------

export const saveSummaryAsNoteTool: AiTool = {
  name: "save_summary_as_note",
  description:
    "Turn a summary result into a saved, structured note artifact with a timeline, a breakdown table, and inline drill-down chips that link to the underlying objects. " +
    "Call this when the user asks to keep a summary as a note, save a summary, or export a summary after you have already run one of the summary tools (summarize_experiments, summarize_notes, summarize_projects, summarize_purchases, summarize_inventory, or lab_digest). " +
    "You MUST call the relevant summary tool FIRST and have its result in hand before calling this tool. " +
    "Pass the full summary object in `summary` (the tool reads the numbers verbatim from it), your narration paragraph in `narration` (the prose you write after reading the summary, structural and count-only, no fabricated findings), and a `noteTitle`. " +
    "Set target to \"new\" with mode \"create\" to make a new note, or to an existing note id from list_notes with mode \"append\" to add the summary as a new entry. " +
    "The app shows the user a draft preview with Approve or Reject BEFORE anything is written. Only on Approve does the note get written. Do NOT ask the user in prose first and do NOT call propose_plan for this. " +
    "THE NUMBERS RULE: the summary object carries every count, total, and display string deterministically from the tool that computed them. This tool echoes those numbers verbatim; it never recomputes, sums, rounds, or reformats any figure. " +
    "After it writes, say in one short sentence what was saved and where.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "object",
        description:
          "The full summary result returned by the summary tool (summarize_experiments, summarize_notes, summarize_projects, summarize_purchases, summarize_inventory, or lab_digest). Must include a `summaryType` field set to one of: \"experiments\", \"notes\", \"projects\", \"purchases\", \"inventory\", \"digest\". All counts and display strings are read verbatim from this object; do not modify them.",
      },
      narration: {
        type: "string",
        description:
          "The narration paragraph you wrote after reading the summary result. Structural and count-based only, no fabricated findings or interpretations. This becomes the opening of the note. Required.",
      },
      noteTitle: {
        type: "string",
        description:
          "The title for the new note, or the entry heading for an appended section. For example \"Experiments Q2 2026\" or \"Weekly digest 2026-06-13\". Optional, defaults to a type-based label.",
      },
      target: {
        type: "string",
        description:
          "Either \"new\" to create a new note, or the numeric id of an existing note (from list_notes) to append the summary to.",
      },
      mode: {
        type: "string",
        description:
          "Either \"create\" (make a new note) or \"append\" (add to the existing note named by target). Defaults from target (\"new\" means create).",
      },
    },
    required: ["summary", "narration"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const parsed = parseSummaryArtifactArgs(args);
    const today = localTodayIso();
    // Build the full note markdown so the draft preview shows exactly what will
    // be written. This is the same path execute() uses.
    const content = composeSummaryNote(
      parsed.summary,
      parsed.narration,
      parsed.noteTitle,
      today,
    );
    const actionSummary =
      parsed.mode === "create"
        ? `create a note "${parsed.noteTitle}"`
        : "add a summary entry to a note";
    return {
      summary: actionSummary,
      draft: {
        content,
        mode: parsed.mode,
        title: parsed.noteTitle,
      },
    };
  },
  execute: async (args) => {
    const parsed = parseSummaryArtifactArgs(args);

    if (!parsed.narration) {
      return {
        ok: false as const,
        error:
          "No narration was provided. Write the narration paragraph from the summary result first, then call save_summary_as_note with it.",
      };
    }

    if (!parsed.summary.summaryType) {
      return {
        ok: false as const,
        error:
          "The summary object is missing a summaryType field. Pass the full result from a summary tool (summarize_experiments, summarize_notes, summarize_projects, summarize_purchases, summarize_inventory, or lab_digest).",
      };
    }

    const today = localTodayIso();
    const content = composeSummaryNote(
      parsed.summary,
      parsed.narration,
      parsed.noteTitle,
      today,
    );

    if (parsed.mode === "create") {
      const note = await summaryArtifactDeps.createNote({
        title: parsed.noteTitle,
        entryTitle: parsed.noteTitle,
        date: today,
        content,
      });
      return { ok: true as const, noteId: note.id, title: note.title, mode: "create" as const };
    }

    // Append mode.
    if (parsed.noteId === null) {
      return {
        ok: false as const,
        error:
          "I could not tell which note to append to. Call list_notes to find the note id, then pass that id as target.",
      };
    }

    const updated = await summaryArtifactDeps.appendEntry(parsed.noteId, {
      title: parsed.noteTitle,
      date: today,
      content,
    });

    if (!updated) {
      return {
        ok: false as const,
        error:
          "That note could not be found. It may have been deleted, or the id is wrong. List the notes again and try one of those.",
      };
    }

    return { ok: true as const, noteId: updated.id, title: updated.title, mode: "append" as const };
  },
};
