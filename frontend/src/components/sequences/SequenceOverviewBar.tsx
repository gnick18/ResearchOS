"use client";

// seq nav bot — the PERSISTENT OVERVIEW / CONTEXT BAR for linear navigation.
//
// SeqViz has NO native fixed top strip (its linear viewer stacks rows and
// scrolls vertically), so this is a CUSTOM lightweight SVG mini-map: the whole
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
// This bar is LINEAR-only (circular molecules already get the circular map). It
// renders nothing when there is no sequence.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bpToTrackX, trackXToBp, showInOverview } from "@/lib/sequences/sequence-zoom";

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
}

export interface SequenceOverviewBarProps {
  seqLength: number;
  features: OverviewFeature[];
  /** The bp window currently visible in the main view: [start, end). */
  window: { start: number; end: number };
  /** Scroll the main view so `bp` sits at the top of its viewport. */
  onScrollToBp: (bp: number) => void;
}

const BAR_HEIGHT = 46; // px, the whole strip
const TRACK_PAD_X = 8; // px horizontal inset so the box edges aren't clipped
const BASELINE_Y = 30; // px, where the sequence baseline sits
const FEATURE_H = 9; // px, feature arrow height

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
}: SequenceOverviewBarProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  // While dragging we render the box at the drag position immediately (the host
  // round-trips the scroll on the next frame; this keeps the box from lagging).
  const [dragBp, setDragBp] = useState<number | null>(null);

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

  const boxX = TRACK_PAD_X + bpToTrackX(effectiveStart, trackWidth, seqLength);
  const boxW = Math.max(6, bpToTrackX(winSpan, trackWidth, seqLength));
  // Clamp so the box stays inside the track.
  const clampedBoxX = Math.min(
    TRACK_PAD_X + trackWidth - boxW,
    Math.max(TRACK_PAD_X, boxX),
  );

  // Convert a clientX on the track into a target bp (top of window). We aim the
  // CENTER of the box at the pointer for a natural "drag the box" feel.
  const clientXToBp = useCallback(
    (clientX: number, centerOnPointer: boolean) => {
      const el = wrapRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left - TRACK_PAD_X;
      const bpAtPointer = trackXToBp(x, trackWidth, seqLength);
      if (!centerOnPointer) return bpAtPointer;
      return Math.max(0, bpAtPointer - Math.round(winSpan / 2));
    },
    [trackWidth, seqLength, winSpan],
  );

  const draggingRef = useRef(false);

  const onPointerDownTrack = useCallback(
    (e: React.PointerEvent) => {
      // Click-to-jump: center the window on the click, then begin a drag.
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
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

  // Features mapped to track geometry (memoized; only features within range).
  const arrows = useMemo(() => {
    if (trackWidth <= 0 || seqLength <= 0) return [];
    return features
      .filter((f) => f.end > f.start)
      // Keep the whole-span `source` feature (and any end-to-end annotation) off
      // the mini-map: a full-width bar adds no navigational value, just clutter.
      .filter((f) => showInOverview(f, seqLength))
      .map((f, i) => {
        const x0 = TRACK_PAD_X + bpToTrackX(f.start, trackWidth, seqLength);
        const x1 = TRACK_PAD_X + bpToTrackX(f.end, trackWidth, seqLength);
        return {
          key: `${f.name}-${f.start}-${f.end}-${i}`,
          points: featureArrow(x0, x1, f.direction),
          color: f.color || "#94a3b8",
          name: f.name,
        };
      });
  }, [features, trackWidth, seqLength]);

  if (!seqLength) return null;

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
        {/* feature arrows */}
        {arrows.map((a) => (
          <polygon key={a.key} points={a.points} fill={a.color} opacity={0.9}>
            <title>{a.name}</title>
          </polygon>
        ))}
        {/* the viewport box */}
        <rect
          x={clampedBoxX}
          y={6}
          width={boxW}
          height={BAR_HEIGHT - 12}
          rx={2}
          fill="rgba(2,132,199,0.10)"
          stroke="#0284c7"
          strokeWidth={1.5}
          style={{ cursor: "grab" }}
        />
        {/* start / end labels */}
        <text x={TRACK_PAD_X} y={BAR_HEIGHT - 3} fontSize={9} fill="#94a3b8">
          1
        </text>
        <text
          x={TRACK_PAD_X + trackWidth}
          y={BAR_HEIGHT - 3}
          fontSize={9}
          fill="#94a3b8"
          textAnchor="end"
        >
          {seqLength.toLocaleString()}
        </text>
      </svg>
    </div>
  );
}
