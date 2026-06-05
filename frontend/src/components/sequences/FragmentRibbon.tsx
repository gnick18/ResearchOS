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

/** A labelled boundary tick on the ribbon, placed at a bp position. The caller
 *  supplies the right label per chemistry: overlap bp + Tm, the overhang seal,
 *  or the att-site scar name. Optional; the ribbon renders without any. */
export interface RibbonJunction {
  /** bp position of the boundary on the 0..length axis. */
  atBp: number;
  /** Short label drawn under the tick (e.g. "25 bp / 59 C", "AATG", "attB1"). */
  label: string;
  /** Optional accent color for the tick + label (matches a fingerprint chip). */
  color?: string;
}

interface Props {
  spans: FragmentSpan[];
  /** Total product length in bp; the axis runs 0..length. */
  length: number;
  /** Optional per-boundary tick labels (overlap bp/Tm, overhang seal, att scar).
   *  Drawn as ticks with a small caption under the strip. */
  junctions?: RibbonJunction[];
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

export default function FragmentRibbon({ spans, length, junctions, onHoverSpan }: Props) {
  if (length <= 0 || spans.length === 0) return null;

  const labelled = junctions && junctions.length > 0;

  // SVG geometry: a fixed-width viewBox; segments are positioned by bp fraction so
  // the strip scales to its container. Heights are in viewBox units. The viewBox
  // grows a label band at the bottom when junction labels are supplied.
  const VW = 1000; // viewBox width
  const AXIS_Y = 20;
  const BAND_Y = 8;
  const BAND_H = 24;
  const TICK_TOP = 4;
  const TICK_BOT = 36;
  const LABEL_Y = 50; // baseline for junction captions
  const VH = labelled ? 60 : 44;

  const x = (pos: number) => (Math.max(0, Math.min(pos, length)) / length) * VW;

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="mb-2 text-meta font-medium text-gray-500">Fragment origins</div>
      {/* The band SVG stretches to fill width (preserveAspectRatio none); the
          junction CAPTIONS live in an HTML overlay on top so the text is not
          distorted by that non-uniform scaling. */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
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

          {/* Emphasized, optionally colored ticks at each labelled junction. */}
          {labelled
            ? junctions!.map((jn, i) => {
                const jx = x(jn.atBp);
                return (
                  <line
                    key={`jt-${i}`}
                    x1={jx}
                    y1={TICK_TOP}
                    x2={jx}
                    y2={LABEL_Y - 6}
                    stroke={jn.color ?? "#475569"}
                    strokeWidth={1.5}
                  />
                );
              })
            : null}
        </svg>

        {/* Junction captions, positioned by bp percentage so they stay legible
            regardless of the strip's rendered width. */}
        {labelled
          ? junctions!.map((jn, i) => {
              const pct = (Math.max(0, Math.min(jn.atBp, length)) / length) * 100;
              return (
                <span
                  key={`jl-${i}`}
                  className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10px] leading-none text-gray-600"
                  style={{ left: `${pct}%`, bottom: 0, color: jn.color ?? undefined }}
                >
                  {jn.label}
                </span>
              );
            })
          : null}
      </div>

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
