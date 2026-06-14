"use client";

// FigureArtboard (shared publication page-frame canvas).
//
// The cross-cutting "artboard" surface used by every figure editor (Data Hub
// plots, Tree Studio, any future plot surface). When ENABLED it draws the figure
// on a real paper sheet (white page on a gray pasteboard) at true scale, with
// rulers along the edges, so you can see whether the figure has room to grow or
// needs to shrink before it goes into a manuscript. When DISABLED the consumer
// renders its figure exactly as before (this component is not mounted), so the
// existing display path is untouched.
//
// All page math, presets, feedback, and the inch-exact SVG export live in the
// pure lib @/lib/figure/artboard; this file is the themed React shell over it.
//
// The figure is injected as an SVG string (the SAME string the consumer renders
// today) via dangerouslySetInnerHTML; it is produced by the internal plot / tree
// serializers from the user's own data (no user HTML), so this is safe.
//
// House style: CSS-var / Tailwind tokens, dark-mode aware, Tooltip for icon-only
// controls, no emojis, no em-dashes, no mid-sentence colons.

import { useId } from "react";
import {
  PAPER_PRESETS,
  CUSTOM_PAPER_ID,
  pageDims,
  pageScale,
  placeFigureCentered,
  fitFeedback,
  rulerTicks,
  pxAtDpi,
  type ArtboardState,
  type RulerUnit,
} from "@/lib/figure/artboard";

/** The default longest-edge size (px) the page is fit into within the stage. */
const DEFAULT_MAX_STAGE_PX = 460;

export interface FigureArtboardProps {
  /** The consumer's self-contained figure SVG (the same string it renders today). */
  figureSvg: string;
  /** The figure's true size in inches (from the consumer's resolved figure frame). */
  figWIn: number;
  figHIn: number;
  state: ArtboardState;
  /** Largest stage edge in px the page is scaled into (default 460). */
  maxStagePx?: number;
}

/**
 * The artboard canvas: a pasteboard with the page sheet, the centered figure, and
 * optional rulers. Read-only display; the controls live in FigureArtboardControls.
 */
export function FigureArtboard({
  figureSvg,
  figWIn,
  figHIn,
  state,
  maxStagePx = DEFAULT_MAX_STAGE_PX,
}: FigureArtboardProps) {
  const page = pageDims(state);
  const scale = pageScale(page, maxStagePx);
  const pageWpx = page.wIn * scale;
  const pageHpx = page.hIn * scale;
  const place = placeFigureCentered(page, figWIn, figHIn);

  const topTicks = state.rulers ? rulerTicks(page.wIn, state.rulerUnit) : [];
  const leftTicks = state.rulers ? rulerTicks(page.hIn, state.rulerUnit) : [];

  return (
    <div
      className="flex min-h-full w-full items-center justify-center overflow-auto bg-surface-sunken p-10"
      data-testid="figure-artboard"
    >
      <div className="relative" style={{ width: pageWpx, height: pageHpx }}>
        {/* Top ruler */}
        {state.rulers && (
          <div
            className="pointer-events-none absolute left-0 right-0 text-[9px] text-foreground-faint"
            style={{ top: -16, height: 12 }}
          >
            {topTicks.map((t, i) => (
              <span
                key={`t${i}`}
                className="absolute"
                style={{ left: t.posIn * scale + 1, top: 0 }}
              >
                {t.label}
              </span>
            ))}
          </div>
        )}
        {/* Left ruler */}
        {state.rulers && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 text-[9px] text-foreground-faint"
            style={{ left: -16, width: 14 }}
          >
            {leftTicks.map((t, i) => (
              <span
                key={`l${i}`}
                className="absolute"
                style={{ top: t.posIn * scale - 5, left: 0 }}
              >
                {t.label}
              </span>
            ))}
          </div>
        )}

        {/* The page sheet */}
        <div
          className="absolute inset-0 border border-[#d8dee9] bg-white shadow-[0_4px_18px_rgba(0,0,0,0.18)]"
          aria-label="publication page"
        />

        {/* The figure, centered at true scale, with a dashed bound */}
        <div
          className="absolute flex items-center justify-center outline-dashed outline-[1.5px] outline-brand-action"
          style={{
            left: place.leftIn * scale,
            top: place.topIn * scale,
            width: figWIn * scale,
            height: figHIn * scale,
          }}
        >
          <span
            className="absolute left-0 whitespace-nowrap text-[10px] font-bold text-brand-action"
            style={{ top: -16 }}
          >
            {round1(figWIn)} x {round1(figHIn)} in
          </span>
          <div
            className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
            // The SVG is built by the figure serializer from the user's own data
            // (no user HTML), so injecting it here is safe.
            dangerouslySetInnerHTML={{ __html: figureSvg }}
          />
        </div>
      </div>
    </div>
  );
}

export interface FigureArtboardControlsProps {
  state: ArtboardState;
  onChange: (patch: Partial<ArtboardState>) => void;
  /** The figure's true inch size, for the feedback chip + export readout. */
  figWIn: number;
  figHIn: number;
  dpi: number;
  /** Fit the figure to the page (writes the figure size on the consumer's style). */
  onFitToPage?: () => void;
  /**
   * Optional figure-width slider (inches). Provide it for a consumer that has no
   * size controls of its own (Tree Studio); a consumer with its own size panel
   * (Data Hub) omits it.
   */
  onFigWidthIn?: (widthIn: number) => void;
}

/**
 * The artboard control rows for a figure editor's side dock: the on/off toggle,
 * paper + orientation, rulers, optional custom size, the live room/fit/overflow
 * chip, and the inch-exact export readout. Self-contained styling so it drops into
 * any editor's dock section.
 */
export function FigureArtboardControls({
  state,
  onChange,
  figWIn,
  figHIn,
  dpi,
  onFitToPage,
  onFigWidthIn,
}: FigureArtboardControlsProps) {
  const toggleId = useId();
  const page = pageDims(state);
  const fb = fitFeedback(page, figWIn, figHIn);
  const fbTone =
    fb.verdict === "overflow"
      ? "bg-amber-500/[0.12] text-amber-700 dark:text-amber-300"
      : "bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300";

  return (
    <div data-testid="figure-artboard-controls">
      <Row label="Page artboard">
        <label className="inline-flex cursor-pointer items-center gap-2" htmlFor={toggleId}>
          <input
            id={toggleId}
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="h-3.5 w-3.5 accent-sky-500"
            data-testid="figure-artboard-toggle"
          />
          <span className="text-meta text-foreground-muted">
            {state.enabled ? "On" : "Off"}
          </span>
        </label>
      </Row>

      {state.enabled && (
        <>
          <Row label="Paper">
            <select
              value={state.paperId}
              onChange={(e) => onChange({ paperId: e.target.value })}
              className={selectClass}
              data-testid="figure-artboard-paper"
            >
              {PAPER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value={CUSTOM_PAPER_ID}>Custom</option>
            </select>
          </Row>

          <Row label="Orientation">
            <MiniSeg
              value={state.orientation}
              options={[
                { value: "portrait", label: "Portrait" },
                { value: "landscape", label: "Landscape" },
              ]}
              onChange={(v) => onChange({ orientation: v })}
            />
          </Row>

          {state.paperId === CUSTOM_PAPER_ID && (
            <Row label="Size (in)">
              <div className="flex items-center gap-1">
                <NumIn
                  value={state.customWIn ?? 6}
                  onChange={(v) => onChange({ customWIn: v })}
                  label="Custom width (in)"
                />
                <span className="text-meta text-foreground-faint">x</span>
                <NumIn
                  value={state.customHIn ?? 6}
                  onChange={(v) => onChange({ customHIn: v })}
                  label="Custom height (in)"
                />
              </div>
            </Row>
          )}

          <Row label="Rulers">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.rulers}
                onChange={(e) => onChange({ rulers: e.target.checked })}
                className="h-3.5 w-3.5 accent-sky-500"
                aria-label="Show rulers"
              />
              {state.rulers && (
                <MiniSeg
                  value={state.rulerUnit}
                  options={[
                    { value: "in", label: "in" },
                    { value: "cm", label: "cm" },
                  ]}
                  onChange={(v: RulerUnit) => onChange({ rulerUnit: v })}
                />
              )}
            </div>
          </Row>

          {onFigWidthIn && (
            <Row label="Figure width">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={Math.max(2, Math.round(page.wIn))}
                  step={0.1}
                  value={Math.min(figWIn, page.wIn)}
                  onChange={(e) => onFigWidthIn(parseFloat(e.target.value))}
                  className="w-24"
                  aria-label="Figure width in inches"
                />
                <span className="text-meta tabular-nums text-foreground-muted">
                  {round1(figWIn)} in
                </span>
              </div>
            </Row>
          )}

          {onFitToPage && (
            <button
              type="button"
              onClick={onFitToPage}
              className="mt-2 w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-sunken"
              data-testid="figure-artboard-fit"
            >
              Fit figure to page
            </button>
          )}

          <div
            className={`mt-2 rounded-md px-2.5 py-1.5 text-meta font-semibold ${fbTone}`}
            data-testid="figure-artboard-feedback"
          >
            {fb.message}
          </div>

          <p
            className="mt-2 border-t border-border pt-2 text-[11px] text-foreground-muted"
            data-testid="figure-artboard-readout"
          >
            Exports at{" "}
            <b className="text-foreground tabular-nums">
              {round1(figWIn)} x {round1(figHIn)} in
            </b>{" "}
            at {dpi} DPI ={" "}
            <b className="text-foreground tabular-nums">
              {pxAtDpi(figWIn, dpi)} x {pxAtDpi(figHIn, dpi)} px
            </b>
            . The SVG is vector, so proportions stay exact at any size.
          </p>
        </>
      )}
    </div>
  );
}

// --- small local primitives (self-contained so this drops into any dock) ---

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-meta text-foreground-muted">{label}</span>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

const selectClass =
  "rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none max-w-[150px]";

function MiniSeg<T extends string>({
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

function NumIn({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <input
      type="number"
      min={0.5}
      step={0.1}
      value={value}
      aria-label={label}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && v > 0) onChange(v);
      }}
      className="w-14 rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none"
    />
  );
}

function round1(v: number): string {
  return String(Number(v.toFixed(1)));
}
