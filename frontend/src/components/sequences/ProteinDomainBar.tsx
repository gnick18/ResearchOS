"use client";

// sequence editor master — CDD-STYLE PROTEIN DOMAIN BAR.
//
// A horizontal, protein-coordinate view of a CDS's annotated domains, modeled on
// NCBI's Conserved Domain Database graphic. The protein runs left-to-right in
// residue coordinates 1..N with a light ruler; each domain is a rounded colored
// block at its aa span, labeled with the family name. Overlapping domains stack
// into lanes (reusing the linear map's pure interval/lane packing). Hover shows
// the family name, accession, residue range, and score / E-value.
//
// Two visual states, so the Annotate-domains review can preview a fresh
// annotation BEFORE the user accepts it:
//   - ACCEPTED domains (the features already on the sequence) draw SOLID. Clicking
//     one selects + scrolls its DNA feature on the map (the cross-link).
//   - CANDIDATE domains (the in-review hits, not yet accepted) draw PENDING
//     (dashed border, lighter fill) so the user sees what accepting would add.
//     A candidate has no feature yet, so it is highlight-only (no click target).
//
// Pure presentational: it takes the projected blocks and renders them. The
// projection (domainsForCds) and the per-family palette (familyColor) live in
// lib/sequences/domain-features. Inline SVG only, <Tooltip> for hover details, no
// emoji, no em-dashes, no mid-sentence colons. Type tokens throughout.

import { useMemo } from "react";
import Tooltip from "@/components/Tooltip";
import { layoutLabels, type LabelItem } from "@/lib/sequences/label-layout";

/** One projected domain to draw. Matches lib/sequences/domain-features
 *  DomainBlock; redeclared here so the bar has no lib coupling beyond the shape.
 *  `featureIndex` is the source feature index for click-to-select; candidates
 *  pass -1 (no feature yet). */
export interface DomainBlock {
  name: string;
  accession: string;
  /** 1-based inclusive residue start. */
  aaStart: number;
  /** 1-based inclusive residue end. */
  aaEnd: number;
  /** The per-family block color (hex or hsl). */
  color: string;
  score?: number;
  evalue?: number;
  featureIndex: number;
}

/** Height of one domain lane (px) and the gap between stacked lanes. */
const LANE_HEIGHT = 22;
const LANE_GAP = 4;
/** The ruler sits below the lanes; reserve room for its ticks + numbers. */
const RULER_HEIGHT = 18;

/** Format the residue range for a block label / tooltip. */
function rangeLabel(b: DomainBlock): string {
  return `${b.aaStart}..${b.aaEnd}`;
}

/** Build the human tooltip body for a block (accession, range, score / E-value).
 *  Lines joined with newlines; the Tooltip body wraps. */
function tooltipBody(b: DomainBlock, pending: boolean): string {
  const lines: string[] = [];
  if (b.accession) lines.push(b.accession);
  lines.push(`residues ${rangeLabel(b)}`);
  const stats: string[] = [];
  if (b.evalue !== undefined) stats.push(`E ${b.evalue.toExponential(1)}`);
  if (b.score !== undefined) stats.push(`bit score ${b.score}`);
  if (stats.length) lines.push(stats.join(" · "));
  if (pending) lines.push("Pending. Accept to keep this domain.");
  return lines.join("\n");
}

/** Pack blocks into non-overlapping lanes by their aa interval, reusing the
 *  linear map's lane packer. We model each block as a label centered at its aa
 *  midpoint with width = its residue span and gap 0, so the packer's no-overlap
 *  guarantee becomes a no-overlap-in-aa-space guarantee. Returns lane index per
 *  block (keyed by a synthetic id = its position in the input array). */
function packLanes(blocks: DomainBlock[]): number[] {
  const items: LabelItem[] = blocks.map((b, i) => {
    const span = Math.max(1, b.aaEnd - b.aaStart + 1);
    return {
      id: String(i),
      anchorX: b.aaStart + span / 2,
      width: span,
    };
  });
  // maxNudge 0 forbids horizontal nudging, so a block that overlaps another in aa
  // space is pushed to a HIGHER tier (a new lane) instead of being shoved sideways
  // off its true residue position. That is exactly the lane-stacking we want.
  const placed = layoutLabels(items, { gap: 0, maxNudge: 0 });
  const laneById = new Map<string, number>();
  for (const p of placed) laneById.set(p.id, p.tier);
  return blocks.map((_, i) => laneById.get(String(i)) ?? 0);
}

/** One domain block, positioned + styled by state, with a hover tooltip. */
function Block({
  block,
  lane,
  aaLength,
  pending,
  onSelectDomain,
}: {
  block: DomainBlock;
  lane: number;
  aaLength: number;
  pending: boolean;
  onSelectDomain?: (featureIndex: number) => void;
}) {
  // residue r occupies the fraction (r-1)/N .. r/N of the track, so an inclusive
  // span [aaStart, aaEnd] spans (aaStart-1)/N .. aaEnd/N.
  const leftPct = ((block.aaStart - 1) / aaLength) * 100;
  const widthPct = ((block.aaEnd - block.aaStart + 1) / aaLength) * 100;
  const top = lane * (LANE_HEIGHT + LANE_GAP);

  const clickable = !pending && block.featureIndex >= 0 && !!onSelectDomain;

  const inner = (
    <div
      data-testid="domain-block"
      data-pending={pending ? "1" : "0"}
      data-accession={block.accession}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={
        clickable
          ? `Select ${block.name} domain feature (residues ${rangeLabel(block)})`
          : undefined
      }
      onClick={clickable ? () => onSelectDomain!(block.featureIndex) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectDomain!(block.featureIndex);
              }
            }
          : undefined
      }
      className={`absolute flex items-center overflow-hidden rounded-md px-1.5 text-meta font-medium leading-none ${
        clickable ? "cursor-pointer" : pending ? "cursor-default" : "cursor-default"
      }`}
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        top,
        height: LANE_HEIGHT,
        minWidth: 6,
        // Accepted: solid fill. Pending: lighter, translucent fill + dashed border.
        backgroundColor: pending ? `${hexish(block.color, 0.22)}` : block.color,
        border: pending ? `1.5px dashed ${block.color}` : "1px solid rgba(0,0,0,0.12)",
        color: pending ? blockTextOnLight(block.color) : "rgba(255,255,255,0.98)",
        boxShadow: pending ? "none" : "0 1px 1px rgba(0,0,0,0.10)",
      }}
    >
      <span className="truncate">{block.name}</span>
    </div>
  );

  return (
    <Tooltip
      label={pending ? `${block.name} (pending)` : block.name}
      body={tooltipBody(block, pending)}
      placement="top"
    >
      {inner}
    </Tooltip>
  );
}

/** Turn a hex / hsl color into a translucent fill for the pending state. Hex is
 *  parsed to rgba; hsl is wrapped to hsla; anything else falls back to a neutral
 *  translucent slate so the block still reads. */
function hexish(color: string, alpha: number): string {
  const c = color.trim();
  const hex = c.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const hsl = c.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/);
  if (hsl) {
    return `hsla(${hsl[1]}, ${hsl[2]}%, ${hsl[3]}%, ${alpha})`;
  }
  return `rgba(100, 116, 139, ${alpha})`;
}

/** Readable text color for a pending block drawn on a light translucent fill:
 *  reuse the family hue at a darker lightness. Falls back to slate-700. */
function blockTextOnLight(color: string): string {
  const hsl = color.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*[\d.]+%\s*\)$/);
  if (hsl) return `hsl(${hsl[1]}, ${hsl[2]}%, 32%)`;
  return "#334155";
}

/** Ruler tick residue positions: 1, every 100, and the end. Deduped + sorted. */
function tickResidues(aaLength: number): number[] {
  const ticks = new Set<number>([1, aaLength]);
  for (let r = 100; r < aaLength; r += 100) ticks.add(r);
  return [...ticks].filter((r) => r >= 1 && r <= aaLength).sort((a, b) => a - b);
}

export default function ProteinDomainBar({
  aaLength,
  domains,
  candidates,
  onSelectDomain,
}: {
  /** The translated protein length (residue count). */
  aaLength: number;
  /** Accepted domains (features on the sequence). Drawn solid + clickable. */
  domains: DomainBlock[];
  /** In-review candidate domains (not yet accepted). Drawn pending, no click. */
  candidates?: DomainBlock[];
  /** Click an accepted block -> select + scroll its DNA feature on the map. */
  onSelectDomain?: (featureIndex: number) => void;
}) {
  const pending = candidates ?? [];
  // Pack accepted + pending together so a candidate never visually collides with
  // an accepted block. Accepted come first so they take the lower lanes.
  const all = useMemo(() => [...domains, ...pending], [domains, pending]);
  const lanes = useMemo(() => packLanes(all), [all]);
  const laneCount = lanes.length ? Math.max(...lanes) + 1 : 1;
  const lanesHeight = laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP;

  const ticks = useMemo(
    () => (aaLength > 0 ? tickResidues(aaLength) : []),
    [aaLength],
  );

  // EMPTY: no accepted and no pending domains -> a calm pointer at the action.
  if (aaLength <= 0 || (domains.length === 0 && pending.length === 0)) {
    return (
      <div
        data-testid="domain-bar-empty"
        className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2.5 text-meta text-gray-500"
      >
        No domains annotated yet. Use Annotate domains below to search this protein.
      </div>
    );
  }

  return (
    <div data-testid="protein-domain-bar" className="select-none">
      {/* The lanes track. Each block is absolutely positioned by aa range; the
          track width is 100% of this box, so percentages map residue -> x. */}
      <div className="relative w-full" style={{ height: lanesHeight }}>
        {all.map((block, i) => (
          <Block
            key={`${block.featureIndex}-${block.aaStart}-${block.aaEnd}-${i}`}
            block={block}
            lane={lanes[i]}
            aaLength={aaLength}
            pending={i >= domains.length}
            onSelectDomain={onSelectDomain}
          />
        ))}
      </div>

      {/* The ruler: a baseline, ticks at 1 / every 100 / the end, residue numbers. */}
      <div className="relative w-full" style={{ height: RULER_HEIGHT, marginTop: 4 }}>
        <div className="absolute left-0 right-0 top-0 h-px bg-gray-200" />
        {ticks.map((r) => {
          const pct = ((r - 1) / aaLength) * 100;
          // Bias the end label inward so it does not spill past the right edge.
          const transform =
            r === 1 ? "translateX(0)" : r === aaLength ? "translateX(-100%)" : "translateX(-50%)";
          return (
            <div
              key={r}
              className="absolute top-0"
              style={{ left: `${Math.min(100, Math.max(0, pct))}%` }}
            >
              <div className="h-1.5 w-px bg-gray-300" />
              <div
                className="mt-0.5 text-meta tabular-nums text-gray-400"
                style={{ transform }}
              >
                {r}
              </div>
            </div>
          );
        })}
      </div>

      {/* A tiny legend only while a pending preview is showing, so the dashed
          state reads as "in review", not a different family. */}
      {pending.length > 0 ? (
        <p className="mt-1 text-meta text-gray-400">
          Dashed blocks are in review. Accept them below to keep them.
        </p>
      ) : null}
    </div>
  );
}
