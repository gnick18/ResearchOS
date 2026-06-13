"use client";

// DatasetPlotDialog (DataHub-largetables lane, Phase 3b).
//
// The dataset-lane figure chooser, the large-table mirror of NewGraphDialog. It
// offers the plot kinds valid for the dataset's schema (gated by the numeric +
// categorical column counts), pulls the chosen columns out of DuckDB into arrays,
// and renders them through renderDatasetPlot, which hands the arrays to the SAME
// validated plot path the editable lane uses. A Save persists the figure spec to
// the dataset sidecar (savedPlots).
//
// THE VALIDATION GATE. DuckDB only MOVES the columns into arrays here. Every
// summary number a figure draws (a bar's mean, an error bar's SD / SEM) is
// computed by the validated engine via renderDatasetPlot; this dialog never
// computes one. Only the SCATTER dots are sampled, and when they are, the dialog
// shows "showing N of M points" so the thinning is never silent.
//
// House style: a popup reads as a contained surface (bg-surface-overlay + border),
// the primary CTA uses .bg-brand-action text-white, <Icon> only, Tooltip for
// icon-only buttons, no emojis / em-dashes / mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { buildPlotSpec, type PlotKind } from "@/lib/datahub/plot-spec";
import type { DatasetSidecar, SavedDatasetPlot } from "@/lib/datahub/bigtable/types";
import type { OpenDatasetHandle } from "@/lib/datahub/bigtable/dataset-view";
import {
  renderDatasetPlot,
  validDatasetPlotKinds,
  DEFAULT_POINT_SAMPLE,
  type DatasetPlotOptions,
  type DatasetPlotSampleInfo,
} from "@/lib/datahub/bigtable/dataset-plots";
import { saveDatasetPlot } from "@/lib/datahub/bigtable/dataset-store";

/** A human label + one-line blurb for each offered plot kind. */
const KIND_META: Record<
  PlotKind,
  { label: string; blurb: string }
> = {
  columnScatter: {
    label: "Column scatter",
    blurb: "Each value as a point over the mean line. The dots are sampled for a large column; the mean and error bars use the full column.",
  },
  columnBar: {
    label: "Column bar",
    blurb: "A bar to the mean with error bars. Computed exact from the full column.",
  },
  groupedBar: {
    label: "Grouped bar",
    blurb: "A value column crossed by two labels: clusters on the x-axis, bars within each cluster.",
  },
  xyScatter: {
    label: "XY scatter",
    blurb: "One numeric column against another. The points are sampled for a large dataset; the fitted curve is off on this lane.",
  },
  // The remaining kinds are not offered on the dataset lane (kept for the typed
  // record so PlotKind stays exhaustive); they never appear in the picker.
  survivalCurve: { label: "Survival curve", blurb: "" },
  estimationGardnerAltman: { label: "Estimation", blurb: "" },
  estimationCumming: { label: "Estimation", blurb: "" },
  qqPlot: { label: "QQ plot", blurb: "" },
  residualPlot: { label: "Residual plot", blurb: "" },
  rocCurve: { label: "ROC curve", blurb: "" },
  pie: { label: "Pie", blurb: "" },
  donut: { label: "Donut", blurb: "" },
  stackedBar: { label: "Stacked bar", blurb: "" },
};

export default function DatasetPlotDialog({
  open,
  owner,
  sidecar,
  handle,
  onClose,
  onSaved,
}: {
  open: boolean;
  owner: string;
  sidecar: DatasetSidecar;
  /** The dataset opened into DuckDB (from DatasetView). Null while opening. */
  handle: OpenDatasetHandle | null;
  onClose: () => void;
  /** Called with the updated sidecar after a Save, so the rail can refresh. */
  onSaved?: (sidecar: DatasetSidecar) => void;
}) {
  const numericNames = useMemo(
    () => sidecar.schema.filter((c) => c.type === "number").map((c) => c.name),
    [sidecar.schema],
  );
  const categoricalNames = useMemo(
    () => sidecar.schema.filter((c) => c.type !== "number").map((c) => c.name),
    [sidecar.schema],
  );
  const offered = useMemo(
    () => validDatasetPlotKinds(numericNames.length, categoricalNames.length),
    [numericNames.length, categoricalNames.length],
  );

  const [kind, setKind] = useState<PlotKind | null>(null);
  // Column picks (the union of what each kind needs).
  const [valueColumn, setValueColumn] = useState("");
  const [xColumn, setXColumn] = useState("");
  const [groupByColumn, setGroupByColumn] = useState("");
  const [rowFactorColumn, setRowFactorColumn] = useState("");
  const [seriesColumn, setSeriesColumn] = useState("");
  // Whether to split a column figure by a group label (the tidy / long shape).
  const [splitByGroup, setSplitByGroup] = useState(false);

  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    svg: string;
    sampleInfo?: DatasetPlotSampleInfo;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset on open: default to the first offered kind and the first columns.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setRenderError(null);
    setSaved(false);
    setKind(offered[0] ?? null);
    setValueColumn(numericNames[0] ?? "");
    setXColumn(numericNames[1] ?? numericNames[0] ?? "");
    setGroupByColumn(categoricalNames[0] ?? "");
    setRowFactorColumn(categoricalNames[0] ?? "");
    setSeriesColumn(categoricalNames[1] ?? categoricalNames[0] ?? "");
    setSplitByGroup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isColumn = kind === "columnScatter" || kind === "columnBar";
  const isGrouped = kind === "groupedBar";
  const isXY = kind === "xyScatter";

  const canRender =
    handle !== null &&
    kind !== null &&
    (isGrouped
      ? valueColumn !== "" &&
        rowFactorColumn !== "" &&
        seriesColumn !== "" &&
        rowFactorColumn !== seriesColumn
      : isXY
        ? xColumn !== "" && valueColumn !== "" && xColumn !== valueColumn
        : // column scatter / bar
          valueColumn !== "" && (!splitByGroup || groupByColumn !== ""));

  /** The column-source options the render + the saved spec share. */
  const buildOptions = (): DatasetPlotOptions => {
    if (isGrouped) {
      return { valueColumn, rowFactorColumn, seriesColumn };
    }
    if (isXY) {
      return { xColumn, valueColumn };
    }
    return {
      valueColumn,
      ...(splitByGroup ? { groupByColumn } : {}),
    };
  };

  const render = async () => {
    if (!canRender || kind === null || !handle) return;
    setRendering(true);
    setRenderError(null);
    setSaved(false);
    try {
      const spec = buildPlotSpec({
        id: `ds-pl-${Date.now()}`,
        kind,
        tableId: sidecar.id,
        yTitle: valueColumn || "Value",
      });
      const res = await renderDatasetPlot(handle, spec, sidecar, buildOptions());
      setPreview({ svg: res.svg, sampleInfo: res.sampleInfo });
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : "The figure could not render.");
    } finally {
      setRendering(false);
    }
  };

  const save = async () => {
    if (!preview || kind === null) return;
    setSaving(true);
    try {
      const spec = buildPlotSpec({
        id: `ds-pl-${Date.now()}`,
        kind,
        tableId: sidecar.id,
        yTitle: valueColumn || "Value",
      });
      const opts = buildOptions();
      const entry: SavedDatasetPlot = {
        id: spec.id,
        kind,
        style: spec.style,
        source: {
          datasetId: sidecar.id,
          ...(opts.valueColumn ? { valueColumn: opts.valueColumn } : {}),
          ...(opts.xColumn ? { xColumn: opts.xColumn } : {}),
          ...(opts.groupByColumn ? { groupByColumn: opts.groupByColumn } : {}),
          ...(opts.rowFactorColumn ? { rowFactorColumn: opts.rowFactorColumn } : {}),
          ...(opts.seriesColumn ? { seriesColumn: opts.seriesColumn } : {}),
          linkedAnalysisId: null,
        },
        pointSampleCount: DEFAULT_POINT_SAMPLE,
        resultStale: false,
        created_at: new Date().toISOString(),
      };
      const updated = await saveDatasetPlot(owner, sidecar.id, entry);
      if (updated) {
        setSaved(true);
        onSaved?.(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="dataset-plot-dialog"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Graph dataset"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface-overlay shadow-xl"
      >
        <div className="flex-none px-5 pt-5">
          <h2 className="text-title font-semibold text-foreground">
            Graph {sidecar.name}
          </h2>
          <p className="mt-1 text-meta text-foreground-muted">
            The figure&apos;s numbers come from the same validated engine the editable
            tables use. A large scatter samples the drawn dots, never the summary.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1">
          {offered.length === 0 ? (
            <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
              Add at least one numeric column to draw a figure.
            </p>
          ) : (
            <>
              {/* Kind picker */}
              <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Figure
              </label>
              <div className="mt-1 flex flex-col gap-2">
                {offered.map((k) => {
                  const active = kind === k;
                  const meta = KIND_META[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setKind(k);
                        setPreview(null);
                      }}
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${
                        active
                          ? "border-sky-400 bg-accent-soft"
                          : "border-border bg-surface-raised hover:bg-surface-sunken"
                      }`}
                    >
                      <span className="block text-body font-medium text-foreground">
                        {meta.label}
                      </span>
                      <span className="mt-0.5 block text-meta text-foreground-muted">
                        {meta.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Column pickers per kind */}
              {isColumn && (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                        Value column
                      </label>
                      <select
                        value={valueColumn}
                        onChange={(e) => setValueColumn(e.target.value)}
                        className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                      >
                        {numericNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    {categoricalNames.length > 0 && (
                      <div>
                        <label className="flex items-center gap-2 text-meta font-medium uppercase tracking-wide text-foreground-muted">
                          <input
                            type="checkbox"
                            checked={splitByGroup}
                            onChange={() => {
                              setSplitByGroup((v) => !v);
                              setPreview(null);
                            }}
                            className="h-3.5 w-3.5 accent-sky-500"
                          />
                          Split by a label
                        </label>
                        {splitByGroup && (
                          <select
                            value={groupByColumn}
                            onChange={(e) => setGroupByColumn(e.target.value)}
                            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                          >
                            {categoricalNames.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isXY && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                      X column
                    </label>
                    <select
                      value={xColumn}
                      onChange={(e) => setXColumn(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                    >
                      {numericNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                      Y column
                    </label>
                    <select
                      value={valueColumn}
                      onChange={(e) => setValueColumn(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                    >
                      {numericNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  {xColumn === valueColumn && (
                    <p className="col-span-2 text-meta text-amber-600">
                      Pick two different columns for X and Y.
                    </p>
                  )}
                </div>
              )}

              {isGrouped && (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                      Value column
                    </label>
                    <select
                      value={valueColumn}
                      onChange={(e) => setValueColumn(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                    >
                      {numericNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                      Cluster label
                    </label>
                    <select
                      value={rowFactorColumn}
                      onChange={(e) => setRowFactorColumn(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                    >
                      {categoricalNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                      Bar label
                    </label>
                    <select
                      value={seriesColumn}
                      onChange={(e) => setSeriesColumn(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                    >
                      {categoricalNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  {rowFactorColumn === seriesColumn && (
                    <p className="text-meta text-amber-600 sm:col-span-3">
                      Pick two different label columns for the clusters and the bars.
                    </p>
                  )}
                </div>
              )}

              {/* Live preview */}
              {preview && (
                <div className="mt-5" data-testid="dataset-plot-preview">
                  {preview.sampleInfo && (
                    <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/[0.08] px-2.5 py-1 text-meta text-foreground">
                      Showing {preview.sampleInfo.rendered.toLocaleString()} of{" "}
                      {preview.sampleInfo.total.toLocaleString()} points. The mean and
                      error bars use every point; only the drawn dots are a sample.
                    </p>
                  )}
                  <div
                    className="flex justify-center rounded-lg border border-border bg-white p-3"
                    // The SVG is built by the internal plot serializer from the
                    // dataset's own numbers (no user HTML), so this is safe.
                    dangerouslySetInnerHTML={{ __html: preview.svg }}
                  />
                </div>
              )}

              {renderError && (
                <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/[0.06] px-3 py-2 text-meta text-foreground">
                  {renderError}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-none items-center justify-between gap-2 border-t border-border px-5 py-4">
          <span />
          <div className="flex items-center gap-2">
            {saved && (
              <span className="text-meta text-emerald-600">Saved to dataset</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
            >
              {preview ? "Done" : "Cancel"}
            </button>
            {preview && (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || saved}
                className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground hover:bg-surface-sunken disabled:opacity-50"
                data-testid="dataset-plot-save"
              >
                {saving ? "Saving" : "Save figure"}
              </button>
            )}
            <Tooltip
              label={
                handle === null ? "The dataset is still opening" : "Draw the figure"
              }
            >
              <button
                type="button"
                onClick={() => void render()}
                disabled={!canRender || rendering}
                className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-body font-medium disabled:opacity-50"
                data-testid="dataset-plot-render"
              >
                {rendering ? "Drawing" : preview ? "Redraw" : "Draw figure"}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
