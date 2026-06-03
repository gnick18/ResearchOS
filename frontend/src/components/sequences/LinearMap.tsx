"use client";

// linear map bot — SnapGene-style SINGLE-LINE LINEAR MAP.
//
// THE PROBLEM IT REPLACES: in Map mode for a LINEAR molecule the editor used to
// pin SeqViz's linear viewer to MAP_ZOOM, which WRAPS the molecule into stacked
// rows. For a large contig (hundreds of kb) that paints the same feature bars
// repeating across dozens of rows — cluttered and useless as a map.
//
// THIS COMPONENT draws the whole molecule as ONE horizontal strand fit to the
// container width (no wrapping, no horizontal scroll), exactly like SnapGene's
// linear map:
//   - a baseline with a POSITION RULER (comma-grouped bp ticks),
//   - FEATURE ARROWS below the line (directional, in feature color, labeled;
//     multi-exon join features draw exon boxes joined by dashed intron lines),
//   - ENZYME CUT-SITES + PRIMERS above the line, each a tick on the baseline
//     plus a label connected by a thin LEADER LINE, de-collided into stacked
//     tiers (layoutLabels) so labels never overlap,
//   - HOVER a cut-site (label or tick) to highlight ALL sites of the SAME enzyme
//     in red.
//
// ZOOM + NAVIGATOR (linear-map zoom bot): the map owns a VISIBLE WINDOW
// [winStart, winEnd] (bp). Default is the whole molecule (exactly the original
// fit-to-width view). A zoom SLIDER (with -/+ buttons) shrinks the window down to
// a MIN_WINDOW_BP cap (it stays a MAP even at max zoom, never base letters). The
// window, not the whole molecule, spans the track; only items overlapping the
// window draw, and a straddling feature box is clipped to the window edge. A "…"
// cue marks each off-screen end. A bottom CONTEXT NAVIGATOR (a mini whole-molecule
// strip with a draggable viewport box) shows + drives where the window sits. The
// window is the single source of truth shared by the map, the slider, and the
// navigator. All zoom math is the unit-tested pure helper linear-map-window.
//
// REUSE: at default zoom the bp -> x mapping equals the original fit-to-width
// scaling. Cut sites come from the vendored digest via digestEnzymes (the active
// enzyme set passed in). Features/primers come straight from the editor's existing
// memos (no recompute, no on-disk change). Label packing is the unit-tested pure
// helper layoutLabels, now applied over the VISIBLE items only.
//
// INTERACTION: double-clicking a feature opens the feature editor; double-
// clicking a primer opens the Edit Primer dialog — both routed through the same
// handlers the SeqViz path uses (onAnnotationDoubleClick / onPrimerDoubleClick).

import { useEffect, useMemo, useRef, useState } from "react";
import { digestEnzymes } from "@/lib/sequences/enzyme-filters";
import { layoutLabels, tierCount, type LabelItem } from "@/lib/sequences/label-layout";
import {
  MIN_WINDOW_BP,
  clampSpan,
  sliderToSpan,
  spanToSlider,
  windowAroundCenter,
  windowAroundPoint,
  fullWindow,
  spanOverlapsWindow,
  clipSpanToWindow,
  rulerStepForSpan,
} from "@/lib/sequences/linear-map-window";
import Tooltip from "@/components/Tooltip";
import LinearMapNavigator from "./LinearMapNavigator";
import type { SeqType } from "@/vendor/seqviz/elements";

/** A feature to draw below the line. Mirrors the editor's annotation shape. */
export interface LinearMapFeature {
  name: string;
  start: number;
  end: number;
  /** 1 = forward (arrow points right), -1 = reverse (points left). */
  direction: 1 | -1;
  color?: string;
  type?: string;
  /** exon spans for a multi-segment (join) feature; absent for single-span. */
  segments?: { start: number; end: number }[];
}

/** A primer to draw above the line (pink). Mirrors the editor's primers memo. */
export interface LinearMapPrimer {
  name: string;
  start: number;
  end: number;
  direction: 1 | -1;
  color: string;
}

export interface LinearMapProps {
  seq: string;
  seqType: SeqType;
  seqLength: number;
  features: LinearMapFeature[];
  /** active enzyme KEYS (lowercase) — same set the editor feeds SeqViz. */
  enzymeKeys: string[];
  showEnzymes: boolean;
  primers: LinearMapPrimer[];
  showPrimers: boolean;
  /** double-click a feature: resolve back to its doc feature + open the editor. */
  onFeatureDoubleClick: (f: { name: string; start: number; end: number; direction?: number }) => void;
  /** double-click a primer: resolve back to its doc feature + open Edit Primer. */
  onPrimerDoubleClick: (p: { name: string; start: number; end: number }) => void;
}

// ── layout constants (px) ──────────────────────────────────────────────────
const PAD_X = 16; // horizontal inset so end ticks/labels are not clipped
const BASELINE_FROM_TOP_BASE = 0; // computed dynamically from tier counts
const STRAND_H = 6; // thickness of the strand band
const TICK_H = 6; // ruler tick length below the baseline
const RULER_LABEL_GAP = 4;
const FEATURE_GAP = 10; // gap between strand and the first feature row
const FEATURE_ARROW_H = 14; // height of a feature arrow body
const FEATURE_LABEL_H = 14; // height reserved per below-line label tier
const FEATURE_ARROWHEAD = 7;
const ABOVE_TICK_H = 7; // tick mark length above the baseline (enzyme/primer)
const ABOVE_LEADER_BASE = 10; // first leader-line segment length above the tick
const ABOVE_TIER_H = 15; // vertical step between stacked label tiers
// SVG map-label type scale (constant pair): coordinate / ruler numbers = 10,
// feature / primer / enzyme labels = 11. Keep these two values only.
const ABOVE_LABEL_FONT = 11; // enzyme / source labels above the strand (label tier)
const FEATURE_LABEL_FONT = 11; // feature name labels (label tier)
const RULER_FONT = 10; // ruler coordinate numbers (number tier)
const MIN_FEATURE_PX = 3; // minimum drawn width for a tiny feature
// navigator pin bot — reserved height (px) for the bottom navigator slot. Matches
// the navigator SVG height (LinearMapNavigator navH ~= 36) plus its py-1 wrapper
// (8) so the slot stays the same whether the strip is shown (zoomed in) or hidden
// (whole molecule); toggling it never shifts the surrounding layout.
const NAV_SLOT_H = 44;

const PRIMER_PINK = "#ec4899";
const ENZYME_COLOR = "#475569";
const ENZYME_HOVER = "#dc2626";
const RULER_COLOR = "#cbd5e1";
const RULER_TEXT = "#94a3b8";
const STRAND_COLOR = "#94a3b8";

/** Estimate a label's pixel width from its text + font size (monospace-ish). */
function estTextWidth(text: string, fontPx: number): number {
  // ~0.58em average advance for the app's UI font at small sizes; good enough
  // for packing (the real measured width only differs by a couple px).
  return Math.max(8, text.length * fontPx * 0.58);
}

/** Build an SVG arrow polygon for a feature block spanning [x0, x1]. */
function featureArrowPoints(x0: number, x1: number, midY: number, direction: 1 | -1): string {
  const top = midY - FEATURE_ARROW_H / 2;
  const bot = midY + FEATURE_ARROW_H / 2;
  const w = Math.max(MIN_FEATURE_PX, x1 - x0);
  const head = Math.min(FEATURE_ARROWHEAD, w * 0.5);
  if (direction === -1) {
    return `${x0},${midY} ${x0 + head},${top} ${x1},${top} ${x1},${bot} ${x0 + head},${bot}`;
  }
  return `${x0},${top} ${x1 - head},${top} ${x1},${midY} ${x1 - head},${bot} ${x0},${bot}`;
}

/** Comma-group an integer (e.g. 10000 -> "10,000"). */
function comma(n: number): string {
  return Math.round(n).toLocaleString();
}

export default function LinearMap({
  seq,
  seqType,
  seqLength,
  features,
  enzymeKeys,
  showEnzymes,
  primers,
  showPrimers,
  onFeatureDoubleClick,
  onPrimerDoubleClick,
}: LinearMapProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  // Hover state for enzyme highlight, keyed on enzyme NAME (all sites of the same
  // enzyme highlight together — SnapGene behavior).
  const [hoverEnzyme, setHoverEnzyme] = useState<string | null>(null);

  // ── VISIBLE WINDOW (single source of truth for zoom + the navigator) ───────
  // [winStart, winEnd] in bp. Default = whole molecule, i.e. exactly the original
  // fit-to-width view. Zoom shrinks the span (down to MIN_WINDOW_BP); the navigator
  // pans / resizes it; the slider position is derived from the span on every render.
  const [win, setWin] = useState<{ start: number; end: number }>(() => fullWindow(seqLength));

  // Reset the window to whole-molecule whenever the molecule length changes (a
  // different sequence opened). Keeps the default-zoom guarantee per molecule.
  useEffect(() => {
    setWin(fullWindow(seqLength));
  }, [seqLength]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const trackWidth = Math.max(0, width - PAD_X * 2);
  const winStart = win.start;
  const winEnd = Math.max(win.start + 1, win.end);
  const winSpan = winEnd - winStart;
  // navigator pin bot — the navigator only has a job when the window is SMALLER
  // than the whole molecule. At full zoom-out (the default) the strand already
  // shows the whole molecule, so the navigator is hidden.
  const isZoomedIn = winSpan < seqLength;
  // The WINDOW (not the whole molecule) spans the track now.
  const bpX = (bp: number) => PAD_X + ((bp - winStart) / winSpan) * trackWidth;

  // Zoom controls. The slider runs 0 (whole molecule) .. 1 (max zoom). Span maps
  // log-scaled so the control feels smooth; zoom keeps the window CENTER stable.
  const sliderPos = spanToSlider(winSpan, seqLength);
  const setSpanKeepingCenter = (span: number) => {
    const center = (winStart + winEnd) / 2;
    setWin(windowAroundCenter(center, clampSpan(span, seqLength), seqLength));
  };
  const onSlider = (pos: number) => setSpanKeepingCenter(sliderToSpan(pos, seqLength));
  // +/- step by a fixed zoom RATIO (one "click" = ~1.6x), respecting the cap.
  const ZOOM_STEP = 1.6;
  const canZoomIn = winSpan > MIN_WINDOW_BP;
  const canZoomOut = winSpan < seqLength;
  const zoomIn = () => setSpanKeepingCenter(winSpan / ZOOM_STEP);
  const zoomOut = () => setSpanKeepingCenter(winSpan * ZOOM_STEP);

  // ── TRACKPAD PINCH-TO-ZOOM (map pinch bot) ────────────────────────────────
  // The map's window is the single source of truth, so a pinch just sets a new
  // window: the slider, navigator, and ellipsis cues all follow. The wheel/gesture
  // listener is attached ONCE (it must be non-passive so preventDefault works), so
  // it reads the live window + track geometry from a ref instead of stale closure
  // values. PINCH = ctrl/meta + wheel (macOS trackpad reports a pinch as a wheel
  // event with ctrlKey true), or a Safari gesture event. A PLAIN wheel is left
  // alone so normal scrolling still works.
  const pinchStateRef = useRef({ winStart, winSpan, trackWidth, seqLength });
  pinchStateRef.current = { winStart, winSpan, trackWidth, seqLength };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    // Apply a pinch of magnitude `deltaY` (deltaY < 0 == spread / zoom IN, > 0 ==
    // pinch / zoom OUT), anchored so the bp under the cursor stays put. K tunes the
    // feel: each unit of deltaY nudges the 0..1 log slider by K, matching the
    // SeqViz pinch's smooth, constant-ratio feel.
    const K = 0.0035;
    const applyPinch = (deltaY: number, clientX: number) => {
      const { winStart: ws, winSpan: span, trackWidth: tw, seqLength: len } = pinchStateRef.current;
      if (tw <= 0 || len <= 0) return;
      const rect = el.getBoundingClientRect();
      // Fraction of the cursor across the TRACK (0 at PAD_X, 1 at PAD_X+trackWidth),
      // clamped so a cursor in the side padding still anchors at an edge.
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left - PAD_X) / tw));
      const anchorBp = ws + fraction * span;
      // Nudge the log slider: deltaY < 0 (spread) -> larger slider -> smaller span
      // (zoom in). Convert span -> slider, step, convert back.
      const pos = spanToSlider(span, len);
      const nextPos = Math.max(0, Math.min(1, pos - deltaY * K));
      const nextSpan = sliderToSpan(nextPos, len);
      if (nextSpan === span) return;
      setWin(windowAroundPoint(anchorBp, nextSpan, fraction, len));
    };

    const onWheel = (e: WheelEvent) => {
      // Only a pinch (ctrl/meta + wheel) zooms; a plain wheel falls through to the
      // container's normal scroll untouched.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      applyPinch(e.deltaY, e.clientX);
    };

    // Safari fires gesture* with a relative `scale` (1 == no change, >1 spread /
    // zoom-in, <1 pinch / zoom-out) instead of ctrl+wheel. Convert scale to a
    // deltaY-equivalent so we reuse the same path (scale 1.1 -> ~ -10 deltaY).
    const onGesture = (e: Event) => {
      const ge = e as Event & { scale?: number; clientX?: number };
      if (typeof ge.scale !== "number") return;
      e.preventDefault();
      const deltaY = (1 - ge.scale) * 100;
      const rect = el.getBoundingClientRect();
      const clientX = typeof ge.clientX === "number" ? ge.clientX : rect.left + rect.width / 2;
      applyPinch(deltaY, clientX);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGesture as EventListener);
    el.addEventListener("gesturechange", onGesture as EventListener);
    el.addEventListener("gestureend", onGesture as EventListener);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGesture as EventListener);
      el.removeEventListener("gesturechange", onGesture as EventListener);
      el.removeEventListener("gestureend", onGesture as EventListener);
    };
  }, []);

  // ── ENZYME CUT SITES (above the line) ────────────────────────────────────
  // Reuse the vendored digest via digestEnzymes; flatten to one item per cut.
  const cuts = useMemo(() => {
    if (!showEnzymes || enzymeKeys.length === 0 || !seq) return [];
    const digests = digestEnzymes(seq, seqType, enzymeKeys);
    const out: { name: string; pos: number }[] = [];
    for (const d of digests) {
      for (const c of d.cuts) out.push({ name: d.info.name, pos: c.position });
    }
    return out.sort((a, b) => a.pos - b.pos);
  }, [showEnzymes, enzymeKeys, seq, seqType]);

  // Above-line ABOVE items = enzyme cut labels + primer labels, packed together
  // so their leader-line labels never overlap (shared layout, as briefed).
  type AboveKind = "enzyme" | "primer";
  interface AboveSource {
    id: string;
    kind: AboveKind;
    anchorBp: number;
    label: string;
    color: string;
    enzymeName?: string;
    primerRef?: { name: string; start: number; end: number };
  }

  // Only items overlapping the VISIBLE WINDOW draw. Cut sites are points, so a
  // cut shows when its position is inside the window; a primer shows when its
  // span overlaps the window. (The id keeps the original index so highlight +
  // double-click routing stay stable across zoom.)
  const aboveSources: AboveSource[] = useMemo(() => {
    const src: AboveSource[] = [];
    cuts.forEach((c, i) => {
      if (c.pos < winStart || c.pos > winEnd) return;
      src.push({
        id: `enz-${i}`,
        kind: "enzyme",
        anchorBp: c.pos,
        // SnapGene-style "EcoRI (5,674)".
        label: `${c.name} (${comma(c.pos)})`,
        color: ENZYME_COLOR,
        enzymeName: c.name,
      });
    });
    if (showPrimers) {
      primers.forEach((p, i) => {
        const lo = Math.min(p.start, p.end);
        const hi = Math.max(p.start, p.end);
        if (!spanOverlapsWindow(lo, hi, winStart, winEnd)) return;
        // Anchor the leader at the primer's visible midpoint so an off-screen-end
        // primer still drops its tick inside the window.
        const visLo = Math.max(lo, winStart);
        const visHi = Math.min(hi, winEnd);
        src.push({
          id: `prm-${i}`,
          kind: "primer",
          anchorBp: (visLo + visHi) / 2,
          label: `${p.name} (${comma(lo)}..${comma(hi)})`,
          color: PRIMER_PINK,
          primerRef: { name: p.name, start: p.start, end: p.end },
        });
      });
    }
    return src;
  }, [cuts, primers, showPrimers, winStart, winEnd]);

  // Pack the above-line labels into tiers. maxNudge 0 keeps each label centered
  // over its tick (cut sites are points; we want the leader to drop straight
  // down), so collisions resolve by STACKING into tiers with leader lines.
  const aboveItems: LabelItem[] = useMemo(
    () =>
      aboveSources.map((s) => ({
        id: s.id,
        anchorX: bpX(s.anchorBp),
        width: estTextWidth(s.label, ABOVE_LABEL_FONT),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aboveSources, trackWidth, winStart, winEnd],
  );

  const abovePlaced = useMemo(
    () => layoutLabels(aboveItems, { gap: 6, maxNudge: 0, minX: PAD_X, maxX: PAD_X + trackWidth }),
    [aboveItems, trackWidth],
  );
  const aboveTiers = tierCount(abovePlaced);

  // ── FEATURES (below the line) ────────────────────────────────────────────
  // Pack feature labels into tiers too (these CAN nudge horizontally, since a
  // feature spans a range — the label just needs to read as "this feature").
  const featureItems: LabelItem[] = useMemo(
    () =>
      features
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => {
          const lo = Math.min(f.start, f.end);
          const hi = Math.max(f.start, f.end);
          return spanOverlapsWindow(lo, hi, winStart, winEnd);
        })
        .map(({ f, i }) => {
          // Anchor the label at the feature's VISIBLE-span midpoint so a feature
          // that straddles a window edge still labels inside the window.
          const lo = Math.max(Math.min(f.start, f.end), winStart);
          const hi = Math.min(Math.max(f.start, f.end), winEnd);
          return {
            id: `feat-${i}`,
            anchorX: bpX((lo + hi) / 2),
            width: estTextWidth(f.name || "feature", FEATURE_LABEL_FONT),
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, trackWidth, winStart, winEnd],
  );

  const featurePlaced = useMemo(
    () =>
      layoutLabels(featureItems, {
        gap: 8,
        maxNudge: 40,
        minX: PAD_X,
        maxX: PAD_X + trackWidth,
      }),
    [featureItems, trackWidth],
  );
  const featureLabelTiers = tierCount(featurePlaced);
  const placedById = useMemo(() => {
    const m = new Map<string, (typeof featurePlaced)[number]>();
    for (const p of featurePlaced) m.set(p.id, p);
    return m;
  }, [featurePlaced]);

  // ── vertical geometry ────────────────────────────────────────────────────
  // Everything above the baseline (cut/primer tiers + leaders), then the strand,
  // ruler, the feature arrow row, then the feature label tiers below it.
  const aboveBlockH = aboveTiers > 0 ? ABOVE_LEADER_BASE + (aboveTiers - 1) * ABOVE_TIER_H + ABOVE_LABEL_FONT + 6 : 6;
  const baselineY = aboveBlockH + ABOVE_TICK_H + 4;
  const rulerLabelY = baselineY + TICK_H + RULER_LABEL_GAP + RULER_FONT;
  const featureRowY = rulerLabelY + FEATURE_GAP + FEATURE_ARROW_H / 2;
  const featureLabelTop = featureRowY + FEATURE_ARROW_H / 2 + 4;
  const totalH =
    featureLabelTop + (featureLabelTiers > 0 ? featureLabelTiers * FEATURE_LABEL_H : 0) + 8;

  // Ruler ticks. The step recomputes from the VISIBLE span so a zoomed window
  // shows finer ticks; only ticks INSIDE the window draw. The molecule start (1)
  // and end labels are forced when those positions fall in the window.
  const ticks = useMemo(() => {
    if (seqLength <= 0 || trackWidth <= 0) return [];
    const step = rulerStepForSpan(winSpan);
    const out: { bp: number; label: string }[] = [];
    if (winStart <= 0) out.push({ bp: 0, label: "1" });
    const first = Math.ceil(winStart / step) * step;
    for (let bp = first; bp < seqLength && bp <= winEnd; bp += step) {
      if (bp <= 0) continue; // 0 already added as "1"
      out.push({ bp, label: comma(bp) });
    }
    // Label the molecule end only when it is visible.
    if (winEnd >= seqLength) out.push({ bp: seqLength, label: comma(seqLength) });
    return out;
  }, [seqLength, trackWidth, winStart, winEnd, winSpan]);

  if (!seqLength) return null;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-white" aria-label="Linear map">
      {/* ── compact zoom control row: -/+ buttons, log slider, readouts ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-meta text-slate-500">
        <Tooltip label="Zoom out">
          <button
            type="button"
            onClick={zoomOut}
            disabled={!canZoomOut}
            aria-label="Zoom out"
            className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </Tooltip>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={sliderPos}
          onChange={(e) => onSlider(Number(e.target.value))}
          aria-label="Zoom level"
          className="h-1 w-32 cursor-pointer accent-blue-500"
        />
        <Tooltip label="Zoom in">
          <button
            type="button"
            onClick={zoomIn}
            disabled={!canZoomIn}
            aria-label="Zoom in"
            className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="6" y1="2.5" x2="6" y2="9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </Tooltip>
        <span className="ml-1 tabular-nums font-medium text-slate-600">{comma(winSpan)} bp</span>
        <span className="tabular-nums text-slate-400">
          {comma(winStart + 1)} .. {comma(winEnd)}
        </span>
      </div>

      {/* ── the map itself (scrollable; wrapRef measures the track width) ── */}
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-auto">
      {trackWidth > 0 ? (
        <svg width="100%" height={totalH} className="block select-none" style={{ minHeight: totalH }}>
          {/* ── strand baseline ── */}
          <rect
            x={PAD_X}
            y={baselineY - STRAND_H / 2}
            width={trackWidth}
            height={STRAND_H}
            rx={STRAND_H / 2}
            fill={STRAND_COLOR}
            opacity={0.5}
          />

          {/* ── "more sequence off-screen" ellipsis cues at the strand ends ── */}
          {winStart > 0 ? (
            <text
              x={PAD_X - 2}
              y={baselineY + RULER_FONT / 2 - 1}
              fontSize={ABOVE_LABEL_FONT + 2}
              fill={STRAND_COLOR}
              textAnchor="end"
              fontWeight={700}
            >
              {"…"}
            </text>
          ) : null}
          {winEnd < seqLength ? (
            <text
              x={PAD_X + trackWidth + 2}
              y={baselineY + RULER_FONT / 2 - 1}
              fontSize={ABOVE_LABEL_FONT + 2}
              fill={STRAND_COLOR}
              textAnchor="start"
              fontWeight={700}
            >
              {"…"}
            </text>
          ) : null}

          {/* ── ruler ticks + labels ── */}
          {ticks.map((t, i) => {
            const x = bpX(t.bp);
            // First/last MOLECULE-end labels anchor inward so they are not clipped
            // at the strand ends; interior ticks center on their position.
            const anchor = t.bp <= 0 ? "start" : t.bp >= seqLength ? "end" : "middle";
            return (
              <g key={`tick-${i}`}>
                <line
                  x1={x}
                  y1={baselineY + STRAND_H / 2}
                  x2={x}
                  y2={baselineY + STRAND_H / 2 + TICK_H}
                  stroke={RULER_COLOR}
                  strokeWidth={1}
                />
                <text x={x} y={rulerLabelY} fontSize={RULER_FONT} fill={RULER_TEXT} textAnchor={anchor}>
                  {t.label}
                </text>
              </g>
            );
          })}

          {/* ── ABOVE the line: enzyme cut-sites + primers with leader lines ── */}
          {abovePlaced.map((p) => {
            const src = aboveSources.find((s) => s.id === p.id);
            if (!src) return null;
            const tickX = src.kind === "enzyme" ? p.anchorX : p.anchorX; // tick at the anchor
            const tickTopY = baselineY - STRAND_H / 2 - ABOVE_TICK_H;
            // Label sits at its tier: higher tier = further above the line.
            const tierY = tickTopY - ABOVE_LEADER_BASE - p.tier * ABOVE_TIER_H;
            const labelBaseY = tierY - 2;
            const highlighted =
              src.kind === "enzyme" && hoverEnzyme != null && src.enzymeName === hoverEnzyme;
            const color = highlighted ? ENZYME_HOVER : src.color;
            const isEnzyme = src.kind === "enzyme";
            return (
              <g
                key={p.id}
                style={{ cursor: isEnzyme ? "pointer" : "pointer" }}
                onMouseEnter={() => {
                  if (isEnzyme && src.enzymeName) setHoverEnzyme(src.enzymeName);
                }}
                onMouseLeave={() => {
                  if (isEnzyme) setHoverEnzyme(null);
                }}
                onDoubleClick={() => {
                  if (src.kind === "primer" && src.primerRef) onPrimerDoubleClick(src.primerRef);
                }}
              >
                {/* tick on the baseline */}
                <line
                  x1={tickX}
                  y1={baselineY - STRAND_H / 2}
                  x2={tickX}
                  y2={tickTopY}
                  stroke={color}
                  strokeWidth={highlighted ? 2 : 1.25}
                />
                {/* leader line: tick top -> up to the tier -> across to the label */}
                <polyline
                  points={`${tickX},${tickTopY} ${tickX},${tierY} ${p.labelX},${tierY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={highlighted ? 1.4 : 0.8}
                  opacity={highlighted ? 1 : 0.65}
                />
                <text
                  x={p.labelX}
                  y={labelBaseY}
                  fontSize={ABOVE_LABEL_FONT}
                  fill={color}
                  textAnchor="middle"
                  fontWeight={highlighted ? 600 : 400}
                >
                  {src.label}
                </text>
              </g>
            );
          })}

          {/* ── BELOW the line: feature arrows + exon boxes + dashed introns ── */}
          {features.map((f, i) => {
            const lo = Math.min(f.start, f.end);
            const hi = Math.max(f.start, f.end);
            // Skip features fully outside the visible window (their labels were
            // already filtered out of featureItems by the same predicate).
            if (!spanOverlapsWindow(lo, hi, winStart, winEnd)) return null;
            const color = f.color || "#94a3b8";
            const segs =
              f.segments && f.segments.length > 1
                ? f.segments
                    .map((s) => ({ start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) }))
                    .sort((a, b) => a.start - b.start)
                : [{ start: lo, end: hi }];
            const placed = placedById.get(`feat-${i}`);
            const labelTierY =
              featureLabelTop + (placed ? placed.tier : 0) * FEATURE_LABEL_H + FEATURE_LABEL_FONT;
            // visible-span midpoint for the (fallback) label + connector anchor.
            const visMidBp = (Math.max(lo, winStart) + Math.min(hi, winEnd)) / 2;
            const labelX = placed ? placed.labelX : bpX(visMidBp);
            // The intron connector is clipped to the window so it never overshoots
            // the strand ends.
            const introClip = clipSpanToWindow(lo, hi, winStart, winEnd);

            return (
              <g
                key={`feat-${i}`}
                style={{ cursor: "pointer" }}
                onDoubleClick={() =>
                  onFeatureDoubleClick({ name: f.name, start: f.start, end: f.end, direction: f.direction })
                }
              >
                {/* dashed intron connector spanning the visible feature (drawn
                    first, so exon boxes sit on top) */}
                {segs.length > 1 && introClip ? (
                  <line
                    x1={bpX(introClip.lo)}
                    y1={featureRowY}
                    x2={bpX(introClip.hi)}
                    y2={featureRowY}
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.7}
                  />
                ) : null}
                {/* exon boxes (or the single span); the LAST exon in the reading
                    direction carries the arrowhead. Each exon is CLIPPED to the
                    window; an exon whose arrowhead tip is off-screen draws flat. */}
                {segs.map((s, si) => {
                  const clip = clipSpanToWindow(s.start, s.end, winStart, winEnd);
                  if (!clip) return null; // exon fully off-screen
                  const x0 = bpX(clip.lo);
                  const x1 = Math.max(x0 + MIN_FEATURE_PX, bpX(clip.hi));
                  const isHeadExon =
                    f.direction === -1 ? si === 0 : si === segs.length - 1;
                  // The arrowhead only draws when the exon's reading-direction TIP
                  // is inside the window (forward: end not clipped; reverse: start
                  // not clipped). A clipped tip means "more sequence off-screen", so
                  // we draw a flat box instead of a misleading arrowhead.
                  const tipVisible =
                    f.direction === -1 ? clip.lo <= s.start : clip.hi >= s.end;
                  const drawArrow = isHeadExon && tipVisible;
                  if (drawArrow) {
                    return (
                      <polygon
                        key={si}
                        points={featureArrowPoints(x0, x1, featureRowY, f.direction)}
                        fill={color}
                        opacity={0.92}
                      />
                    );
                  }
                  // interior / non-head exon, or a clipped head: plain box.
                  return (
                    <rect
                      key={si}
                      x={x0}
                      y={featureRowY - FEATURE_ARROW_H / 2}
                      width={x1 - x0}
                      height={FEATURE_ARROW_H}
                      fill={color}
                      opacity={0.92}
                    />
                  );
                })}
                {/* feature label (de-collided tier) + a thin connector when the
                    label was nudged away from the feature center */}
                {Math.abs(labelX - bpX(visMidBp)) > 2 ? (
                  <line
                    x1={bpX(visMidBp)}
                    y1={featureRowY + FEATURE_ARROW_H / 2}
                    x2={labelX}
                    y2={labelTierY - FEATURE_LABEL_FONT + 2}
                    stroke={color}
                    strokeWidth={0.7}
                    opacity={0.5}
                  />
                ) : null}
                <text
                  x={labelX}
                  y={labelTierY}
                  fontSize={FEATURE_LABEL_FONT}
                  fill="#374151"
                  textAnchor="middle"
                >
                  {f.name || "feature"}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
      </div>

      {/* ── bottom CONTEXT NAVIGATOR + footer (fixed-height, BOTTOM-PINNED) ──
          navigator pin bot — the navigator is a fixed-height sibling pinned below
          the scrolling map SVG above, NOT inside the auto-height SVG content. That
          is why dragging the blue box (which reflows the feature-label tiers and
          changes the SVG height above) can no longer move the navigator vertically.

          The navigator strip + box only render when ZOOMED IN (winSpan < seqLength):
          at full zoom-out the whole molecule already fills the track, so there is
          nothing to navigate. The strip's vertical slot is RESERVED at all zoom
          levels (a fixed min-height matching the navigator height) so showing /
          hiding it does not shift the surrounding layout. The "Whole molecule (N bp)"
          footer is always present as the label. */}
      <div className="shrink-0 border-t border-slate-100">
        <div
          className="px-0"
          // Reserve the navigator's vertical slot whether or not the strip renders,
          // so toggling zoomed-in / whole-molecule does not jar the layout.
          style={{ minHeight: NAV_SLOT_H }}
        >
          {isZoomedIn && width > 0 ? (
            <div className="py-1">
              <LinearMapNavigator
                seqLength={seqLength}
                width={width}
                window={{ start: winStart, end: winEnd }}
                onWindowChange={setWin}
              />
            </div>
          ) : null}
        </div>
        <div className="px-3 pb-1 text-meta tabular-nums text-slate-400">
          Whole molecule ({comma(seqLength)} bp)
        </div>
      </div>
    </div>
  );
}
