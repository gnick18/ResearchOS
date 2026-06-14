// Pure, headless renderer: a SeqDocument -> a self-contained SVG string at a
// requested px size (viewBox, white bg). The figure composer (and any future
// export) needs a sequence map WITHOUT a mounted SeqViz component, which is
// DOM-bound. Circular = a plasmid ring with a bp coordinate ring + directional
// feature wedges; linear = a backbone ruler with stacked strand-aware arrows.
// Feature colors come from the SAME resolveFeatureColor the editor uses.
//
// A `SequenceMapStyle` lets a styling UI drive the map (per-feature color / hide,
// block thickness, tick + label toggles) so a publication version can be made in
// app instead of round-tripping the SVG to Illustrator.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { SeqDocument, EditFeature } from "./edit-model";
import { resolveFeatureColor } from "./feature-colors";

export interface MapSize {
  width: number;
  height: number;
}

/** Composition-local styling, applied at render so a panel can be perfected. */
export interface SequenceMapStyle {
  /** Block thickness multiplier (arc width / arrow height). Default 1. */
  featureScale?: number;
  /** Draw the bp coordinate ring (circular) / ruler ticks (linear). Default true. */
  showTicks?: boolean;
  /** Draw feature labels. Default true. */
  showLabels?: boolean;
  /** Per-feature overrides, keyed by featureKey(f). */
  perFeature?: Record<string, { color?: string; hidden?: boolean }>;
}

const INK = "#0f172a";
const MUTED = "#64748b";
const BACKBONE = "#94a3b8";
const TICK = "#cbd5e1";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** A stable key for a feature, used to address per-feature style overrides. */
export function featureKey(f: { name: string; start: number; end: number }): string {
  return `${f.name}:${f.start}:${f.end}`;
}

/** Feature sweep in bp, handling a feature that wraps the circular origin. */
function featureSpanBp(f: EditFeature, seqLen: number): number {
  let d = f.end - f.start;
  if (d < 0) d += seqLen;
  return d;
}

/** Apply per-feature style: the override color wins, else the editor color. */
function colorOf(f: EditFeature, style: SequenceMapStyle): string {
  return style.perFeature?.[featureKey(f)]?.color || resolveFeatureColor(f);
}

/** The visible features under the current style (hidden ones dropped). */
function visibleFeatures(doc: SeqDocument, style: SequenceMapStyle): EditFeature[] {
  return doc.features.filter((f) => !style.perFeature?.[featureKey(f)]?.hidden);
}

/**
 * Push a sorted list of ideal y positions apart so labels do not overlap, then
 * recenter so the group does not drift off one edge. Pure.
 */
function deCollide(ys: number[], minGap: number): number[] {
  const out = ys.slice();
  for (let i = 1; i < out.length; i++) {
    if (out[i] < out[i - 1] + minGap) out[i] = out[i - 1] + minGap;
  }
  // recenter around the original mean to avoid drifting downward
  const idealMean = ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length);
  const outMean = out.reduce((a, b) => a + b, 0) / Math.max(1, out.length);
  const shift = idealMean - outMean;
  return out.map((y) => y + shift);
}

/** Render a sequence map to a standalone SVG string at the requested px size. */
export function renderSequenceMapSvg(
  doc: SeqDocument,
  size: MapSize,
  style: SequenceMapStyle = {},
): string {
  const W = Math.max(1, size.width);
  const H = Math.max(1, size.height);
  const seqLen = Math.max(1, doc.seq.length);
  const body = doc.circular
    ? circularMap(doc, W, H, seqLen, style)
    : linearMap(doc, W, H, seqLen, style);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>` +
    body +
    `</svg>`
  );
}

function circularMap(
  doc: SeqDocument,
  W: number,
  H: number,
  seqLen: number,
  style: SequenceMapStyle,
): string {
  const cx = W / 2;
  const cy = H / 2;
  const fontPx = Math.max(7, Math.min(W, H) * 0.028);
  const R = Math.max(8, Math.min(W, H) * 0.3);
  const half = Math.max(2, R * 0.06 * (style.featureScale ?? 1));
  const Rin = R - half;
  const Rout = R + half;
  const showTicks = style.showTicks !== false;
  const showLabels = style.showLabels !== false;
  const parts: string[] = [];

  const ang = (pos: number) => (pos / seqLen) * Math.PI * 2 - Math.PI / 2; // 0 at top, clockwise
  const pt = (a: number, r: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

  // bp coordinate ring + ticks.
  if (showTicks) {
    const Ridx = Rin - Math.max(5, half);
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Ridx.toFixed(1)}" fill="none" stroke="${TICK}" stroke-width="1"/>`,
    );
    for (let i = 0; i < 12; i++) {
      const a = ang((seqLen * i) / 12);
      const [tx0, ty0] = pt(a, Ridx);
      const [tx1, ty1] = pt(a, Ridx - 4);
      parts.push(
        `<line x1="${tx0.toFixed(1)}" y1="${ty0.toFixed(1)}" x2="${tx1.toFixed(1)}" y2="${ty1.toFixed(1)}" stroke="${TICK}" stroke-width="1"/>`,
      );
      if (i % 3 === 0) {
        const [lx, ly] = pt(a, Ridx - 11);
        parts.push(
          `<text x="${lx.toFixed(1)}" y="${(ly + fontPx * 0.32).toFixed(1)}" font-size="${(fontPx * 0.8).toFixed(1)}" fill="${MUTED}" text-anchor="middle">${Math.round((seqLen * i) / 12)}</text>`,
        );
      }
    }
  } else {
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R.toFixed(1)}" fill="none" stroke="${BACKBONE}" stroke-width="${Math.max(1, R * 0.02).toFixed(1)}"/>`,
    );
  }

  // center name + length.
  parts.push(
    `<text x="${cx.toFixed(1)}" y="${(cy - 1).toFixed(1)}" font-size="${(fontPx * 1.05).toFixed(1)}" fill="${INK}" text-anchor="middle" font-weight="600">${esc(truncate(doc.name, 22))}</text>`,
  );
  parts.push(
    `<text x="${cx.toFixed(1)}" y="${(cy + fontPx * 1.3).toFixed(1)}" font-size="${fontPx.toFixed(1)}" fill="${MUTED}" text-anchor="middle">${seqLen} bp</text>`,
  );

  // Feature wedges + collect label anchors per side for de-collision.
  type Lab = { am: number; name: string };
  const right: Lab[] = [];
  const left: Lab[] = [];
  for (const f of visibleFeatures(doc, style)) {
    const span = featureSpanBp(f, seqLen);
    if (span <= 0) continue;
    const a0 = ang(f.start);
    const a1 = a0 + (span / seqLen) * Math.PI * 2;
    const fwd = f.forward !== false;
    const pa = Math.min(0.06, (a1 - a0) * 0.5);
    const lead = fwd ? a1 : a0;
    const leadIn = fwd ? a1 - pa : a0 + pa;
    const tail = fwd ? a0 : a1;
    const [oTx, oTy] = pt(tail, Rout);
    const [oLx, oLy] = pt(leadIn, Rout);
    const [iLx, iLy] = pt(leadIn, Rin);
    const [iTx, iTy] = pt(tail, Rin);
    const [tipX, tipY] = pt(lead, (Rin + Rout) / 2);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const color = colorOf(f, style);
    parts.push(
      `<path d="M${oTx.toFixed(1)} ${oTy.toFixed(1)} A${Rout.toFixed(1)} ${Rout.toFixed(1)} 0 ${large} 1 ${oLx.toFixed(1)} ${oLy.toFixed(1)} ` +
        `L${tipX.toFixed(1)} ${tipY.toFixed(1)} L${iLx.toFixed(1)} ${iLy.toFixed(1)} ` +
        `A${Rin.toFixed(1)} ${Rin.toFixed(1)} 0 ${large} 0 ${iTx.toFixed(1)} ${iTy.toFixed(1)} Z" fill="${color}"/>`,
    );
    if (showLabels) (Math.cos((a0 + a1) / 2) >= 0 ? right : left).push({ am: (a0 + a1) / 2, name: f.name });
  }

  if (showLabels) {
    const labelCol = (side: Lab[], anchor: "start" | "end", colX: number) => {
      const sorted = side.slice().sort((p, q) => pt(p.am, Rout)[1] - pt(q.am, Rout)[1]);
      const ys = deCollide(
        sorted.map((s) => pt(s.am, Rout)[1]),
        fontPx * 1.15,
      );
      sorted.forEach((s, i) => {
        const [ax, ay] = pt(s.am, Rout);
        const ly = ys[i];
        parts.push(
          `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${colX.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${TICK}" stroke-width="0.75"/>`,
        );
        parts.push(
          `<text x="${colX.toFixed(1)}" y="${(ly + fontPx * 0.32).toFixed(1)}" font-size="${fontPx.toFixed(1)}" fill="${INK}" text-anchor="${anchor}">${esc(truncate(s.name, 16))}</text>`,
        );
      });
    };
    labelCol(right, "start", cx + Rout + 8);
    labelCol(left, "end", cx - Rout - 8);
  }
  return parts.join("");
}

function linearMap(
  doc: SeqDocument,
  W: number,
  H: number,
  seqLen: number,
  style: SequenceMapStyle,
): string {
  const parts: string[] = [];
  const margin = Math.max(10, W * 0.06);
  const x0 = margin;
  const x1 = W - margin;
  const usableW = Math.max(1, x1 - x0);
  const fontPx = Math.max(7, Math.min(W, H) * 0.03);
  const baseY = H * 0.66;
  const showTicks = style.showTicks !== false;
  const showLabels = style.showLabels !== false;
  const xOf = (pos: number) => x0 + (pos / seqLen) * usableW;

  parts.push(
    `<text x="${x0.toFixed(1)}" y="${(fontPx * 1.6).toFixed(1)}" font-size="${(fontPx * 1.1).toFixed(1)}" fill="${INK}" font-weight="600">${esc(truncate(doc.name, 30))}</text>`,
  );
  parts.push(
    `<line x1="${x0.toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="${BACKBONE}" stroke-width="1.5"/>`,
  );

  if (showTicks) {
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const pos = Math.round((seqLen * i) / ticks);
      const tx = xOf(pos);
      parts.push(
        `<line x1="${tx.toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(baseY + 4).toFixed(1)}" stroke="${BACKBONE}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${tx.toFixed(1)}" y="${(baseY + 4 + fontPx).toFixed(1)}" font-size="${(fontPx * 0.8).toFixed(1)}" fill="${MUTED}" text-anchor="middle">${pos}</text>`,
      );
    }
  }

  const fh = Math.max(6, fontPx * 1.1 * (style.featureScale ?? 1));
  const rowH = fh + fontPx * 0.7;
  const rowEnds: number[] = [];
  for (const f of visibleFeatures(doc, style)) {
    let s = Math.min(f.start, f.end);
    let e = Math.max(f.start, f.end);
    if (f.end < f.start) {
      s = f.start;
      e = seqLen;
    }
    const fx0 = xOf(s);
    const fx1 = Math.max(fx0 + 2, xOf(e));
    let row = 0;
    while (row < rowEnds.length && rowEnds[row] > fx0 - 4) row++;
    rowEnds[row] = fx1 + (showLabels ? truncate(f.name, 20).length * fontPx * 0.55 + 6 : 0);
    const fy = baseY - 12 - row * rowH - fh;
    parts.push(featureArrow(fx0, fx1, fy, fh, f.forward !== false, colorOf(f, style)));
    if (showLabels) {
      parts.push(
        `<text x="${(fx1 + 3).toFixed(1)}" y="${(fy + fh * 0.78).toFixed(1)}" font-size="${(fontPx * 0.85).toFixed(1)}" fill="${INK}">${esc(truncate(f.name, 20))}</text>`,
      );
    }
  }
  return parts.join("");
}

/** A strand-aware feature arrow (a rect with a directional tip). */
function featureArrow(x0: number, x1: number, y: number, h: number, forward: boolean, color: string): string {
  const tip = Math.min((x1 - x0) * 0.4, h);
  const ym = y + h / 2;
  const d = forward
    ? `M${x0.toFixed(1)} ${y.toFixed(1)} H${(x1 - tip).toFixed(1)} L${x1.toFixed(1)} ${ym.toFixed(1)} ` +
      `L${(x1 - tip).toFixed(1)} ${(y + h).toFixed(1)} H${x0.toFixed(1)} Z`
    : `M${x1.toFixed(1)} ${y.toFixed(1)} H${(x0 + tip).toFixed(1)} L${x0.toFixed(1)} ${ym.toFixed(1)} ` +
      `L${(x0 + tip).toFixed(1)} ${(y + h).toFixed(1)} H${x1.toFixed(1)} Z`;
  return `<path d="${d}" fill="${color}"/>`;
}
