// Dev-only: seed a freshly-connected ephemeral OPFS workspace with one of each
// thing so a fresh session is testable immediately, a project, one experiment
// (with an image), one list task, one single note, one multi-entry note, a
// purchase task with a couple of items, and a couple of Data Hub tables (a
// Control-vs-treatment Column table plus an XY growth curve) so the analysis
// picker and the rest of the Data Hub have real data to run against. Best-effort:
// a failure on any step is logged and the rest continue, so a partial seed never
// blocks the session.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  projectsApi,
  tasksApi,
  notesApi,
  purchasesApi,
  filesApi,
} from "@/lib/local-api";
import { dataHubApi } from "@/lib/datahub/api";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import { buildPlotSpec, type FitModelId, type PlotKind } from "@/lib/datahub/plot-spec";
import type {
  AnalysisSpec,
  ColumnDef,
  DataHubDocContent,
  DataHubTableType,
  RowRecord,
} from "@/lib/datahub/model/types";

/** ISO YYYY-MM-DD for today (local). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A small, visible demo PNG drawn on a canvas, returned as base64 (no data-URI
 *  prefix), so we can seed a real image without embedding a big blob. Null when
 *  no canvas is available. */
function demoImageBase64(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const c = document.createElement("canvas");
    c.width = 280;
    c.height = 180;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#1AA0E6";
    ctx.fillRect(0, 0, 280, 180);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px -apple-system, sans-serif";
    ctx.fillText("DEMO experiment image", 22, 96);
    ctx.font = "13px -apple-system, sans-serif";
    ctx.fillText("seeded into the fresh session", 22, 124);
    return c.toDataURL("image/png").split(",")[1] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Data Hub seeding
//
// These mirror the well-formed /demo fixtures (see
// frontend/src/lib/datahub/__seed__/seed-datahub-demo.test.ts) so a fresh
// ephemeral session opens with the same shape of tables the demo has. We reuse
// the real construction path (dataHubApi.create -> persistDataHubContent ->
// seedDataHubDoc) so the tables round-trip identically, and run the analysis
// through the real engine so the cached result is genuine, not a stub. The
// numbers are the exact arrays the demo uses, so this stays deterministic.
// ---------------------------------------------------------------------------

/** A ColumnDef, defaulting to a numeric column (mirrors the demo seed's col()). */
function col(
  id: string,
  name: string,
  role: ColumnDef["role"],
  dataType: ColumnDef["dataType"] = "number",
): ColumnDef {
  return { id, name, role, dataType };
}

/** Build a Column table: each group is a y column, each replicate a row. */
function columnTable(
  groups: Array<{ id: string; name: string; values: number[] }>,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns = groups.map((g) => col(g.id, g.name, "y"));
  const maxLen = Math.max(...groups.map((g) => g.values.length));
  const rows: RowRecord[] = [];
  for (let r = 0; r < maxLen; r++) {
    const cells: Record<string, number | string | null> = {};
    for (const g of groups) cells[g.id] = r < g.values.length ? g.values[r] : null;
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

interface EphemeralTableSpec {
  name: string;
  table_type: DataHubTableType;
  columns: ColumnDef[];
  rows: RowRecord[];
  /** An analysis to run against the table; its result is computed and cached. */
  analysis?: { id: string; type: string; columnIds: string[] };
  /** A figure to draw; built via the real plot builder once the id is known. */
  plot?: {
    id: string;
    kind: PlotKind;
    analysisId?: string | null;
    yColumnId?: string | null;
    yTitle?: string;
    xTitle?: string;
    title?: string;
    fitModel?: FitModelId;
  };
}

/**
 * Create one Data Hub table in the live workspace. The analysis is run through
 * the real engine against a base content (its cached result does NOT depend on
 * the document id), so it can be seeded in the same create() call. The plot's
 * source.tableId MUST match the minted document id, which create() allocates at
 * write time, so the plot is attached in a follow-up update() once the id exists.
 */
async function seedDataHubTable(
  projectId: string,
  spec: EphemeralTableSpec,
): Promise<void> {
  // Base content so the engine reads the table (meta is a stub here; create()
  // mints the authoritative meta with the real id and timestamps).
  const base: DataHubDocContent = {
    meta: {
      id: "",
      name: spec.name,
      project_ids: [projectId],
      folder_path: null,
      table_type: spec.table_type,
      created_at: "",
    },
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

  const created = await dataHubApi.create({
    name: spec.name,
    table_type: spec.table_type,
    project_ids: [projectId],
    columns: spec.columns,
    rows: spec.rows,
    analyses,
  });

  if (spec.plot) {
    const plot = buildPlotSpec({
      id: spec.plot.id,
      kind: spec.plot.kind,
      tableId: created.id,
      analysisId: spec.plot.analysisId ?? null,
      yColumnId: spec.plot.yColumnId ?? null,
      yTitle: spec.plot.yTitle,
      xTitle: spec.plot.xTitle,
      title: spec.plot.title,
      fitModel: spec.plot.fitModel,
    });
    await dataHubApi.update(created.id, { plots: [plot] });
  }
}

/**
 * Seed a couple of Data Hub tables into the fresh workspace, themed to the same
 * FakeYeast lab as the rest of the seed: a Control-vs-treatment Column table (4
 * groups, the analysis-picker's bread and butter) plus an XY growth curve. Each
 * table is best-effort on its own so one failing never blocks the other.
 */
async function seedDataHubTables(projectId: string): Promise<void> {
  // 1) Column table: fakeGFP reporter expression by strain (relative qPCR).
  //    Control vs three engineered strains, 5 biological replicates each.
  const gfp = columnTable([
    { id: "col-1", name: "Control (WT)", values: [1.02, 0.97, 1.05, 0.99, 1.0] },
    { id: "col-2", name: "FakeYeast-001", values: [2.31, 2.48, 2.19, 2.55, 2.4] },
    { id: "col-3", name: "FakeYeast-002", values: [3.12, 3.45, 2.98, 3.3, 3.21] },
    { id: "col-4", name: "FakeYeast-003", values: [1.85, 1.72, 1.94, 1.68, 1.8] },
  ]);
  try {
    await seedDataHubTable(projectId, {
      name: "fakeGFP expression (qPCR)",
      table_type: "column",
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
      },
    });
  } catch (e) {
    console.warn("[seed-ephemeral] datahub column table skipped:", e);
  }

  // 2) XY table: growth curve, OD600 over time, YPD vs 4% glucose.
  const time = [0, 2, 4, 6, 8, 10, 12, 24];
  const growth = xyTable("Time (h)", time, [
    { id: "col-ypd", name: "YPD", values: [0.05, 0.12, 0.31, 0.74, 1.32, 1.98, 2.41, 3.05] },
    { id: "col-glu", name: "4% glucose", values: [0.05, 0.09, 0.21, 0.48, 0.92, 1.44, 1.83, 2.36] },
  ]);
  try {
    await seedDataHubTable(projectId, {
      name: "Growth curve, YPD vs 4% glucose",
      table_type: "xy",
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
    });
  } catch (e) {
    console.warn("[seed-ephemeral] datahub xy table skipped:", e);
  }
}

export async function seedEphemeralWorkspace(username: string): Promise<void> {
  const today = todayIso();
  try {
    const project = await projectsApi.create({
      name: "Demo: Engineer FakeYeast",
      color: "#1AA0E6",
      tags: ["demo", "yeast"],
    });

    // One experiment (task_type "experiment") under the project. Capture it so
    // we can attach an image to its results.
    const experiment = await tasksApi.create({
      project_id: project.id,
      name: "qPCR -- fakeGFP expression",
      start_date: today,
      duration_days: 2,
      task_type: "experiment",
    });

    // One list task.
    await tasksApi.create({
      project_id: project.id,
      name: "Order Spring resupply",
      start_date: today,
      task_type: "list",
    });

    // One single note.
    await notesApi.create({
      title: "Lab meeting notes",
      description: "Sample single note seeded into the fresh ephemeral session.",
    });

    // One multi-entry note (running log) with a couple of dated entries.
    await notesApi.create({
      title: "fakeGFP cloning -- running log",
      is_running_log: true,
      entries: [
        { title: "Day 1 -- transformation", date: today, content: "Plated transformants on LB+amp. Sample multi-entry note." },
        { title: "Day 2 -- colony pick", date: today, content: "Picked 4 colonies into overnight cultures." },
        { title: "Day 3 -- miniprep", date: today, content: "Miniprepped; sent for sequencing." },
      ],
    });

    // A purchase task plus a couple of purchase items.
    const purchaseTask = await tasksApi.create({
      project_id: project.id,
      name: "Reagent order",
      start_date: today,
      task_type: "purchase",
    });
    await purchasesApi.create({
      task_id: purchaseTask.id,
      item_name: "Taq polymerase",
      quantity: 2,
      price_per_unit: 120,
    });
    await purchasesApi.create({
      task_id: purchaseTask.id,
      item_name: "dNTP mix (10 mM)",
      quantity: 1,
      price_per_unit: 45,
    });

    // A couple of Data Hub tables so the analysis picker and the rest of the
    // Data Hub have real data to open (its own try/catch per table inside). The
    // Data Hub links tables by stringified project id (project.id is numeric).
    await seedDataHubTables(String(project.id));

    // Attach an image to the experiment (its own try/catch, the image is the
    // most fragile step and must never block the rest of the seed).
    try {
      const b64 = demoImageBase64();
      if (b64) {
        const base = `users/${username}/results/task-${experiment.id}`;
        await filesApi.uploadImage(`${base}/Images/demo-gel.png`, b64);
        await filesApi.writeFile(
          `${base}/results.md`,
          "# Results\n\nSeeded demo image for the experiment.\n\n![demo gel](Images/demo-gel.png)\n",
        );
      }
    } catch (imgErr) {
      console.warn("[seed-ephemeral] image attach skipped:", imgErr);
    }
  } catch (err) {
    console.warn("[seed-ephemeral] partial seed:", err);
  }
}
