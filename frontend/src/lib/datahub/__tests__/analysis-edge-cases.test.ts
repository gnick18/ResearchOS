import { describe, it, expect } from "vitest";

import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
} from "@/lib/datahub/model/types";
import { runAnalysis, type NormalizedSurvival } from "@/lib/datahub/run-analysis";

// Edge / degenerate inputs for the new analyses. Confirms runAnalysis returns a
// typed { ok: false, error } the ResultsSheet renders as a calm "this analysis
// cannot run on the current table" message, OR a graceful ok:true result for
// the legitimately-empty cases (no events yet), rather than throwing. This is
// the failure-mode coverage the happy-path tests do not give.

function meta(table_type: DataHubDocument["table_type"]): DataHubDocument {
  return {
    id: "1",
    name: "Edge",
    project_ids: [],
    folder_path: null,
    table_type,
    created_at: "2026-06-11T00:00:00.000Z",
  };
}
function content(
  table_type: DataHubDocument["table_type"],
  columns: DataHubDocContent["columns"],
  rows: RowRecord[],
): DataHubDocContent {
  return { meta: meta(table_type), columns, rows, analyses: [], plots: [] };
}
function spec(type: string, columnIds: string[] = []): AnalysisSpec {
  return {
    id: "a1",
    type,
    params: {},
    inputs: { columnIds },
    resultCache: null,
    resultStale: false,
  };
}

describe("analysis edge cases: XY", () => {
  const cols = [
    { id: "x", name: "X", role: "x" as const, dataType: "number" as const },
    { id: "y1", name: "Y", role: "y" as const, dataType: "number" as const },
  ];

  it("linear regression with a single finite pair fails cleanly", () => {
    const c = content("xy", cols, [
      { id: "r1", cells: { x: 1, y1: 2 } },
      { id: "r2", cells: { x: 2, y1: null } }, // dropped (no Y)
    ]);
    const out = runAnalysis(spec("linearRegression", ["y1"]), c);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.length).toBeGreaterThan(0);
  });

  it("correlation with two pairs fails cleanly (needs three)", () => {
    const c = content("xy", cols, [
      { id: "r1", cells: { x: 1, y1: 2 } },
      { id: "r2", cells: { x: 2, y1: 4 } },
    ]);
    expect(runAnalysis(spec("correlationPearson", ["y1"]), c).ok).toBe(false);
  });

  it("dose-response with too few points for the 4PL fails cleanly", () => {
    // 4PL has 4 params; 4 points is underdetermined, the engine must reject it.
    const c = content("xy", cols, [
      { id: "r1", cells: { x: -8, y1: 5 } },
      { id: "r2", cells: { x: -7, y1: 20 } },
      { id: "r3", cells: { x: -6, y1: 60 } },
      { id: "r4", cells: { x: -5, y1: 95 } },
    ]);
    const out = runAnalysis(spec("doseResponse", ["y1"]), c);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.length).toBeGreaterThan(0);
  });
});

describe("analysis edge cases: Grouped (two-way ANOVA)", () => {
  const cols = [
    { id: "rowlabel", name: "Row", role: "x" as const, dataType: "text" as const },
    { id: "a1", name: "A", role: "y" as const, dataType: "number" as const, datasetId: "g1", subcolumnKind: "replicate" as const },
    { id: "a2", name: "A", role: "y" as const, dataType: "number" as const, datasetId: "g1", subcolumnKind: "replicate" as const },
    { id: "b1", name: "B", role: "y" as const, dataType: "number" as const, datasetId: "g2", subcolumnKind: "replicate" as const },
    { id: "b2", name: "B", role: "y" as const, dataType: "number" as const, datasetId: "g2", subcolumnKind: "replicate" as const },
  ];

  it("an empty (row, group) cell fails cleanly", () => {
    // lo/B has no values, so the design has an empty cell.
    const c = content("grouped", cols, [
      { id: "r1", cells: { rowlabel: "lo", a1: 9, a2: 10, b1: null, b2: null } },
      { id: "r2", cells: { rowlabel: "hi", a1: 14, a2: 15, b1: 17, b2: 18 } },
    ]);
    expect(runAnalysis(spec("twoWayAnova"), c).ok).toBe(false);
  });

  it("no replication (one value per cell) fails cleanly", () => {
    const oneRep = [
      { id: "rowlabel", name: "Row", role: "x" as const, dataType: "text" as const },
      { id: "a1", name: "A", role: "y" as const, dataType: "number" as const, datasetId: "g1", subcolumnKind: "replicate" as const },
      { id: "b1", name: "B", role: "y" as const, dataType: "number" as const, datasetId: "g2", subcolumnKind: "replicate" as const },
    ];
    const c = content("grouped", oneRep, [
      { id: "r1", cells: { rowlabel: "lo", a1: 9, b1: 11 } },
      { id: "r2", cells: { rowlabel: "hi", a1: 14, b1: 17 } },
    ]);
    expect(runAnalysis(spec("twoWayAnova"), c).ok).toBe(false);
  });
});

describe("analysis edge cases: Survival", () => {
  const cols = [
    { id: "time", name: "Time", role: "x" as const, dataType: "number" as const },
    { id: "event", name: "Event", role: "y" as const, dataType: "number" as const },
    { id: "group", name: "Group", role: "group" as const, dataType: "text" as const },
  ];

  it("all-censored data runs gracefully with no median (not an error)", () => {
    const c = content("survival", cols, [
      { id: "r1", cells: { time: 5, event: 0, group: "A" } },
      { id: "r2", cells: { time: 8, event: 0, group: "A" } },
      { id: "r3", cells: { time: 6, event: 0, group: "B" } },
      { id: "r4", cells: { time: 9, event: 0, group: "B" } },
    ]);
    const out = runAnalysis(spec("kaplanMeier"), c);
    expect(out.ok).toBe(true);
    if (out.ok && out.kind === "survival") {
      const r = out as NormalizedSurvival & { ok: true };
      // No events -> survival never drops -> median not reached, zero events.
      for (const g of r.groups) {
        expect(g.median).toBeNull();
        expect(g.events).toBe(0);
      }
    }
  });

  it("a single arm runs Kaplan-Meier with no log-rank", () => {
    const c = content("survival", cols, [
      { id: "r1", cells: { time: 5, event: 1, group: null } },
      { id: "r2", cells: { time: 8, event: 1, group: null } },
      { id: "r3", cells: { time: 12, event: 0, group: null } },
    ]);
    const out = runAnalysis(spec("kaplanMeier"), c);
    expect(out.ok).toBe(true);
    if (out.ok && out.kind === "survival") {
      expect(out.groups).toHaveLength(1);
      expect(out.logRank).toBeNull(); // needs two or more arms
    }
  });

  it("an empty survival table fails cleanly", () => {
    const c = content("survival", cols, [
      { id: "r1", cells: { time: null, event: null, group: null } },
    ]);
    expect(runAnalysis(spec("kaplanMeier"), c).ok).toBe(false);
  });
});
