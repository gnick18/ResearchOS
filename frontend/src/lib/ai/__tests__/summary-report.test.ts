// Tests for the summary-aggregate widget seam (BeakerAI lane, 2026-06-15). Asserts
// the normalized report each builder emits from a deterministic aggregate, the
// scope-chip echo, and the attach/extract round-trip that carries the aggregate on
// the shared record-set _ui (including the >= 2 gate that keeps a tiny summary
// prose-only). The widget renders verbatim from this, so the builders ARE the
// contract.

import { describe, it, expect } from "vitest";
import type { ArtifactFilter } from "@/lib/ai/artifact-index";
import type { ExperimentSummary } from "@/lib/ai/tools/summarize-experiments";
import type { PurchaseSummary } from "@/lib/ai/tools/summarize-purchases";
import { attachSummaryUi, recordSetFromResult, type RecordSetRow } from "@/lib/ai/record-set";
import {
  experimentSummaryReport,
  purchaseSummaryReport,
  noteSummaryReport,
  projectsSummaryReport,
  inventorySummaryReport,
  labDigestReport,
  scopeChips,
  summaryReportFromResult,
} from "@/lib/ai/summary-report";

const filter: ArtifactFilter = {
  types: ["experiment"],
  since: "2026-04-01",
  until: "2026-06-30",
  owners: ["kritika"],
  status: "overdue",
};

const expSummary: ExperimentSummary = {
  filter,
  total: 12,
  byStatus: { complete: 7, active: 3, overdue: 2, upcoming: 0 },
  byProject: [{ projectId: "9", projectName: "cyp51A", count: 8 }],
  byOwner: { kritika: 8, diego: 4 },
  byMonth: [
    { month: "2026-04", count: 4 },
    { month: "2026-05", count: 8 },
  ],
  finishingThisWeek: 3,
  asOf: "2026-06-15",
  items: [],
  truncated: false,
};

const purSummary: PurchaseSummary = {
  filter: { types: ["purchase"] },
  count: 5,
  totalSpend: 6966,
  totalSpendDisplay: "$6,966.00",
  byVendor: [
    { key: "Sigma", count: 3, spend: 5000, spendDisplay: "$5,000.00" },
    { key: "Fisher", count: 2, spend: 1966, spendDisplay: "$1,966.00" },
  ],
  byCategory: [{ key: "Reagents", count: 5, spend: 6966, spendDisplay: "$6,966.00" }],
  byMonth: [{ key: "2026-05", count: 5, spend: 6966, spendDisplay: "$6,966.00" }],
  byStatus: { needs_ordering: 1, ordered: 1, received: 3 },
  pendingVsReceived: { pending: 2, received: 3 },
  largestItems: [],
  truncated: false,
};

describe("scopeChips", () => {
  it("echoes the date window, owners, and status", () => {
    expect(scopeChips(filter)).toEqual([
      "2026-04-01 to 2026-06-30",
      "kritika",
      "overdue",
    ]);
  });
  it("defaults to whole lab when no owners are set", () => {
    expect(scopeChips({ types: ["experiment"] })).toEqual(["whole lab"]);
  });
});

describe("experimentSummaryReport", () => {
  const report = experimentSummaryReport(expSummary);
  it("copies the counts verbatim into stat tiles", () => {
    expect(report.heading).toBe("Experiments");
    expect(report.stats.find((s) => s.label === "experiments")?.value).toBe("12");
    expect(report.stats.find((s) => s.label === "overdue")?.value).toBe("2");
    expect(report.stats.find((s) => s.label === "finishing this week")?.value).toBe("3");
  });
  it("builds a by-status group and includes owner + project groups when present", () => {
    const titles = report.barGroups.map((g) => g.title);
    expect(titles).toContain("By status");
    expect(titles).toContain("By owner");
    expect(titles).toContain("By project");
    const owner = report.barGroups.find((g) => g.title === "By owner")!;
    // descending by count
    expect(owner.rows.map((r) => r.label)).toEqual(["kritika", "diego"]);
  });
  it("maps byMonth to a histogram", () => {
    expect(report.histogram?.bars).toEqual([
      { label: "2026-04", value: 4 },
      { label: "2026-05", value: 8 },
    ]);
  });
});

describe("purchaseSummaryReport", () => {
  const report = purchaseSummaryReport(purSummary);
  it("echoes the pre-formatted spend strings verbatim, never a re-typed number", () => {
    expect(report.stats.find((s) => s.label === "total spend")?.value).toBe("$6,966.00");
    const vendor = report.barGroups.find((g) => g.title === "Spend by vendor")!;
    expect(vendor.rows[0]).toMatchObject({ label: "Sigma", display: "$5,000.00", value: 5000 });
  });
  it("splits pending vs received from the aggregate", () => {
    expect(report.stats.find((s) => s.label === "received")?.value).toBe("3");
    expect(report.stats.find((s) => s.label === "pending")?.value).toBe("2");
  });
});

describe("the remaining four builders", () => {
  it("notes: counts + entry total + by-owner + histogram", () => {
    const r = noteSummaryReport({
      filter: { types: ["note"] },
      total: 9,
      byOwner: { kritika: 5, diego: 4 },
      byMonth: [{ month: "2026-05", count: 9 }],
      totalEntries: 22,
      items: [],
      truncated: false,
    });
    expect(r.heading).toBe("Notes");
    expect(r.stats.find((s) => s.label === "entries")?.value).toBe("22");
    expect(r.barGroups[0].title).toBe("By owner");
    expect(r.histogram?.bars[0]).toEqual({ label: "2026-05", value: 9 });
  });

  it("projects: percent-complete bars, overdue toned red, manual scope chips", () => {
    const r = projectsSummaryReport({
      filter: { includeShared: true, includeArchived: false, asOf: "2026-06-15" },
      totalProjects: 2,
      projectsWithOverdue: 1,
      projects: [
        { name: "cyp51A", percentComplete: 80, overdue: true } as never,
        { name: "screen", percentComplete: 40, overdue: false } as never,
      ],
    });
    expect(r.scope).toEqual(["whole lab", "active only"]);
    const bars = r.barGroups[0].rows;
    expect(bars[0]).toMatchObject({ label: "cyp51A", display: "80%", tone: "overdue" });
    expect(bars[1]).toMatchObject({ tone: "done" });
  });

  it("inventory: flag tiles + expiring-window scope chip", () => {
    const r = inventorySummaryReport({
      filter: { owners: null, keywords: null, expiringWithinDays: 30, asOf: "2026-06-15" },
      itemCount: 40,
      stockCount: 88,
      byCategory: [{ category: "Reagents", count: 30 }],
      low: [{}, {}] as never,
      out: [{}] as never,
      expiringSoon: [{}, {}, {}] as never,
      expired: [],
      recentMovements: [],
      truncated: false,
    });
    expect(r.scope).toContain("expiring ≤ 30d");
    expect(r.stats.find((s) => s.label === "low")?.value).toBe("2");
    expect(r.stats.find((s) => s.label === "expiring soon")?.value).toBe("3");
  });

  it("lab_digest: cross-type tiles echo the verbatim spend string", () => {
    const r = labDigestReport({
      window: { since: "2026-06-08", until: "2026-06-14", owners: null, asOf: "2026-06-15" },
      experiments: { run: 6, finished: 4, overdue: 1, finishingThisWeek: 2 },
      notes: { written: 3, entries: 7 },
      purchases: { made: 2, totalSpend: 412, totalSpendDisplay: "$412.00", pending: 1 },
      scheduled: { projectsWithOverdue: 1, nextUpcomingStart: "2026-06-16" },
    });
    expect(r.heading).toBe("Lab digest");
    expect(r.stats.find((s) => s.label === "spend")?.value).toBe("$412.00");
    expect(r.barGroups[0].rows.map((x) => x.label)).toContain("Experiments");
  });
});

describe("attach/extract round-trip", () => {
  const rows: RecordSetRow[] = [
    { type: "experiment", id: "1", title: "A" },
    { type: "experiment", id: "2", title: "B" },
  ];
  it("rides the aggregate on the record-set _ui and reads it back", () => {
    const report = experimentSummaryReport(expSummary);
    const result = attachSummaryUi({ ok: true as const }, rows, report, {
      kind: "summarize_experiments",
      title: "Experiments",
      total: 12,
    });
    // items still parse as a record set (rendered below), aggregate rides along
    expect(recordSetFromResult(result)?.items).toHaveLength(2);
    expect(summaryReportFromResult(result)?.heading).toBe("Experiments");
  });
  it("attaches nothing for a sub-set (< 2 rows) so a tiny summary stays prose", () => {
    const report = experimentSummaryReport(expSummary);
    const result = attachSummaryUi({ ok: true as const }, rows.slice(0, 1), report, {
      kind: "summarize_experiments",
      title: "Experiments",
      total: 1,
    });
    expect(summaryReportFromResult(result)).toBeNull();
    expect(recordSetFromResult(result)).toBeNull();
  });
  it("returns null for a plain record-set with no aggregate", () => {
    const result = { _ui: { kind: "search", title: "x", total: 2, items: rows } };
    expect(summaryReportFromResult(result)).toBeNull();
  });
});
