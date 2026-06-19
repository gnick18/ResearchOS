// The Figure page compositor: turn a FigurePage plus each panel's source-rendered
// SVG into ONE self-contained, publication-exact page SVG (the export). Pure, no
// DOM. Each panel keeps its real-inch size, so the page is vector-exact at any dpi.
//
// Panels are placed as nested <svg> viewports (x/y/width/height set to the panel's
// real-unit box, the panel's own viewBox handles internal scaling), so a panel
// from any surface drops in without re-rendering. Labels (A/B/C) and the 3-tool
// annotation layer draw on top in page coordinates.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  type FigurePage,
  type Annotation,
  type PlacedAsset,
  pageSizeIn,
  assignLabels,
  pageAssets,
  pageConnectors,
  pageShapes,
  TEXT_VARIANT_WEIGHT,
} from "@/lib/figure/figure-page";

/**
 * Build an SVG transform string that applies clockwise rotation and optional
 * horizontal/vertical flip, all about the element's own center. Returns ""
 * when no transform is needed (pure helper, shared by export + canvas layers).
 */
export function elementTransform(
  px: number,
  py: number,
  pw: number,
  ph: number,
  opts: { rotation?: number; flipX?: boolean; flipY?: boolean },
): string {
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  const parts: string[] = [];
  if (opts.rotation) parts.push(`rotate(${opts.rotation} ${cx.toFixed(2)} ${cy.toFixed(2)})`);
  const sx = opts.flipX ? -1 : 1;
  const sy = opts.flipY ? -1 : 1;
  if (sx !== 1 || sy !== 1) {
    // Translate to center, scale, translate back.
    parts.push(
      `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${sx} ${sy}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`,
    );
  }
  return parts.join(" ");
}
import { missingPanelSvg } from "@/lib/figure/figure-source";
import { connectorEndpoints, connectorPath, type Point } from "@/lib/figure/figure-connectors";

/**
 * The <defs> (arrowhead markers) the annotation layer needs. Shared by the
 * export compositor and the on-screen annotation overlay so they draw identically.
 */
export function annotationDefs(): string {
  return (
    `<defs>` +
    `<marker id="fp-ah" markerWidth="9" markerHeight="9" refX="6" refY="4" orient="auto">` +
    `<path d="M0,0 L9,4 L0,8 z" fill="#0f172a"/></marker>` +
    `<marker id="fp-ah-s" markerWidth="9" markerHeight="9" refX="3" refY="4" orient="auto">` +
    `<path d="M9,0 L0,4 L9,8 z" fill="#0f172a"/></marker>` +
    `</defs>`
  );
}

/**
 * Draw ONE annotation at `ppi` px per inch, in page coordinates. Pure, returns an
 * SVG fragment. Shared by the export compositor and the on-screen overlay so an
 * annotation looks identical on screen and in the exported file.
 */
export function annotationToSvg(a: Annotation, ppi: number): string {
  if (a.kind === "text") {
    const fs = (a.fontPt * ppi) / 72;
    const weight = TEXT_VARIANT_WEIGHT[a.variant ?? "label"];
    return (
      `<text x="${(a.xIn * ppi).toFixed(1)}" y="${(a.yIn * ppi).toFixed(1)}" ` +
      `font-size="${fs.toFixed(1)}" font-weight="${weight}" fill="#0f172a">${esc(a.text)}</text>`
    );
  }
  if (a.kind === "arrow") {
    const x1 = (a.x1In * ppi).toFixed(1);
    const y1 = (a.y1In * ppi).toFixed(1);
    const x2 = (a.x2In * ppi).toFixed(1);
    const y2 = (a.y2In * ppi).toFixed(1);
    const start = a.heads === 2 ? ` marker-start="url(#fp-ah-s)"` : "";
    const end = a.heads >= 1 ? ` marker-end="url(#fp-ah)"` : "";
    return (
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0f172a" ` +
      `stroke-width="${Math.max(1, 0.02 * ppi).toFixed(1)}"${start}${end}/>`
    );
  }
  // bracket (horizontal or vertical), optional label = significance marker.
  const x = a.xIn * ppi;
  const y = a.yIn * ppi;
  const span = a.spanIn * ppi;
  const tick = Math.max(4, 0.06 * ppi);
  const sw = Math.max(1, 0.018 * ppi).toFixed(1);
  const fs = Math.max(9, 0.14 * ppi).toFixed(1);
  if (a.orientation === "horizontal") {
    let out =
      `<path d="M${x.toFixed(1)},${(y + tick).toFixed(1)} V${y.toFixed(1)} ` +
      `H${(x + span).toFixed(1)} V${(y + tick).toFixed(1)}" fill="none" stroke="#0f172a" stroke-width="${sw}"/>`;
    if (a.label) {
      out +=
        `<text x="${(x + span / 2).toFixed(1)}" y="${(y - tick * 0.4).toFixed(1)}" ` +
        `font-size="${fs}" fill="#0f172a" text-anchor="middle">${esc(a.label)}</text>`;
    }
    return out;
  }
  let out =
    `<path d="M${(x + tick).toFixed(1)},${y.toFixed(1)} H${x.toFixed(1)} ` +
    `V${(y + span).toFixed(1)} H${(x + tick).toFixed(1)}" fill="none" stroke="#0f172a" stroke-width="${sw}"/>`;
  if (a.label) {
    out +=
      `<text x="${(x - tick * 0.4).toFixed(1)}" y="${(y + span / 2).toFixed(1)}" ` +
      `font-size="${fs}" fill="#0f172a" text-anchor="end">${esc(a.label)}</text>`;
  }
  return out;
}

export interface ComposeOpts {
  /** Output px per inch (export dpi, e.g. 300, or a screen scale like 96). */
  pxPerInch: number;
  /** The source-rendered SVG per panelId, fetched by the caller from the sources. */
  panelSvgs: Map<string, string>;
  /** The raw SVG per placed-asset assetId, fetched by the caller from the CDN. */
  assetSvgs?: Map<string, string>;
}

/**
 * The placed-asset layer as one standalone SVG string, for the on-screen overlay
 * (the export embeds the same fragments via composeFigurePageSvg, so they match).
 * `assetSvgs` maps assetId to its raw SVG; a missing one simply draws nothing.
 */
export function assetLayerSvg(
  page: FigurePage,
  ppi: number,
  assetSvgs: Map<string, string>,
): string {
  const { wIn, hIn } = pageSizeIn(page);
  const W = (wIn * ppi).toFixed(1);
  const H = (hIn * ppi).toFixed(1);
  const body = pageAssets(page)
    .map((a) => {
      const svg = assetSvgs.get(a.assetId);
      return svg ? placeAssetSvg(a, svg, ppi) : "";
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}">${body}</svg>`
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Re-anchor a self-contained panel SVG as a nested viewport at (px, py) sized
 * (pw, ph). Strips any width/height/x/y on the opening tag and sets ours; the
 * panel's own viewBox does the internal scaling. Falls back to wrapping when the
 * string is not a recognizable <svg ...> (keeps the compositor crash-free).
 */
function placeSvg(svg: string, px: number, py: number, pw: number, ph: number): string {
  const m = svg.match(/^\s*<svg\b([^>]*)>/i);
  if (!m) {
    return `<svg x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${pw.toFixed(2)}" height="${ph.toFixed(2)}">${svg}</svg>`;
  }
  const attrs = m[1]
    .replace(/\s(?:width|height|x|y)="[^"]*"/gi, "")
    .trim();
  const head =
    `<svg ${attrs} x="${px.toFixed(2)}" y="${py.toFixed(2)}" ` +
    `width="${pw.toFixed(2)}" height="${ph.toFixed(2)}">`;
  return svg.replace(/^\s*<svg\b[^>]*>/i, head);
}

/**
 * Recolor every concrete fill in an SVG to one tint (single-tint recolor). Leaves
 * `fill="none"` alone so outlines/holes stay. Per-fill targeting comes later; this
 * is the whole-asset tint a placed icon uses. Pure string transform.
 */
/**
 * Recolor an SVG. A string `tint` recolors the WHOLE icon (single-tint). A map
 * recolors PER FILL: each key is an original fill value (as returned by
 * extractFills) and only those fills are replaced, so multi-part icons can be
 * recolored piece by piece. `none` fills are always left alone.
 */
export function tintSvg(svg: string, tint: string | Record<string, string>): string {
  if (typeof tint === "string") {
    return svg
      .replace(/fill="(?!none")[^"]*"/gi, `fill="${tint}"`)
      .replace(/fill:\s*(?!none)[^;"']+/gi, `fill:${tint}`);
  }
  return svg
    .replace(/fill="([^"]*)"/gi, (full, v: string) => {
      const next = tint[v.trim()];
      return next ? `fill="${next}"` : full;
    })
    .replace(/fill:\s*([^;"']+)/gi, (full, v: string) => {
      const next = tint[v.trim()];
      return next ? `fill:${next}` : full;
    });
}

/** Distinct fill colors in an SVG (excluding `none`), in document order. */
export function extractFills(svg: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const v = raw.trim();
    if (v && v.toLowerCase() !== "none" && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  for (const m of svg.matchAll(/fill="([^"]*)"/gi)) push(m[1]);
  for (const m of svg.matchAll(/fill:\s*([^;"']+)/gi)) push(m[1]);
  return out;
}

/** The display SVG for a placed asset: per-fill recolor, else whole tint, else raw. */
export function recolorPlacedAsset(svg: string, a: PlacedAsset): string {
  if (a.isLogo) return svg; // trademark logos keep their original brand colors
  if (a.fillTints && Object.keys(a.fillTints).length > 0) return tintSvg(svg, a.fillTints);
  if (a.tint) return tintSvg(svg, a.tint);
  return svg;
}

/**
 * Place an asset SVG as a nested viewport at (px, py) sized (pw, ph), with an
 * optional tint, clockwise rotation, and H/V flip about its own center. Reuses
 * placeSvg for the viewport so the asset's own viewBox handles internal scaling.
 */
function placeAssetSvg(a: PlacedAsset, svg: string, ppi: number): string {
  const px = a.xIn * ppi;
  const py = a.yIn * ppi;
  const pw = a.wIn * ppi;
  const ph = a.hIn * ppi;
  const tinted = recolorPlacedAsset(svg, a);
  const inner = placeSvg(tinted, px, py, pw, ph);
  const tf = elementTransform(px, py, pw, ph, { rotation: a.rotation, flipX: a.flipX, flipY: a.flipY });
  if (!tf) return inner;
  return `<g transform="${tf}">${inner}</g>`;
}

/**
 * The annotation layer as one standalone SVG string, for the on-screen overlay
 * (the export embeds the same fragments via composeFigurePageSvg, so they match).
 * Built here in lib so the composer component carries no inline SVG of its own.
 */
export function annotationLayerSvg(page: FigurePage, ppi: number): string {
  const { wIn, hIn } = pageSizeIn(page);
  const W = (wIn * ppi).toFixed(1);
  const H = (hIn * ppi).toFixed(1);
  const body = page.annotations.filter((a) => !a.hidden).map((a) => annotationToSvg(a, ppi)).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}">${annotationDefs()}${body}</svg>`
  );
}

/** Shapes (rectangles / ellipses) as SVG, in page coordinates. Skips hidden shapes. */
export function shapesToSvg(page: FigurePage, ppi: number): string {
  return pageShapes(page)
    .filter((s) => !s.hidden)
    .map((s) => {
      const fill = s.fill === "none" ? "none" : s.fill;
      const stroke = s.stroke === "none" ? "none" : s.stroke;
      const sw = ((s.strokeWPt * ppi) / 72).toFixed(2);
      const common = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`;
      const px = s.xIn * ppi;
      const py = s.yIn * ppi;
      const pw = s.wIn * ppi;
      const ph = s.hIn * ppi;
      const tf = elementTransform(px, py, pw, ph, { rotation: s.rotation, flipX: s.flipX, flipY: s.flipY });
      let shape: string;
      if (s.kind === "ellipse") {
        const cx = (px + pw / 2).toFixed(1);
        const cy = (py + ph / 2).toFixed(1);
        const rx = (pw / 2).toFixed(1);
        const ry = (ph / 2).toFixed(1);
        shape = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${common}/>`;
      } else {
        shape = `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="2" ${common}/>`;
      }
      return tf ? `<g transform="${tf}">${shape}</g>` : shape;
    })
    .join("");
}

/** Arrowhead marker for connectors (follows each path's stroke via context-stroke). */
export function connectorArrowMarker(): string {
  return (
    `<marker id="fc-arrow" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">` +
    `<path d="M0 0 L6 3 L0 6 z" fill="context-stroke" /></marker>`
  );
}

/** The connector path elements (no <svg> wrapper). interactive adds fat hit paths. */
export function connectorsToSvg(
  page: FigurePage,
  ppi: number,
  opts: { selectedConn?: string | null; interactive?: boolean } = {},
): string {
  const parts: string[] = [];
  for (const c of pageConnectors(page)) {
    const ep = connectorEndpoints(page, c);
    if (!ep) continue;
    const a: Point = { xIn: ep.from.xIn * ppi, yIn: ep.from.yIn * ppi };
    const b: Point = { xIn: ep.to.xIn * ppi, yIn: ep.to.yIn * ppi };
    const d = connectorPath(a, b, c.shape);
    const seld = opts.selectedConn === c.connId;
    const w = Math.max(1, (c.weightPt * ppi) / 72);
    const me = c.heads >= 1 ? ` marker-end="url(#fc-arrow)"` : "";
    const ms = c.heads === 2 ? ` marker-start="url(#fc-arrow)"` : "";
    if (opts.interactive) {
      parts.push(
        `<path d="${d}" fill="none" stroke="transparent" stroke-width="${Math.max(10, w + 8).toFixed(1)}" ` +
          `data-conn-id="${c.connId}" style="pointer-events:stroke;cursor:pointer" />`,
      );
    }
    parts.push(
      `<path d="${d}" fill="none" stroke="${seld ? "#7c5cff" : c.color}" ` +
        `stroke-width="${(seld ? w + 0.5 : w).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round" ` +
        `style="pointer-events:none"${me}${ms} />`,
    );
  }
  return parts.join("");
}

/** The on-screen connector layer (injected string; interactive hit paths + rubber). */
export function connectorLayerSvg(
  page: FigurePage,
  ppi: number,
  opts: { selectedConn?: string | null; rubber?: { from: Point; to: Point } | null } = {},
): string {
  const { wIn, hIn } = pageSizeIn(page);
  const W = (wIn * ppi).toFixed(1);
  const H = (hIn * ppi).toFixed(1);
  let rubber = "";
  if (opts.rubber) {
    const r = opts.rubber;
    rubber =
      `<line x1="${(r.from.xIn * ppi).toFixed(1)}" y1="${(r.from.yIn * ppi).toFixed(1)}" ` +
      `x2="${(r.to.xIn * ppi).toFixed(1)}" y2="${(r.to.yIn * ppi).toFixed(1)}" ` +
      `stroke="#7c5cff" stroke-width="1.5" stroke-dasharray="4 3" style="pointer-events:none" />`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs>${connectorArrowMarker()}</defs>` +
    connectorsToSvg(page, ppi, { selectedConn: opts.selectedConn, interactive: true }) +
    rubber +
    `</svg>`
  );
}

/** Compose the whole page into one SVG string. */
export function composeFigurePageSvg(page: FigurePage, opts: ComposeOpts): string {
  const ppi = opts.pxPerInch;
  const { wIn, hIn } = pageSizeIn(page);
  const W = wIn * ppi;
  const H = hIn * ppi;
  const labels = assignLabels(page);

  const parts: string[] = [
    `<svg width="${W.toFixed(1)}" height="${H.toFixed(1)}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" ` +
      `xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, Inter, system-ui, sans-serif">`,
  ];

  // Arrowhead markers, used by arrow annotations + smart connectors.
  parts.push(annotationDefs());
  parts.push(`<defs>${connectorArrowMarker()}</defs>`);

  // The page sheet.
  parts.push(`<rect x="0" y="0" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="#ffffff"/>`);

  // Shapes (rectangles / ellipses), below the panels as backgrounds.
  parts.push(shapesToSvg(page, ppi));

  // Panels, each as a positioned nested viewport, plus its label. Skip hidden.
  const labelPx = Math.max(9, 0.16 * ppi);
  for (const p of page.panels) {
    if (p.hidden) continue;
    const px = p.xIn * ppi;
    const py = p.yIn * ppi;
    const pw = p.wIn * ppi;
    const ph = p.hIn * ppi;
    const svg = opts.panelSvgs.get(p.panelId) ?? missingPanelSvg(p.wIn, p.hIn).svg;
    const placed = placeSvg(svg, px, py, pw, ph);
    const tf = elementTransform(px, py, pw, ph, { flipX: p.flipX, flipY: p.flipY });
    parts.push(tf ? `<g transform="${tf}">${placed}</g>` : placed);
    const lab = labels.get(p.panelId);
    if (lab) {
      parts.push(
        `<text x="${(px + labelPx * 0.2).toFixed(1)}" y="${(py + labelPx).toFixed(1)}" ` +
          `font-size="${labelPx.toFixed(1)}" font-weight="700" fill="#0f172a">${esc(lab)}</text>`,
      );
    }
  }

  // Placed-asset layer (icons / illustrations), above panels, below annotations. Skip hidden.
  const assetSvgs = opts.assetSvgs;
  if (assetSvgs) {
    for (const a of pageAssets(page)) {
      if (a.hidden) continue;
      const svg = assetSvgs.get(a.assetId);
      if (svg) parts.push(placeAssetSvg(a, svg, ppi));
    }
  }

  // Smart-connector layer (element-anchored), above panels + icons.
  parts.push(connectorsToSvg(page, ppi, { interactive: false }));

  // Annotation layer (page coordinates), drawn by the shared renderer. Skip hidden.
  for (const a of page.annotations) {
    if (a.hidden) continue;
    parts.push(annotationToSvg(a, ppi));
  }

  parts.push(`</svg>`);
  return parts.join("");
}
