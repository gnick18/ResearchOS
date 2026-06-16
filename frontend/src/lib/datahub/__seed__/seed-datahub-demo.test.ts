/**
 * seed-datahub-demo.test.ts
 *
 * Re-runnable generator + well-formedness gate for the Data Hub demo fixtures.
 *
 * Two modes, both driven through vitest so the `@` alias and the real Data Hub
 * doc code resolve without a separate build step (the repo has no tsx / ts-node):
 *
 *   GENERATE  (SEED_DEMO=1 vitest run src/lib/datahub/__seed__):
 *     builds the demo Data Hub documents in memory using the REAL analysis engine
 *     (runAnalysis) + plot builder (buildPlotSpec), checks each one round-trips
 *     through the REAL seedDataHubDoc snapshot exporter, then writes the readable
 *     `.json` mirror into frontend/public/demo-data/users/alex/datahub/. Run this
 *     when the demo content below changes, then commit the regenerated files. The
 *     binary `.loro` snapshot is not shipped (the editor re-seeds it from the
 *     mirror on first edit), so only the `.json` mirror is written and committed.
 *
 *   GATE  (plain vitest run, the default in CI):
 *     reads the committed `.json` mirrors back, re-seeds a Loro doc from each, and
 *     asserts the on-disk fixture is well-formed (columns / rows / analyses / plots
 *     round-trip, the analysis carries a real cached result, the plot points at a
 *     real table). This catches drift if the Data Hub on-disk format ever changes
 *     under the committed fixture.
 *
 * Why a `.test.ts` and not a `.mjs`: the doc + engine modules import via the `@`
 * alias and pull in loro-crdt; running them through vitest is the only no-extra-dep
 * way to execute the real code path (mirrors how the golden generators piggyback on
 * vitest). The generator half is gated behind SEED_DEMO so the default test run is a
 * read-only assertion, never a disk write.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LoroDoc } from "loro-crdt";
import { seedDataHubDoc, getDataHubContent } from "@/lib/loro/datahub-doc";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import { buildPlotSpec, type FitModelId } from "@/lib/datahub/plot-spec";
import type {
  AnalysisSpec,
  ColumnDef,
  DataHubDocContent,
  DataHubDocument,
  PlotSpec,
  RowRecord,
} from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
// .../frontend/src/lib/datahub/__seed__ -> .../frontend
const FRONTEND_ROOT = join(HERE, "..", "..", "..", "..");
const DATAHUB_DIR = join(
  FRONTEND_ROOT,
  "public",
  "demo-data",
  "users",
  "alex",
  "datahub",
);

// The demo persona owner the fixtures attach to.
const OWNER = "alex";
// alex's demo projects (stringified ids, matching the catalog's project_ids).
const PROJ_BIOFUEL = "1"; // "DEMO: Engineer FakeYeast for biofuel"
const PROJ_STRESS = "3"; // "DEMO: Stress tolerance screening"

// Fixed timestamps. The demo rebase (lib/demo/rebase.ts) does NOT touch the
// datahub dir, so these stay put. They read as recent bench work without being
// schedule-relative anywhere in the Data Hub UI.
const CREATED_AT = "2026-05-14T15:00:00.000Z";
const EDITED_AT = "2026-05-15T10:30:00.000Z";

// ---------------------------------------------------------------------------
// Builders for the demo documents (realistic-but-fake replicate numbers)
// ---------------------------------------------------------------------------

function col(
  id: string,
  name: string,
  role: ColumnDef["role"],
  dataType: ColumnDef["dataType"] = "number",
): ColumnDef {
  return { id, name, role, dataType };
}

/**
 * Build a Column table from a label-per-column matrix. Each group is a y column;
 * each replicate is a row. Ragged columns are allowed (shorter groups leave the
 * trailing rows null), which is exactly how real replicate sets look.
 */
function columnTable(
  groups: Array<{ id: string; name: string; values: number[] }>,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns = groups.map((g) => col(g.id, g.name, "y"));
  const maxLen = Math.max(...groups.map((g) => g.values.length));
  const rows: RowRecord[] = [];
  for (let r = 0; r < maxLen; r++) {
    const cells: Record<string, number | string | null> = {};
    for (const g of groups) {
      cells[g.id] = r < g.values.length ? g.values[r] : null;
    }
    rows.push({ id: `row-${r + 1}`, cells });
  }
  return { columns, rows };
}

/** Build an XY table: one x column plus N y columns, rows aligned by index. */
function xyTable(
  xName: string,
  xValues: number[],
  ys: Array<{ id: string; name: string; values: number[] }>,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns: ColumnDef[] = [
    col("col-x", xName, "x"),
    ...ys.map((y) => col(y.id, y.name, "y")),
  ];
  const rows: RowRecord[] = xValues.map((xv, r) => {
    const cells: Record<string, number | string | null> = { "col-x": xv };
    for (const y of ys) cells[y.id] = r < y.values.length ? y.values[r] : null;
    return { id: `row-${r + 1}`, cells };
  });
  return { columns, rows };
}

interface DemoDocSpec {
  id: string;
  name: string;
  table_type: DataHubDocument["table_type"];
  project_ids: string[];
  folder_path: string | null;
  columns: ColumnDef[];
  rows: RowRecord[];
  /** An analysis to run against the table; its result is computed and cached. */
  analysis?: { id: string; type: string; columnIds: string[] };
  /** A figure to draw; built via the real plot builder. */
  plot?: {
    id: string;
    kind: "columnScatter" | "columnBar" | "xyScatter" | "groupedBar";
    analysisId?: string | null;
    yColumnId?: string | null;
    yTitle?: string;
    xTitle?: string;
    title?: string;
    /** Fitted curve to bake into the figure (defaults to linear in the builder). */
    fitModel?: FitModelId;
    /** Significance-bracket comparison set ("all" pairs vs "vsControl"). */
    bracketComparisons?: "all" | "vsControl";
  };
}

/**
 * The demo Data Hub documents, themed to the FakeYeast biofuel lab. Numbers are
 * fabricated but plausible; stats are computed by the real engine, not eyeballed.
 */
function demoDocs(): DemoDocSpec[] {
  // 1) Column table: fakeGFP reporter expression by strain (relative qPCR).
  //    Control vs three engineered strains, 5 biological replicates each.
  const gfp = columnTable([
    { id: "col-1", name: "Control (WT)", values: [1.02, 0.97, 1.05, 0.99, 1.0] },
    { id: "col-2", name: "FakeYeast-001", values: [2.31, 2.48, 2.19, 2.55, 2.4] },
    { id: "col-3", name: "FakeYeast-002", values: [3.12, 3.45, 2.98, 3.3, 3.21] },
    { id: "col-4", name: "FakeYeast-003", values: [1.85, 1.72, 1.94, 1.68, 1.8] },
  ]);

  // 2) XY table: growth curve, OD600 over time, YPD vs 4% glucose.
  const time = [0, 2, 4, 6, 8, 10, 12, 24];
  const growth = xyTable("Time (h)", time, [
    {
      id: "col-ypd",
      name: "YPD",
      values: [0.05, 0.12, 0.31, 0.74, 1.32, 1.98, 2.41, 3.05],
    },
    {
      id: "col-glu",
      name: "4% glucose",
      values: [0.05, 0.09, 0.21, 0.48, 0.92, 1.44, 1.83, 2.36],
    },
  ]);

  // 3) Column table: heat-shock survival (% survival at 50 C, 30 min) by strain.
  const survival = columnTable([
    { id: "col-1", name: "Control (WT)", values: [42.1, 38.7, 45.3, 40.2] },
    { id: "col-2", name: "FakeYeast-001", values: [61.4, 58.9, 64.2, 60.1] },
    { id: "col-3", name: "FakeYeast-002", values: [55.8, 52.3, 57.1, 54.6] },
  ]);

  // 4) XY table: dose-response, FakeDrug-A inhibition of FakeYeast growth. x is
  //    log10(dose in M), an 11-point serial dilution; y is percent inhibition.
  //    The same arrays the D1 dose-response transparency pins are validated on, so
  //    the 4PL / 5PL fit and the EC50 are known to converge cleanly.
  const dose = xyTable(
    "log[FakeDrug-A] (M)",
    [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0],
    [
      {
        id: "col-inhib",
        name: "% inhibition",
        values: [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1],
      },
    ],
  );

  // 5) XY table: a binary resistance outcome vs FakeDrug-A dose, for simple
  //    logistic regression. x is dose (mg/L); y is 1 if the colony survived. The
  //    D4 logistic transparency dataset (moderate overlap, no separation).
  const resistance = xyTable(
    "FakeDrug-A dose (mg/L)",
    [
      0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5,
      8.0, 8.5, 9.0, 9.5, 10.0,
    ],
    [
      {
        id: "col-resist",
        name: "Resistant (1 = survived)",
        values: [0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1],
      },
    ],
  );

  // 6) Column table: biofuel yield against two predictors, for multiple linear
  //    regression. Each column is one variable (Y first, then the two predictors),
  //    rows aligned by run. The D5 multiple-regression transparency dataset (mild
  //    predictor correlation so the VIF is meaningful, about 3.5).
  const yield2 = columnTable([
    {
      id: "col-yield",
      name: "Biofuel yield (g/L)",
      values: [
        4.1, 7.8, 8.9, 13.2, 13.0, 18.7, 18.2, 24.1, 22.0, 28.9, 27.1, 32.0,
      ],
    },
    {
      id: "col-sugar",
      name: "Sugar feed (g/L)",
      values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    },
    {
      id: "col-aer",
      name: "Aeration (vvm x10)",
      values: [2, 5, 3, 8, 4, 9, 6, 11, 7, 13, 10, 14],
    },
  ]);

  // 7) XY table: two dose-response curves that share Bottom / Top / Hill and
  //    differ only in EC50, the textbook case for a global (shared-parameter) fit.
  //    The D3 global-fit transparency dataset (curve A EC50 10x lower than B).
  const multiCurve = xyTable(
    "log[drug] (M)",
    [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0],
    [
      {
        id: "col-ya",
        name: "FakeDrug-A (% inhibition)",
        values: [0.9, 2.9, 8.6, 23.0, 50.4, 75.9, 90.8, 96.9, 99.1, 99.6, 100.1],
      },
      {
        id: "col-yb",
        name: "FakeDrug-B (% inhibition)",
        values: [0.1, 0.4, 0.8, 2.9, 8.6, 23.4, 50.4, 75.9, 90.8, 96.9, 99.1],
      },
    ],
  );

  return [
    {
      id: "1",
      name: "fakeGFP expression (qPCR)",
      table_type: "column",
      project_ids: [PROJ_BIOFUEL],
      folder_path: null,
      columns: gfp.columns,
      rows: gfp.rows,
      analysis: {
        id: "analysis-gfp-anova",
        type: "oneWayAnova",
        columnIds: ["col-1", "col-2", "col-3", "col-4"],
      },
      plot: {
        id: "plot-gfp-scatter",
        kind: "columnScatter",
        analysisId: "analysis-gfp-anova",
        yTitle: "Relative fakeGFP expression",
        title: "fakeGFP reporter induction by strain",
        // Each strain vs the WT control, not all 6 pairwise (cleaner figure).
        bracketComparisons: "vsControl",
      },
    },
    {
      id: "2",
      name: "Growth curve, YPD vs 4% glucose",
      table_type: "xy",
      project_ids: [PROJ_STRESS],
      folder_path: null,
      columns: growth.columns,
      rows: growth.rows,
      analysis: {
        id: "analysis-growth-reg",
        type: "linearRegression",
        columnIds: ["col-ypd"],
      },
      plot: {
        id: "plot-growth-xy",
        kind: "xyScatter",
        yColumnId: "col-ypd",
        yTitle: "OD600",
        xTitle: "Time (h)",
        title: "Growth curve, YPD vs 4% glucose",
      },
    },
    {
      id: "3",
      name: "Heat-shock survival by strain",
      table_type: "column",
      project_ids: [PROJ_STRESS],
      folder_path: null,
      columns: survival.columns,
      rows: survival.rows,
      analysis: {
        id: "analysis-survival-ttest",
        type: "unpairedTTest",
        columnIds: ["col-1", "col-2"],
      },
      plot: {
        id: "plot-survival-bar",
        kind: "columnBar",
        analysisId: "analysis-survival-ttest",
        yTitle: "% survival (50 C, 30 min)",
        title: "Heat-shock survival by strain",
      },
    },
    {
      id: "4",
      name: "Dose-response, FakeDrug-A inhibition",
      table_type: "xy",
      project_ids: [PROJ_STRESS],
      folder_path: null,
      columns: dose.columns,
      rows: dose.rows,
      analysis: {
        id: "analysis-dose-4pl",
        type: "doseResponse",
        columnIds: ["col-inhib"],
      },
      plot: {
        id: "plot-dose-xy",
        kind: "xyScatter",
        yColumnId: "col-inhib",
        yTitle: "% inhibition",
        xTitle: "log[FakeDrug-A] (M)",
        title: "Dose-response, FakeDrug-A inhibition",
        fitModel: "logistic4pl",
      },
    },
    {
      id: "5",
      name: "Resistance vs FakeDrug-A dose (binary)",
      table_type: "xy",
      project_ids: [PROJ_STRESS],
      folder_path: null,
      columns: resistance.columns,
      rows: resistance.rows,
      analysis: {
        id: "analysis-resist-logit",
        type: "logisticRegression",
        columnIds: ["col-resist"],
      },
    },
    {
      id: "6",
      name: "Biofuel yield vs sugar feed + aeration",
      table_type: "column",
      project_ids: [PROJ_BIOFUEL],
      folder_path: null,
      columns: yield2.columns,
      rows: yield2.rows,
      analysis: {
        id: "analysis-yield-mlr",
        type: "multipleRegression",
        columnIds: ["col-yield", "col-sugar", "col-aer"],
      },
    },
    {
      id: "7",
      name: "Two-drug dose-response (global fit)",
      table_type: "xy",
      project_ids: [PROJ_STRESS],
      folder_path: null,
      columns: multiCurve.columns,
      rows: multiCurve.rows,
      analysis: {
        id: "analysis-globalfit",
        type: "globalFit",
        columnIds: ["col-ya", "col-yb"],
      },
      plot: {
        id: "plot-multicurve-xy",
        kind: "xyScatter",
        yColumnId: "col-ya",
        yTitle: "% inhibition",
        xTitle: "log[drug] (M)",
        title: "Two-drug dose-response",
      },
    },
  ];
}

/**
 * Materialize a DemoDocSpec into a full DataHubDocContent, running the analysis
 * through the real engine so resultCache holds a genuine result (not a stub) and
 * building the plot through the real builder so source / style are canonical.
 */
function buildContent(spec: DemoDocSpec): DataHubDocContent {
  const meta: DataHubDocument = {
    id: spec.id,
    name: spec.name,
    project_ids: spec.project_ids,
    folder_path: spec.folder_path,
    table_type: spec.table_type,
    created_at: CREATED_AT,
    last_edited_by: OWNER,
    last_edited_at: EDITED_AT,
  };

  // Base content (no analyses / plots yet) so the engine reads the table.
  const base: DataHubDocContent = {
    meta,
    columns: spec.columns,
    rows: spec.rows,
    analyses: [],
    plots: [],
  };

  const analyses: AnalysisSpec[] = [];
  if (spec.analysis) {
    const draft: AnalysisSpec = {
      id: spec.analysis.id,
      type: spec.analysis.type,
      params: {},
      inputs: { columnIds: spec.analysis.columnIds },
      resultCache: null,
      resultStale: false,
    };
    const outcome = runAnalysis(draft, base);
    draft.resultCache = outcome.ok ? outcome : null;
    // If the engine could not run it, leave it stale so the page recomputes on
    // open rather than showing a permanently-empty result.
    draft.resultStale = !outcome.ok;
    analyses.push(draft);
  }

  const plots: PlotSpec[] = [];
  if (spec.plot) {
    plots.push(
      buildPlotSpec({
        id: spec.plot.id,
        kind: spec.plot.kind,
        tableId: spec.id,
        analysisId: spec.plot.analysisId ?? null,
        yColumnId: spec.plot.yColumnId ?? null,
        yTitle: spec.plot.yTitle,
        xTitle: spec.plot.xTitle,
        title: spec.plot.title,
        fitModel: spec.plot.fitModel,
        bracketComparisons: spec.plot.bracketComparisons,
      }),
    );
  }

  return { ...base, analyses, plots };
}

// ---------------------------------------------------------------------------
// GENERATE mode (SEED_DEMO=1) vs GATE mode (default)
// ---------------------------------------------------------------------------

const GENERATE = process.env.SEED_DEMO === "1";

describe("Data Hub demo fixtures", () => {
  if (GENERATE) {
    it("writes the .json mirrors", () => {
      mkdirSync(DATAHUB_DIR, { recursive: true });
      for (const spec of demoDocs()) {
        const content = buildContent(spec);
        // Sanity-check the content round-trips through the real CRDT exporter
        // before committing, even though only the readable mirror is shipped.
        seedDataHubDoc(content);
        writeFileSync(
          join(DATAHUB_DIR, `${spec.id}.json`),
          JSON.stringify(content, null, 2) + "\n",
          "utf8",
        );
      }
      expect(existsSync(join(DATAHUB_DIR, "1.json"))).toBe(true);
    });
    return;
  }

  // GATE mode: assert the committed fixtures are well-formed and round-trip.
  for (const spec of demoDocs()) {
    it(`fixture ${spec.id} (${spec.name}) is well-formed`, () => {
      const mirrorPath = join(DATAHUB_DIR, `${spec.id}.json`);
      expect(existsSync(mirrorPath), `${mirrorPath} missing`).toBe(true);

      const mirror = JSON.parse(
        readFileSync(mirrorPath, "utf8"),
      ) as DataHubDocContent;

      // Catalog metadata is intact and linked to a project.
      expect(mirror.meta.id).toBe(spec.id);
      expect(mirror.meta.name).toBe(spec.name);
      expect(mirror.meta.table_type).toBe(spec.table_type);
      expect(mirror.meta.project_ids).toEqual(spec.project_ids);

      // The table carries the seeded columns + rows.
      expect(mirror.columns.length).toBe(spec.columns.length);
      expect(mirror.rows.length).toBe(spec.rows.length);

      // The analysis (if any) carries a real cached result.
      if (spec.analysis) {
        const a = mirror.analyses.find((x) => x.id === spec.analysis!.id);
        expect(a, "seeded analysis missing").toBeTruthy();
        expect(a!.resultCache, "analysis result not cached").toBeTruthy();
        expect((a!.resultCache as { ok?: boolean }).ok).toBe(true);
      }

      // The plot (if any) points at this table.
      if (spec.plot) {
        const p = mirror.plots.find((x) => x.id === spec.plot!.id);
        expect(p, "seeded plot missing").toBeTruthy();
        expect((p!.source as { tableId?: string }).tableId).toBe(spec.id);
      }

      // Re-seed a Loro doc from the readable mirror and project it back to the
      // same shape, proving the committed `.json` round-trips through the real
      // CRDT exporter. The demo tree ships the `.json` mirror only (the editor
      // re-seeds the `.loro` snapshot on first edit), so the gate reads the
      // mirror rather than a committed binary sidecar.
      const doc = new LoroDoc();
      doc.import(seedDataHubDoc(mirror));
      const projected = getDataHubContent(doc, spec.id);
      expect(projected.columns.length).toBe(spec.columns.length);
      expect(projected.rows.length).toBe(spec.rows.length);
      expect(projected.analyses.length).toBe(mirror.analyses.length);
      expect(projected.plots.length).toBe(mirror.plots.length);
    });
  }
});
