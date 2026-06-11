"use client";

// GraphEditor (Data Hub graphs slice). The main-panel figure surface from the
// approved mockup's Graph panel: a live publication SVG on the left, a styling
// panel of real publication controls on the right, and an export row (SVG
// vector, hi-DPI PNG, copy-to-clipboard) under the figure.
//
// The figure is REAL SVG, laid out by the pure geometry in plot-spec.ts (d3
// linear scale), so the same node serializes to a vector .svg and rasterizes to
// a crisp PNG. Every control recomputes the figure live and persists the change
// onto the versioned PlotSpec through the page's onStyleChange, so the styling is
// version-controlled with the rest of the document.
//
// Error bars come from the raw replicates (the same mean / SD / SEM the grid
// footer shows), and the significance brackets come from the table's stored
// one-way ANOVA, so a researcher gets a correct, consistent figure without
// re-entering anything.
//
// House style: <Icon> only, Tooltip on icon-only buttons, brand + semantic
// tokens, no emojis / em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import PaletteStudio from "@/components/datahub/PaletteStudio";
import PlotColorEditor from "@/components/datahub/PlotColorEditor";
import type {
  AnalysisSpec,
  DataHubDocContent,
  PlotSpec,
} from "@/lib/datahub/model/types";
import {
  readPlotStyle,
  renderPlot,
  figureFileStem,
  downloadSvg,
  downloadPng,
  copyFigureToClipboard,
  type PlotStyle,
  type ErrorBarKind,
  type FitModelId,
} from "@/lib/datahub/plot-spec";
import {
  addUserPalette,
  newUserPaletteId,
} from "@/lib/datahub/user-palettes";

/** The fitted-curve choices the XY style panel offers, labeled for scientists. */
const FIT_MODEL_OPTIONS: { value: FitModelId; label: string }[] = [
  { value: "none", label: "None (points only)" },
  { value: "linear", label: "Linear" },
  { value: "logistic4pl", label: "4-parameter logistic (dose-response)" },
  { value: "michaelis-menten", label: "Michaelis-Menten" },
  { value: "exp-decay-1phase", label: "Exponential decay" },
  { value: "exp-association-1phase", label: "Exponential association" },
  { value: "polynomial2", label: "Quadratic" },
  { value: "gaussian", label: "Gaussian peak" },
];

/** A labeled row in the style panel (label left, control right). */
function Ctl({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <span className="text-meta text-foreground-muted">{label}</span>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** A two- or three-way segmented toggle (Scatter / Bar, On / Off, ...). */
function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-2 py-1 text-meta font-medium transition-colors ${
              i > 0 ? "border-l border-border" : ""
            } ${
              active
                ? "bg-accent-soft text-accent"
                : "bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function GraphEditor({
  spec,
  content,
  analysis,
  title,
  onStyleChange,
}: {
  spec: PlotSpec;
  content: DataHubDocContent;
  /** The linked ANOVA analysis (for brackets), or null. */
  analysis: AnalysisSpec | null;
  /** The figure's display title (from the rail). */
  title: string;
  /** Persist a style patch onto the versioned PlotSpec. */
  onStyleChange: (patch: Partial<PlotStyle>) => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "image" | "text">("idle");
  const [busy, setBusy] = useState(false);

  const style = useMemo(() => readPlotStyle(spec), [spec]);
  const isXY = style.kind === "xyScatter";
  const isGrouped = style.kind === "groupedBar";
  const isSurvival = style.kind === "survivalCurve";
  // The live figure. Recomputed whenever the spec, the table, or the linked
  // analysis changes (a cell edit reprojects content, so the points move).
  const { svg, geometry } = useMemo(
    () => renderPlot(spec, content, analysis),
    [spec, content, analysis],
  );

  // The plot's actual series (count + display names + the colors it is drawing),
  // derived from the laid-out geometry per kind. This seeds the studio's filter
  // count, the custom per-series list, and the direct-edit popover's "real"
  // color readout. An XY figure is a single series.
  const seriesInfo = useMemo(() => {
    const g = geometry as unknown as Record<string, unknown>;
    if (Array.isArray(g.groups)) {
      const groups = g.groups as { name: string; color: string }[];
      return {
        count: groups.length,
        names: groups.map((x) => x.name),
        colors: groups.map((x) => x.color),
      };
    }
    if (Array.isArray(g.legend)) {
      const legend = g.legend as { name: string; color: string }[];
      return {
        count: legend.length,
        names: legend.map((x) => x.name),
        colors: legend.map((x) => x.color),
      };
    }
    // XY scatter (single series).
    const color = typeof g.color === "string" ? (g.color as string) : "#1AA0E6";
    return { count: 1, names: [style.yTitle || "Series 1"], colors: [color] };
  }, [geometry, style.yTitle]);

  const fileStem = figureFileStem(style.title.trim() || title);

  // Save the figure's current effective colors (seriesInfo.colors, the resolved
  // per-series colors with any overrides already applied) as a reusable user
  // palette and select it, so a right-click "Save colors as palette" keeps the
  // exact colors on screen. The name is renameable later in the studio.
  const onSaveColorsAsPalette = (name: string) => {
    const colors = seriesInfo.colors.length ? seriesInfo.colors : ["#1AA0E6"];
    const id = newUserPaletteId();
    addUserPalette({
      id,
      name: name.trim() || "My palette",
      category: "qualitative",
      cbSafe: false,
      printSafe: false,
      colors,
    });
    onStyleChange({ palette: id, colorOverrides: {} });
  };

  const onExportSvg = () => downloadSvg(svg, fileStem);
  const onExportPng = async () => {
    setBusy(true);
    try {
      await downloadPng(svg, geometry.width, geometry.height, fileStem);
    } finally {
      setBusy(false);
    }
  };
  const onCopy = async () => {
    setBusy(true);
    try {
      const mode = await copyFigureToClipboard(
        svg,
        geometry.width,
        geometry.height,
      );
      setCopyState(mode);
      setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("idle");
    } finally {
      setBusy(false);
    }
  };

  const copyLabel =
    copyState === "image"
      ? "Copied image"
      : copyState === "text"
        ? "Copied SVG"
        : "Copy";

  return (
    <div data-testid="datahub-graph-editor">
      <h1 className="text-title font-semibold text-foreground">{title}</h1>
      <p className="mt-1 max-w-xl text-meta text-foreground-muted">
        {isXY
          ? "Your X and Y observations as a scatter, with a fitted curve laid over them. The fit is computed from the same points, so an edit re-fits the curve, and the export stays a true vector."
          : isGrouped
            ? "One cluster per row label, one bar per group, with error bars from the replicates. Every control redraws the figure, and the export stays a true vector."
            : isSurvival
              ? "A Kaplan-Meier step curve per group, survival on the Y axis against time on the X axis. Every control redraws the figure, and the export stays a true vector."
              : "Individual points with the group mean and error bars, plus significance brackets from the stored analysis. Every control redraws the figure, and the export stays a true vector."}
      </p>

      <div className="mt-4 flex flex-wrap items-start gap-5">
        {/* Figure + export row */}
        <div className="rounded-lg border border-border bg-white p-3">
          <PlotColorEditor
            svg={svg}
            style={style}
            resolvedColors={seriesInfo.colors}
            onStyleChange={onStyleChange}
            onSaveColorsAsPalette={onSaveColorsAsPalette}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onExportSvg}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
              data-testid="datahub-export-svg"
            >
              <Icon name="download" className="h-3.5 w-3.5" />
              Export SVG
            </button>
            <button
              type="button"
              onClick={onExportPng}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
              data-testid="datahub-export-png"
            >
              <Icon name="export" className="h-3.5 w-3.5" />
              Export PNG
            </button>
            <button
              type="button"
              onClick={onCopy}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
              data-testid="datahub-copy-figure"
            >
              <Icon name="copy" className="h-3.5 w-3.5" />
              {copyLabel}
            </button>
          </div>
          <p className="mt-1.5 max-w-[430px] text-[11px] text-foreground-muted">
            SVG stays an infinitely-scalable vector for a paper. PNG renders at 3x
            for a crisp slide. Copy drops a PNG straight into a doc.
          </p>
        </div>

        {/* Style panel */}
        <div
          className="w-[280px] shrink-0 rounded-lg border border-border bg-surface-raised p-3"
          data-testid="datahub-graph-style-panel"
        >
          <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-foreground-muted">
            Graph style
          </h4>

          {isXY ? (
            <Ctl label="Fitted curve">
              <select
                value={style.fitModel}
                onChange={(e) =>
                  onStyleChange({ fitModel: e.target.value as FitModelId })
                }
                className="max-w-[140px] rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none"
                data-testid="datahub-style-fitmodel"
              >
                {FIT_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Ctl>
          ) : isGrouped ? (
            <Ctl label="Error bars">
              <select
                value={style.errorBar}
                onChange={(e) =>
                  onStyleChange({ errorBar: e.target.value as ErrorBarKind })
                }
                className="rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none"
                data-testid="datahub-style-errorbar"
              >
                <option value="sem">Mean + SEM</option>
                <option value="sd">Mean + SD</option>
                <option value="none">None</option>
              </select>
            </Ctl>
          ) : isSurvival ? null : (
            <>
              <Ctl label="Style">
                <Seg<PlotStyle["kind"]>
                  value={style.kind === "columnBar" ? "columnBar" : "columnScatter"}
                  options={[
                    { value: "columnScatter", label: "Scatter" },
                    { value: "columnBar", label: "Bar" },
                  ]}
                  onChange={(kind) => onStyleChange({ kind })}
                />
              </Ctl>

              <Ctl label="Error bars">
                <select
                  value={style.errorBar}
                  onChange={(e) =>
                    onStyleChange({ errorBar: e.target.value as ErrorBarKind })
                  }
                  className="rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none"
                  data-testid="datahub-style-errorbar"
                >
                  <option value="sem">Mean + SEM</option>
                  <option value="sd">Mean + SD</option>
                  <option value="none">None</option>
                </select>
              </Ctl>

              <Ctl label="Show points">
                <Seg<"on" | "off">
                  value={style.showPoints ? "on" : "off"}
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                  onChange={(v) => onStyleChange({ showPoints: v === "on" })}
                />
              </Ctl>

              <Ctl label="Brackets">
                <Seg<"on" | "off">
                  value={style.showBrackets ? "on" : "off"}
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                  onChange={(v) => onStyleChange({ showBrackets: v === "on" })}
                />
              </Ctl>
            </>
          )}

          <PaletteStudio
            style={style}
            seriesCount={seriesInfo.count}
            seriesNames={seriesInfo.names}
            resolvedColors={seriesInfo.colors}
            onStyleChange={onStyleChange}
          />

          <Ctl label="Axis text">
            <input
              type="range"
              min={10}
              max={16}
              value={style.fontSize}
              onChange={(e) =>
                onStyleChange({ fontSize: Number(e.target.value) })
              }
              className="w-24"
              aria-label="Axis text size"
            />
          </Ctl>

          <div className="mt-3 border-t border-border pt-3">
            <label className="block text-[11px] font-bold uppercase tracking-wide text-foreground-muted">
              Title
            </label>
            <input
              type="text"
              value={style.title}
              onChange={(e) => onStyleChange({ title: e.target.value })}
              placeholder="Figure title"
              className="mt-1 w-full rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            />
            <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-foreground-muted">
              Y axis title
            </label>
            <input
              type="text"
              value={style.yTitle}
              onChange={(e) => onStyleChange({ yTitle: e.target.value })}
              placeholder="Value"
              className="mt-1 w-full rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            />
            <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-foreground-muted">
              X axis title
            </label>
            <input
              type="text"
              value={style.xTitle}
              onChange={(e) => onStyleChange({ xTitle: e.target.value })}
              placeholder="Optional"
              className="mt-1 w-full rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2 text-[11px] text-foreground-muted">
            <Tooltip label="Error bars and brackets are computed from this table's replicates and ANOVA, so the figure always matches the data.">
              <span className="inline-flex items-center gap-1">
                <Icon name="check" className="h-3 w-3" />
                Live from the table
              </span>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
