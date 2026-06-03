"use client";

// seq nav bot — the BOTTOM COORDINATE / ZOOM CLUSTER (from Grant's screenshot).
//
// Left-to-right:
//   - the zoom slider (- / slider / + / Fit), reusing SequenceZoomControl;
//   - an EDITABLE "bp in view" number field: type a span (e.g. 20,480) to set the
//     zoom so roughly that many bases are visible;
//   - an exact readout "bp = <start> .. <end>" of the currently-visible window
//     (1-based, comma-grouped);
//   - a HORIZONTAL coordinate minimap: the whole molecule laid out left-to-right
//     with a draggable viewport box + a few tick labels, so the user can drag or
//     click to fly to any region.
//
// All fields read from the SAME live `window` (the true visible bp range, fed
// from the main scroller geometry) and the same zoom state as the top overview
// strip, so they update live as you pinch / scroll / zoom. The bp<->zoom mapping
// is the calibrated `zoomForTargetSpan` helper in lib/sequences/sequence-zoom.ts.
//
// Inline SVG only (no emoji); icon-only controls are labelled; no em-dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SequenceZoomControl from "./SequenceZoomControl";
import { bpToTrackX, trackXToBp, zoomForTargetSpan } from "@/lib/sequences/sequence-zoom";

const TICK_PAD_X = 6;
const MINIMAP_H = 22;

export interface SequenceCoordinateBarProps {
  seqLength: number;
  /** The bp window currently visible in the main view: [start, end). */
  window: { start: number; end: number };
  /** Current linear zoom (0-100). */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Scroll the main view so `bp` sits at the top of its viewport. */
  onScrollToBp: (bp: number) => void;
}

export default function SequenceCoordinateBar({
  seqLength,
  window: win,
  zoom,
  onZoomChange,
  onScrollToBp,
}: SequenceCoordinateBarProps) {
  const span = Math.max(1, win.end - win.start);

  // ── editable "bp in view" field ────────────────────────────────────────────
  // We mirror the live span into the field, but pause mirroring while the user is
  // actively typing so their keystrokes are not clobbered by scroll/zoom updates.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const liveValue = span.toLocaleString();
  const fieldValue = editing ? draft : liveValue;

  const commitField = useCallback(() => {
    setEditing(false);
    const target = Number(draft.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(target) || target <= 0) return;
    const clampedTarget = Math.min(seqLength, Math.max(1, target));
    onZoomChange(zoomForTargetSpan({ currentZoom: zoom, currentSpan: span, targetSpan: clampedTarget }));
  }, [draft, seqLength, zoom, span, onZoomChange]);

  // ── horizontal coordinate minimap ───────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragBp, setDragBp] = useState<number | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(Math.max(0, el.clientWidth - TICK_PAD_X * 2));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveStart = dragBp ?? win.start;
  const boxX = TICK_PAD_X + bpToTrackX(effectiveStart, trackWidth, seqLength);
  const boxW = Math.max(6, bpToTrackX(span, trackWidth, seqLength));
  const clampedBoxX = Math.min(
    TICK_PAD_X + trackWidth - boxW,
    Math.max(TICK_PAD_X, boxX),
  );

  const clientXToBp = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left - TICK_PAD_X;
      const bpAtPointer = trackXToBp(x, trackWidth, seqLength);
      // Center the window on the pointer for a natural "drag the box" feel.
      return Math.max(0, bpAtPointer - Math.round(span / 2));
    },
    [trackWidth, seqLength, span],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      draggingRef.current = true;
      const bp = clientXToBp(e.clientX);
      setDragBp(bp);
      onScrollToBp(bp);
    },
    [clientXToBp, onScrollToBp],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const bp = clientXToBp(e.clientX);
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

  // A few evenly spaced coordinate ticks (1-based labels).
  const ticks = useMemo(() => {
    if (trackWidth <= 0 || seqLength <= 0) return [];
    const count = trackWidth > 420 ? 6 : 4;
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i <= count; i++) {
      const bp = Math.round((i / count) * seqLength);
      out.push({
        x: TICK_PAD_X + bpToTrackX(bp, trackWidth, seqLength),
        label: (Math.max(1, bp)).toLocaleString(),
      });
    }
    return out;
  }, [trackWidth, seqLength]);

  return (
    <div className="flex items-center gap-3 border-t border-gray-100 bg-white px-3 py-1.5">
      {/* zoom slider cluster */}
      <SequenceZoomControl axis="linear" zoom={zoom} onZoomChange={onZoomChange} />

      <div className="h-5 w-px bg-gray-200" />

      {/* editable bp-in-view field */}
      <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span className="hidden sm:inline">bp in view</span>
        <input
          type="text"
          inputMode="numeric"
          value={fieldValue}
          onFocus={() => {
            setEditing(true);
            setDraft(liveValue);
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitField}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Bases in view (type a span to set the zoom)"
          className="w-20 rounded border border-gray-200 px-1.5 py-0.5 text-right font-mono text-[12px] text-gray-700 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-200"
        />
      </label>

      {/* exact visible-window readout (1-based, comma-grouped) */}
      <div className="hidden whitespace-nowrap font-mono text-[12px] text-gray-500 md:block">
        bp = {(win.start + 1).toLocaleString()} .. {win.end.toLocaleString()}
      </div>

      {/* horizontal coordinate minimap with a draggable viewport box */}
      <div
        ref={trackRef}
        className="relative h-[34px] min-w-0 flex-1 select-none"
        aria-label="Coordinate minimap"
      >
        <svg
          width="100%"
          height={34}
          className="block touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ cursor: "ew-resize" }}
        >
          {/* track */}
          <rect
            x={TICK_PAD_X}
            y={4}
            width={Math.max(0, trackWidth)}
            height={MINIMAP_H}
            rx={3}
            fill="#f1f5f9"
            stroke="#e2e8f0"
          />
          {/* tick marks + labels */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={t.x} y1={4} x2={t.x} y2={4 + MINIMAP_H} stroke="#e2e8f0" strokeWidth={1} />
              <text
                x={Math.min(Math.max(t.x, 10), TICK_PAD_X + trackWidth - 2)}
                y={34}
                fontSize={8}
                fill="#94a3b8"
                textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
              >
                {t.label}
              </text>
            </g>
          ))}
          {/* viewport box */}
          <rect
            x={clampedBoxX}
            y={2}
            width={boxW}
            height={MINIMAP_H + 4}
            rx={2}
            fill="rgba(2,132,199,0.12)"
            stroke="#0284c7"
            strokeWidth={1.5}
            style={{ cursor: "grab" }}
          />
        </svg>
      </div>
    </div>
  );
}
