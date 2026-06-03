"use client";

// sequence feat-popup bot — the mini gene viewer at the top of the
// FeatureEditorDialog (SnapGene "Edit Feature" parity). Draws the feature's
// span as filled segment bars with arrowheads in the strand direction, dashed
// intron connectors in the gaps, a numbered marker per segment, the span's
// start/end coordinate labels at the ends, and a SnapGene-style summary line.
// It reflects the segment table LIVE because it is driven entirely by the
// `segments` prop the dialog already holds in state. Pure presentation; all
// geometry is computed by computeSegmentDiagram. No emojis (inline SVG only).

import { useMemo } from "react";
import type { FeatureSegment } from "@/lib/sequences/feature-edit";
import { computeSegmentDiagram } from "@/lib/sequences/segment-diagram";

const WIDTH = 460;
const PAD = 18;
const TRACK_Y = 30;
const BAR_H = 18;
const ARROW_W = 8;

export default function FeatureSegmentDiagram({
  segments,
  strand,
  color,
}: {
  segments: FeatureSegment[];
  /** +1 forward, -1 reverse, 0 no direction (drawn as a plain capped bar). */
  strand: 1 | -1 | 0;
  /** The effective feature color (used when a segment has no override). */
  color: string;
}) {
  const layout = useMemo(
    () => computeSegmentDiagram(segments, WIDTH, PAD),
    [segments],
  );

  const barTop = TRACK_Y - BAR_H / 2;
  const barBottom = TRACK_Y + BAR_H / 2;

  // Build a bar path. Forward features get the right-hand arrowhead, reverse the
  // left-hand one, no-direction a plain rectangle. The arrowhead is only drawn
  // on the FIRST (reverse) / LAST (forward) bar so multi-segment features read
  // as one directional gene, matching SnapGene.
  const arrowOn = (idx: number): "left" | "right" | null => {
    if (strand === 1) return idx === layout.segments.length - 1 ? "right" : null;
    if (strand === -1) return idx === 0 ? "left" : null;
    return null;
  };

  const barPath = (x: number, w: number, arrow: "left" | "right" | null) => {
    const x2 = x + w;
    if (arrow === "right") {
      const tip = Math.min(ARROW_W, w);
      return `M${x},${barTop} L${x2 - tip},${barTop} L${x2},${TRACK_Y} L${x2 - tip},${barBottom} L${x},${barBottom} Z`;
    }
    if (arrow === "left") {
      const tip = Math.min(ARROW_W, w);
      return `M${x2},${barTop} L${x + tip},${barTop} L${x},${TRACK_Y} L${x + tip},${barBottom} L${x2},${barBottom} Z`;
    }
    return `M${x},${barTop} L${x2},${barTop} L${x2},${barBottom} L${x},${barBottom} Z`;
  };

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50/70 px-3 pb-2 pt-1.5">
      <svg
        viewBox={`0 0 ${WIDTH} 52`}
        className="h-[52px] w-full"
        role="img"
        aria-label={`Feature map: ${layout.summary}`}
      >
        {/* baseline through the gaps */}
        <line
          x1={PAD}
          y1={TRACK_Y}
          x2={WIDTH - PAD}
          y2={TRACK_Y}
          stroke="#d1d5db"
          strokeWidth={1}
        />

        {/* dashed intron connectors */}
        {layout.gaps.map((g, i) => (
          <line
            key={`gap-${i}`}
            x1={g.x}
            y1={TRACK_Y}
            x2={g.x + g.width}
            y2={TRACK_Y}
            stroke="#9ca3af"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        ))}

        {/* segment bars + numbered markers */}
        {layout.segments.map((s, i) => {
          const fill = s.color || color;
          const arrow = arrowOn(i);
          return (
            <g key={`seg-${s.index}`}>
              <path d={barPath(s.x, s.width, arrow)} fill={fill} stroke="rgba(0,0,0,0.18)" strokeWidth={0.75} />
              {layout.segments.length > 1 ? (
                <text
                  x={s.x + s.width / 2}
                  y={TRACK_Y + 0.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="select-none"
                  fontSize={10}
                  fontWeight={600}
                  fill="#fff"
                  style={{ paintOrder: "stroke" }}
                  stroke="rgba(0,0,0,0.25)"
                  strokeWidth={0.5}
                >
                  {s.index}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* span coordinate labels (1-based inclusive) */}
        <text x={PAD} y={TRACK_Y + 18} textAnchor="start" fontSize={9.5} fill="#6b7280">
          {(layout.spanStart + 1).toLocaleString()}
        </text>
        <text x={WIDTH - PAD} y={TRACK_Y + 18} textAnchor="end" fontSize={9.5} fill="#6b7280">
          {layout.spanEnd.toLocaleString()}
        </text>
      </svg>

      {/* SnapGene-style summary line */}
      <div className="mt-0.5 text-center text-[11px] font-medium text-gray-500">
        {layout.summary}
      </div>
    </div>
  );
}
