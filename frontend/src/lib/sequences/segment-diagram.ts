// sequence feat-popup bot — PURE geometry for the FeatureEditorDialog's mini
// gene viewer (SnapGene "Edit Feature" parity). Given the segment table and a
// pixel width, lay out each segment as a filled bar and the gaps between them as
// dashed intron connectors, mapping document coordinates onto the drawable
// track. No React, no SVG: just numbers so the layout is unit-testable.
//
// Coordinates in are the editor's 0-based [start, end) segments. We render in
// POSITIONAL order (sorted by start) so the picture always reads left-to-right
// regardless of segment table order.

import type { FeatureSegment } from "./feature-edit";

/** A single laid-out segment bar in pixel space. */
export interface DiagramSegment {
  /** 1-based table index of this segment (matches the numbered marker). */
  index: number;
  /** Left edge in px within the track. */
  x: number;
  /** Bar width in px (>= MIN_SEG_PX so a 1bp exon is still visible). */
  width: number;
  /** Segment length in bp (end - start, clamped >= 0). */
  bp: number;
  /** 0-based document coordinates, for labels / tooltips. */
  start: number;
  end: number;
  /** Optional per-segment color override (hex), passed straight through. */
  color?: string;
}

/** A dashed intron connector drawn between two consecutive segments. */
export interface DiagramGap {
  x: number;
  width: number;
}

/** The full computed layout the SVG renders. */
export interface SegmentDiagramLayout {
  /** Laid-out segment bars in positional (left-to-right) order. */
  segments: DiagramSegment[];
  /** Dashed gaps between bars (introns). Empty for a single-segment feature. */
  gaps: DiagramGap[];
  /** Overall span [start, end) in document coordinates. */
  spanStart: number;
  spanEnd: number;
  /** Total span in bp (spanEnd - spanStart). */
  spanBp: number;
  /** Summed exon length across all segments (the feature's length). */
  featureBp: number;
  /** Number of segments. */
  segmentCount: number;
  /** The human summary line, SnapGene-style:
   *  single-segment  -> "978 bp"
   *  multi-segment   -> "1,129 bp / 2 segments = 978 bp" */
  summary: string;
}

/** A 1bp segment still needs a clickable/visible sliver. */
const MIN_SEG_PX = 4;

/** Lay segments out across `width` px, leaving `pad` px of breathing room at
 *  each end so arrowheads / coordinate labels are not clipped. */
export function computeSegmentDiagram(
  segments: FeatureSegment[],
  width: number,
  pad = 0,
): SegmentDiagramLayout {
  const usable = Math.max(1, width - pad * 2);

  // Positional order with original 1-based indices retained for the markers.
  const ordered = segments
    .map((s, i) => ({ ...s, index: i + 1 }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const spanStart = ordered.length
    ? ordered.reduce((m, s) => Math.min(m, s.start), ordered[0].start)
    : 0;
  const spanEnd = ordered.length
    ? ordered.reduce((m, s) => Math.max(m, s.end), ordered[0].end)
    : 0;
  const spanBp = Math.max(0, spanEnd - spanStart);
  const featureBp = ordered.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);

  // Map a document coordinate to px within the padded track.
  const denom = spanBp > 0 ? spanBp : 1;
  const toX = (coord: number) => pad + ((coord - spanStart) / denom) * usable;

  const diagramSegments: DiagramSegment[] = ordered.map((s) => {
    const bp = Math.max(0, s.end - s.start);
    const x = toX(s.start);
    const rawW = toX(s.end) - x;
    return {
      index: s.index,
      x,
      width: Math.max(MIN_SEG_PX, rawW),
      bp,
      start: s.start,
      end: s.end,
      color: s.color,
    };
  });

  // Gaps span the gap between one bar's true end and the next bar's true start.
  const gaps: DiagramGap[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    if (b.start > a.end) {
      const gx = toX(a.end);
      gaps.push({ x: gx, width: Math.max(0, toX(b.start) - gx) });
    }
  }

  const summary =
    ordered.length > 1
      ? `${spanBp.toLocaleString()} bp / ${ordered.length} segments = ${featureBp.toLocaleString()} bp`
      : `${featureBp.toLocaleString()} bp`;

  return {
    segments: diagramSegments,
    gaps,
    spanStart,
    spanEnd,
    spanBp,
    featureBp,
    segmentCount: ordered.length,
    summary,
  };
}
