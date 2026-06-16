// BeakerBot summary-aggregate widget seam (BeakerAI lane, 2026-06-15).
//
// Layer 3 of the summary suite (docs/proposals/beakerbot-summary-suite.md). The
// per-type summarize_* tools already compute a deterministic aggregate and narrate
// it. This module carries that aggregate to a DETERMINISTIC inline card so the
// counts the user SEES come straight from the tool, not from the model's prose. It
// is the whole point of the suite's anti-hallucination rule made visual: the model
// can fat-finger a number in a sentence, a widget rendering the tool's aggregate
// cannot.
//
// The seam piggybacks on the existing record-set `_ui` (one tool result has exactly
// one `_ui`): a summarize tool attaches its items record-set under `_ui` as before
// AND tucks this normalized SummaryReport on it as `_ui.aggregate`. The presence of
// `aggregate` is the discriminator, so a plain record-set from search_my_work is
// never mistaken for a summary. summaryReportFromResult reads it back; the items
// keep rendering through RecordSetWidget unchanged, with this card above them.
//
// NORMALIZED on purpose: one SummaryReportWidget renders every summary type. Each
// tool maps its own aggregate shape to this shape with a small pure builder, so the
// widget never learns about experiments-vs-purchases. Every number here is COPIED
// verbatim from the tool's aggregate; this module never sums, rounds, or recomputes.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { ArtifactFilter } from "@/lib/ai/artifact-index";
import { recordSetFromResult } from "@/lib/ai/record-set";
import type { ExperimentSummary } from "@/lib/ai/tools/summarize-experiments";
import type { PurchaseSummary } from "@/lib/ai/tools/summarize-purchases";
import type { NoteSummary } from "@/lib/ai/tools/summarize-notes";
import type { ProjectsSummary } from "@/lib/ai/tools/summarize-projects";
import type { InventorySummary } from "@/lib/ai/tools/summarize-inventory";
import type { LabDigest } from "@/lib/ai/tools/lab-digest";

/** Semantic tone for a stat tile or a bar. Maps to a color in the widget; it is a
 *  STATUS / role tone (done / overdue / spend), never an object-domain tint. */
export type SummaryTone =
  | "done"
  | "active"
  | "overdue"
  | "upcoming"
  | "accent"
  | "spend"
  | "neutral";

/** One stat tile (a big number + a label). value is a pre-formatted string so a
 *  spend total ("$6,966.00") and a count ("47") share one type. */
export type SummaryStat = {
  label: string;
  value: string;
  tone?: SummaryTone;
  /** The headline tile (e.g. the total). Rendered slightly stronger. */
  emphasis?: boolean;
};

/** One bar in a breakdown. value drives the bar WIDTH; display is the text shown at
 *  the end (a count, or a verbatim spend string). When display is absent the value
 *  is shown as-is. */
export type SummaryBarRow = {
  label: string;
  value: number;
  display?: string;
  tone?: SummaryTone;
};

export type SummaryBarGroup = { title: string; rows: SummaryBarRow[] };

export type SummaryHistogram = {
  title: string;
  bars: Array<{ label: string; value: number }>;
};

/** The normalized payload one widget renders for any summary type. Everything here
 *  is copied verbatim from a summarize_* tool's deterministic aggregate. */
export type SummaryReport = {
  /** The originating tool name, e.g. "summarize_experiments". */
  kind: string;
  /** Short heading noun, e.g. "Experiments" or "Purchases". */
  heading: string;
  /** The echoed filter scope as short chips ("whole lab", "overdue", a date range). */
  scope: string[];
  /** Up to ~4 headline tiles. */
  stats: SummaryStat[];
  /** Breakdown bar groups (by status, by owner, by vendor, ...). */
  barGroups: SummaryBarGroup[];
  /** A period timeline, or null when there is nothing dated to show. */
  histogram: SummaryHistogram | null;
};

/** Build the echoed scope chips from the filter the tool applied. Pure. Shows the
 *  whose / status / keyword / project-count / date-window scope so the user sees
 *  exactly what was counted. Date detail also lives in the heading via periodLabel;
 *  here it is a compact range chip. */
export function scopeChips(filter: ArtifactFilter | undefined): string[] {
  const chips: string[] = [];
  const since = filter?.since?.trim();
  const until = filter?.until?.trim();
  if (since && until) chips.push(`${since} to ${until}`);
  else if (since) chips.push(`since ${since}`);
  else if (until) chips.push(`through ${until}`);

  const owners = filter?.owners?.filter((o) => o.trim().length > 0) ?? [];
  chips.push(owners.length > 0 ? owners.join(", ") : "whole lab");

  if (filter?.status?.trim()) chips.push(filter.status.trim());
  const projectIds = filter?.projectIds?.filter((p) => p.trim().length > 0) ?? [];
  if (projectIds.length > 0) {
    chips.push(projectIds.length === 1 ? "1 project" : `${projectIds.length} projects`);
  }
  if (filter?.keywords?.trim()) chips.push(`"${filter.keywords.trim()}"`);
  return chips;
}

/** Map an ExperimentSummary aggregate to the normalized report. Pure, numbers
 *  copied verbatim. Empty breakdown groups are omitted so the card stays tight. */
export function experimentSummaryReport(s: ExperimentSummary): SummaryReport {
  const ownerRows: SummaryBarRow[] = Object.entries(s.byOwner)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, tone: "accent" as const }));
  const projectRows: SummaryBarRow[] = s.byProject
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((p) => ({ label: p.projectName, value: p.count, tone: "accent" as const }));

  const barGroups: SummaryBarGroup[] = [
    {
      title: "By status",
      rows: [
        { label: "Done", value: s.byStatus.complete, tone: "done" },
        { label: "In progress", value: s.byStatus.active, tone: "active" },
        { label: "Overdue", value: s.byStatus.overdue, tone: "overdue" },
        { label: "Upcoming", value: s.byStatus.upcoming, tone: "upcoming" },
      ],
    },
  ];
  if (ownerRows.length > 0) barGroups.push({ title: "By owner", rows: ownerRows });
  if (projectRows.length > 0) barGroups.push({ title: "By project", rows: projectRows });

  return {
    kind: "summarize_experiments",
    heading: "Experiments",
    scope: scopeChips(s.filter),
    stats: [
      { label: "experiments", value: String(s.total), emphasis: true },
      { label: "done", value: String(s.byStatus.complete), tone: "done" },
      { label: "overdue", value: String(s.byStatus.overdue), tone: "overdue" },
      { label: "finishing this week", value: String(s.finishingThisWeek), tone: "accent" },
    ],
    barGroups,
    histogram:
      s.byMonth.length > 0
        ? {
            title: "Over time",
            bars: s.byMonth.map((m) => ({ label: m.month, value: m.count })),
          }
        : null,
  };
}

/** Map a PurchaseSummary aggregate to the normalized report. Spend strings are the
 *  tool's pre-formatted *Display values, echoed verbatim (the model never re-types a
 *  number). Bar widths use the raw spend, the labels show the display string. */
export function purchaseSummaryReport(s: PurchaseSummary): SummaryReport {
  const vendorRows: SummaryBarRow[] = s.byVendor.map((b) => ({
    label: b.key,
    value: b.spend,
    display: b.spendDisplay,
    tone: "spend" as const,
  }));
  const categoryRows: SummaryBarRow[] = s.byCategory.map((b) => ({
    label: b.key,
    value: b.spend,
    display: b.spendDisplay,
    tone: "spend" as const,
  }));

  const barGroups: SummaryBarGroup[] = [];
  if (vendorRows.length > 0) barGroups.push({ title: "Spend by vendor", rows: vendorRows });
  if (categoryRows.length > 0) barGroups.push({ title: "Spend by category", rows: categoryRows });

  return {
    kind: "summarize_purchases",
    heading: "Purchases",
    scope: scopeChips(s.filter),
    stats: [
      { label: "total spend", value: s.totalSpendDisplay, tone: "spend", emphasis: true },
      { label: "line items", value: String(s.count) },
      { label: "received", value: String(s.pendingVsReceived.received), tone: "done" },
      { label: "pending", value: String(s.pendingVsReceived.pending), tone: "upcoming" },
    ],
    barGroups,
    histogram:
      s.byMonth.length > 0
        ? {
            title: "Spend over time",
            bars: s.byMonth.map((m) => ({ label: m.key, value: m.spend })),
          }
        : null,
  };
}

/** Map a NoteSummary aggregate to the normalized report. Structural only (counts,
 *  owners, months, entry total) - never a model reading of note content. Pure. */
export function noteSummaryReport(s: NoteSummary): SummaryReport {
  const ownerRows: SummaryBarRow[] = Object.entries(s.byOwner)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, tone: "accent" as const }));
  const barGroups: SummaryBarGroup[] = [];
  if (ownerRows.length > 0) barGroups.push({ title: "By owner", rows: ownerRows });
  return {
    kind: "summarize_notes",
    heading: "Notes",
    scope: scopeChips(s.filter),
    stats: [
      { label: "notes", value: String(s.total), emphasis: true },
      { label: "entries", value: String(s.totalEntries) },
    ],
    barGroups,
    histogram:
      s.byMonth.length > 0
        ? { title: "Over time", bars: s.byMonth.map((m) => ({ label: m.month, value: m.count })) }
        : null,
  };
}

/** Map a ProjectsSummary rollup to the normalized report. Each project bar shows
 *  its percent-complete (overdue projects toned red). Pure. Its filter is the
 *  scope-flag shape, not an ArtifactFilter, so the chips are built inline. */
export function projectsSummaryReport(s: ProjectsSummary): SummaryReport {
  const scope: string[] = [s.filter.includeShared ? "whole lab" : "mine"];
  scope.push(s.filter.includeArchived ? "incl. archived" : "active only");
  const projectRows: SummaryBarRow[] = s.projects.map((p) => ({
    label: p.name,
    value: p.percentComplete,
    display: `${p.percentComplete}%`,
    tone: p.overdue ? ("overdue" as const) : ("done" as const),
  }));
  const barGroups: SummaryBarGroup[] = [];
  if (projectRows.length > 0) barGroups.push({ title: "Percent complete", rows: projectRows });
  return {
    kind: "summarize_projects",
    heading: "Projects",
    scope,
    stats: [
      { label: "projects", value: String(s.totalProjects), emphasis: true },
      { label: "with overdue", value: String(s.projectsWithOverdue), tone: "overdue" },
    ],
    barGroups,
    histogram: null,
  };
}

/** Map an InventorySummary aggregate to the normalized report. The flag lists drive
 *  the headline tiles (low / out / expiring), categories drive the breakdown. Pure. */
export function inventorySummaryReport(s: InventorySummary): SummaryReport {
  const scope: string[] = [
    s.filter.owners && s.filter.owners.length > 0 ? s.filter.owners.join(", ") : "whole lab",
    `expiring ≤ ${s.filter.expiringWithinDays}d`,
  ];
  if (s.filter.keywords?.trim()) scope.push(`"${s.filter.keywords.trim()}"`);
  const categoryRows: SummaryBarRow[] = s.byCategory.map((c) => ({
    label: c.category,
    value: c.count,
    tone: "accent" as const,
  }));
  const barGroups: SummaryBarGroup[] = [];
  if (categoryRows.length > 0) barGroups.push({ title: "By category", rows: categoryRows });
  return {
    kind: "summarize_inventory",
    heading: "Inventory",
    scope,
    stats: [
      { label: "items", value: String(s.itemCount), emphasis: true },
      { label: "low", value: String(s.low.length), tone: "upcoming" },
      { label: "out", value: String(s.out.length), tone: "overdue" },
      { label: "expiring soon", value: String(s.expiringSoon.length), tone: "upcoming" },
    ],
    barGroups,
    histogram: null,
  };
}

/** Map a cross-type LabDigest to the normalized report (the week-in-review card).
 *  Every number is lifted verbatim from the composed digest. Pure. */
export function labDigestReport(d: LabDigest): SummaryReport {
  const scope: string[] = [];
  if (d.window.since && d.window.until) scope.push(`${d.window.since} to ${d.window.until}`);
  else if (d.window.since) scope.push(`since ${d.window.since}`);
  scope.push(d.window.owners && d.window.owners.length > 0 ? d.window.owners.join(", ") : "whole lab");
  return {
    kind: "lab_digest",
    heading: "Lab digest",
    scope,
    stats: [
      { label: "experiments run", value: String(d.experiments.run), emphasis: true },
      { label: "finished", value: String(d.experiments.finished), tone: "done" },
      { label: "notes written", value: String(d.notes.written) },
      { label: "spend", value: d.purchases.totalSpendDisplay, tone: "spend" },
    ],
    barGroups: [
      {
        title: "This window",
        rows: [
          { label: "Experiments", value: d.experiments.run, tone: "accent" },
          { label: "Finished", value: d.experiments.finished, tone: "done" },
          { label: "Overdue", value: d.experiments.overdue, tone: "overdue" },
          { label: "Notes", value: d.notes.written, tone: "accent" },
          { label: "Purchases", value: d.purchases.made, tone: "spend" },
        ],
      },
    ],
    histogram: null,
  };
}

/** Read a SummaryReport off a (possibly unstripped) tool result, or null when the
 *  result carries no summary aggregate. Reuses recordSetFromResult so the parse and
 *  the `_ui` key stay in one place; the aggregate rides on the record-set `_ui`. */
export function summaryReportFromResult(result: unknown): SummaryReport | null {
  const set = recordSetFromResult(result);
  const aggregate = (set as { aggregate?: SummaryReport } | null)?.aggregate;
  return aggregate ?? null;
}
