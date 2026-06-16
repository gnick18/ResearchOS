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
