// Pure, headless renderer: a SeqDocument -> a self-contained SVG string at a
// requested px size (viewBox, white bg). The figure composer (and any future
// export) needs a sequence map WITHOUT a mounted SeqViz component, which is
// DOM-bound. Circular = a plasmid ring with feature arcs; linear = a backbone
// with stacked, strand-aware feature arrows. Feature colors come from the SAME
// resolveFeatureColor the editor uses, so a composed panel shows the same map.
//
// This is a clean publication map, NOT a pixel-identical SeqViz capture (SeqViz
// is interactive + React-only). It shows the same features, colors, topology.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { SeqDocument, EditFeature } from "./edit-model";
import { resolveFeatureColor } from "./feature-colors";

export interface MapSize {
  width: number;
  height: number;
}

const INK = "#0f172a";
const MUTED = "#64748b";
const BACKBONE = "#94a3b8";

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

/** Feature sweep in bp, handling a feature that wraps the circular origin. */
function featureSpanBp(f: EditFeature, seqLen: number): number {
  let d = f.end - f.start;
  if (d < 0) d += seqLen;
  return d;
}

/** Render a sequence map to a standalone SVG string at the requested px size. */
export function renderSequenceMapSvg(doc: SeqDocument, size: MapSize): string {
  const W = Math.max(1, size.width);
  const H = Math.max(1, size.height);
  const seqLen = Math.max(1, doc.seq.length);
  const body = doc.circular ? circularMap(doc, W, H, seqLen) : linearMap(doc, W, H, seqLen);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>` +
    body +
    `</svg>`
  );
}

function circularMap(doc: SeqDocument, W: number, H: number, seqLen: number): string {
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.max(8, Math.min(W, H) * 0.3);
  const fontPx = Math.max(7, Math.min(W, H) * 0.028);
  const arcW = Math.max(3, R * 0.12);
  const parts: string[] = [];

  parts.push(
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R.toFixed(1)}" ` +
      `fill="none" stroke="${BACKBONE}" stroke-width="${Math.max(1, R * 0.02).toFixed(1)}"/>`,
  );
  parts.push(
    `<text x="${cx.toFixed(1)}" y="${(cy - 1).toFixed(1)}" font-size="${(fontPx * 1.05).toFixed(1)}" ` +
      `fill="${INK}" text-anchor="middle" font-weight="600">${esc(truncate(doc.name, 22))}</text>`,
  );
  parts.push(
    `<text x="${cx.toFixed(1)}" y="${(cy + fontPx * 1.3).toFixed(1)}" font-size="${fontPx.toFixed(1)}" ` +
      `fill="${MUTED}" text-anchor="middle">${seqLen} bp</text>`,
  );

  const ang = (pos: number) => (pos / seqLen) * Math.PI * 2 - Math.PI / 2; // 0 at top, clockwise
  const pt = (a: number, r: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

  for (const f of doc.features) {
    const span = featureSpanBp(f, seqLen);
    if (span <= 0) continue;
    const a0 = ang(f.start);
    const a1 = a0 + (span / seqLen) * Math.PI * 2;
    const [x0, y0] = pt(a0, R);
    const [x1, y1] = pt(a1, R);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const color = resolveFeatureColor(f);
    parts.push(
      `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R.toFixed(1)} ${R.toFixed(1)} 0 ${large} 1 ` +
        `${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${arcW.toFixed(1)}"/>`,
    );
    const am = (a0 + a1) / 2;
    const [tx, ty] = pt(am, R + arcW / 2 + 2);
    const [lx, ly] = pt(am, R + arcW / 2 + 5);
    const anchor = Math.cos(am) >= 0 ? "start" : "end";
    parts.push(
      `<line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${BACKBONE}" stroke-width="0.75"/>`,
    );
    parts.push(
      `<text x="${lx.toFixed(1)}" y="${(ly + fontPx * 0.35).toFixed(1)}" font-size="${fontPx.toFixed(1)}" ` +
        `fill="${INK}" text-anchor="${anchor}">${esc(truncate(f.name, 16))}</text>`,
    );
  }
  return parts.join("");
}

function linearMap(doc: SeqDocument, W: number, H: number, seqLen: number): string {
  const parts: string[] = [];
  const margin = Math.max(10, W * 0.06);
  const x0 = margin;
  const x1 = W - margin;
  const usableW = Math.max(1, x1 - x0);
  const fontPx = Math.max(7, Math.min(W, H) * 0.03);
  const baseY = H * 0.66;
  const xOf = (pos: number) => x0 + (pos / seqLen) * usableW;

  parts.push(
    `<text x="${x0.toFixed(1)}" y="${(fontPx * 1.6).toFixed(1)}" font-size="${(fontPx * 1.1).toFixed(1)}" ` +
      `fill="${INK}" font-weight="600">${esc(truncate(doc.name, 30))}</text>`,
  );
  parts.push(
    `<line x1="${x0.toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="${BACKBONE}" stroke-width="1.5"/>`,
  );

  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const pos = Math.round((seqLen * i) / ticks);
    const tx = xOf(pos);
    parts.push(
      `<line x1="${tx.toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(baseY + 4).toFixed(1)}" stroke="${BACKBONE}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${tx.toFixed(1)}" y="${(baseY + 4 + fontPx).toFixed(1)}" font-size="${(fontPx * 0.8).toFixed(1)}" ` +
        `fill="${MUTED}" text-anchor="middle">${pos}</text>`,
    );
  }

  const fh = Math.max(6, fontPx * 1.1);
  const rowH = fh + fontPx * 0.7;
  const rowEnds: number[] = [];
  for (const f of doc.features) {
    let s = Math.min(f.start, f.end);
    let e = Math.max(f.start, f.end);
    if (f.end < f.start) {
      // wraps the origin on a linear view: clamp to the visible span
      s = f.start;
      e = seqLen;
    }
    const fx0 = xOf(s);
    const fx1 = Math.max(fx0 + 2, xOf(e));
    let row = 0;
    while (row < rowEnds.length && rowEnds[row] > fx0 - 4) row++;
    rowEnds[row] = fx1 + truncate(f.name, 20).length * fontPx * 0.55 + 6;
    const fy = baseY - 12 - row * rowH - fh;
    const color = resolveFeatureColor(f);
    parts.push(featureArrow(fx0, fx1, fy, fh, f.forward !== false, color));
    parts.push(
      `<text x="${(fx1 + 3).toFixed(1)}" y="${(fy + fh * 0.78).toFixed(1)}" font-size="${(fontPx * 0.85).toFixed(1)}" ` +
        `fill="${INK}">${esc(truncate(f.name, 20))}</text>`,
    );
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
