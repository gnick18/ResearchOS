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
// INTERACTION (map select bot — SnapGene selection model): the Map is its OWN
// selection surface and NEVER changes the view mode.
//   - HOVER a feature -> a floating INFO CARD at the cursor (name, 1-based range,
//     bp length, aa/kDa for a cds/gene, the product/note) + RED BRACKET markers
//     on the ruler previewing the range a click will select.
//   - SINGLE-click a feature -> SELECT its [start, end] (the shared editor
//     selection), stay on the Map.
//   - SHIFT-click another feature -> EXTEND the selection to span the anchor
//     (first-selected) feature through the shift-clicked one.
//   - DOUBLE-click a feature -> open the feature editor (primer -> Edit Primer).
//   - Click empty backbone / ruler -> CLEAR the selection (deselect).
// The selection is the shared editor state, so it PERSISTS across the Map and
// Sequence tabs and is drawn here as a translucent blue SELECTION BAND.

import { useEffect, useMemo, useRef, useState } from "react";
import { digestEnzymes } from "@/lib/sequences/enzyme-filters";
import {
  layoutLabels,
  tierCount,
  cutSiteStackTooDeep,
  type LabelItem,
} from "@/lib/sequences/label-layout";
import { Icon } from "@/components/icons";
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
  panWindow,
  jogScrubToDeltaBp,
} from "@/lib/sequences/linear-map-window";
import Tooltip from "@/components/Tooltip";
import LinearMapNavigator from "./LinearMapNavigator";
import MapJogWheel from "./MapJogWheel";
import { buildFeatureCard, buildPrimerCard, selectionBandRect, dragSelectRange, isDrag } from "@/lib/sequences/linear-map-select";
import HoverCardActionHint from "./HoverCardActionHint";
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
  /** map select bot — /product or /note qualifier text for the hover info card. */
  note?: string;
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
  /**
   * map select bot — SINGLE-click a feature: SELECT its DNA range (the shared
   * editor selection). A plain click selects that one feature and resets the
   * span anchor; a SHIFT-click extends the selection from the anchor through the
   * clicked feature (SequenceEditView computes the union). The Map NEVER changes
   * view mode. `mods.shiftKey` carries the modifier up.
   */
  onFeatureClick?: (
    f: { name: string; start: number; end: number; direction?: number },
    mods: { shiftKey: boolean },
  ) => void;
  /**
   * map select bot — click on empty backbone / ruler / track (NOT a feature):
   * CLEAR the selection (deselect). No navigation, no view-mode change.
   */
  onClearSelection?: () => void;
  /**
   * map drag bot — CLICK-DRAG a bp RANGE across the bare track / ruler. Fires
   * continuously while dragging (so the band + base view + overview update live)
   * and once more on pointer-up to finalize. `range` is the normalized
   * [start, end] under the drag; `anchorBp` is the drag ORIGIN bp so a later
   * shift-click extends from where the drag began. The Map NEVER changes the
   * view mode. A pointer-down with no movement is NOT a drag (it stays a normal
   * empty-track click that clears the selection via onClearSelection).
   */
  onRangeSelect?: (range: { start: number; end: number }, anchorBp: number) => void;
  /**
   * map select bot — the CURRENT editor selection [start, end] (0-based,
   * half-open), or null when nothing is selected. The Map draws a translucent
   * blue SELECTION BAND over this range (clipped to the visible window) so the
   * shared selection is visible here too and persists across Map/Sequence.
   */
  selection?: { start: number; end: number } | null;
  /**
   * Optional: turn the cut-site / primer layers off, wired to the editor's rail
   * toggles. When provided, the "labels are crowded" advisory (shown when the
   * above-line tier stack gets deep) offers a one-click hide. Omitted = the
   * advisory still warns but without the buttons (the toggles live elsewhere).
   */
  onHideEnzymes?: () => void;
  onHidePrimers?: () => void;
}

// ── layout constants (px) ──────────────────────────────────────────────────
const PAD_X = 16; // horizontal inset so end ticks/labels are not clipped
const BASELINE_FROM_TOP_BASE = 0; // computed dynamically from tier counts
const STRAND_H = 6; // thickness of the strand band
const TICK_H = 6; // ruler tick length below the baseline
const RULER_LABEL_GAP = 4;
const FEATURE_GAP = 10; // gap between strand and the first feature row
const FEATURE_ARROW_H = 14; // height of a feature arrow body
// label legibility bot — vertical step per stacked label tier. Widened from 14
// to 20 (below-line features) / 15 to 22 (above-line enzymes/primers) so stacked
// labels get real breathing room, SnapGene-style, instead of cramming. The map
// height grows from the tier count and the canvas scrolls, so taller is fine.
const FEATURE_LABEL_H = 20; // height reserved per below-line label tier
const FEATURE_ARROWHEAD = 7;
const ABOVE_TICK_H = 7; // tick mark length above the baseline (enzyme/primer)
const ABOVE_LEADER_BASE = 12; // first leader-line segment length above the tick
const ABOVE_TIER_H = 22; // vertical step between stacked label tiers
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

// Colors are driven through the --seq-* CSS vars (globals.css) so the map flips
// with data-theme. Light values match the pre-dark-mode hex exactly. SVG fill/
// stroke accept var() directly.
const PRIMER_PINK = "var(--seq-primer)";
const ENZYME_COLOR = "var(--seq-enzyme)";
const ENZYME_HOVER = "var(--seq-enzyme-hover)";
const RULER_COLOR = "var(--seq-ruler-line)";
const RULER_TEXT = "var(--seq-ruler-text)";
const STRAND_COLOR = "var(--seq-strand)";
// map select bot — red HOVER BRACKETS (preview the range a click will select) +
// the translucent blue SELECTION BAND (the persisted, shared editor selection).
const HOVER_BRACKET_RED = "var(--seq-enzyme-hover)";
const SELECTION_BLUE = "var(--seq-selection)";

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

/**
 * map interactivity bot — INVERSE of the map's bp -> x mapping. Convert an x (px,
 * measured from the SVG's left edge) to the bp under the cursor, accounting for
 * the left inset (PAD_X) and the current VISIBLE WINDOW (so a zoomed map maps to
 * the window's bp range, not the whole molecule). The x is clamped to the track
 * so a click in the side padding lands on the nearest end bp, and the result is
 * clamped to [0, seqLength]. Pure + unit-tested (see LinearMap math test).
 */
export function xToBp(
  x: number,
  opts: { padX: number; trackWidth: number; winStart: number; winSpan: number; seqLength: number },
): number {
  const { padX, trackWidth, winStart, winSpan, seqLength } = opts;
  if (trackWidth <= 0) return Math.max(0, Math.min(seqLength, Math.round(winStart)));
  const frac = Math.max(0, Math.min(1, (x - padX) / trackWidth));
  const bp = winStart + frac * winSpan;
  return Math.max(0, Math.min(seqLength, Math.round(bp)));
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
  onFeatureClick,
  onClearSelection,
  onRangeSelect,
  selection,
  onHideEnzymes,
  onHidePrimers,
}: LinearMapProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(0);
  // crowding advisory bot — dismiss the "cut-site labels are crowded" hint for the
  // session (it re-shows next mount; cheap, no persistence needed).
  const [crowdHintDismissed, setCrowdHintDismissed] = useState(false);
  // Hover state for enzyme highlight, keyed on enzyme NAME (all sites of the same
  // enzyme highlight together — SnapGene behavior).
  const [hoverEnzyme, setHoverEnzyme] = useState<string | null>(null);
  // map select bot — HOVER a feature: which feature index is hovered + the
  // card's already-clamped {left, top} (px, relative to the scroll wrapper) so
  // the floating info card follows the cursor without reading refs during render.
  // The hovered feature also drives the red bracket preview on the ruler.
  const [hoverFeature, setHoverFeature] = useState<{ idx: number; left: number; top: number } | null>(null);
  // primer hover bot — hovering a primer shows the same coords / bp / GC / Tm
  // card the click readout shows (separate from the feature hover state).
  const [hoverPrimer, setHoverPrimer] = useState<{
    primer: { name: string; start: number; end: number };
    left: number;
    top: number;
  } | null>(null);

  // map select bot — compute the info card's clamped position from a pointer
  // event. Reads the wrapper rect + scroll offsets HERE (in an event handler,
  // where ref access is allowed), not during render. Flips left near the right
  // edge so the card never overflows the map.
  const CARD_W = 240;
  const cardPosFromEvent = (clientX: number, clientY: number): { left: number; top: number } => {
    const el = wrapRef.current;
    if (!el) return { left: 0, top: 0 };
    const rect = el.getBoundingClientRect();
    const OFFSET = 14;
    const scrollTop = el.scrollTop;
    const scrollLeft = el.scrollLeft;
    let left = clientX - rect.left + scrollLeft + OFFSET;
    let top = clientY - rect.top + scrollTop + OFFSET;
    if (left + CARD_W > rect.width + scrollLeft) {
      left = clientX - rect.left + scrollLeft - CARD_W - OFFSET;
    }
    if (left < scrollLeft + 4) left = scrollLeft + 4;
    if (top < scrollTop + 4) top = scrollTop + 4;
    return { left, top };
  };

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

  // ── CLICK MODEL (map select bot — SnapGene selection surface) ─────────────
  // The Map NEVER changes the view mode. A SINGLE click on a feature SELECTS its
  // range (shift-click extends the span); a DOUBLE click opens the editor; a
  // click on empty track CLEARS the selection. Selection is immediate on click,
  // so no single-vs-double timer is needed — selecting on the first click of a
  // double-click is harmless (the editor opens on the second click regardless).

  // Map a pointer event to the bp under it (inverse of bpX, window-aware). Kept
  // for the future, currently unused by the click handlers (empty click clears
  // rather than seeks), so it is referenced by xToBp's export + tests only.
  const eventToBp = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : clientX;
    return xToBp(x, { padX: PAD_X, trackWidth, winStart, winSpan, seqLength });
  };

  // ── map drag bot — CLICK-DRAG to select a bp RANGE across the bare track ────
  // A pointer-down on the SVG itself (NOT on a feature arrow / above-line item,
  // both of which stopPropagation, and NOT on the jog wheel / navigator / zoom
  // controls, which live OUTSIDE this SVG) starts a candidate drag. We record the
  // down point + origin bp and capture the pointer so a drag that leaves the SVG
  // keeps tracking. On move, once the pointer passes the click/drag px threshold,
  // we report the live [min, max] bp range up to SequenceEditView (which sets the
  // SAME externalSel the band + base view + overview read, plus the span anchor).
  // On up, a drag finalizes the range; a no-move pointer-up falls through to the
  // SVG onClick (empty-track clear), so a steady click still deselects. The live
  // geometry is read from a ref so a fast drag never acts on a stale window.
  const dragGeomRef = useRef({ trackWidth, winStart, winSpan, seqLength });
  dragGeomRef.current = { trackWidth, winStart, winSpan, seqLength };
  const dragRef = useRef<{
    pointerId: number;
    downX: number;
    downY: number;
    originBp: number;
    active: boolean;
  } | null>(null);

  const bpFromClientX = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : clientX;
    const g = dragGeomRef.current;
    return xToBp(x, { padX: PAD_X, trackWidth: g.trackWidth, winStart: g.winStart, winSpan: g.winSpan, seqLength: g.seqLength });
  };

  const onTrackPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Only a primary (left) button starts a drag; ignore right/middle so a
    // context menu or middle-click never begins a selection.
    if (e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
      downX: e.clientX,
      downY: e.clientY,
      originBp: bpFromClientX(e.clientX),
      active: false,
    };
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already gone; harmless.
    }
  };

  const onTrackPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active && !isDrag(e.clientX - d.downX, e.clientY - d.downY)) return;
    d.active = true;
    const curBp = bpFromClientX(e.clientX);
    const range = dragSelectRange(d.originBp, curBp);
    onRangeSelect?.(range, d.originBp);
  };

  const onTrackPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore: pointer may already be released.
    }
    if (!d.active) return; // no movement -> let onClick run the empty-track clear
    // A real drag happened: SUPPRESS the click event that the browser fires after
    // this pointer-up so the SVG onClick does NOT clear the just-made selection.
    justDraggedRef.current = true;
    const curBp = bpFromClientX(e.clientX);
    const range = dragSelectRange(d.originBp, curBp);
    // A drag that ended without crossing a whole bp (degenerate range) is still a
    // click, not a selection; let the empty-track clear handle it instead.
    if (range.start === range.end) {
      justDraggedRef.current = false;
      onClearSelection?.();
      return;
    }
    onRangeSelect?.(range, d.originBp);
  };

  // map drag bot — set true on a drag-ending pointer-up so the trailing synthetic
  // click on the SVG is swallowed (it would otherwise clear the new selection).
  const justDraggedRef = useRef(false);

  void eventToBp;

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

  // ── JOG / SHUTTLE WHEEL (map jog wheel bot) ───────────────────────────────
  // Each onScrub reports the incremental drag (px) since the last move. We turn
  // that into a FINE bp pan via the unit-tested jogScrubToDeltaBp (scaled by the
  // current span so the feel is consistent across zoom) and apply it with the
  // pure panWindow (which clamps to [0, seqLength] keeping the span). The handler
  // reads live geometry from a ref + uses the functional setWin form so a fast
  // drag never acts on a stale window. The wheel only matters when zoomed in.
  //
  // FRACTIONAL ACCUMULATOR: at tight zoom one move's deltaBp is often well under
  // 1 bp (e.g. a 7px move on a 66 bp window is ~0.17 bp). panWindow rounds the
  // start to an integer, so applying each sub-bp delta in isolation would round
  // back to the same start and the wheel would feel dead. We carry the leftover
  // fraction in a ref and only feed panWindow whole-bp steps, keeping the
  // remainder for the next move. This makes a slow drag accumulate smoothly.
  const jogGeomRef = useRef({ trackWidth, winSpan });
  jogGeomRef.current = { trackWidth, winSpan };
  const jogFracRef = useRef(0);
  const onJogScrub = (deltaPx: number) => {
    const { trackWidth: tw, winSpan: span } = jogGeomRef.current;
    const deltaBp = jogScrubToDeltaBp(deltaPx, tw, span) + jogFracRef.current;
    const wholeBp = Math.trunc(deltaBp);
    jogFracRef.current = deltaBp - wholeBp; // carry the sub-bp remainder
    if (wholeBp === 0) return;
    setWin((w) => panWindow(w, wholeBp, seqLength));
  };

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
          // primer colors bot — color the primer's tick, leader, AND label in the
          // primer's own color (carried on p.color, derived from the primer_bind
          // feature). A forward + reverse pair colored alike are easy to match.
          // Falls back to the standard primer pink when the primer has none.
          color: p.color || PRIMER_PINK,
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

  // label legibility bot — maxNudge 0 keeps each enzyme/primer label centered
  // over its tick so its leader drops straight down; collisions resolve by
  // STACKING into more tiers (the vertical spread Grant wants). gap widened to 10
  // so even same-tier labels keep clear air between them.
  const abovePlaced = useMemo(
    () => layoutLabels(aboveItems, { gap: 10, maxNudge: 0, minX: PAD_X, maxX: PAD_X + trackWidth }),
    [aboveItems, trackWidth],
  );
  const aboveTiers = tierCount(abovePlaced);
  // crowding advisory bot — the above-line cut-site / primer labels never overlap
  // (layoutLabels guarantees it) but they STACK into tiers, and a deep stack reads
  // as a thicket of long leaders. Surface a quiet, dismissible nudge to hide a layer
  // or zoom in (the same levers the rail + zoom already offer). Mirrors the layout
  // advisor's philosophy on the interactive surface.
  const cutSitesCrowded =
    cutSiteStackTooDeep(aboveTiers) && !crowdHintDismissed && aboveSources.length > 0;

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

  // label legibility bot — Grant wants feature labels SPREAD VERTICALLY, not
  // crammed horizontally. maxNudge dropped from 40 to 12 so a label only drifts a
  // hair off its feature center before it stacks into a fresh tier instead, and
  // gap widened from 8 to 12 so same-tier neighbors keep clear air.
  const featurePlaced = useMemo(
    () =>
      layoutLabels(featureItems, {
        gap: 12,
        maxNudge: 12,
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

  // ── map select bot — SELECTION BAND geometry ───────────────────────────────
  // Map the shared editor selection to a clipped pixel band over the window.
  const band = useMemo(() => {
    if (!selection) return null;
    return selectionBandRect({
      selStart: selection.start,
      selEnd: selection.end,
      winStart,
      winEnd,
      padX: PAD_X,
      trackWidth,
    });
  }, [selection, winStart, winEnd, trackWidth]);

  // ── map select bot — HOVERED feature -> red bracket preview + info card ────
  // The hovered feature (by index into `features`) clipped to the visible window
  // gives the start/end x for the red brackets; buildFeatureCard supplies the
  // floating card content. Both clear on mouse-leave (hoverFeature -> null).
  const hovered = hoverFeature ? features[hoverFeature.idx] : null;
  const hoverBracket = useMemo(() => {
    if (!hovered) return null;
    const lo = Math.min(hovered.start, hovered.end);
    const hi = Math.max(hovered.start, hovered.end);
    if (hi <= winStart || lo >= winEnd) return null; // off-screen
    const clipLo = Math.max(lo, winStart);
    const clipHi = Math.min(hi, winEnd);
    return { x0: bpX(clipLo), x1: bpX(clipHi), startClipped: lo < winStart, endClipped: hi > winEnd };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, winStart, winEnd, trackWidth]);
  const hoverCard = useMemo(
    () => (hovered ? buildFeatureCard(hovered) : null),
    [hovered],
  );
  // primer hover bot — the primer info card (coords / bp / GC / Tm).
  const primerCard = useMemo(
    () => (hoverPrimer ? buildPrimerCard(hoverPrimer.primer, seq) : null),
    [hoverPrimer, seq],
  );

  if (!seqLength) return null;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-[var(--seq-bg)]" aria-label="Linear map">
      {/* ── compact zoom control row: -/+ buttons, log slider, readouts ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-meta text-foreground-muted">
        <Tooltip label="Zoom out">
          <button
            type="button"
            onClick={zoomOut}
            disabled={!canZoomOut}
            aria-label="Zoom out"
            className="flex h-6 w-6 items-center justify-center rounded border border-border text-foreground-muted hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
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
            className="flex h-6 w-6 items-center justify-center rounded border border-border text-foreground-muted hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="6" y1="2.5" x2="6" y2="9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </Tooltip>
        <span className="ml-1 tabular-nums font-medium text-foreground-muted">{comma(winSpan)} bp</span>
        <span className="tabular-nums text-foreground-muted">
          {comma(winStart + 1)} .. {comma(winEnd)}
        </span>

        {/* ── jog / shuttle wheel: FINE panning when zoomed in (map jog wheel
            bot). Inert at full zoom-out (nothing to pan). ── */}
        <div className="ml-auto flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 ring-1 ring-border">
          <span className="text-meta font-semibold tracking-wide text-foreground-muted uppercase">Scroll</span>
          <MapJogWheel onScrub={onJogScrub} disabled={!isZoomedIn} width={96} />
        </div>
      </div>

      {/* ── the map itself (scrollable; wrapRef measures the track width) ──
          vertical layout: a single-line linear map is short, so without this it
          would pin to the top and leave a tall empty band above the navigator.
          Centering the SVG in the available column places the strand + feature
          track in the middle of the canvas. `my-auto` (not justify-center) does
          the centering so a tall map (many feature-label tiers) still scrolls
          fully into view without the flexbox top-clipping bug. */}
      <div
        ref={wrapRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-auto"
      >
      {cutSitesCrowded ? (
        <div className="pointer-events-none sticky top-2 z-10 flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-meta text-amber-900 shadow-sm dark:border-amber-500/40 dark:bg-amber-950/60 dark:text-amber-200">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex flex-col gap-1.5">
              <span>
                Cut-site &amp; primer labels are {aboveTiers} tiers deep. Hide a layer or
                zoom in for a cleaner read.
              </span>
              {(onHideEnzymes || onHidePrimers) && (
                <div className="flex flex-wrap gap-1.5">
                  {onHideEnzymes && showEnzymes && (
                    <button
                      type="button"
                      onClick={onHideEnzymes}
                      className="rounded border border-amber-400/60 px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/50"
                    >
                      Hide cut sites
                    </button>
                  )}
                  {onHidePrimers && showPrimers && (
                    <button
                      type="button"
                      onClick={onHidePrimers}
                      className="rounded border border-amber-400/60 px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/50"
                    >
                      Hide primers
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCrowdHintDismissed(true)}
              aria-label="Dismiss"
              className="ml-1 shrink-0 rounded px-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      {trackWidth > 0 ? (
        <svg
          ref={svgRef}
          width="100%"
          height={totalH}
          className="my-auto block shrink-0 cursor-pointer select-none"
          style={{ minHeight: totalH }}
          // map select bot — a click that reaches the SVG itself (it was NOT
          // consumed by a feature arrow or an above-line item, both of which
          // stopPropagation) is a click on empty track / ruler / backbone.
          // CLEAR the selection (deselect). No navigation, no view-mode change.
          // map drag bot — but if a click-drag JUST finished, swallow the trailing
          // synthetic click so it does not wipe the range the drag selected.
          onClick={() => {
            if (justDraggedRef.current) {
              justDraggedRef.current = false;
              return;
            }
            onClearSelection?.();
          }}
          // map drag bot — CLICK-DRAG range select over the bare track / ruler.
          // A drag that starts on a feature arrow / above-line item never reaches
          // here (those stopPropagation their own pointer/click events), so the
          // drag only begins on empty backbone, exactly as briefed. Pointer
          // capture keeps tracking even when the drag leaves the SVG.
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
        >
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

          {/* ── map select bot — SELECTION BAND (the persisted shared editor
              selection). A calm translucent sky band spanning the selection,
              clipped to the visible window; thin edge rules mark the bounds.
              Drawn here (under the ruler ticks + features) so feature arrows and
              labels stay legible on top. pointer-events:none so it never
              swallows a click meant for a feature or the empty-track clear. */}
          {band ? (
            <g pointerEvents="none">
              <rect
                x={band.x0}
                y={baselineY - STRAND_H / 2 - 5}
                width={Math.max(2, band.x1 - band.x0)}
                height={featureRowY + FEATURE_ARROW_H / 2 - (baselineY - STRAND_H / 2 - 5)}
                fill={SELECTION_BLUE}
                opacity={0.14}
                rx={2}
              />
              {!band.clampedLeft ? (
                <line
                  x1={band.x0}
                  y1={baselineY - STRAND_H / 2 - 5}
                  x2={band.x0}
                  y2={featureRowY + FEATURE_ARROW_H / 2}
                  stroke={SELECTION_BLUE}
                  strokeWidth={1.25}
                  opacity={0.55}
                />
              ) : null}
              {!band.clampedRight ? (
                <line
                  x1={band.x1}
                  y1={baselineY - STRAND_H / 2 - 5}
                  x2={band.x1}
                  y2={featureRowY + FEATURE_ARROW_H / 2}
                  stroke={SELECTION_BLUE}
                  strokeWidth={1.25}
                  opacity={0.55}
                />
              ) : null}
            </g>
          ) : null}

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

          {/* ── map select bot — RED BRACKET PREVIEW. While a feature is hovered,
              draw SnapGene-style red square brackets on the ruler at the hovered
              feature's start + end x, previewing the range a click will select.
              A bracket whose side is clipped off-screen is omitted (the feature
              continues past the window). pointer-events:none so it never blocks
              the underlying feature click. ── */}
          {hoverBracket ? (
            (() => {
              const top = baselineY - STRAND_H / 2 - 7;
              const bot = baselineY + STRAND_H / 2 + TICK_H + 1;
              const tab = 4; // horizontal foot of each bracket
              return (
                <g pointerEvents="none" stroke={HOVER_BRACKET_RED} strokeWidth={1.5} fill="none">
                  {!hoverBracket.startClipped ? (
                    <polyline
                      points={`${hoverBracket.x0 + tab},${top} ${hoverBracket.x0},${top} ${hoverBracket.x0},${bot} ${hoverBracket.x0 + tab},${bot}`}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {!hoverBracket.endClipped ? (
                    <polyline
                      points={`${hoverBracket.x1 - tab},${top} ${hoverBracket.x1},${top} ${hoverBracket.x1},${bot} ${hoverBracket.x1 - tab},${bot}`}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                </g>
              );
            })()
          ) : null}

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
                // map drag bot — an above-line item (enzyme / primer) is NOT bare
                // track, so a pointer-down here must NOT begin a range drag. Stop
                // it from bubbling to the SVG root's drag-start handler.
                onPointerDown={(e) => e.stopPropagation()}
                onMouseEnter={(e) => {
                  if (isEnzyme && src.enzymeName) setHoverEnzyme(src.enzymeName);
                  else if (src.kind === "primer" && src.primerRef)
                    setHoverPrimer({ primer: src.primerRef, ...cardPosFromEvent(e.clientX, e.clientY) });
                }}
                onMouseMove={(e) => {
                  if (src.kind === "primer" && src.primerRef)
                    setHoverPrimer({ primer: src.primerRef, ...cardPosFromEvent(e.clientX, e.clientY) });
                }}
                onMouseLeave={() => {
                  if (isEnzyme) setHoverEnzyme(null);
                  else setHoverPrimer(null);
                }}
                // map select bot — a single click on an above-line item (enzyme
                // cut / primer) is consumed (stopPropagation) so it does NOT fall
                // through to the empty-track clear; it has no select action of its
                // own. A double-click on a primer opens the Edit Primer dialog
                // (unchanged behavior).
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
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
                {/* label legibility bot — leader: tick top -> straight up to the
                    label's tier row -> elbow across to the label. Stroke raised
                    from 0.8 to 1.1 px and opacity from 0.65 to 0.9 so the line
                    clearly connects ONE label to its tick, SnapGene-style. */}
                <polyline
                  points={`${tickX},${tickTopY} ${tickX},${tierY} ${p.labelX},${tierY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={highlighted ? 1.6 : 1.1}
                  strokeLinejoin="round"
                  opacity={highlighted ? 1 : 0.9}
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
            const color = f.color || "var(--seq-strand)";
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
                // map drag bot — a feature arrow is NOT bare track, so a
                // pointer-down on it must NOT begin a range drag. Stop it from
                // bubbling to the SVG root's drag-start handler; the feature's own
                // click / shift-click / double-click handlers stay intact.
                onPointerDown={(e) => e.stopPropagation()}
                // map select bot — HOVER a feature: track its index + the cursor
                // so the floating info card follows the pointer and the red
                // bracket preview draws on the ruler. Clear on mouse-leave.
                onMouseEnter={(e) =>
                  setHoverFeature({ idx: i, ...cardPosFromEvent(e.clientX, e.clientY) })
                }
                onMouseMove={(e) =>
                  setHoverFeature({ idx: i, ...cardPosFromEvent(e.clientX, e.clientY) })
                }
                onMouseLeave={() =>
                  setHoverFeature((h) => (h && h.idx === i ? null : h))
                }
                // map select bot — SINGLE click SELECTS this feature's range
                // (shift-click extends the span; SequenceEditView computes the
                // union from the anchor). The Map stays put. DOUBLE click opens
                // the editor. stopPropagation so the click does not also hit the
                // SVG-level empty-track clear.
                onClick={(e) => {
                  e.stopPropagation();
                  if (!onFeatureClick) return;
                  onFeatureClick(
                    { name: f.name, start: f.start, end: f.end, direction: f.direction },
                    { shiftKey: e.shiftKey },
                  );
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onFeatureDoubleClick({ name: f.name, start: f.start, end: f.end, direction: f.direction });
                }}
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
                        stroke="var(--seq-feature-stroke)"
                        strokeWidth={0.75}
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
                      stroke="var(--seq-feature-stroke)"
                      strokeWidth={0.75}
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
                  fill="var(--seq-letter)"
                  textAnchor="middle"
                >
                  {f.name || "feature"}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}

      {/* ── map select bot — HOVER INFO CARD. A custom floating popover (NOT the
          icon Tooltip component) anchored at the cursor inside the scroll
          wrapper, listing the hovered feature's name, 1-based range, bp length,
          the aa / kDa readout for a coding feature, and the product / note. It
          follows the pointer and is clamped on-screen so it never overflows the
          map. pointer-events:none so it never intercepts the feature click. ── */}
      {hoverFeature && hoverCard ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-30 rounded-md border border-border bg-surface-raised px-3 py-2 shadow-lg"
          style={{ left: hoverFeature.left, top: hoverFeature.top, width: CARD_W }}
        >
          <div className="text-body font-semibold text-foreground">{hoverCard.title}</div>
          <div className="mt-1 space-y-0.5">
            {hoverCard.lines.map((line, li) => (
              <div key={li} className="text-meta text-foreground-muted">
                {line.label ? (
                  <span className="font-medium text-foreground-muted">{line.label} </span>
                ) : null}
                {line.value}
              </div>
            ))}
          </div>
          <HoverCardActionHint />
        </div>
      ) : null}

      {/* primer hover bot — the same floating card for a hovered PRIMER, showing
          its binding coords, length, %GC and nearest-neighbor Tm (the stats the
          click readout shows). Same popover treatment as the feature card. */}
      {hoverPrimer && primerCard ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-30 rounded-md border border-border bg-surface-raised px-3 py-2 shadow-lg"
          style={{ left: hoverPrimer.left, top: hoverPrimer.top, width: CARD_W }}
        >
          <div className="text-body font-semibold text-foreground">{primerCard.title}</div>
          <div className="mt-1 space-y-0.5">
            {primerCard.lines.map((line, li) => (
              <div key={li} className="text-meta text-foreground-muted">
                {line.label ? (
                  <span className="font-medium text-foreground-muted">{line.label} </span>
                ) : null}
                {line.value}
              </div>
            ))}
          </div>
          <HoverCardActionHint />
        </div>
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
          hiding it does not shift the surrounding layout.

          NOTE: the "Whole molecule (N bp)" caption is NOT drawn here. The editor's
          shared SequenceCoordinateBar (Map mode) already renders that indicator
          directly below this component, so a footer label here was a visible
          duplicate. The navigator slot only carries the strip itself now. */}
      <div className="shrink-0">
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
      </div>
    </div>
  );
}
