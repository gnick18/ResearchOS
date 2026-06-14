// The Figure page document model + pure layout helpers. A Figure page composes
// several figures (from any FigureSource) onto one real publication page, with
// auto panel labels, an annotation layer, and a snap-to-grid arrange. Reuses the
// artboard paper / page-dims math (artboard.ts). Pure data, no DOM, no rendering.
//
// Decisions locked 2026-06-14 (see the proposal section 12):
//  - labels: user picks ABC / abc / 123 / none (labelStyle on the page).
//  - layout: free drag by default + snapToGrid() (undo is the prior page).
//  - sizing: each panel independent; snapToGrid takes "align" (keep sizes) or
//    "resize" (fit the cells).
//  - panels are live references ({ type, id }) + optional per-panel overrides.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  type ArtboardState,
  DEFAULT_ARTBOARD_STATE,
  pageDims,
} from "@/lib/figure/artboard";

/** How panels are tagged for the figure caption. User-pickable per page. */
export type LabelStyle = "ABC" | "abc" | "123" | "none";

/** Composition-local tweaks that never mutate the source figure. */
export interface PanelOverride {
  hideTitle?: boolean;
  hideLegend?: boolean;
}

/** One panel: a live reference to a figure, placed in real inches on the page. */
export interface FigurePanel {
  panelId: string;
  /** The FigureSource type + the figure id (resolved live at render). */
  ref: { type: string; id: string };
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  /** Explicit label override; when absent the label is auto-assigned by order. */
  label?: string;
  overrides?: PanelOverride;
}

/** The 3-tool annotation set (Text, Arrow with head toggle, Bracket with label). */
export type Annotation =
  | { annId: string; kind: "text"; xIn: number; yIn: number; text: string; fontPt: number }
  | {
      annId: string;
      kind: "arrow";
      x1In: number;
      y1In: number;
      x2In: number;
      y2In: number;
      /** 0 heads = a plain line, 1 = arrow, 2 = double arrow. */
      heads: 0 | 1 | 2;
    }
  | {
      annId: string;
      kind: "bracket";
      xIn: number;
      yIn: number;
      spanIn: number;
      orientation: "horizontal" | "vertical";
      /** Empty = a grouping bracket; "**" / "p = 0.03" = a significance marker. */
      label?: string;
    };

/** A composed publication page. Stored as its own document, collection-scoped. */
export interface FigurePage {
  id: string;
  name: string;
  collectionId: string | null;
  /** Paper / orientation / rulers, reusing the artboard state (always enabled). */
  paper: ArtboardState;
  labelStyle: LabelStyle;
  panels: FigurePanel[];
  annotations: Annotation[];
}

/** Page margin (inches) kept clear of panels for the grid + a tidy frame. */
export const PAGE_MARGIN_IN = 0.5;
/** Gap between grid cells (inches). */
export const GRID_GAP_IN = 0.25;

/** A fresh empty page (Letter portrait, ABC labels). */
export function createFigurePage(
  id: string,
  name: string,
  collectionId: string | null,
): FigurePage {
  return {
    id,
    name,
    collectionId,
    paper: { ...DEFAULT_ARTBOARD_STATE, enabled: true },
    labelStyle: "ABC",
    panels: [],
    annotations: [],
  };
}

/** The page size in inches, resolved for paper + orientation. */
export function pageSizeIn(page: FigurePage): { wIn: number; hIn: number } {
  const d = pageDims(page.paper);
  return { wIn: d.wIn, hIn: d.hIn };
}

/**
 * Panels in reading order (top row first, then left to right). Used for auto
 * labels and for grid placement, so dragging a panel above another re-flows both.
 * Rows are bucketed with a tolerance so near-aligned panels count as one row.
 */
export function orderedPanels(panels: FigurePanel[]): FigurePanel[] {
  const ROW_TOL = 0.4; // inches
  return [...panels].sort((a, b) => {
    if (Math.abs(a.yIn - b.yIn) > ROW_TOL) return a.yIn - b.yIn;
    return a.xIn - b.xIn;
  });
}

/** The label for the i-th panel under a style ("" for none). */
export function panelLabel(index: number, style: LabelStyle): string {
  if (style === "none") return "";
  if (style === "abc") return String.fromCharCode(97 + index);
  if (style === "123") return String(index + 1);
  return String.fromCharCode(65 + index);
}

/** Auto labels by reading order, with any explicit per-panel label winning. */
export function assignLabels(page: FigurePage): Map<string, string> {
  const out = new Map<string, string>();
  orderedPanels(page.panels).forEach((p, i) => {
    out.set(p.panelId, p.label ?? panelLabel(i, page.labelStyle));
  });
  return out;
}

/** A near-square grid (rows x cols) that holds n panels. */
export function gridFor(n: number): { rows: number; cols: number } {
  if (n <= 0) return { rows: 1, cols: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { rows, cols };
}

/** Add a panel, sized to fit a default cell, aspect-aware when known. */
export function addPanel(
  page: FigurePage,
  ref: { type: string; id: string },
  panelId: string,
  naturalAspect = 1.25,
): FigurePage {
  const { wIn } = pageSizeIn(page);
  const usableW = wIn - 2 * PAGE_MARGIN_IN;
  const defaultW = Math.min(usableW / 2 - GRID_GAP_IN / 2, 3.2);
  const defaultH = defaultW / Math.max(0.2, naturalAspect);
  const i = page.panels.length;
  const col = i % 2;
  const row = Math.floor(i / 2);
  const panel: FigurePanel = {
    panelId,
    ref,
    xIn: PAGE_MARGIN_IN + col * (defaultW + GRID_GAP_IN),
    yIn: PAGE_MARGIN_IN + row * (defaultH + GRID_GAP_IN + 0.2),
    wIn: defaultW,
    hIn: defaultH,
  };
  return { ...page, panels: [...page.panels, panel] };
}

/** Remove a panel by id. */
export function removePanel(page: FigurePage, panelId: string): FigurePage {
  return { ...page, panels: page.panels.filter((p) => p.panelId !== panelId) };
}

/**
 * Arrange every panel into a clean grid (reading order). The caller keeps the
 * prior page for undo, the locked behavior. `mode` is the decision-4 sub-choice:
 *  - "resize": each panel is resized to fill its cell (aspect ignored, even grid).
 *  - "align": each panel keeps its own size, centered in its cell (positions only).
 */
export function snapToGrid(page: FigurePage, mode: "align" | "resize"): FigurePage {
  const ordered = orderedPanels(page.panels);
  const n = ordered.length;
  if (n === 0) return page;
  const { rows, cols } = gridFor(n);
  const { wIn, hIn } = pageSizeIn(page);
  const usableW = wIn - 2 * PAGE_MARGIN_IN;
  const usableH = hIn - 2 * PAGE_MARGIN_IN;
  const cellW = (usableW - (cols - 1) * GRID_GAP_IN) / cols;
  const cellH = (usableH - (rows - 1) * GRID_GAP_IN) / rows;

  const byId = new Map(page.panels.map((p) => [p.panelId, p]));
  ordered.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = PAGE_MARGIN_IN + col * (cellW + GRID_GAP_IN);
    const cellY = PAGE_MARGIN_IN + row * (cellH + GRID_GAP_IN);
    const cur = byId.get(p.panelId)!;
    if (mode === "resize") {
      byId.set(p.panelId, { ...cur, xIn: cellX, yIn: cellY, wIn: cellW, hIn: cellH });
    } else {
      // Keep the panel's size, center it in the cell (clamped to the cell).
      const w = Math.min(cur.wIn, cellW);
      const h = Math.min(cur.hIn, cellH);
      byId.set(p.panelId, {
        ...cur,
        xIn: cellX + (cellW - w) / 2,
        yIn: cellY + (cellH - h) / 2,
      });
    }
  });
  // Preserve original array order, updated in place.
  return { ...page, panels: page.panels.map((p) => byId.get(p.panelId)!) };
}
