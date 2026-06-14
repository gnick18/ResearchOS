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

import { type FigurePage, pageSizeIn, assignLabels } from "@/lib/figure/figure-page";
import { missingPanelSvg } from "@/lib/figure/figure-source";

export interface ComposeOpts {
  /** Output px per inch (export dpi, e.g. 300, or a screen scale like 96). */
  pxPerInch: number;
  /** The source-rendered SVG per panelId, fetched by the caller from the sources. */
  panelSvgs: Map<string, string>;
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

  // Arrowhead markers, used by arrow annotations.
  parts.push(
    `<defs>` +
      `<marker id="fp-ah" markerWidth="9" markerHeight="9" refX="6" refY="4" orient="auto">` +
      `<path d="M0,0 L9,4 L0,8 z" fill="#0f172a"/></marker>` +
      `<marker id="fp-ah-s" markerWidth="9" markerHeight="9" refX="3" refY="4" orient="auto">` +
      `<path d="M9,0 L0,4 L9,8 z" fill="#0f172a"/></marker>` +
      `</defs>`,
  );

  // The page sheet.
  parts.push(`<rect x="0" y="0" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="#ffffff"/>`);

  // Panels, each as a positioned nested viewport, plus its label.
  const labelPx = Math.max(9, 0.16 * ppi);
  for (const p of page.panels) {
    const px = p.xIn * ppi;
    const py = p.yIn * ppi;
    const pw = p.wIn * ppi;
    const ph = p.hIn * ppi;
    const svg = opts.panelSvgs.get(p.panelId) ?? missingPanelSvg(p.wIn, p.hIn).svg;
    parts.push(placeSvg(svg, px, py, pw, ph));
    const lab = labels.get(p.panelId);
    if (lab) {
      parts.push(
        `<text x="${(px + labelPx * 0.2).toFixed(1)}" y="${(py + labelPx).toFixed(1)}" ` +
          `font-size="${labelPx.toFixed(1)}" font-weight="700" fill="#0f172a">${esc(lab)}</text>`,
      );
    }
  }

  // Annotation layer (page coordinates).
  for (const a of page.annotations) {
    if (a.kind === "text") {
      const fs = (a.fontPt * ppi) / 72;
      parts.push(
        `<text x="${(a.xIn * ppi).toFixed(1)}" y="${(a.yIn * ppi).toFixed(1)}" ` +
          `font-size="${fs.toFixed(1)}" fill="#0f172a">${esc(a.text)}</text>`,
      );
    } else if (a.kind === "arrow") {
      const x1 = (a.x1In * ppi).toFixed(1);
      const y1 = (a.y1In * ppi).toFixed(1);
      const x2 = (a.x2In * ppi).toFixed(1);
      const y2 = (a.y2In * ppi).toFixed(1);
      const start = a.heads === 2 ? ` marker-start="url(#fp-ah-s)"` : "";
      const end = a.heads >= 1 ? ` marker-end="url(#fp-ah)"` : "";
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0f172a" stroke-width="${Math.max(1, 0.02 * ppi).toFixed(1)}"${start}${end}/>`,
      );
    } else {
      // bracket (horizontal or vertical), optional label = significance marker.
      const x = a.xIn * ppi;
      const y = a.yIn * ppi;
      const span = a.spanIn * ppi;
      const tick = Math.max(4, 0.06 * ppi);
      const sw = Math.max(1, 0.018 * ppi).toFixed(1);
      if (a.orientation === "horizontal") {
        parts.push(
          `<path d="M${x.toFixed(1)},${(y + tick).toFixed(1)} V${y.toFixed(1)} H${(x + span).toFixed(1)} V${(y + tick).toFixed(1)}" ` +
            `fill="none" stroke="#0f172a" stroke-width="${sw}"/>`,
        );
        if (a.label) {
          parts.push(
            `<text x="${(x + span / 2).toFixed(1)}" y="${(y - tick * 0.4).toFixed(1)}" font-size="${Math.max(9, 0.14 * ppi).toFixed(1)}" fill="#0f172a" text-anchor="middle">${esc(a.label)}</text>`,
          );
        }
      } else {
        parts.push(
          `<path d="M${(x + tick).toFixed(1)},${y.toFixed(1)} H${x.toFixed(1)} V${(y + span).toFixed(1)} H${(x + tick).toFixed(1)}" ` +
            `fill="none" stroke="#0f172a" stroke-width="${sw}"/>`,
        );
        if (a.label) {
          parts.push(
            `<text x="${(x - tick * 0.4).toFixed(1)}" y="${(y + span / 2).toFixed(1)}" font-size="${Math.max(9, 0.14 * ppi).toFixed(1)}" fill="#0f172a" text-anchor="end">${esc(a.label)}</text>`,
          );
        }
      }
    }
  }

  parts.push(`</svg>`);
  return parts.join("");
}
