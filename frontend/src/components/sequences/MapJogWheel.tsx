"use client";

// map jog wheel bot — a SnapGene-style ribbed JOG / SHUTTLE WHEEL for FINE
// panning of the linear map when zoomed in.
//
// THE PROBLEM IT SOLVES: when the visible window is tiny (e.g. 60 bp of a 456 kb
// molecule) the whole-molecule navigator box is only a pixel or two wide, so
// nudging it precisely is hopeless. SnapGene's answer is a tactile jog wheel in
// the bottom control cluster: grab it and drag left/right to scroll the view by
// fine increments, with the ribs translating under your cursor so it reads as a
// spinning physical dial.
//
// WHAT THIS IS: a horizontal recessed track of evenly spaced vertical ribs. On
// pointer-down it captures the pointer; each horizontal move reports the
// INCREMENTAL drag distance (delta px since the last move) via onScrub, and the
// rib pattern is offset by the cumulative drag (wrapped modulo the rib pitch) so
// the ribs appear to spin with the drag. Pointer capture means the drag keeps
// working even if the cursor leaves the wheel. The parent turns each onScrub
// delta into a panWindow call (the bp-per-px sensitivity lives in the parent /
// the unit-tested jogScrubToDeltaBp helper, NOT here — this component is a pure
// "how far did you drag" surface).
//
// No emojis (inline SVG ribs), no em-dashes. Strict TS. Wrapped in <Tooltip>.

import { useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";

export interface MapJogWheelProps {
  /**
   * Called on every pointer move during a drag with the INCREMENTAL horizontal
   * distance (px) since the previous move. Positive = dragged right. The parent
   * scales this into a fine bp pan.
   */
  onScrub: (deltaPx: number) => void;
  /** When true the wheel is inert + visually dimmed (nothing to pan). */
  disabled?: boolean;
  /** Overall pixel width of the wheel track. Default 96. */
  width?: number;
}

const WHEEL_W_DEFAULT = 96;
const WHEEL_H = 22;
const RIB_PITCH = 8; // px between rib centers
const RIB_W = 1.5; // rib stroke width

/**
 * Build the rib x-positions for a given horizontal offset. The pattern is drawn
 * one pitch wider than the track on each side and shifted by (offset mod pitch)
 * so ribs continuously enter one edge and leave the other as the wheel spins.
 */
function ribXs(trackW: number, offset: number): number[] {
  const shift = ((offset % RIB_PITCH) + RIB_PITCH) % RIB_PITCH;
  const xs: number[] = [];
  for (let x = -RIB_PITCH + shift; x <= trackW + RIB_PITCH; x += RIB_PITCH) {
    xs.push(x);
  }
  return xs;
}

export default function MapJogWheel({
  onScrub,
  disabled = false,
  width = WHEEL_W_DEFAULT,
}: MapJogWheelProps) {
  const trackW = Math.max(RIB_PITCH * 2, width);
  // Cumulative drag distance, used only to spin the ribs (NOT the pan amount).
  const [ribOffset, setRibOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Last clientX seen, so each move reports the incremental delta.
  const lastXRef = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    lastXRef.current = e.clientX;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || lastXRef.current == null) return;
    const dx = e.clientX - lastXRef.current;
    if (dx === 0) return;
    lastXRef.current = e.clientX;
    setRibOffset((o) => o + dx);
    onScrub(dx);
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (lastXRef.current == null) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    lastXRef.current = null;
    setDragging(false);
  };

  const xs = ribXs(trackW, ribOffset);
  const midRib = trackW / 2;

  return (
    <Tooltip label="Drag to fine-scroll">
      <span
        className="inline-flex select-none items-center"
        aria-hidden={disabled ? true : undefined}
      >
        <svg
          width={trackW}
          height={WHEEL_H}
          viewBox={`0 0 ${trackW} ${WHEEL_H}`}
          role="slider"
          aria-label="Fine-scroll the map"
          aria-disabled={disabled || undefined}
          className={
            disabled
              ? "cursor-not-allowed opacity-40"
              : dragging
                ? "cursor-grabbing"
                : "cursor-grab"
          }
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <defs>
            {/* recessed inset look: a soft top-to-bottom shade on the track */}
            <linearGradient id="jogInset" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e2e8f0" />
              <stop offset="0.5" stopColor="#f8fafc" />
              <stop offset="1" stopColor="#e2e8f0" />
            </linearGradient>
            {/* clip the spinning ribs to the rounded track */}
            <clipPath id="jogClip">
              <rect x="0.5" y="0.5" width={trackW - 1} height={WHEEL_H - 1} rx={5} />
            </clipPath>
          </defs>

          {/* recessed track */}
          <rect
            x={0.5}
            y={0.5}
            width={trackW - 1}
            height={WHEEL_H - 1}
            rx={5}
            fill="url(#jogInset)"
            stroke="#cbd5e1"
            strokeWidth={1}
          />

          {/* ribs (translate with the drag so the wheel reads as spinning) */}
          <g clipPath="url(#jogClip)">
            {xs.map((x, i) => {
              // fade ribs toward the track edges for a cylindrical, rounded feel
              const edgeFade = Math.min(1, Math.min(x, trackW - x) / (trackW / 2.5));
              const opacity = 0.25 + 0.5 * Math.max(0, edgeFade);
              return (
                <line
                  key={i}
                  x1={x}
                  y1={3}
                  x2={x}
                  y2={WHEEL_H - 3}
                  stroke="#94a3b8"
                  strokeWidth={RIB_W}
                  strokeLinecap="round"
                  opacity={opacity}
                />
              );
            })}
            {/* center detent marker so the wheel has a visual home line */}
            <line
              x1={midRib}
              y1={2}
              x2={midRib}
              y2={WHEEL_H - 2}
              stroke="#3b82f6"
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={0.55}
            />
          </g>
        </svg>
      </span>
    </Tooltip>
  );
}
