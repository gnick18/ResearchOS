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

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import PaletteStudio from "@/components/datahub/PaletteStudio";
import CodePanel from "@/components/datahub/CodePanel";
import StyledSelect from "@/components/datahub/StyledSelect";
import PlotColorPicker from "@/components/datahub/PlotColorPicker";
import PlotColorEditor from "@/components/datahub/PlotColorEditor";
import { PlotLayoutAdvisor } from "@/components/datahub/PlotLayoutAdvisor";
import ScrollableNumberInput from "@/components/datahub/ScrollableNumberInput";
import type {
  AnalysisSpec,
  DataHubDocContent,
  PlotSpec,
} from "@/lib/datahub/model/types";
import {
  readPlotStyle,
  renderPlot,
  figureFileStem,
  downloadFigureSvg,
  downloadFigurePng,
  copyFigure,
  downloadSvg,
  withRootSize,
  convertUnit,
  fromDesignPx,
  FIG,
  type PlotStyle,
  type SizeUnit,
  type ResizeMode,
  type ErrorBarKind,
  type FitModelId,
  type AxisScaleType,
  type BarMode,
} from "@/lib/datahub/plot-spec";
import { isPartsOfWholeKind } from "@/lib/datahub/parts-of-whole-plot";
import { plotCode } from "@/lib/datahub/plot-code";
import { chainCode, type ContentResolver } from "@/lib/datahub/chain-code";
import {
  addUserPalette,
  newUserPaletteId,
} from "@/lib/datahub/user-palettes";
import {
  FigureArtboard,
  FigureArtboardControls,
} from "@/components/figure/FigureArtboard";
import ZoomPanCanvas from "@/components/figure/ZoomPanCanvas";
import {
  artboardInitial,
  saveArtboardPrefs,
  pageDims,
  placeFigureCentered,
  fitFigureToPage,
  artboardExportSvg,
  type ArtboardState,
} from "@/lib/figure/artboard";

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
  testIdPrefix,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  /** Optional prefix for data-testid on each option button, e.g. "datahub-charttype" → "datahub-charttype-columnBar". */
  testIdPrefix?: string;
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
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
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

/**
 * One section of the right dock. A full-width neutral gray band (the approved
 * "Neutral gray band" treatment from datahub-section-headers.html) carries the
 * uppercase header so each group reads as its own block down the panel. The
 * band's bottom border separates it from the body, so the body needs no top
 * divider of its own.
 */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  /** An optional leading icon name (reuses the registry). */
  icon?: React.ComponentProps<typeof Icon>["name"];
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-sunken px-3.5 py-2">
        {icon ? (
          <Icon name={icon} className="h-3 w-3 text-foreground" />
        ) : null}
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-foreground">
          {title}
        </h3>
      </div>
      <div className="px-3.5 py-3">{children}</div>
    </div>
  );
}

/** An optional-number axis input: blank means auto (undefined), any finite number
 * is the override. Used for the manual axis-range controls. */
function AxisInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      aria-label={ariaLabel}
      placeholder="auto"
      onChange={(e) => {
        const t = e.target.value.trim();
        if (t === "") return onChange(undefined);
        const n = Number(t);
        onChange(Number.isFinite(n) ? n : undefined);
      }}
      className="w-20 rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
    />
  );
}

/** Round a size number to a tidy precision for the input (inches / cm keep two
 * decimals, px stays whole). */
function roundForUnit(value: number, unit: SizeUnit): number {
  if (unit === "px") return Math.round(value);
  return Math.round(value * 100) / 100;
}

/** The journal / slide size presets, all in inches. */
const SIZE_PRESETS: { label: string; widthIn: number; heightIn: number }[] = [
  // A single journal column is 3.5 in wide; the height keeps the base aspect.
  { label: "Single column", widthIn: 3.5, heightIn: 3.5 * (FIG.height / FIG.width) },
  // A double (full-page) column is 7.0 in wide.
  { label: "Double column", widthIn: 7.0, heightIn: 7.0 * (FIG.height / FIG.width) },
  // A 16:9 slide figure (10 in wide keeps a comfortable half-slide height).
  { label: "Slide 16:9", widthIn: 10, heightIn: 5.63 },
];

/**
 * The "Figure size" section of the style panel. Type-in width / height with a
 * px / in / cm unit, an export DPI, an aspect lock, a re-layout / scale toggle,
 * and journal / slide presets. The why: a figure that is sized to its real
 * destination (a 3.5 in journal column, a 16:9 slide) drops in without
 * rescaling, and re-layout keeps the axis text legible at that size instead of
 * shrinking it. All edits write through onStyleChange onto the versioned spec.
 */
function FigureSizeControls({
  style,
  onStyleChange,
}: {
  style: PlotStyle;
  onStyleChange: (patch: Partial<PlotStyle>) => void;
}) {
  const unit: SizeUnit = style.sizeUnit ?? "px";
  const mode: ResizeMode = style.resizeMode ?? "relayout";
  const locked = style.aspectLocked ?? true;
  const dpi = style.dpi ?? 300;

  // The displayed numbers. With no stored size the figure is at the base FIG
  // box, so show that box in the current unit as the editable starting point.
  const baseW = fromDesignPx(FIG.width, unit);
  const baseH = fromDesignPx(FIG.height, unit);
  const curW = style.width ?? baseW;
  const curH = style.height ?? baseH;
  const ratio = curW > 0 && curH > 0 ? curW / curH : FIG.width / FIG.height;

  const dispW = roundForUnit(curW, unit);
  const dispH = roundForUnit(curH, unit);

  // Write a new width / height pair, keeping the aspect ratio when locked.
  const setWidth = (w: number) => {
    if (!Number.isFinite(w) || w <= 0) return;
    const h = locked ? w / ratio : curH;
    onStyleChange({ width: roundForUnit(w, unit), height: roundForUnit(h, unit) });
  };
  const setHeight = (h: number) => {
    if (!Number.isFinite(h) || h <= 0) return;
    const w = locked ? h * ratio : curW;
    onStyleChange({ width: roundForUnit(w, unit), height: roundForUnit(h, unit) });
  };

  // Switching the unit converts the displayed numbers so the figure does not
  // change size (3.5 in becomes 8.89 cm, not a relabeled 3.5 cm).
  const setUnit = (next: SizeUnit) => {
    if (next === unit) return;
    onStyleChange({
      sizeUnit: next,
      width: roundForUnit(convertUnit(curW, unit, next), next),
      height: roundForUnit(convertUnit(curH, unit, next), next),
    });
  };

  const applyPreset = (widthIn: number, heightIn: number) => {
    onStyleChange({
      sizeUnit: "in",
      width: roundForUnit(widthIn, "in"),
      height: roundForUnit(heightIn, "in"),
    });
  };

  const numClass =
    "w-16 rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none";

  return (
    <div data-testid="datahub-figure-size">
      <Ctl label="Width">
        <ScrollableNumberInput
          min={0}
          max={unit === "px" ? 8000 : unit === "cm" ? 200 : 80}
          step={unit === "px" ? 10 : 0.1}
          value={dispW}
          onChange={setWidth}
          className={numClass}
          ariaLabel="Figure width"
          data-testid="datahub-size-width"
        />
      </Ctl>
      <Ctl label="Height">
        <ScrollableNumberInput
          min={0}
          max={unit === "px" ? 8000 : unit === "cm" ? 200 : 80}
          step={unit === "px" ? 10 : 0.1}
          value={dispH}
          onChange={setHeight}
          className={numClass}
          ariaLabel="Figure height"
          data-testid="datahub-size-height"
        />
      </Ctl>
      <Ctl label="Unit">
        <Seg<SizeUnit>
          value={unit}
          options={[
            { value: "px", label: "px" },
            { value: "in", label: "in" },
            { value: "cm", label: "cm" },
          ]}
          onChange={setUnit}
        />
      </Ctl>
      <Ctl label="Lock aspect">
        <button
          type="button"
          onClick={() => onStyleChange({ aspectLocked: !locked })}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition-colors ${
            locked
              ? "border-accent bg-accent-soft text-accent"
              : "border-border bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
          }`}
          aria-pressed={locked}
          data-testid="datahub-size-lock"
        >
          <Icon name="lock" className="h-3 w-3" />
          {locked ? "Locked" : "Free"}
        </button>
      </Ctl>
      <Ctl label="Export DPI">
        <ScrollableNumberInput
          min={72}
          max={1200}
          step={10}
          value={dpi}
          onChange={(v) => {
            if (Number.isFinite(v) && v > 0) onStyleChange({ dpi: Math.round(v) });
          }}
          className={numClass}
          ariaLabel="Export DPI"
          data-testid="datahub-size-dpi"
        />
      </Ctl>
      <Ctl label="On resize">
        <Seg<ResizeMode>
          value={mode}
          options={[
            { value: "relayout", label: "Re-layout" },
            { value: "scale", label: "Scale" },
          ]}
          onChange={(v) => onStyleChange({ resizeMode: v })}
        />
      </Ctl>
      <p className="mt-1 text-[11px] text-foreground-muted">
        {mode === "relayout"
          ? "Re-layout redraws the axes to fill the box, so the text stays legible at the chosen size."
          : "Scale zooms the whole figure like a slide image, so the text and markers grow with the box."}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5" data-testid="datahub-size-presets">
        {SIZE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p.widthIn, p.heightIn)}
            className="rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Wrap the live figure with a draggable bottom-right corner handle so a
 * researcher can resize the figure by eye, the way they would in a slide tool.
 * The handle sits in the corner OUTSIDE the SVG hit area and stops its own
 * pointer events, so it never swallows the double-click / right-click color
 * editing on the plot. The px drag delta is converted back into the figure's
 * current unit; aspect lock constrains the ratio. The current dimensions show in
 * a small label while dragging.
 */
function FigureResizeFrame({
  style,
  frameWidthPx,
  frameHeightPx,
  onStyleChange,
  children,
}: {
  style: PlotStyle;
  /** The figure's on-screen size in design-px (CSS px), so deltas map 1:1. */
  frameWidthPx: number;
  frameHeightPx: number;
  onStyleChange: (patch: Partial<PlotStyle>) => void;
  children: React.ReactNode;
}) {
  const unit: SizeUnit = style.sizeUnit ?? "px";
  const locked = style.aspectLocked ?? true;
  const [drag, setDrag] = useState<{ w: number; h: number } | null>(null);

  const ratio =
    frameWidthPx > 0 && frameHeightPx > 0
      ? frameWidthPx / frameHeightPx
      : FIG.width / FIG.height;

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = frameWidthPx;
    const startH = frameHeightPx;
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const MIN = 120; // keep the figure from collapsing past a usable size

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      let w = Math.max(MIN, startW + dx);
      let h: number;
      if (locked) {
        h = w / ratio;
      } else {
        const dy = ev.clientY - startY;
        h = Math.max(MIN, startH + dy);
        // Re-derive w in case the height hit the floor (keeps the box sane).
        w = Math.max(MIN, startW + dx);
      }
      setDrag({ w: Math.round(w), h: Math.round(h) });
      onStyleChange({
        width: roundForUnit(fromDesignPx(w, unit), unit),
        height: roundForUnit(fromDesignPx(h, unit), unit),
      });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      (e.target as Element).releasePointerCapture?.(ev.pointerId);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="relative inline-block">
      {children}
      {/* Drag handle in the bottom-right corner, on top of the figure corner but
          a small target so it does not block the plot's color hit-testing. */}
      <Tooltip label="Drag to resize">
        <div
          role="slider"
          aria-label="Resize figure"
          aria-valuenow={Math.round(frameWidthPx)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize rounded-tl-sm border border-border bg-surface-raised opacity-70 transition-opacity hover:opacity-100"
          data-testid="datahub-figure-resize-handle"
        >
          <Icon
            name="resize"
            className="pointer-events-none h-3 w-3 text-foreground-muted"
          />
        </div>
      </Tooltip>
      {drag && (
        <div
          className="pointer-events-none absolute bottom-1 right-5 z-10 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-white"
          data-testid="datahub-figure-resize-readout"
        >
          {roundForUnit(fromDesignPx(drag.w, unit), unit)} x{" "}
          {roundForUnit(fromDesignPx(drag.h, unit), unit)} {unit}
        </div>
      )}
    </div>
  );
}

export default function GraphEditor({
  spec,
  content,
  analysis,
  title,
  onStyleChange,
  resolveContent,
}: {
  spec: PlotSpec;
  content: DataHubDocContent;
  /** The linked ANOVA analysis (for brackets), or null. */
  analysis: AnalysisSpec | null;
  /** The figure's display title (from the rail). */
  title: string;
  /** Persist a style patch onto the versioned PlotSpec. */
  onStyleChange: (patch: Partial<PlotStyle>) => void;
  /**
   * Resolve any table's raw stored content by id, so the Code export can walk
   * this figure's source-table lineage and emit the WHOLE chain (base table to
   * transforms, the annotated analysis when linked, then the figure). When
   * absent, the Code panel falls back to the single matplotlib snippet.
   */
  resolveContent?: ContentResolver;
}) {
  const [copyState, setCopyState] = useState<"idle" | "image" | "text">("idle");
  const [busy, setBusy] = useState(false);
  // The full PaletteStudio lives in a roomy modal so the browse grid is not
  // cramped into the 300px dock. The dock keeps a compact swatch + mode toggle
  // for quick switching; "Browse all palettes" opens the studio.
  const [browseOpen, setBrowseOpen] = useState(false);
  // The matplotlib "show the code" panel, hidden until the researcher asks for
  // it, so the export row stays uncluttered.
  const [showingCode, setShowingCode] = useState(false);

  const style = useMemo(() => readPlotStyle(spec), [spec]);
  const isXY = style.kind === "xyScatter";
  const isGrouped = style.kind === "groupedBar";
  const isColumn = style.kind === "columnScatter" || style.kind === "columnBar";
  const isSurvival = style.kind === "survivalCurve";
  const isPartsOfWhole = isPartsOfWholeKind(style.kind);
  const isEstimation =
    style.kind === "estimationGardnerAltman" ||
    style.kind === "estimationCumming";
  // The live figure. Recomputed whenever the spec, the table, or the linked
  // analysis changes (a cell edit reprojects content, so the points move).
  const { svg, geometry, frame } = useMemo(
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

  // The lineage-aware Code export: the whole chain from the source table's base
  // data through every transform, the annotated analysis when linked, then this
  // figure. It is async (it resolves the source tables by id), so it is computed
  // into state when the Code panel is open. Without a resolver we fall back to
  // the single matplotlib snippet (the pre-lineage behavior, still correct).
  const singleCode = useMemo(
    () => plotCode(spec, content, analysis),
    [spec, content, analysis],
  );
  const [chainSource, setChainSource] = useState<string>("");
  useEffect(() => {
    if (!showingCode) return;
    if (!resolveContent) {
      setChainSource(singleCode);
      return;
    }
    let active = true;
    void chainCode(
      { kind: "figure", tableId: content.meta.id, content, plot: spec },
      resolveContent,
    ).then((code) => {
      if (active) setChainSource(code);
    });
    return () => {
      active = false;
    };
  }, [showingCode, resolveContent, spec, content, singleCode]);
  const code = chainSource || singleCode;

  // Close the Browse-all-palettes modal on Escape, so the studio popout always
  // has a keyboard escape (no soft-lock).
  useEffect(() => {
    if (!browseOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBrowseOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [browseOpen]);

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

  // The publication page-frame config for this figure (normalized from the spec;
  // absent => disabled, so an old figure renders exactly as before).
  const artboard = useMemo(
    () => artboardInitial(style.artboard),
    [style.artboard],
  );
  const onArtboardChange = (patch: Partial<ArtboardState>) => {
    const next = { ...artboard, ...patch };
    onStyleChange({ artboard: next });
    // Remember the paper / orientation / ruler-unit so the next new figure starts
    // on the same page.
    saveArtboardPrefs(next);
  };
  // Fit the figure to the page (largest centered figure that keeps the aspect),
  // writing the size in inches onto the versioned style.
  const onFitToPage = () => {
    const page = pageDims(artboard);
    const aspect =
      frame.exportInchesH > 0 ? frame.exportInchesW / frame.exportInchesH : 1;
    const fit = fitFigureToPage(page, aspect);
    onStyleChange({
      sizeUnit: "in",
      width: roundForUnit(fit.figWIn, "in"),
      height: roundForUnit(fit.figHIn, "in"),
    });
  };

  const onExportSvg = () => downloadFigureSvg(svg, frame, fileStem);
  // Export the whole page sheet (the figure centered on the chosen paper, at true
  // inches). Available only when the artboard is on.
  const onExportPage = () => {
    const page = pageDims(artboard);
    const figWIn = frame.exportInchesW;
    const figHIn = frame.exportInchesH;
    const placement = placeFigureCentered(page, figWIn, figHIn);
    const markup = artboardExportSvg({
      figureSvg: svg,
      figWIn,
      figHIn,
      mode: "page",
      page,
      placement,
    });
    downloadSvg(markup, `${fileStem}-page`);
  };
  const onExportPng = async () => {
    setBusy(true);
    try {
      await downloadFigurePng(svg, frame, fileStem);
    } finally {
      setBusy(false);
    }
  };
  const onCopy = async () => {
    setBusy(true);
    try {
      const mode = await copyFigure(svg, frame);
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

  const blurb = isXY
    ? "Your X and Y observations as a scatter, with a fitted curve laid over them. The fit is computed from the same points, so an edit re-fits the curve, and the export stays a true vector."
    : isGrouped
      ? "One cluster per row label, one bar per group, with error bars from the replicates. Every control redraws the figure, and the export stays a true vector."
      : isSurvival
        ? "A Kaplan-Meier step curve per group, survival on the Y axis against time on the X axis. Every control redraws the figure, and the export stays a true vector."
        : "Individual points with the group mean and error bars, plus significance brackets from the stored analysis. Every control redraws the figure, and the export stays a true vector.";

  return (
    <div
      className="flex h-full min-h-0 flex-1"
      data-testid="datahub-graph-editor"
    >
      {/* Canvas. Fills the remaining width, centered on a sunken backdrop so the
          figure gets the screen and the controls live in the right dock. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <h1 className="truncate text-title font-semibold text-foreground">
            {title}
          </h1>
          <Tooltip label={blurb}>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-foreground-muted">
              <Icon name="check" className="h-3 w-3" />
              Live from the table
            </span>
          </Tooltip>
        </div>

        {/* Collision-aware layout advisor (Phase 5): when the legend piles onto the
            bars / curves, labels crowd, or a many-category legend runs off the
            figure, a quiet banner offers a one-click auto-fix + per-fix previews.
            Grouped bar, survival, and parts-of-whole emit a manifest today; it
            renders nothing when the plot is clean or for other plot kinds. */}
        {(isGrouped || isSurvival || isPartsOfWhole) && (
          <PlotLayoutAdvisor
            spec={spec}
            content={content}
            analysis={analysis}
            onStyleChange={onStyleChange}
            plotId={spec.id ?? null}
          />
        )}

        {/* Shared pan/zoom viewport (same ZoomPanCanvas the Phylo Studio + Figure
            composer use): two-finger pan, pinch / Cmd-wheel zoom-at-cursor,
            Space-drag, scrollbars, minimap. The figure renders at its natural size;
            the canvas zooms on top. The resize handle stops pointer propagation, so
            dragging it never pans; color clicks stay under the pan threshold. */}
        {artboard.enabled ? (
          // Publication page-frame view: the figure on a real paper sheet at true
          // scale. Color editing lives in the standard (artboard-off) view.
          <div className="min-h-0 flex-1 bg-surface-sunken">
            <ZoomPanCanvas
              contentWidth={pageDims(artboard).wIn * 96}
              contentHeight={pageDims(artboard).hIn * 96}
              minimap={
                <FigureArtboard
                  figureSvg={svg}
                  figWIn={frame.exportInchesW}
                  figHIn={frame.exportInchesH}
                  state={artboard}
                />
              }
            >
              <FigureArtboard
                figureSvg={svg}
                figWIn={frame.exportInchesW}
                figHIn={frame.exportInchesH}
                state={artboard}
                renderFigure={({ wPx, hPx }) => (
                  // Size the figure SVG to the page box so direct-on-figure color
                  // editing keeps working inside the artboard view.
                  <PlotColorEditor
                    svg={withRootSize(svg, `${Math.round(wPx)}px`, `${Math.round(hPx)}px`)}
                    style={style}
                    resolvedColors={seriesInfo.colors}
                    onStyleChange={onStyleChange}
                    onSaveColorsAsPalette={onSaveColorsAsPalette}
                  />
                )}
              />
            </ZoomPanCanvas>
          </div>
        ) : (
          <div className="min-h-0 flex-1 bg-surface-sunken">
            <ZoomPanCanvas
              contentWidth={frame.screenWidth + 30}
              contentHeight={frame.screenHeight + 30}
              minimap={
                <div
                  className="[&>svg]:h-full [&>svg]:w-full"
                  style={{ width: frame.screenWidth, height: frame.screenHeight }}
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              }
            >
              <div className="rounded-lg border border-border bg-white p-3 shadow-sm">
                <FigureResizeFrame
                  style={style}
                  frameWidthPx={frame.screenWidth}
                  frameHeightPx={frame.screenHeight}
                  onStyleChange={onStyleChange}
                >
                  <PlotColorEditor
                    svg={svg}
                    style={style}
                    resolvedColors={seriesInfo.colors}
                    onStyleChange={onStyleChange}
                    onSaveColorsAsPalette={onSaveColorsAsPalette}
                  />
                </FigureResizeFrame>
              </div>
            </ZoomPanCanvas>
          </div>
        )}
      </div>

      {/* Right dock. Fixed-width full-height column with its own scroll, so the
          control sections stack down the side the way the mockup shows. */}
      <aside
        className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface-raised"
        data-testid="datahub-graph-style-panel"
      >
        <Section title="Graph style">
          {isXY ? (
            <>
              <Ctl label="Fitted curve">
                <div className="max-w-[150px]" data-testid="datahub-style-fitmodel">
                  <StyledSelect
                    value={style.fitModel}
                    options={FIT_MODEL_OPTIONS.map((o) => ({
                      value: o.value,
                      label: o.label,
                    }))}
                    onChange={(v) =>
                      onStyleChange({ fitModel: v as FitModelId })
                    }
                    ariaLabel="Fitted curve"
                  />
                </div>
              </Ctl>
              <Ctl label="X axis">
                <Seg<AxisScaleType>
                  value={style.xScaleType ?? "linear"}
                  options={[
                    { value: "linear", label: "Linear" },
                    { value: "log", label: "Log" },
                  ]}
                  onChange={(v) =>
                    onStyleChange({ xScaleType: v === "log" ? "log" : undefined })
                  }
                />
              </Ctl>
              <Ctl label="Y axis">
                <Seg<AxisScaleType>
                  value={style.yScaleType ?? "linear"}
                  options={[
                    { value: "linear", label: "Linear" },
                    { value: "log", label: "Log" },
                  ]}
                  onChange={(v) =>
                    onStyleChange({ yScaleType: v === "log" ? "log" : undefined })
                  }
                />
              </Ctl>
            </>
          ) : isGrouped ? (
            <>
              <Ctl label="Bars">
                <Seg<BarMode>
                  value={style.barMode ?? "dodge"}
                  options={[
                    { value: "dodge", label: "Dodge" },
                    { value: "stack", label: "Stack" },
                    { value: "stack100", label: "100%" },
                  ]}
                  onChange={(v) =>
                    onStyleChange({ barMode: v === "dodge" ? undefined : v })
                  }
                />
              </Ctl>
              <Ctl label="Error bars">
                <Seg<ErrorBarKind>
                  value={style.errorBar}
                  options={[
                    { value: "sem", label: "SEM" },
                    { value: "sd", label: "SD" },
                    { value: "ci95", label: "95% CI" },
                    { value: "none", label: "None" },
                  ]}
                  onChange={(v) => onStyleChange({ errorBar: v })}
                />
              </Ctl>
              <Ctl label="Legend">
                <Seg<"overlay" | "right">
                  value={style.legendPlacement ?? "overlay"}
                  options={[
                    { value: "overlay", label: "Overlay" },
                    { value: "right", label: "Right" },
                  ]}
                  onChange={(v) =>
                    onStyleChange({
                      legendPlacement: v === "overlay" ? undefined : v,
                    })
                  }
                />
              </Ctl>
              <Ctl label="X labels">
                <Seg<"auto" | "horizontal" | "angled">
                  value={style.xLabelMode ?? "auto"}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "horizontal", label: "Flat" },
                    { value: "angled", label: "Angled" },
                  ]}
                  onChange={(v) => onStyleChange({ xLabelMode: v })}
                />
              </Ctl>
            </>
          ) : isSurvival ? (
            <>
              <Ctl label="Legend">
                <Seg<"overlay" | "right">
                  value={style.legendPlacement ?? "overlay"}
                  options={[
                    { value: "overlay", label: "Overlay" },
                    { value: "right", label: "Right" },
                  ]}
                  onChange={(v) =>
                    onStyleChange({
                      legendPlacement: v === "overlay" ? undefined : v,
                    })
                  }
                />
              </Ctl>
              <p className="text-[11px] text-foreground-muted">
                A survival curve has no per-bar style. Tune colors and labels in the
                sections below.
              </p>
            </>
          ) : isEstimation ? (
            <>
              <Ctl label="Control group">
                <select
                  value={style.estimationControlIndex ?? 0}
                  onChange={(e) =>
                    onStyleChange({
                      estimationControlIndex: Number(e.target.value),
                    })
                  }
                  className="max-w-[150px] rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none"
                  aria-label="Control group"
                >
                  {seriesInfo.names.map((name, i) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </Ctl>
              <Ctl label="CI method">
                <Seg<"bca" | "percentile">
                  value={style.estimationBootMethod ?? "bca"}
                  options={[
                    { value: "bca", label: "BCa" },
                    { value: "percentile", label: "Pct" },
                  ]}
                  onChange={(v) => onStyleChange({ estimationBootMethod: v })}
                />
              </Ctl>
              {style.kind === "estimationGardnerAltman" &&
              seriesInfo.count === 2 ? (
                <Ctl label="Paired">
                  <Seg<"on" | "off">
                    value={style.estimationPaired ? "on" : "off"}
                    options={[
                      { value: "off", label: "No" },
                      { value: "on", label: "Yes" },
                    ]}
                    onChange={(v) =>
                      onStyleChange({ estimationPaired: v === "on" })
                    }
                  />
                </Ctl>
              ) : null}
              <p className="mt-2 text-[11px] text-foreground-muted">
                The mean difference and its CI come from a bootstrap, the same
                numbers an estimation analysis reports. The density on the
                difference axis is that bootstrap distribution.
              </p>
            </>
          ) : (
            <>
              <Ctl label="Chart type">
                <Seg<PlotStyle["kind"]>
                  value={
                    style.kind === "columnBar" ? "columnBar" : "columnScatter"
                  }
                  options={[
                    { value: "columnScatter", label: "Scatter" },
                    { value: "columnBar", label: "Bar" },
                  ]}
                  onChange={(kind) => onStyleChange({ kind })}
                  testIdPrefix="datahub-charttype"
                />
              </Ctl>

              <Ctl label="Error bars">
                <Seg<ErrorBarKind>
                  value={style.errorBar}
                  options={[
                    { value: "sem", label: "SEM" },
                    { value: "sd", label: "SD" },
                    { value: "ci95", label: "95% CI" },
                    { value: "none", label: "None" },
                  ]}
                  onChange={(v) => onStyleChange({ errorBar: v })}
                  testIdPrefix="datahub-errorbars"
                />
              </Ctl>

              <Ctl label="Points">
                <Seg<"on" | "off">
                  value={style.showPoints ? "on" : "off"}
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                  onChange={(v) => onStyleChange({ showPoints: v === "on" })}
                  testIdPrefix="datahub-points"
                />
              </Ctl>

              <Ctl label="X labels">
                <Seg<"auto" | "horizontal" | "angled">
                  value={style.xLabelMode ?? "auto"}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "horizontal", label: "Flat" },
                    { value: "angled", label: "Angled" },
                  ]}
                  onChange={(v) => onStyleChange({ xLabelMode: v })}
                  testIdPrefix="datahub-xlabels"
                />
              </Ctl>

              <Ctl label="Value labels">
                <Seg<"on" | "off">
                  value={style.showValueLabels ? "on" : "off"}
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                  onChange={(v) =>
                    onStyleChange({ showValueLabels: v === "on" ? true : undefined })
                  }
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
                  testIdPrefix="datahub-brackets"
                />
              </Ctl>

              {style.showBrackets && (
                <Ctl label="Compare">
                  <Seg<"all" | "vsControl">
                    value={style.bracketComparisons === "vsControl" ? "vsControl" : "all"}
                    options={[
                      { value: "all", label: "All pairs" },
                      { value: "vsControl", label: "Vs control" },
                    ]}
                    onChange={(v) => onStyleChange({ bracketComparisons: v })}
                    testIdPrefix="datahub-bracket-compare"
                  />
                </Ctl>
              )}
            </>
          )}
        </Section>

        <Section title="Colors">
          {seriesInfo.count === 1 ? (
            // One series means one color, so a palette is meaningless. Show a
            // direct inline picker that sets that single series color. It writes
            // the same colorOverrides[0] the on-plot double-click editor does.
            <PlotColorPicker
              value={seriesInfo.colors[0] ?? "#1AA0E6"}
              onChange={(hex) =>
                onStyleChange({
                  colorOverrides: { ...(style.colorOverrides ?? {}), 0: hex },
                })
              }
            />
          ) : (
            // Multiple series. The dock shows only the chosen palette's swatches
            // plus a Palette button that opens the full studio (Library / Custom
            // / Generate). The mode toggle and quick-pick moved into that modal.
            <PaletteStudio
              compact
              onBrowse={() => setBrowseOpen(true)}
              style={style}
              seriesCount={seriesInfo.count}
              seriesNames={seriesInfo.names}
              resolvedColors={seriesInfo.colors}
              onStyleChange={onStyleChange}
            />
          )}
        </Section>

        <Section title="Figure size" icon="ruler">
          <FigureSizeControls style={style} onStyleChange={onStyleChange} />
        </Section>

        <Section title="Page artboard" icon="ruler">
          <FigureArtboardControls
            state={artboard}
            onChange={onArtboardChange}
            figWIn={frame.exportInchesW}
            figHIn={frame.exportInchesH}
            dpi={frame.dpi}
            onFitToPage={onFitToPage}
          />
        </Section>

        {(isXY || isColumn || isGrouped) && (
          <Section title="Axis range" icon="ruler">
            {isXY ? (
              <>
                <Ctl label="X min">
                  <AxisInput
                    value={style.xAxisMin}
                    onChange={(v) => onStyleChange({ xAxisMin: v })}
                    ariaLabel="X axis minimum"
                  />
                </Ctl>
                <Ctl label="X max">
                  <AxisInput
                    value={style.xAxisMax}
                    onChange={(v) => onStyleChange({ xAxisMax: v })}
                    ariaLabel="X axis maximum"
                  />
                </Ctl>
                <Ctl label="Y min">
                  <AxisInput
                    value={style.yAxisMin}
                    onChange={(v) => onStyleChange({ yAxisMin: v })}
                    ariaLabel="Y axis minimum"
                  />
                </Ctl>
                <Ctl label="Y max">
                  <AxisInput
                    value={style.yAxisMax}
                    onChange={(v) => onStyleChange({ yAxisMax: v })}
                    ariaLabel="Y axis maximum"
                  />
                </Ctl>
              </>
            ) : (
              <>
                <Ctl label="Y max">
                  <AxisInput
                    value={style.yAxisMax}
                    onChange={(v) => onStyleChange({ yAxisMax: v })}
                    ariaLabel="Y axis maximum"
                  />
                </Ctl>
                <Ctl label="Y tick step">
                  <AxisInput
                    value={style.yTickStep}
                    onChange={(v) => onStyleChange({ yTickStep: v })}
                    ariaLabel="Y axis tick step"
                  />
                </Ctl>
              </>
            )}
            <p className="mt-1 text-[11px] text-foreground-muted">
              Leave blank for auto.
            </p>
          </Section>
        )}

        <Section title="Labels and text">
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
          <div className="mt-2">
            <label className="block text-[11px] font-semibold text-foreground-muted">
              Title
            </label>
            <input
              type="text"
              value={style.title}
              onChange={(e) => onStyleChange({ title: e.target.value })}
              placeholder="Figure title"
              className="mt-1 w-full rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            />
            <label className="mt-2 block text-[11px] font-semibold text-foreground-muted">
              Y axis title
            </label>
            <input
              type="text"
              value={style.yTitle}
              onChange={(e) => onStyleChange({ yTitle: e.target.value })}
              placeholder="Value"
              className="mt-1 w-full rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            />
            <label className="mt-2 block text-[11px] font-semibold text-foreground-muted">
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
        </Section>

        <Section title="Export">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportSvg}
              className="ros-btn-neutral flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-meta font-medium text-foreground"
              data-testid="datahub-export-svg"
            >
              <Icon name="download" className="h-3.5 w-3.5" />
              SVG
            </button>
            <button
              type="button"
              onClick={onExportPng}
              disabled={busy}
              className="ros-btn-neutral flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-meta font-medium text-foreground disabled:opacity-50"
              data-testid="datahub-export-png"
            >
              <Icon name="export" className="h-3.5 w-3.5" />
              PNG
            </button>
            <button
              type="button"
              onClick={onCopy}
              disabled={busy}
              className="ros-btn-neutral flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-meta font-medium text-foreground disabled:opacity-50"
              data-testid="datahub-copy-figure"
            >
              <Icon name="copy" className="h-3.5 w-3.5" />
              {copyState === "idle" ? "Copy" : copyLabel}
            </button>
          </div>
          {artboard.enabled && (
            <button
              type="button"
              onClick={onExportPage}
              className="ros-btn-neutral mt-2 flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-meta font-medium text-foreground"
              data-testid="datahub-export-page"
            >
              <Icon name="download" className="h-3.5 w-3.5" />
              Export page (full sheet)
            </button>
          )}
          <p className="mt-2 text-[11px] text-foreground-muted">
            SVG stays an infinitely-scalable vector for a paper. PNG renders at 3x
            for a crisp slide. Copy drops a PNG straight into a doc.
          </p>

          <button
            type="button"
            onClick={() => setShowingCode((v) => !v)}
            className="ros-btn-neutral mt-3 flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-meta font-medium text-foreground"
            data-testid="datahub-figure-code-toggle"
            aria-expanded={showingCode}
          >
            <Icon name="file" className="h-3.5 w-3.5" />
            {showingCode ? "Hide the code" : "Show the code"}
          </button>
          <p className="mt-2 text-[11px] text-foreground-muted">
            Show the matplotlib code that redraws this figure from the same
            values, so you can rebuild it in a notebook instead of treating the
            plot as a black box.
          </p>

          {showingCode && (
            <div className="mt-2">
              <CodePanel
                code={code}
                caption="This reproduces the figure from the base table, loading the data and running every transform before drawing the plot, so the picture traces back to the raw numbers rather than a black box."
                testId="datahub-figure-code-panel"
              />
            </div>
          )}
        </Section>
      </aside>

      {/* Browse-all-palettes popout. The full studio (filter-by-N, CB / print
          toggles, custom per-series, generate, Coolors import, save-your-own)
          gets a roomy modal instead of the cramped dock. */}
      {browseOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          data-testid="datahub-palette-browse"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setBrowseOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Browse all palettes"
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface-overlay shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <h2 className="text-title font-semibold text-foreground">
                Color palettes
              </h2>
              <p className="ml-2 hidden text-meta text-foreground-muted sm:block">
                Filter by how many series the figure has, then preview live.
              </p>
              <Tooltip label="Close">
                <button
                  type="button"
                  onClick={() => setBrowseOpen(false)}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground-muted transition-colors hover:bg-surface-sunken"
                  aria-label="Close palette browser"
                >
                  <Icon name="close" className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
            <div className="overflow-y-auto px-4 py-3">
              <PaletteStudio
                style={style}
                seriesCount={seriesInfo.count}
                seriesNames={seriesInfo.names}
                resolvedColors={seriesInfo.colors}
                onStyleChange={onStyleChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
