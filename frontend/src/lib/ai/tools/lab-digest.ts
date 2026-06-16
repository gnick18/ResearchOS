// BeakerBot lab_digest tool (BeakerAI lane, 2026-06-12).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md). The
// cross-type "what happened" rollup, the weekly-review artifact. It calls the
// already-deterministic per-type aggregations (experiments, purchases, notes, and
// the projects rollup for what is scheduled next) over ONE date window and
// assembles a single digest object.
//
// THE HARD RULE, kept by composition: lab_digest does NOT recompute or re-tally
// anything. It pulls the loaded records once, hands them to the SAME exported
// aggregate* functions the per-type tools use, and lifts a few headline numbers
// out of those already-deterministic results. The model NEVER counts or totals,
// it only relays the composed digest and never interprets it into a finding or a
// judgment about the lab's week.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  aggregateExperiments,
  summarizeExperimentsDeps,
} from "./summarize-experiments";
import {
  aggregatePurchases,
  summarizePurchasesDeps,
} from "./summarize-purchases";
import { aggregateNotes, summarizeNotesDeps } from "./summarize-notes";
import { aggregateProjects, summarizeProjectsDeps } from "./summarize-projects";
import {
  attachSummaryUi,
  periodLabel,
  RECORD_SET_UI_CAP,
  type RecordSetRow,
} from "@/lib/ai/record-set";
import { labDigestReport } from "@/lib/ai/summary-report";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Composed digest shape. Every number here is lifted verbatim from a per-type
// deterministic aggregate, never recomputed by this tool.
// ---------------------------------------------------------------------------

export type LabDigest = {
  /** The window + scope this digest covers, echoed for the user. */
  window: {
    since: string | null;
    until: string | null;
    owners: string[] | null;
    /** The "today" used for the projects "scheduled next" rollup, YYYY-MM-DD. */
    asOf: string;
  };
  /** Experiments in the window. run = total started in-window; finished = the
   *  complete tally; finishingThisWeek = lifted straight from the experiment
   *  aggregate. */
  experiments: {
    run: number;
    finished: number;
    overdue: number;
    finishingThisWeek: number;
  };
  /** Notes written in the window (the structural count + entry total). */
  notes: {
    written: number;
    entries: number;
  };
  /** Purchases made in the window (count + the deterministic total spend). */
  purchases: {
    made: number;
    totalSpend: number;
    /** Pre-formatted total spend string, e.g. "$6,966.00". Echo this verbatim
     *  when narrating the purchase spend. Never re-type the number yourself. */
    totalSpendDisplay: string;
    pending: number;
  };
  /** What is scheduled next, lifted from the projects rollup (overdue project
   *  count + the soonest upcoming task start across all projects, if any). */
  scheduled: {
    projectsWithOverdue: number;
    nextUpcomingStart: string | null;
  };
};

// ---------------------------------------------------------------------------
// Pure composition. Exported for direct unit testing so a test feeds the four
// record sets + a frozen today and asserts the composed digest matches the
// per-type aggregates.
// ---------------------------------------------------------------------------

import type { Task, PurchaseItem, Note, Project } from "@/lib/types";

type OwnedPurchase = PurchaseItem & { owner: string };
type OwnedNote = Note & { owner: string };

export function composeLabDigest(
  input: {
    experiments: Task[];
    purchases: OwnedPurchase[];
    notes: OwnedNote[];
    projects: Project[];
    tasks: Task[];
  },
  window: { since?: string; until?: string; owners?: string[] },
  today: string,
): LabDigest {
  const owners = window.owners && window.owners.length > 0 ? window.owners : undefined;

  // Re-use the SAME deterministic aggregators, no fresh counting here.
  const exp = aggregateExperiments(input.experiments, {
    types: ["experiment"],
    since: window.since,
    until: window.until,
    owners,
  }, today);

  const pur = aggregatePurchases(input.purchases, {
    types: ["purchase"],
    since: window.since,
    until: window.until,
    owners,
  });

  const notes = aggregateNotes(input.notes, {
    types: ["note"],
    since: window.since,
    until: window.until,
    owners,
  });

  // Projects rollup uses the full task list (not windowed) so "scheduled next"
  // reflects the live forward schedule, not just in-window tasks.
  const projects = aggregateProjects(input.projects, input.tasks, today, {
    includeShared: true,
    includeArchived: false,
  });

  // The soonest upcoming start across all projects (verbatim from the rollup).
  let nextUpcomingStart: string | null = null;
  for (const p of projects.projects) {
    const start = p.nearestUpcomingStart;
    if (start !== null && (nextUpcomingStart === null || start < nextUpcomingStart)) {
      nextUpcomingStart = start;
    }
  }

  return {
    window: {
      since: window.since ?? null,
      until: window.until ?? null,
      owners: owners ?? null,
      asOf: today,
    },
    experiments: {
      run: exp.total,
      finished: exp.byStatus.complete,
      overdue: exp.byStatus.overdue,
      finishingThisWeek: exp.finishingThisWeek,
    },
    notes: {
      written: notes.total,
      entries: notes.totalEntries,
    },
    purchases: {
      made: pur.count,
      totalSpend: pur.totalSpend,
      totalSpendDisplay: pur.totalSpendDisplay,
      pending: pur.pendingVsReceived.pending,
    },
    scheduled: {
      projectsWithOverdue: projects.projectsWithOverdue,
      nextUpcomingStart,
    },
  };
}

// ---------------------------------------------------------------------------
// Combined record-set rows. The digest itself holds only headline counts, but the
// inline widget needs REAL rows, so this re-runs the SAME deterministic
// aggregators at the UI cap and maps every in-window record to a row keyed by its
// REAL type (experiment / note / purchase), so the widget's type-filter chips
// slice it and previews dispatch correctly. The projects rollup contributes no
// rows (it is the forward schedule, not in-window records). Pure and exported for
// direct unit testing. The window mirrors composeLabDigest exactly.
// ---------------------------------------------------------------------------

export function labDigestRows(
  input: {
    experiments: Task[];
    purchases: OwnedPurchase[];
    notes: OwnedNote[];
  },
  window: { since?: string; until?: string; owners?: string[] },
  today: string,
): RecordSetRow[] {
  const owners = window.owners && window.owners.length > 0 ? window.owners : undefined;

  const exp = aggregateExperiments(
    input.experiments,
    { types: ["experiment"], since: window.since, until: window.until, owners },
    today,
    RECORD_SET_UI_CAP,
  );
  const pur = aggregatePurchases(
    input.purchases,
    { types: ["purchase"], since: window.since, until: window.until, owners },
    RECORD_SET_UI_CAP,
  );
  const notes = aggregateNotes(
    input.notes,
    { types: ["note"], since: window.since, until: window.until, owners },
    RECORD_SET_UI_CAP,
  );

  const rows: RecordSetRow[] = [];
  for (const it of exp.items) {
    rows.push({
      type: "experiment",
      id: String(it.id),
      title: it.title,
      ...(it.projectName ? { subtitle: it.projectName } : {}),
      ...(it.startDate ? { date: it.startDate } : {}),
      meta: it.status,
    });
  }
  for (const it of notes.items) {
    rows.push({
      type: "note",
      id: String(it.id),
      title: it.title,
      ...(it.firstEntryTitle ? { subtitle: it.firstEntryTitle } : {}),
      ...(it.date ? { date: it.date } : {}),
    });
  }
  for (const it of pur.largestItems) {
    rows.push({
      type: "purchase",
      id: String(it.id),
      title: it.name,
      ...(it.vendor ? { subtitle: it.vendor } : {}),
      meta: it.totalPriceDisplay,
    });
  }
  return rows.slice(0, RECORD_SET_UI_CAP);
}

// ---------------------------------------------------------------------------
// Argument parsing + runtime today.
// ---------------------------------------------------------------------------

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const labDigestTool: AiTool = {
  name: "lab_digest",
  description:
    "Assemble a cross-type digest of the lab's activity over a date window, the experiments run / finished / overdue and finishing this week, the notes written and their entry count, the purchases made with the deterministic total spend and the pending count, and what is scheduled next (projects with overdue work, the soonest upcoming task start). " +
    "Call this for a week-in-review or status roundup, for example \"what did the lab do this week\", \"give me a digest of last month\", \"summarize everything since April 1\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. It COMPOSES the per-type summary tools, so every count and the total spend come straight from those deterministic aggregates. You NEVER count, total, or add anything yourself, you relay the composed digest exactly and never interpret it into a finding or a verdict about how the week went. " +
    "VERBATIM ECHO RULE: the purchases block carries totalSpendDisplay (e.g. \"$6,966.00\"). When you state the purchase spend, COPY that string CHARACTER FOR CHARACTER. Never re-type, re-sum, round, or recompute it. " +
    "Pass absolute YYYY-MM-DD dates for since / until; resolve relative phrasing (\"this week\", \"last month\") to absolute dates yourself using the current date in the context line first. Pass owners (usernames) to scope to members; the whole lab is the default (own plus everything shared with the user, never a member's private work). " +
    "Returns { ok, digest } where digest echoes the window and carries experiments, notes, purchases (with totalSpend and totalSpendDisplay), and scheduled blocks. When a block is all zeros, say plainly that nothing happened in that area for the window.",
  parameters: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description:
          "Optional inclusive lower bound as YYYY-MM-DD for the window. Resolve relative phrasing to an absolute date yourself first.",
      },
      until: {
        type: "string",
        description:
          "Optional inclusive upper bound as YYYY-MM-DD for the window.",
      },
      owners: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Usernames of the lab members to scope to. Omit for the whole lab (own plus everything shared with the current user). Never reaches a member's private work.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const owners = Array.isArray(args.owners)
      ? args.owners.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined;
    const window = { since: str(args.since), until: str(args.until), owners };

    const [experiments, purchases, notes, projects, tasks] = await Promise.all([
      summarizeExperimentsDeps.listExperiments(),
      summarizePurchasesDeps.listPurchases(),
      summarizeNotesDeps.listNotes(),
      summarizeProjectsDeps.listProjects(true),
      summarizeProjectsDeps.listTasks(),
    ]);

    const today = todayString();
    const digest = composeLabDigest(
      { experiments, purchases, notes, projects, tasks },
      window,
      today,
    );

    // One combined widget set of every in-window record across types, each row
    // keyed by its REAL type so the widget's type-filter chips slice it. The digest
    // the model reads is unchanged; the rows ride out-of-band under _ui, gated on
    // the ">4" rule by attachRecordSetIfBig.
    const rows = labDigestRows({ experiments, purchases, notes }, window, today);
    return attachSummaryUi({ ok: true as const, digest }, rows, labDigestReport(digest), {
      kind: "lab_digest",
      title: periodLabel("Lab digest", { since: window.since, until: window.until }),
      total: rows.length,
    });
  },
};
