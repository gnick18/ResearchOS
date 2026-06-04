"use client";

// seq nav bot — the PERSISTENT OVERVIEW / CONTEXT BAR for linear navigation.
//
// SeqViz has NO native fixed top strip (its linear viewer stacks rows and
// scrolls vertically), so this is a CUSTOM lightweight SVG mini-map: the
// sequence laid out left-to-right as a thin baseline, every visible feature as
// a small arrow, plus a draggable VIEWPORT BOX showing the current view window.
//
// TWO-WAY SYNC:
//   - the box POSITION is driven by `window` (the bp range currently visible in
//     the main linear viewer, computed from the main scroller's geometry);
//   - dragging the box (or clicking the track) calls `onScrollToBp` with the bp
//     the user wants at the top of the main view, which the host turns into a
//     main-view scroll. So the box both reflects and controls the main view.
//
// overview zoom bot — TWO-LEVEL ZOOM (SnapGene-style). The bar now has its OWN
// independent zoom: a scroll / trackpad pinch OVER THE BAR shrinks or grows the
// visible bp EXTENT `[start, end]`, decoupled from the detail-view zoom. The
// detail `window` box is projected onto whatever extent is showing, clamped to
// the track when the detail window sits partly outside the extent. At the
// default whole-molecule extent (`[0, seqLength]`) every behavior is unchanged.
//
// This bar is LINEAR-only (circular molecules already get the circular map). It
// renders nothing when there is no sequence.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bpToTrackX,
  trackXToBp,
  showInOverview,
  zoomExtentAroundCursor,
  panExtent,
  overviewSelectionRect,
  pickOverviewFeatureAtBp,
} from "@/lib/sequences/sequence-zoom";

/** overview selband bot — the shared editor SELECTION color, matched exactly to
 *  the LinearMap band (SELECTION_BLUE = sky-500) so a selection reads identically
 *  across Map / base view / this overview strip. */
const SELECTION_BLUE = "#0ea5e9"; // sky-500, same as LinearMap.tsx

export interface OverviewFeature {
  name: string;
  start: number;
  end: number;
  /** 1 = forward (arrow points right), -1 = reverse (points left). */
  direction: 1 | -1;
  color?: string;
  /** GenBank feature type (e.g. "CDS", "source"). Used only to keep the
   *  whole-span `source` feature off the mini-map; see showInOverview. */
  type?: string;
  /**
   * overview featclick bot — a stable reference back to this feature's index in
   * the source `doc.features` list, so a click on the arrow resolves straight to
   * `selectFeature(index)` (the same path the Map / Features list use). Populated
   * by the host's overviewFeatures memo.
   */
  index?: number;
}

export interface SequenceOverviewBarProps {
  seqLength: number;
  features: OverviewFeature[];
  /** The bp window currently visible in the main view: [start, end). */
  window: { start: number; end: number };
  /** Scroll the main view so `bp` sits at the top of its viewport. */
  onScrollToBp: (bp: number) => void;
  /**
   * overview featclick bot — clicking ON a feature arrow SELECTS that feature
   * (sets the shared selection to its range) instead of scrolling. Only fired
   * when a click lands on a feature; a bare-track click still scrolls via
   * `onScrollToBp`. Omitted => the bar reverts to scroll-only on every click.
   */
  onFeatureClick?: (feature: OverviewFeature, mods: { shiftKey: boolean }) => void;
  /**
   * Shift-click on the bare track EXTENDS the current selection to the clicked
   * bp (matching the Map's shift-click span), instead of scrolling. Only fired
   * for a shift-click that does not land on a feature.
   */
  onShiftSelectToBp?: (bp: number) => void;
  /**
   * overview zoom bot — the bp DOMAIN the bar currently spans (its OWN zoom).
   * Defaults to the whole molecule when omitted, preserving the original
   * whole-molecule behavior. Scroll / pinch over the bar changes this via
   * `onExtentChange`, independent of the detail view's zoom.
   */
  extent?: { start: number; end: number };
  /** Emitted when a scroll / pinch / pan over the bar changes the extent. */
  onExtentChange?: (extent: { start: number; end: number }) => void;
  /**
   * overview selband bot — the shared editor SELECTION (bp range) to draw as a
   * translucent BLUE band, matching the LinearMap + base-view selection. Mapped
   * through the active extent and clamped to the track; omitted (null) when there
   * is no selection. Distinct from the viewport box (a neutral outline).
   */
  selection?: { start: number; end: number } | null;
}

const BAR_HEIGHT = 46; // px, the whole strip
const TRACK_PAD_X = 8; // px horizontal inset so the box edges aren't clipped
const BASELINE_Y = 30; // px, where the sequence baseline sits
const FEATURE_H = 9; // px, feature arrow height

/** overview zoom bot — how aggressively a plain wheel / pinch step scales the
 *  extent span. Each unit of wheel deltaY multiplies the span by
 *  exp(deltaY * SPAN_ZOOM_K); positive deltaY (scroll down / pinch together)
 *  widens (zoom OUT), negative narrows (zoom IN), matching the LinearMap feel. */
const SPAN_ZOOM_K = 0.0025;

/** Build an SVG arrow polygon for a feature spanning [x0, x1] at the baseline. */
function featureArrow(x0: number, x1: number, direction: 1 | -1): string {
  const top = BASELINE_Y - FEATURE_H / 2;
  const bot = BASELINE_Y + FEATURE_H / 2;
  const mid = BASELINE_Y;
  const w = Math.max(2, x1 - x0);
  // Arrowhead length is capped so tiny features still read as a block.
  const head = Math.min(6, w * 0.5);
  if (direction === -1) {
    // points left
    return `${x0},${mid} ${x0 + head},${top} ${x1},${top} ${x1},${bot} ${x0 + head},${bot}`;
  }
  // points right
  return `${x0},${top} ${x1 - head},${top} ${x1},${mid} ${x1 - head},${bot} ${x0},${bot}`;
}

export default function SequenceOverviewBar({
  seqLength,
  features,
  window: win,
  onScrollToBp,
  onFeatureClick,
  onShiftSelectToBp,
  extent,
  onExtentChange,
  selection,
}: SequenceOverviewBarProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  // While dragging we render the box at the drag position immediately (the host
  // round-trips the scroll on the next frame; this keeps the box from lagging).
  const [dragBp, setDragBp] = useState<number | null>(null);

  // overview zoom bot — resolve the active extent (default whole molecule). lo/hi
  // are the bp domain the track covers; everything below maps bp<->x over this.
  const lo = Math.max(0, Math.min(seqLength, extent?.start ?? 0));
  const hiRaw = extent?.end ?? seqLength;
  const hi = Math.max(lo + 1, Math.min(seqLength, hiRaw));
  const extentSpan = Math.max(1, hi - lo);
  const isZoomed = lo > 0 || hi < seqLength;

  // Track the available track width (full width minus the horizontal padding).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(Math.max(0, el.clientWidth - TRACK_PAD_X * 2));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const winSpan = Math.max(1, win.end - win.start);
  // The bp at the top of the visible window (what the box's left edge tracks).
  const effectiveStart = dragBp ?? win.start;

  // overview zoom bot — project the detail window box onto the active extent. The
  // edges are clamped to the track so a detail window that sits partly (or fully)
  // outside the extent still shows a clamped box rather than spilling past.
  const winStartX = bpToTrackX(effectiveStart, trackWidth, seqLength, lo, hi);
  const winEndX = bpToTrackX(effectiveStart + winSpan, trackWidth, seqLength, lo, hi);
  const boxX = TRACK_PAD_X + winStartX;
  const boxW = Math.max(6, winEndX - winStartX);
  // Clamp so the box stays inside the track.
  const clampedBoxX = Math.min(
    TRACK_PAD_X + trackWidth - boxW,
    Math.max(TRACK_PAD_X, boxX),
  );

  // Convert a clientX on the track into a target bp (top of window). We aim the
  // CENTER of the box at the pointer for a natural "drag the box" feel. The
  // pointer bp is read over the ACTIVE EXTENT, so click-to-scroll lands correctly
  // even when the bar is zoomed in.
  const clientXToBp = useCallback(
    (clientX: number, centerOnPointer: boolean) => {
      const el = wrapRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left - TRACK_PAD_X;
      const bpAtPointer = trackXToBp(x, trackWidth, seqLength, lo, hi);
      if (!centerOnPointer) return bpAtPointer;
      return Math.max(0, bpAtPointer - Math.round(winSpan / 2));
    },
    [trackWidth, seqLength, winSpan, lo, hi],
  );

  const draggingRef = useRef(false);

  // overview featclick bot — the features eligible for a click hit-test: the same
  // set the bar DRAWS as arrows (drop empty + whole-span `source` features, and
  // anything fully outside the visible extent), kept in draw order so a later
  // entry is "topmost". Drawing arrows clamp to the extent, but the hit-test runs
  // against the feature's TRUE [start, end] so a click anywhere on the on-screen
  // arrow resolves, and clamped-off portions don't falsely match.
  const hittableFeatures = useMemo(
    () =>
      features.filter(
        (f) =>
          f.end > f.start && showInOverview(f, seqLength) && f.end > lo && f.start < hi,
      ),
    [features, seqLength, lo, hi],
  );

  // overview featclick bot — resolve the MOST SPECIFIC feature under a clicked bp
  // (narrowest containing span, topmost on a tie). Pure pick lives in the zoom lib
  // so it is unit-testable; null means the bare track was clicked.
  const featureAtBp = useCallback(
    (bp: number): OverviewFeature | null => pickOverviewFeatureAtBp(hittableFeatures, bp),
    [hittableFeatures],
  );

  const onPointerDownTrack = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      // overview featclick bot — FIRST hit-test the clicked bp against the visible
      // features. A click ON a feature SELECTS it (no scroll, no drag); only a
      // BARE-track click falls through to the existing click-to-jump + drag. The
      // viewport-box drag is handled by the box's own pointer handler, so it is
      // unaffected by this branch.
      const bpAtPointer = clientXToBp(e.clientX, false);
      const hit = onFeatureClick ? featureAtBp(bpAtPointer) : null;
      if (hit) {
        onFeatureClick?.(hit, { shiftKey: e.shiftKey });
        return;
      }
      // Bare-track SHIFT-click extends the current selection to this bp (like the
      // Map's shift-span), instead of scrolling/dragging.
      if (e.shiftKey && onShiftSelectToBp) {
        onShiftSelectToBp(bpAtPointer);
        return;
      }
      // Bare track: click-to-jump (center the window on the click), then drag.
      (e.target as Element).setPointerCapture?.(e.pointerId);
      draggingRef.current = true;
      const bp = clientXToBp(e.clientX, true);
      setDragBp(bp);
      onScrollToBp(bp);
    },
    [clientXToBp, onScrollToBp, onFeatureClick, onShiftSelectToBp, featureAtBp],
  );

  // overview featclick bot — the VIEWPORT BOX gets its OWN pointer-down so a click
  // that lands on the box always DRAGS (centers the window on the pointer), even
  // when a feature arrow sits under the box. stopPropagation keeps the SVG-level
  // feature hit-test from also firing, so the box stays a pure drag handle.
  const onPointerDownBox = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      draggingRef.current = true;
      const bp = clientXToBp(e.clientX, true);
      setDragBp(bp);
      onScrollToBp(bp);
    },
    [clientXToBp, onScrollToBp],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const bp = clientXToBp(e.clientX, true);
      setDragBp(bp);
      onScrollToBp(bp);
    },
    [clientXToBp, onScrollToBp],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    setDragBp(null);
  }, []);

  // overview zoom bot — INDEPENDENT WHEEL / PINCH ZOOM over the bar. Mirrors the
  // proven LinearMap handler: a non-passive wheel listener (so preventDefault
  // works) plus Safari gesture* events. A pinch (ctrl/meta + wheel) OR a plain
  // vertical wheel zooms the EXTENT anchored at the bp under the cursor; the page
  // never scrolls. A horizontal wheel (shift+wheel / trackpad sideways) PANS a
  // zoomed extent. This touches ONLY the overview extent, never the detail view.
  //
  // Live values (extent, geometry, callbacks) are read from a ref so the listener
  // can be attached once and still see the latest state.
  const zoomStateRef = useRef({
    lo,
    hi,
    seqLength,
    trackWidth,
    winSpan,
    onExtentChange,
    isZoomed,
  });
  zoomStateRef.current = { lo, hi, seqLength, trackWidth, winSpan, onExtentChange, isZoomed };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    // Min extent span: never tighter than the detail window (so the box stays
    // meaningful) and never below a small absolute floor.
    const minSpan = () => {
      const { winSpan: ws } = zoomStateRef.current;
      return Math.max(50, ws);
    };

    const cursorFractionAt = (clientX: number) => {
      const { trackWidth: tw } = zoomStateRef.current;
      if (tw <= 0) return 0.5;
      const rect = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left - TRACK_PAD_X) / tw));
    };

    const applyZoom = (deltaY: number, clientX: number) => {
      const st = zoomStateRef.current;
      if (st.trackWidth <= 0 || st.seqLength <= 0) return;
      if (!st.onExtentChange) return;
      // factor < 1 narrows (zoom IN) on a spread / scroll up; > 1 widens.
      const factor = Math.exp(deltaY * SPAN_ZOOM_K);
      const next = zoomExtentAroundCursor({
        extent: { start: st.lo, end: st.hi },
        seqLength: st.seqLength,
        cursorFraction: cursorFractionAt(clientX),
        factor,
        minSpan: minSpan(),
      });
      if (next.start === st.lo && next.end === st.hi) return;
      st.onExtentChange(next);
    };

    const applyPan = (deltaX: number) => {
      const st = zoomStateRef.current;
      if (!st.onExtentChange || !st.isZoomed || st.trackWidth <= 0) return;
      const span = Math.max(1, st.hi - st.lo);
      // Convert a horizontal pixel delta to a bp delta across the visible extent.
      const deltaBp = (deltaX / st.trackWidth) * span;
      const next = panExtent({ start: st.lo, end: st.hi }, deltaBp, st.seqLength);
      if (next.start === st.lo && next.end === st.hi) return;
      st.onExtentChange(next);
    };

    const onWheel = (e: WheelEvent) => {
      const st = zoomStateRef.current;
      if (!st.onExtentChange) return;
      // A dominant horizontal wheel pans a zoomed extent (nice-to-have).
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        Math.abs(e.deltaX) > Math.abs(e.deltaY) &&
        st.isZoomed
      ) {
        e.preventDefault();
        e.stopPropagation();
        applyPan(e.deltaX);
        return;
      }
      // Otherwise zoom the extent (pinch == ctrl/meta+wheel, or a plain vertical
      // wheel over the bar). Either way preventDefault so the page never scrolls.
      e.preventDefault();
      e.stopPropagation();
      applyZoom(e.deltaY, e.clientX);
    };

    // Safari fires gesture* with a relative `scale` (1 == no change, >1 spread /
    // zoom-in, <1 pinch / zoom-out). Convert to a deltaY-equivalent so we reuse
    // the same anchored-zoom path (scale 1.1 -> ~ -10 deltaY -> zoom IN).
    const onGesture = (e: Event) => {
      const ge = e as Event & { scale?: number; clientX?: number };
      if (typeof ge.scale !== "number") return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const clientX = typeof ge.clientX === "number" ? ge.clientX : rect.left + rect.width / 2;
      const deltaY = (1 - ge.scale) * 100;
      applyZoom(deltaY, clientX);
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

  // Features mapped to track geometry (memoized). Features fully outside the
  // active extent are dropped; partially-overlapping ones clamp to the edges via
  // bpToTrackX's clamp, so a feature straddling the extent edge stays on-screen.
  const arrows = useMemo(() => {
    if (trackWidth <= 0 || seqLength <= 0) return [];
    return features
      .filter((f) => f.end > f.start)
      // Keep the whole-span `source` feature (and any end-to-end annotation) off
      // the mini-map: a full-width bar adds no navigational value, just clutter.
      .filter((f) => showInOverview(f, seqLength))
      // Drop features that don't overlap the visible extent at all.
      .filter((f) => f.end > lo && f.start < hi)
      .map((f, i) => {
        const x0 = TRACK_PAD_X + bpToTrackX(f.start, trackWidth, seqLength, lo, hi);
        const x1 = TRACK_PAD_X + bpToTrackX(f.end, trackWidth, seqLength, lo, hi);
        return {
          key: `${f.name}-${f.start}-${f.end}-${i}`,
          points: featureArrow(x0, x1, f.direction),
          color: f.color || "#94a3b8",
          name: f.name,
        };
      });
  }, [features, trackWidth, seqLength, lo, hi]);

  // overview selband bot — the shared selection mapped to a clamped pixel band
  // over the active extent. null when there is no selection or it sits entirely
  // outside the visible extent. Drawn BEHIND the viewport box (see render order).
  const selBand = useMemo(() => {
    const rect = overviewSelectionRect({
      selection,
      trackWidth,
      seqLength,
      lo,
      hi,
    });
    if (!rect) return null;
    const x0 = TRACK_PAD_X + rect.x0;
    const x1 = TRACK_PAD_X + rect.x1;
    return { x: x0, width: Math.max(2, x1 - x0) };
  }, [selection, trackWidth, seqLength, lo, hi]);

  if (!seqLength) return null;

  // Edge labels show the EXTENT bounds (1-based for the left edge, like the
  // original whole-molecule labels which read "1" .. "seqLength").
  const leftLabel = (lo + 1).toLocaleString();
  const rightLabel = hi.toLocaleString();

  return (
    <div
      ref={wrapRef}
      className="relative w-full shrink-0 select-none border-b border-gray-100 bg-gray-50"
      style={{ height: BAR_HEIGHT }}
      aria-label="Sequence overview"
    >
      <svg
        width="100%"
        height={BAR_HEIGHT}
        className="block touch-none"
        onPointerDown={onPointerDownTrack}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: "ew-resize" }}
      >
        {/* baseline */}
        <line
          x1={TRACK_PAD_X}
          y1={BASELINE_Y}
          x2={TRACK_PAD_X + trackWidth}
          y2={BASELINE_Y}
          stroke="#cbd5e1"
          strokeWidth={2}
        />
        {/* feature arrows. overview featclick bot — a pointer cursor signals the
            arrows are clickable (a click SELECTS the feature); the actual select
            is handled by the SVG-level hit-test in onPointerDownTrack, not a
            per-arrow handler, so the narrowest-feature tie-break stays in one
            place. */}
        {arrows.map((a) => (
          <polygon
            key={a.key}
            points={a.points}
            fill={a.color}
            opacity={0.9}
            style={onFeatureClick ? { cursor: "pointer" } : undefined}
          >
            <title>{a.name}</title>
          </polygon>
        ))}
        {/* overview selband bot — the SELECTION BAND (the shared editor
            selection, same translucent sky as the LinearMap band + base view).
            Drawn BEHIND the viewport box so the outlined box reads on top of the
            blue fill where they overlap; feature ticks stay legible above the low
            opacity. pointer-events:none so it never swallows the box drag. */}
        {selBand ? (
          <rect
            pointerEvents="none"
            x={selBand.x}
            y={6}
            width={selBand.width}
            height={BAR_HEIGHT - 12}
            rx={2}
            fill={SELECTION_BLUE}
            opacity={0.18}
          />
        ) : null}
        {/* the VIEWPORT box (where the user is currently looking). A NEUTRAL
            slate outline with a faint fill, deliberately distinct from the blue
            selection band: at a glance, blue fill = what's selected, outlined box
            = where you're looking. Still draggable / click-to-scroll. */}
        <rect
          x={clampedBoxX}
          y={6}
          width={boxW}
          height={BAR_HEIGHT - 12}
          rx={2}
          fill="rgba(71,85,105,0.06)"
          stroke="#475569"
          strokeWidth={1.5}
          style={{ cursor: "grab" }}
          onPointerDown={onPointerDownBox}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
        {/* start / end labels (the visible EXTENT bounds) */}
        <text x={TRACK_PAD_X} y={BAR_HEIGHT - 3} fontSize={10} fill="#94a3b8">
          {leftLabel}
        </text>
        <text
          x={TRACK_PAD_X + trackWidth}
          y={BAR_HEIGHT - 3}
          fontSize={10}
          fill="#94a3b8"
          textAnchor="end"
        >
          {rightLabel}
        </text>
      </svg>
    </div>
  );
}
