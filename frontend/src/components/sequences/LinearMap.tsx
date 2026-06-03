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
// REUSE: the bp -> x mapping is the SAME fit-to-width scaling the overview strip
// uses (bpToTrackX from sequence-zoom). Cut sites come from the vendored digest
// via digestEnzymes (the active enzyme set passed in). Features/primers come
// straight from the editor's existing memos (no recompute, no on-disk change).
// Label packing is the unit-tested pure helper layoutLabels.
//
// INTERACTION: double-clicking a feature opens the feature editor; double-
// clicking a primer opens the Edit Primer dialog — both routed through the same
// handlers the SeqViz path uses (onAnnotationDoubleClick / onPrimerDoubleClick).

import { useEffect, useMemo, useRef, useState } from "react";
import { bpToTrackX } from "@/lib/sequences/sequence-zoom";
import { digestEnzymes } from "@/lib/sequences/enzyme-filters";
import { layoutLabels, tierCount, type LabelItem } from "@/lib/sequences/label-layout";
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
}

// ── layout constants (px) ──────────────────────────────────────────────────
const PAD_X = 16; // horizontal inset so end ticks/labels are not clipped
const BASELINE_FROM_TOP_BASE = 0; // computed dynamically from tier counts
const STRAND_H = 6; // thickness of the strand band
const TICK_H = 6; // ruler tick length below the baseline
const RULER_LABEL_GAP = 4;
const FEATURE_GAP = 10; // gap between strand and the first feature row
const FEATURE_ARROW_H = 14; // height of a feature arrow body
const FEATURE_LABEL_H = 14; // height reserved per below-line label tier
const FEATURE_ARROWHEAD = 7;
const ABOVE_TICK_H = 7; // tick mark length above the baseline (enzyme/primer)
const ABOVE_LEADER_BASE = 10; // first leader-line segment length above the tick
const ABOVE_TIER_H = 15; // vertical step between stacked label tiers
const ABOVE_LABEL_FONT = 10;
const FEATURE_LABEL_FONT = 11;
const RULER_FONT = 9;
const MIN_FEATURE_PX = 3; // minimum drawn width for a tiny feature

const PRIMER_PINK = "#ec4899";
const ENZYME_COLOR = "#475569";
const ENZYME_HOVER = "#dc2626";
const RULER_COLOR = "#cbd5e1";
const RULER_TEXT = "#94a3b8";
const STRAND_COLOR = "#94a3b8";

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

/** Pick "nice" ruler tick step so we get ~6-10 labeled ticks across the width. */
function rulerStep(seqLength: number): number {
  if (seqLength <= 0) return 1;
  const target = seqLength / 8; // aim for ~8 intervals
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const candidates = [1, 2, 5, 10].map((m) => m * pow);
  for (const c of candidates) if (c >= target) return c;
  return candidates[candidates.length - 1];
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
}: LinearMapProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  // Hover state for enzyme highlight, keyed on enzyme NAME (all sites of the same
  // enzyme highlight together — SnapGene behavior).
  const [hoverEnzyme, setHoverEnzyme] = useState<string | null>(null);

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
  const bpX = (bp: number) => PAD_X + bpToTrackX(bp, trackWidth, seqLength);

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

  const aboveSources: AboveSource[] = useMemo(() => {
    const src: AboveSource[] = [];
    cuts.forEach((c, i) => {
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
        src.push({
          id: `prm-${i}`,
          kind: "primer",
          anchorBp: (lo + hi) / 2,
          label: `${p.name} (${comma(lo)}..${comma(hi)})`,
          color: PRIMER_PINK,
          primerRef: { name: p.name, start: p.start, end: p.end },
        });
      });
    }
    return src;
  }, [cuts, primers, showPrimers]);

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
    [aboveSources, trackWidth, seqLength],
  );

  const abovePlaced = useMemo(
    () => layoutLabels(aboveItems, { gap: 6, maxNudge: 0, minX: PAD_X, maxX: PAD_X + trackWidth }),
    [aboveItems, trackWidth],
  );
  const aboveTiers = tierCount(abovePlaced);

  // ── FEATURES (below the line) ────────────────────────────────────────────
  // Pack feature labels into tiers too (these CAN nudge horizontally, since a
  // feature spans a range — the label just needs to read as "this feature").
  const featureItems: LabelItem[] = useMemo(
    () =>
      features.map((f, i) => {
        const lo = Math.min(f.start, f.end);
        const hi = Math.max(f.start, f.end);
        return {
          id: `feat-${i}`,
          anchorX: bpX((lo + hi) / 2),
          width: estTextWidth(f.name || "feature", FEATURE_LABEL_FONT),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, trackWidth, seqLength],
  );

  const featurePlaced = useMemo(
    () =>
      layoutLabels(featureItems, {
        gap: 8,
        maxNudge: 40,
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

  // Ruler ticks.
  const ticks = useMemo(() => {
    if (seqLength <= 0 || trackWidth <= 0) return [];
    const step = rulerStep(seqLength);
    const out: { bp: number; label: string }[] = [];
    for (let bp = 0; bp < seqLength; bp += step) {
      out.push({ bp, label: bp === 0 ? "1" : comma(bp) });
    }
    // Always label the end.
    out.push({ bp: seqLength, label: comma(seqLength) });
    return out;
  }, [seqLength, trackWidth]);

  if (!seqLength) return null;

  return (
    <div
      ref={wrapRef}
      className="relative min-h-0 w-full flex-1 overflow-auto bg-white"
      aria-label="Linear map"
    >
      {trackWidth > 0 ? (
        <svg width="100%" height={totalH} className="block select-none" style={{ minHeight: totalH }}>
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

          {/* ── ruler ticks + labels ── */}
          {ticks.map((t, i) => {
            const x = bpX(t.bp);
            const anchor = i === 0 ? "start" : t.bp === seqLength ? "end" : "middle";
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
                onMouseEnter={() => {
                  if (isEnzyme && src.enzymeName) setHoverEnzyme(src.enzymeName);
                }}
                onMouseLeave={() => {
                  if (isEnzyme) setHoverEnzyme(null);
                }}
                onDoubleClick={() => {
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
                {/* leader line: tick top -> up to the tier -> across to the label */}
                <polyline
                  points={`${tickX},${tickTopY} ${tickX},${tierY} ${p.labelX},${tierY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={highlighted ? 1.4 : 0.8}
                  opacity={highlighted ? 1 : 0.65}
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
            const color = f.color || "#94a3b8";
            const segs =
              f.segments && f.segments.length > 1
                ? f.segments
                    .map((s) => ({ start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) }))
                    .sort((a, b) => a.start - b.start)
                : [{ start: lo, end: hi }];
            const placed = placedById.get(`feat-${i}`);
            const labelTierY =
              featureLabelTop + (placed ? placed.tier : 0) * FEATURE_LABEL_H + FEATURE_LABEL_FONT;
            const labelX = placed ? placed.labelX : bpX((lo + hi) / 2);

            return (
              <g
                key={`feat-${i}`}
                style={{ cursor: "pointer" }}
                onDoubleClick={() =>
                  onFeatureDoubleClick({ name: f.name, start: f.start, end: f.end, direction: f.direction })
                }
              >
                {/* dashed intron connector spanning the whole feature (drawn first,
                    so exon boxes sit on top) */}
                {segs.length > 1 ? (
                  <line
                    x1={bpX(lo)}
                    y1={featureRowY}
                    x2={bpX(hi)}
                    y2={featureRowY}
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.7}
                  />
                ) : null}
                {/* exon boxes (or the single span); the LAST exon in the reading
                    direction carries the arrowhead */}
                {segs.map((s, si) => {
                  const x0 = bpX(s.start);
                  const x1 = Math.max(x0 + MIN_FEATURE_PX, bpX(s.end));
                  const isHeadExon =
                    f.direction === -1 ? si === 0 : si === segs.length - 1;
                  if (isHeadExon && segs.length > 1) {
                    return (
                      <polygon
                        key={si}
                        points={featureArrowPoints(x0, x1, featureRowY, f.direction)}
                        fill={color}
                        opacity={0.92}
                      />
                    );
                  }
                  if (segs.length === 1) {
                    return (
                      <polygon
                        key={si}
                        points={featureArrowPoints(x0, x1, featureRowY, f.direction)}
                        fill={color}
                        opacity={0.92}
                      />
                    );
                  }
                  // interior / non-head exon: plain box
                  return (
                    <rect
                      key={si}
                      x={x0}
                      y={featureRowY - FEATURE_ARROW_H / 2}
                      width={x1 - x0}
                      height={FEATURE_ARROW_H}
                      fill={color}
                      opacity={0.92}
                    />
                  );
                })}
                {/* feature label (de-collided tier) + a thin connector when the
                    label was nudged away from the feature center */}
                {Math.abs(labelX - bpX((lo + hi) / 2)) > 2 ? (
                  <line
                    x1={bpX((lo + hi) / 2)}
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
                  fill="#374151"
                  textAnchor="middle"
                >
                  {f.name || "feature"}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
