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
import { featureKey, type SequenceMapStyle } from "./figure-style";
import type { LayoutManifest, PlacedBox } from "@/lib/figure/layout-manifest";

// Re-export so existing importers (the adapter) keep importing from map-render.
export { featureKey, type SequenceMapStyle };

export interface MapSize {
  width: number;
  height: number;
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

/** The visible features under the current style (hidden ones dropped).
 *  Coordinates are clamped to [0, seqLen] as a render-boundary safety net so a
 *  legacy bad value stored on disk (end > seqLen) cannot produce NaN geometry
 *  or an infinite arc sweep that freezes the SVG layout.
 *
 *  Origin-wrapping circular features (start > end, both within [0, seqLen]) are
 *  preserved as-is; only values genuinely outside [0, seqLen] are clamped. */
function visibleFeatures(doc: SeqDocument, style: SequenceMapStyle): EditFeature[] {
  const seqLen = Math.max(1, doc.seq.length);
  return doc.features
    .filter((f) => !style.perFeature?.[featureKey(f)]?.hidden)
    .map((f) => {
      // Clamp each bound independently to [0, seqLen]. Do NOT impose start <= end
      // because a circular feature legitimately has start > end (origin wrap).
      const start = Math.max(0, Math.min(f.start, seqLen));
      const end = Math.max(0, Math.min(f.end, seqLen));
      if (start === f.start && end === f.end) return f;
      return { ...f, start, end };
    });
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

/** The shared circular-map geometry, derived once from the canvas + style so the
 *  draw and the layout manifest never drift. */
interface CircularGeom {
  cx: number;
  cy: number;
  fontPx: number;
  R: number;
  half: number;
  Rin: number;
  Rout: number;
}
function circularGeom(W: number, H: number, style: SequenceMapStyle): CircularGeom {
  const cx = W / 2;
  const cy = H / 2;
  const fontPx = Math.max(7, Math.min(W, H) * 0.028);
  const R = Math.max(8, Math.min(W, H) * 0.3);
  const half = Math.max(2, R * 0.06 * (style.featureScale ?? 1));
  return { cx, cy, fontPx, R, half, Rin: R - half, Rout: R + half };
}

/** One feature label placed in a circular map: its wedge anchor (ax, ay) on the
 *  ring and its de-collided text position (colX, ly) in the side column. Shared by
 *  the draw and the manifest so the leader + text land at identical spots. */
interface CircularLabelPlacement {
  name: string;
  ax: number;
  ay: number;
  colX: number;
  ly: number;
  anchor: "start" | "end";
}

/** The per-side, de-collided feature-label columns of a circular map (the pure
 *  layout the SVG draws from, lifted out so the manifest reads identical numbers). */
function circularLabelPlacements(
  doc: SeqDocument,
  W: number,
  H: number,
  seqLen: number,
  style: SequenceMapStyle,
): CircularLabelPlacement[] {
  const g = circularGeom(W, H, style);
  const ang = (pos: number) => (pos / seqLen) * Math.PI * 2 - Math.PI / 2;
  const pt = (a: number, r: number): [number, number] => [
    g.cx + r * Math.cos(a),
    g.cy + r * Math.sin(a),
  ];
  type Lab = { am: number; name: string };
  const right: Lab[] = [];
  const left: Lab[] = [];
  for (const f of visibleFeatures(doc, style)) {
    const span = featureSpanBp(f, seqLen);
    if (span <= 0) continue;
    const a0 = ang(f.start);
    const a1 = a0 + (span / seqLen) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    (Math.cos(am) >= 0 ? right : left).push({ am, name: f.name });
  }
  const out: CircularLabelPlacement[] = [];
  const place = (side: Lab[], anchor: "start" | "end", colX: number) => {
    const sorted = side.slice().sort((p, q) => pt(p.am, g.Rout)[1] - pt(q.am, g.Rout)[1]);
    const ys = deCollide(
      sorted.map((s) => pt(s.am, g.Rout)[1]),
      g.fontPx * 1.15,
    );
    sorted.forEach((s, i) => {
      const [ax, ay] = pt(s.am, g.Rout);
      out.push({ name: s.name, ax, ay, colX, ly: ys[i], anchor });
    });
  };
  place(right, "start", g.cx + g.Rout + 8);
  place(left, "end", g.cx - g.Rout - 8);
  return out;
}

function circularMap(
  doc: SeqDocument,
  W: number,
  H: number,
  seqLen: number,
  style: SequenceMapStyle,
): string {
  const { cx, cy, fontPx, R, half, Rin, Rout } = circularGeom(W, H, style);
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

  // Feature wedges.
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
  }

  if (showLabels) {
    for (const p of circularLabelPlacements(doc, W, H, seqLen, style)) {
      parts.push(
        `<line x1="${p.ax.toFixed(1)}" y1="${p.ay.toFixed(1)}" x2="${p.colX.toFixed(1)}" y2="${p.ly.toFixed(1)}" stroke="${TICK}" stroke-width="0.75"/>`,
      );
      parts.push(
        `<text x="${p.colX.toFixed(1)}" y="${(p.ly + fontPx * 0.32).toFixed(1)}" font-size="${fontPx.toFixed(1)}" fill="${INK}" text-anchor="${p.anchor}">${esc(truncate(p.name, 16))}</text>`,
      );
    }
  }

  // Center name + length, drawn LAST over a masking backdrop chip. A circular tree
  // can be rotated freely, so any leader / wedge can swing behind the center text --
  // detecting that collision is futile. Instead the callout always wins: a rounded
  // white card sized to the two lines masks whatever passes behind it, so the name +
  // bp stay legible at every rotation. (Grant's fix; rotation-proof, no detection.)
  const nameTrunc = truncate(doc.name, 22);
  const bpStr = `${seqLen} bp`;
  const cardW =
    Math.max(nameTrunc.length * fontPx * 1.05 * 0.56, bpStr.length * fontPx * 0.55) +
    fontPx * 1.4;
  const cardH = fontPx * 3.1;
  parts.push(
    `<rect x="${(cx - cardW / 2).toFixed(1)}" y="${(cy - fontPx * 1.25).toFixed(1)}" width="${cardW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="${(fontPx * 0.5).toFixed(1)}" fill="#ffffff" stroke="${TICK}" stroke-width="0.75"/>`,
  );
  parts.push(
    `<text x="${cx.toFixed(1)}" y="${(cy - 1).toFixed(1)}" font-size="${(fontPx * 1.05).toFixed(1)}" fill="${INK}" text-anchor="middle" font-weight="600">${esc(nameTrunc)}</text>`,
  );
  parts.push(
    `<text x="${cx.toFixed(1)}" y="${(cy + fontPx * 1.3).toFixed(1)}" font-size="${fontPx.toFixed(1)}" fill="${MUTED}" text-anchor="middle">${bpStr}</text>`,
  );
  return parts.join("");
}

/** One feature placed in the linear map: its arrow span + row, and (if shown) its
 *  label. Computed once and consumed by BOTH the SVG draw and the layout manifest,
 *  so the advisor's boxes are the exact numbers the map was drawn from. */
interface LinearFeaturePlacement {
  key: string;
  name: string;
  fx0: number;
  fx1: number;
  fy: number;
  fh: number;
  forward: boolean;
  color: string;
  hasLabel: boolean;
  labelX: number;
  labelY: number;
  labelFont: number;
  labelW: number;
}

interface LinearMapLayout {
  W: number;
  H: number;
  x0: number;
  x1: number;
  baseY: number;
  fontPx: number;
  showTicks: boolean;
  showLabels: boolean;
  title: { x: number; y: number; fontSize: number; text: string };
  ticks: { pos: number; tx: number }[];
  features: LinearFeaturePlacement[];
}

/** The pure linear-map layout: the same lane-packing the draw uses, lifted out so
 *  the manifest can read the identical positions (no drift). */
function linearMapLayout(
  doc: SeqDocument,
  W: number,
  H: number,
  seqLen: number,
  style: SequenceMapStyle,
): LinearMapLayout {
  const margin = Math.max(10, W * 0.06);
  const x0 = margin;
  const x1 = W - margin;
  const usableW = Math.max(1, x1 - x0);
  const fontPx = Math.max(7, Math.min(W, H) * 0.03);
  const baseY = H * 0.66;
  const showTicks = style.showTicks !== false;
  const showLabels = style.showLabels !== false;
  const xOf = (pos: number) => x0 + (pos / seqLen) * usableW;

  const ticks: { pos: number; tx: number }[] = [];
  if (showTicks) {
    const n = 4;
    for (let i = 0; i <= n; i++) {
      const pos = Math.round((seqLen * i) / n);
      ticks.push({ pos, tx: xOf(pos) });
    }
  }

  const fh = Math.max(6, fontPx * 1.1 * (style.featureScale ?? 1));
  const rowH = fh + fontPx * 0.7;
  const rowEnds: number[] = [];
  const features: LinearFeaturePlacement[] = [];
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
    const labelFont = fontPx * 0.85;
    features.push({
      key: featureKey(f),
      name: truncate(f.name, 20),
      fx0,
      fx1,
      fy,
      fh,
      forward: f.forward !== false,
      color: colorOf(f, style),
      hasLabel: showLabels,
      labelX: fx1 + 3,
      labelY: fy + fh * 0.78,
      labelFont,
      labelW: truncate(f.name, 20).length * labelFont * 0.6,
    });
  }

  return {
    W,
    H,
    x0,
    x1,
    baseY,
    fontPx,
    showTicks,
    showLabels,
    title: { x: x0, y: fontPx * 1.6, fontSize: fontPx * 1.1, text: truncate(doc.name, 30) },
    ticks,
    features,
  };
}

function linearMap(
  doc: SeqDocument,
  W: number,
  H: number,
  seqLen: number,
  style: SequenceMapStyle,
): string {
  const L = linearMapLayout(doc, W, H, seqLen, style);
  const parts: string[] = [];
  parts.push(
    `<text x="${L.title.x.toFixed(1)}" y="${L.title.y.toFixed(1)}" font-size="${L.title.fontSize.toFixed(1)}" fill="${INK}" font-weight="600">${esc(L.title.text)}</text>`,
  );
  parts.push(
    `<line x1="${L.x0.toFixed(1)}" y1="${L.baseY.toFixed(1)}" x2="${L.x1.toFixed(1)}" y2="${L.baseY.toFixed(1)}" stroke="${BACKBONE}" stroke-width="1.5"/>`,
  );
  for (const t of L.ticks) {
    parts.push(
      `<line x1="${t.tx.toFixed(1)}" y1="${L.baseY.toFixed(1)}" x2="${t.tx.toFixed(1)}" y2="${(L.baseY + 4).toFixed(1)}" stroke="${BACKBONE}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${t.tx.toFixed(1)}" y="${(L.baseY + 4 + L.fontPx).toFixed(1)}" font-size="${(L.fontPx * 0.8).toFixed(1)}" fill="${MUTED}" text-anchor="middle">${t.pos}</text>`,
    );
  }
  for (const f of L.features) {
    parts.push(featureArrow(f.fx0, f.fx1, f.fy, f.fh, f.forward, f.color));
    if (f.hasLabel) {
      parts.push(
        `<text x="${f.labelX.toFixed(1)}" y="${f.labelY.toFixed(1)}" font-size="${f.labelFont.toFixed(1)}" fill="${INK}">${esc(f.name)}</text>`,
      );
    }
  }
  return parts.join("");
}

/**
 * The layout manifest for a LINEAR sequence map (the collision advisor seam). Emits
 * each feature arrow as a `mark` and its label as a crowdable `tipLabel`, plus the
 * ruler numbers as `axisLabel`, at the EXACT positions the map drew them (shared
 * linearMapLayout). The key signal on a busy plasmid is content-overflow: features
 * lane-pack upward, so a dense map stacks rows off the TOP of the canvas (fy < 0).
 * The circular map has its own builder (buildCircularMapManifest).
 */
export function buildLinearMapManifest(
  doc: SeqDocument,
  size: MapSize,
  style: SequenceMapStyle,
): LayoutManifest {
  const W = Math.max(1, Math.round(size.width));
  const H = Math.max(1, Math.round(size.height));
  const seqLen = Math.max(1, doc.seq.length);
  const L = linearMapLayout(doc, W, H, seqLen, style);
  const boxes: PlacedBox[] = [];
  for (const f of L.features) {
    boxes.push({
      id: `feature:${f.key}`,
      kind: "mark",
      x: f.fx0,
      y: f.fy,
      w: Math.max(1, f.fx1 - f.fx0),
      h: f.fh,
      label: f.name,
    });
    if (f.hasLabel) {
      boxes.push({
        id: `featureLabel:${f.key}`,
        kind: "tipLabel",
        x: f.labelX,
        y: f.labelY - f.labelFont * 0.8,
        w: f.labelW,
        h: f.labelFont,
        label: f.name,
      });
    }
  }
  for (const t of L.ticks) {
    boxes.push({
      id: `ruler:${t.pos}`,
      kind: "axisLabel",
      x: t.tx - L.fontPx,
      y: L.baseY + 4,
      w: L.fontPx * 2,
      h: L.fontPx * 0.8,
      label: String(t.pos),
    });
  }
  return { width: W, height: H, plotRight: L.x1, boxes };
}

/**
 * The layout manifest for a CIRCULAR (plasmid) map. The feature labels self-de-
 * collide per side (left / right of the ring) but are NEVER bounded to the canvas,
 * so a busy plasmid's label column runs off the TOP or BOTTOM (content-overflow,
 * the dominant failure here). Emits each de-collided label as a `tipLabel` at its
 * exact drawn position (shared circularLabelPlacements), the ruler numbers as
 * `axisLabel`, and the center name / length as `content`. (Leader-over-wedge
 * crossings need a line primitive the box engine does not have; not covered in v1.)
 */
export function buildCircularMapManifest(
  doc: SeqDocument,
  size: MapSize,
  style: SequenceMapStyle,
): LayoutManifest {
  const W = Math.max(1, Math.round(size.width));
  const H = Math.max(1, Math.round(size.height));
  const seqLen = Math.max(1, doc.seq.length);
  const g = circularGeom(W, H, style);
  const boxes: PlacedBox[] = [];
  const placements =
    style.showLabels !== false ? circularLabelPlacements(doc, W, H, seqLen, style) : [];
  placements.forEach((p, i) => {
    const w = Math.max(1, truncate(p.name, 16).length * g.fontPx * 0.6);
    boxes.push({
      id: `featureLabel:${i}:${esc(p.name)}`,
      kind: "tipLabel",
      // "end"-anchored (left side) text extends LEFT from colX.
      x: p.anchor === "end" ? p.colX - w : p.colX,
      y: p.ly - g.fontPx * 0.8,
      w,
      h: g.fontPx,
      label: p.name,
    });
  });
  // Center name + length block (informational; a future center-overlap rule).
  const centerChars = Math.max(truncate(doc.name, 22).length, String(seqLen).length + 3);
  const centerW = Math.max(1, centerChars * g.fontPx * 0.6);
  boxes.push({
    id: "center",
    kind: "content",
    x: g.cx - centerW / 2,
    y: g.cy - g.fontPx,
    w: centerW,
    h: g.fontPx * 2.6,
    label: doc.name,
  });
  if (style.showTicks !== false) {
    const Ridx = g.Rin - Math.max(5, g.half);
    for (let i = 0; i < 12; i += 3) {
      const a = ((seqLen * i) / 12 / seqLen) * Math.PI * 2 - Math.PI / 2;
      const lx = g.cx + (Ridx - 11) * Math.cos(a);
      const ly = g.cy + (Ridx - 11) * Math.sin(a);
      const pos = Math.round((seqLen * i) / 12);
      const w = Math.max(1, String(pos).length * g.fontPx * 0.8 * 0.6);
      boxes.push({
        id: `ruler:${pos}`,
        kind: "axisLabel",
        x: lx - w / 2,
        y: ly - g.fontPx * 0.4,
        w,
        h: g.fontPx * 0.8,
        label: String(pos),
      });
    }
  }
  return { width: W, height: H, plotRight: g.cx + g.Rout, boxes };
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
