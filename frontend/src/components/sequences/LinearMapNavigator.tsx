"use client";

// linear-map zoom bot — BOTTOM CONTEXT NAVIGATOR for the SnapGene-style linear
// map. A mini whole-molecule strip (0 .. seqLength at full width) with coordinate
// tick labels and a draggable VIEWPORT BOX marking the current visible window
// [winStart, winEnd]:
//   - drag the box BODY  -> PAN the window (clamped to the molecule),
//   - drag an edge HANDLE -> RESIZE (zoom) the window, keeping the other edge,
//   - click elsewhere on the strip -> RECENTER the window there.
//
// The window state lives in the parent LinearMap (single source of truth); this
// strip only reports requested changes back via callbacks. Pure SVG, no emojis,
// no third-party icons.

import { useCallback, useRef } from "react";
import {
  panWindow,
  resizeWindowEdge,
  windowAroundCenter,
  rulerStepForSpan,
} from "@/lib/sequences/linear-map-window";

const NAV_PAD_X = 16;
const NAV_TRACK_H = 18; // height of the mini-strip track band
const NAV_LABEL_FONT = 8;
const NAV_HANDLE_W = 6; // px hit-area for each resize edge handle
const BOX_FILL = "#3b82f6";
const TRACK_FILL = "#e2e8f0";
const TICK_COLOR = "#cbd5e1";
const TICK_TEXT = "#94a3b8";

/** Comma-group an integer (shared visual style with the map). */
function comma(n: number): string {
  return Math.round(n).toLocaleString();
}

export interface LinearMapNavigatorProps {
  seqLength: number;
  /** total pixel width available (the navigator fits the same width as the map). */
  width: number;
  window: { start: number; end: number };
  onWindowChange: (win: { start: number; end: number }) => void;
}

type DragMode = "pan" | "start" | "end";

export default function LinearMapNavigator({
  seqLength,
  width,
  window: win,
  onWindowChange,
}: LinearMapNavigatorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startClientX: number;
    startWin: { start: number; end: number };
  } | null>(null);

  const trackWidth = Math.max(1, width - NAV_PAD_X * 2);
  const len = Math.max(1, Math.round(seqLength));
  const bpToX = useCallback((bp: number) => NAV_PAD_X + (bp / len) * trackWidth, [len, trackWidth]);
  const xToBp = useCallback(
    (x: number) => ((x - NAV_PAD_X) / trackWidth) * len,
    [len, trackWidth],
  );

  const boxX0 = bpToX(win.start);
  const boxX1 = bpToX(win.end);
  const boxW = Math.max(2, boxX1 - boxX0);

  const trackTop = NAV_LABEL_FONT + 6;

  const onPointerDownBody = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      e.preventDefault();
      e.stopPropagation();
      // Pointer capture keeps move/up events flowing to this element even when the
      // pointer leaves it mid-drag. Guard the call: setPointerCapture throws a
      // NotFoundError when the pointer is no longer active (e.g. a fast release or
      // a programmatically dispatched event), and that must not abort the drag.
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // capture is a best-effort enhancement; the drag still works without it.
      }
      dragRef.current = { mode, startClientX: e.clientX, startWin: { ...win } };
    },
    [win],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dxPx = e.clientX - drag.startClientX;
      const dxBp = (dxPx / trackWidth) * len;
      if (drag.mode === "pan") {
        onWindowChange(panWindow(drag.startWin, dxBp, len));
      } else if (drag.mode === "start") {
        const target = drag.startWin.start + dxBp;
        onWindowChange(resizeWindowEdge(drag.startWin, "start", target, len));
      } else {
        const target = drag.startWin.end + dxBp;
        onWindowChange(resizeWindowEdge(drag.startWin, "end", target, len));
      }
    },
    [trackWidth, len, onWindowChange],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        // mirror the setPointerCapture guard: releasing a stale pointer is a no-op.
      }
      dragRef.current = null;
    }
  }, []);

  // Click on the bare track (not the box) recenters the window there.
  const onTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const center = Math.max(0, Math.min(len, Math.round(xToBp(x))));
      const span = win.end - win.start;
      onWindowChange(windowAroundCenter(center, span, len));
    },
    [xToBp, len, win.end, win.start, onWindowChange],
  );

  // Coordinate ticks across the whole molecule.
  const step = rulerStepForSpan(len);
  const ticks: { bp: number; label: string }[] = [];
  for (let bp = step; bp < len; bp += step) ticks.push({ bp, label: comma(bp) });

  const navH = trackTop + NAV_TRACK_H + 4;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={navH}
      className="block select-none"
      style={{ minHeight: navH }}
      onClick={onTrackClick}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      aria-label="Map navigator"
    >
      {/* coordinate tick labels above the strip */}
      {ticks.map((t, i) => (
        <g key={`navtick-${i}`}>
          <line
            x1={bpToX(t.bp)}
            y1={trackTop}
            x2={bpToX(t.bp)}
            y2={trackTop + NAV_TRACK_H}
            stroke={TICK_COLOR}
            strokeWidth={1}
          />
          <text
            x={bpToX(t.bp)}
            y={trackTop - 2}
            fontSize={NAV_LABEL_FONT}
            fill={TICK_TEXT}
            textAnchor="middle"
          >
            {t.label}
          </text>
        </g>
      ))}

      {/* the whole-molecule track band */}
      <rect
        x={NAV_PAD_X}
        y={trackTop}
        width={trackWidth}
        height={NAV_TRACK_H}
        rx={3}
        fill={TRACK_FILL}
      />

      {/* the viewport box (drag body = pan) */}
      <rect
        x={boxX0}
        y={trackTop}
        width={boxW}
        height={NAV_TRACK_H}
        rx={2}
        fill={BOX_FILL}
        fillOpacity={0.28}
        stroke={BOX_FILL}
        strokeWidth={1.25}
        style={{ cursor: "grab" }}
        onPointerDown={(e) => onPointerDownBody(e, "pan")}
      />

      {/* left edge resize handle */}
      <rect
        x={boxX0 - NAV_HANDLE_W / 2}
        y={trackTop}
        width={NAV_HANDLE_W}
        height={NAV_TRACK_H}
        fill={BOX_FILL}
        fillOpacity={0.9}
        style={{ cursor: "ew-resize" }}
        onPointerDown={(e) => onPointerDownBody(e, "start")}
      />
      {/* right edge resize handle */}
      <rect
        x={boxX1 - NAV_HANDLE_W / 2}
        y={trackTop}
        width={NAV_HANDLE_W}
        height={NAV_TRACK_H}
        fill={BOX_FILL}
        fillOpacity={0.9}
        style={{ cursor: "ew-resize" }}
        onPointerDown={(e) => onPointerDownBody(e, "end")}
      />
    </svg>
  );
}
