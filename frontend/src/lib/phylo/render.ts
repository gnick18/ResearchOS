// Phylo Tree Studio, the native SVG figure renderer (Phase 2 + 3).
//
// THIS IS THE SINGLE FILE that emits raw SVG markup for the Studio. It is the
// data-figure twin of the Data Hub plot renderer (lib/datahub/diagnostic-plot.ts
// etc.), so the icon-guard baseline gets ONE small, reviewable entry rather than
// inline figure SVG scattered across components. Everything upstream (parse,
// layout, editing) is pure data; everything downstream (PhyloStudio.tsx) injects
// this string and never writes its own figure SVG.
//
// The renderer takes a laid-out tree (layout.ts) plus a figure spec + bound
// metadata and returns a complete SVG document string. The output feeds both the
// live canvas (dangerouslySetInnerHTML) and the SVG / PNG export path reused from
// Data Hub (downloadSvg / svgToPngBlob), so what you see is exactly what you
// export, one source.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  layoutCircular,
  layoutRectangular,
  type CircularLayout,
  type LayoutOptions,
  type RectLayout,
} from "./layout";
import { leaves, type TreeNode } from "./parse";

/** Which annotation tracks are on, and which metadata column drives each. */
export interface FigureTracks {
  labels: boolean;
  /** Italicize tip labels (species convention). */
  labelsItalic: boolean;
  points: boolean;
  strip: boolean;
  bars: boolean;
  heat: boolean;
  clade: boolean;
  support: boolean;
}

export interface FigureColumns {
  /** Categorical column for tip points + color strip. */
  category?: string;
  /** Numeric column for the aligned bar chart. */
  bar?: string;
  /** Columns rendered as a presence / value heatmap panel. */
  heat?: string[];
}

export interface RenderSpec {
  layout: "rectangular" | "circular";
  phylogram: boolean;
  tracks: FigureTracks;
  columns: FigureColumns;
  width: number;
  height: number;
  /** tip id -> metadata row, from matchMetadataToTips. */
  metadata?: Map<number, Record<string, string>>;
  /** Stable category-value -> color, so the strip + points + legend agree. */
  categoryColors?: Record<string, string>;
  /** A clade highlight, by the highlighted clade's root node id + a label. */
  cladeHighlight?: { nodeId: number; label: string; color: string } | null;
  /** Branch color overrides, node id -> color. */
  branchColors?: Record<number, string>;
}

const FG = "#1f2937";
const MUTED = "#64748b";
const ACCENT = "#1AA0E6"; // brand-sky
const PANEL_BG = "#ffffff";
const BORDER = "#e2e8f0";

/** Escape text bound for an SVG text node (labels are user data). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Deterministic categorical palette (brand-led), cycled for many categories. */
export const CATEGORY_PALETTE = [
  "#1AA0E6",
  "#5B47D6",
  "#16a34a",
  "#b45309",
  "#dc2626",
  "#0891b2",
  "#94a3b8",
  "#7c3aed",
];

/** Assign a stable color to each distinct value of a categorical column. */
export function buildCategoryColors(
  root: TreeNode,
  metadata: Map<number, Record<string, string>> | undefined,
  column: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!metadata || !column) return out;
  const seen: string[] = [];
  for (const tip of leaves(root)) {
    const v = metadata.get(tip.id)?.[column];
    if (v && !seen.includes(v)) seen.push(v);
  }
  seen.forEach((v, i) => (out[v] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]));
  return out;
}

/** Build a complete SVG string for the current figure. */
export function renderTreeSvg(root: TreeNode, spec: RenderSpec): string {
  const opts: LayoutOptions = {
    width: spec.width,
    height: spec.height,
    rightInset: rightInsetFor(root, spec),
    padding: 16,
    phylogram: spec.phylogram,
  };
  const body =
    spec.layout === "circular"
      ? renderCircular(root, layoutCircular(root, opts), spec)
      : renderRectangular(root, layoutRectangular(root, opts), spec);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="${spec.width}" height="${spec.height}" font-family="system-ui, sans-serif">`,
    `<rect x="0" y="0" width="${spec.width}" height="${spec.height}" fill="${PANEL_BG}"/>`,
    body,
    `</svg>`,
  ].join("");
}

/** Reserve horizontal room on the right for the active tracks + labels. */
function rightInsetFor(root: TreeNode, spec: RenderSpec): number {
  if (spec.layout === "circular") return 0;
  let inset = 16;
  if (spec.tracks.strip) inset += 16;
  if (spec.tracks.bars) inset += 78;
  if (spec.tracks.heat) inset += (spec.columns.heat?.length ?? 0) * 16 + 8;
  if (spec.tracks.labels) inset += longestLabelPx(root);
  return inset;
}

function longestLabelPx(root: TreeNode): number {
  const max = Math.max(8, ...leaves(root).map((t) => t.name.length));
  return Math.min(220, 14 + max * 6.2);
}

function colorForBranch(
  spec: RenderSpec,
  nodeId: number,
): string {
  return spec.branchColors?.[nodeId] ?? FG;
}

// ---------------------------------------------------------------------------
// Rectangular renderer.
// ---------------------------------------------------------------------------

function renderRectangular(
  root: TreeNode,
  layout: RectLayout,
  spec: RenderSpec,
): string {
  const parts: string[] = [];
  const byId = new Map(layout.nodes.map((p) => [p.node.id, p]));
  const lv = leaves(root);
  const tips = lv.map((t) => byId.get(t.id)!);
  const plotRight = Math.max(...layout.nodes.map((p) => p.x));

  // Clade highlight band behind the edges.
  if (spec.tracks.clade && spec.cladeHighlight) {
    const cladeRoot = layout.nodes.find(
      (p) => p.node.id === spec.cladeHighlight!.nodeId,
    );
    if (cladeRoot) {
      const cl = leaves(cladeRoot.node).map((t) => byId.get(t.id)!);
      if (cl.length > 0) {
        const y0 = Math.min(...cl.map((c) => c.y)) - 12;
        const y1 = Math.max(...cl.map((c) => c.y)) + 12;
        parts.push(
          `<rect x="12" y="${y0}" width="${plotRight + 6 - 12}" height="${y1 - y0}" rx="6" fill="${spec.cladeHighlight.color}" opacity="0.10"/>`,
          `<text x="16" y="${y0 + 12}" font-size="10" font-weight="700" fill="${spec.cladeHighlight.color}">${esc(spec.cladeHighlight.label)}</text>`,
        );
      }
    }
  }

  // Edges (elbow connectors).
  for (const p of layout.nodes) {
    if (p.parentX === null || p.parentY === null) continue;
    parts.push(
      `<path d="M${p.parentX} ${p.parentY} V${p.y} H${p.x}" fill="none" stroke="${colorForBranch(spec, p.node.id)}" stroke-width="1.5"/>`,
    );
    // Support values on internal branches.
    if (
      spec.tracks.support &&
      p.node.children.length > 0 &&
      p.node.support !== null
    ) {
      parts.push(
        `<text x="${p.parentX + 3}" y="${p.y - 3}" font-size="9" fill="${MUTED}">${p.node.support}</text>`,
      );
    }
  }

  // Tip decorations, column by column.
  for (const tip of tips) {
    const y = tip.y;
    const meta = spec.metadata?.get(tip.node.id);
    const cat = spec.columns.category ? meta?.[spec.columns.category] : undefined;
    const catColor = (cat && spec.categoryColors?.[cat]) || MUTED;

    let cx = tip.x + 6;
    if (spec.tracks.points) {
      parts.push(`<circle cx="${cx}" cy="${y}" r="4" fill="${catColor}"/>`);
      cx += 10;
    }

    let tx = plotRight + 8;
    if (spec.tracks.strip) {
      parts.push(
        `<rect x="${tx}" y="${y - 9}" width="12" height="18" fill="${catColor}"/>`,
      );
      tx += 16;
    }
    if (spec.tracks.bars && spec.columns.bar) {
      const v = Number(meta?.[spec.columns.bar] ?? "0");
      const range = barRange(root, spec);
      const bw =
        range.max > range.min
          ? ((v - range.min) / (range.max - range.min)) * 64
          : 0;
      parts.push(
        `<rect x="${tx}" y="${y - 7}" width="${Math.max(2, bw)}" height="14" rx="2" fill="${ACCENT}" opacity="0.85"/>`,
      );
      tx += 78;
    }
    if (spec.tracks.heat && spec.columns.heat) {
      spec.columns.heat.forEach((col, gi) => {
        const raw = meta?.[col] ?? "";
        const on = isTruthy(raw);
        parts.push(
          `<rect x="${tx + gi * 16}" y="${y - 7}" width="14" height="14" rx="2" fill="${on ? ACCENT : "#f1f5f9"}" stroke="${BORDER}"/>`,
        );
      });
      tx += spec.columns.heat.length * 16 + 8;
    }
    if (spec.tracks.labels) {
      parts.push(
        `<text x="${tx}" y="${y + 4}" font-size="11"${spec.tracks.labelsItalic ? ' font-style="italic"' : ""} fill="${FG}">${esc(tip.node.name)}</text>`,
      );
    }
  }

  // Scale bar (phylogram only).
  if (spec.phylogram && layout.unitsPerPx) {
    const tick = niceTick(layout.maxDepth);
    const px = tick / layout.unitsPerPx;
    const y = spec.height - 6;
    parts.push(
      `<line x1="16" y1="${y}" x2="${16 + px}" y2="${y}" stroke="${MUTED}" stroke-width="1.5"/>`,
      `<text x="16" y="${y - 4}" font-size="9" fill="${MUTED}">${tick}</text>`,
    );
  }
  return parts.join("");
}

/** Range of the bar-chart numeric column across matched tips. */
function barRange(root: TreeNode, spec: RenderSpec): { min: number; max: number } {
  const col = spec.columns.bar;
  if (!col || !spec.metadata) return { min: 0, max: 1 };
  const vals: number[] = [];
  for (const tip of leaves(root)) {
    const v = Number(spec.metadata.get(tip.id)?.[col]);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(0, ...vals), max: Math.max(...vals) };
}

function isTruthy(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "yes" || v === "true" || v === "y" || v === "present";
}

/** A round-ish scale-bar tick at roughly a quarter of the tree depth. */
function niceTick(maxDepth: number): number {
  const target = maxDepth / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(target || 1)));
  const candidates = [1, 2, 5, 10].map((m) => m * mag);
  return candidates.reduce((best, c) =>
    Math.abs(c - target) < Math.abs(best - target) ? c : best,
  );
}

// ---------------------------------------------------------------------------
// Circular renderer.
// ---------------------------------------------------------------------------

function renderCircular(
  root: TreeNode,
  layout: CircularLayout,
  spec: RenderSpec,
): string {
  const parts: string[] = [];
  for (const p of layout.nodes) {
    if (
      p.parentX === null ||
      p.parentY === null ||
      p.parentRadius === null ||
      p.parentAngle === null
    )
      continue;
    // Radial step out from the parent radius at the child angle, then an arc.
    const ax = layout.cx + p.parentRadius * Math.cos(p.angle - Math.PI / 2);
    const ay = layout.cy + p.parentRadius * Math.sin(p.angle - Math.PI / 2);
    const px = layout.cx + p.parentRadius * Math.cos(p.parentAngle - Math.PI / 2);
    const py = layout.cy + p.parentRadius * Math.sin(p.parentAngle - Math.PI / 2);
    const large = Math.abs(p.angle - p.parentAngle) > Math.PI ? 1 : 0;
    const sweep = p.angle > p.parentAngle ? 1 : 0;
    parts.push(
      `<path d="M${px} ${py} A ${p.parentRadius} ${p.parentRadius} 0 ${large} ${sweep} ${ax} ${ay} L ${p.x} ${p.y}" fill="none" stroke="${colorForBranch(spec, p.node.id)}" stroke-width="1.4"/>`,
    );
  }
  const byId = new Map(layout.nodes.map((p) => [p.node.id, p]));
  for (const tip of leaves(root)) {
    const p = byId.get(tip.id)!;
    const meta = spec.metadata?.get(tip.id);
    const cat = spec.columns.category ? meta?.[spec.columns.category] : undefined;
    const catColor = (cat && spec.categoryColors?.[cat]) || MUTED;
    if (spec.tracks.points) {
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${catColor}"/>`);
    }
    if (spec.tracks.strip) {
      const sx = layout.cx + (p.radius + 8) * Math.cos(p.angle - Math.PI / 2);
      const sy = layout.cy + (p.radius + 8) * Math.sin(p.angle - Math.PI / 2);
      parts.push(`<circle cx="${sx}" cy="${sy}" r="4" fill="${catColor}"/>`);
    }
    if (spec.tracks.labels) {
      const lr = p.radius + (spec.tracks.strip ? 18 : 12);
      const lx = layout.cx + lr * Math.cos(p.angle - Math.PI / 2);
      const ly = layout.cy + lr * Math.sin(p.angle - Math.PI / 2);
      const deg = ((p.angle - Math.PI / 2) * 180) / Math.PI;
      const flip = Math.cos(p.angle - Math.PI / 2) < 0;
      parts.push(
        `<text x="${lx}" y="${ly}" font-size="10"${spec.tracks.labelsItalic ? ' font-style="italic"' : ""} fill="${FG}" transform="rotate(${flip ? deg + 180 : deg} ${lx} ${ly})" text-anchor="${flip ? "end" : "start"}">${esc(tip.name)}</text>`,
      );
    }
  }
  return parts.join("");
}
