"use client";

// cloning visuals bot (Phase A). A standalone SVG strip that shows which source
// fragment contributed which span of the assembled product. It is a LINEARIZED
// bp axis (0..length), so the same drawing works for both circular and linear
// products. Driven entirely by the additive `fragmentSpans` the three engines
// now return; no SeqViz, no vendored files. Keep it pure presentation.
//
// No emojis (inline SVG only), no em-dashes, Tooltip not needed (no icon-only
// controls here; the segment labels carry their own text).

import { FEATURE_COLOR_SWATCHES } from "@/lib/sequences/feature-colors";
import type { FragmentSpan } from "@/lib/sequences/cloning";

interface Props {
  spans: FragmentSpan[];
  /** Total product length in bp; the axis runs 0..length. */
  length: number;
  /** Hovering a segment calls this with the span index (or null on leave). For a
   *  caller that wants to highlight the matching picked-fragment row. */
  onHoverSpan?: (index: number | null) => void;
}

/** Deterministic color per span index, cycling the shared feature palette. */
function spanColor(index: number): string {
  return FEATURE_COLOR_SWATCHES[index % FEATURE_COLOR_SWATCHES.length];
}

/** "1,234" style grouping for bp numbers. */
function bp(n: number): string {
  return n.toLocaleString();
}

export default function FragmentRibbon({ spans, length, onHoverSpan }: Props) {
  if (length <= 0 || spans.length === 0) return null;

  // SVG geometry: a fixed-width viewBox; segments are positioned by bp fraction so
  // the strip scales to its container. Heights are in viewBox units.
  const VW = 1000; // viewBox width
  const AXIS_Y = 20;
  const BAND_Y = 8;
  const BAND_H = 24;
  const TICK_TOP = 4;
  const TICK_BOT = 36;

  const x = (pos: number) => (Math.max(0, Math.min(pos, length)) / length) * VW;

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="mb-2 text-meta font-medium text-gray-500">Fragment origins</div>
      <svg
        viewBox={`0 0 ${VW} 44`}
        className="w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Fragment-origin ribbon: which source fragment contributed each span of the product"
      >
        {/* Thin axis bar 0..length. */}
        <line x1={0} y1={AXIS_Y} x2={VW} y2={AXIS_Y} stroke="#e5e7eb" strokeWidth={1} />

        {spans.map((sp, i) => {
          const xs = x(sp.start);
          const xe = x(sp.end);
          const w = Math.max(1, xe - xs);
          return (
            <g
              key={i}
              onMouseEnter={onHoverSpan ? () => onHoverSpan(i) : undefined}
              onMouseLeave={onHoverSpan ? () => onHoverSpan(null) : undefined}
            >
              <rect
                x={xs}
                y={BAND_Y}
                width={w}
                height={BAND_H}
                rx={2}
                fill={spanColor(i)}
                fillOpacity={0.85}
              />
              {/* Junction ticks at both boundaries. */}
              <line x1={xs} y1={TICK_TOP} x2={xs} y2={TICK_BOT} stroke="#9ca3af" strokeWidth={1} />
              <line x1={xe} y1={TICK_TOP} x2={xe} y2={TICK_BOT} stroke="#9ca3af" strokeWidth={1} />
            </g>
          );
        })}
      </svg>

      {/* A readable legend under the strip (the SVG band scales non-uniformly, so
          the names live here where they stay legible regardless of width). */}
      <ul className="mt-2 space-y-1">
        {spans.map((sp, i) => (
          <li
            key={i}
            className="flex items-center gap-2 text-meta text-gray-600"
            onMouseEnter={onHoverSpan ? () => onHoverSpan(i) : undefined}
            onMouseLeave={onHoverSpan ? () => onHoverSpan(null) : undefined}
          >
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: spanColor(i) }}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">
              <span className="font-medium text-gray-700">{sp.name}</span>
              {sp.strand === -1 ? <span className="text-gray-400"> (rev)</span> : null}
            </span>
            <span className="ml-auto shrink-0 font-mono text-gray-500">
              {bp(sp.start + 1)}
              {"-"}
              {bp(sp.end)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
