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
import type { PanelStyle } from "@/lib/figure/figure-source";

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
  /** Per-panel content style (recolor / hide elements, source-specific options). */
  style?: PanelStyle;
  // ── QoL Tier-1 additions (all optional, defaults preserve old docs) ──────
  /** Shared group tag (flat, no nesting). Absent = ungrouped. */
  groupId?: string;
  /** Mirror horizontally about the element center. */
  flipX?: boolean;
  /** Mirror vertically about the element center. */
  flipY?: boolean;
  /** Locked elements cannot be selected, moved, or resized. */
  locked?: boolean;
  /** Hidden elements are not rendered on the canvas and excluded from export. */
  hidden?: boolean;
}

/** Semantic text styles (Heading / Label / Body), the science-text presets. */
export type TextVariant = "heading" | "label" | "body";
export const TEXT_VARIANT_PT: Record<TextVariant, number> = { heading: 18, label: 12, body: 10 };
export const TEXT_VARIANT_WEIGHT: Record<TextVariant, number> = {
  heading: 700,
  label: 600,
  body: 400,
};

/** Shared QoL Tier-1 fields on every element kind. */
export interface ElementQoL {
  /** Shared group tag (flat, no nesting). Absent = ungrouped. */
  groupId?: string;
  /** Mirror horizontally about the element center. */
  flipX?: boolean;
  /** Mirror vertically about the element center. */
  flipY?: boolean;
  /** Locked elements cannot be selected, moved, or resized. */
  locked?: boolean;
  /** Hidden elements are not rendered on the canvas and excluded from export. */
  hidden?: boolean;
}

/** The 3-tool annotation set (Text, Arrow with head toggle, Bracket with label). */
export type Annotation =
  | ({
      annId: string;
      kind: "text";
      xIn: number;
      yIn: number;
      text: string;
      fontPt: number;
      /** Semantic style. Absent on legacy text annotations (treated as label). */
      variant?: TextVariant;
    } & ElementQoL)
  | ({
      annId: string;
      kind: "arrow";
      x1In: number;
      y1In: number;
      x2In: number;
      y2In: number;
      /** 0 heads = a plain line, 1 = arrow, 2 = double arrow. */
      heads: 0 | 1 | 2;
    } & ElementQoL)
  | ({
      annId: string;
      kind: "bracket";
      xIn: number;
      yIn: number;
      spanIn: number;
      orientation: "horizontal" | "vertical";
      /** Empty = a grouping bracket; "**" / "p = 0.03" = a significance marker. */
      label?: string;
    } & ElementQoL);

/**
 * A placed library asset (a science icon / illustration from the open-asset
 * federation). Unlike a panel (a live data figure with an A/B/C label), an asset
 * is a lightweight decorative graphic: positioned in real inches, freely sized,
 * optionally tinted. Its provenance (credit + whether attribution is required) is
 * cached at place-time so export + the credits block need no live fetch.
 */
export interface PlacedAsset {
  assetId: string;
  /** Which library asset this instance draws (source + id within the source). */
  ref: { source: string; sourceId: string };
  /** Relative SVG path in the asset bundle, cached so render resolves the URL. */
  svgPath: string;
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  /** Clockwise rotation in degrees (0 = upright). */
  rotation?: number;
  /** Single-color tint applied to the whole asset (overridden by fillTints). */
  tint?: string;
  /** Per-fill recolor map: original fill value -> replacement. Multi-part icons
   *  recolored piece by piece. When non-empty it takes precedence over `tint`. */
  fillTints?: Record<string, string>;
  /** The verbatim citation, cached at place-time for the auto-credits block. */
  credit: string;
  /** Whether the license requires the credit be shown (CC-BY / SA / MIT / BSD). */
  requiresAttribution: boolean;
  // ── QoL Tier-1 additions (all optional, defaults preserve old docs) ──────
  /** Shared group tag (flat, no nesting). Absent = ungrouped. */
  groupId?: string;
  /** Mirror horizontally about the element center. */
  flipX?: boolean;
  /** Mirror vertically about the element center. */
  flipY?: boolean;
  /** Locked elements cannot be selected, moved, or resized. */
  locked?: boolean;
  /** Hidden elements are not rendered on the canvas and excluded from export. */
  hidden?: boolean;
}

// ── Smart connectors (Phase 2) ────────────────────────────────────────────────
// A connector is an arrow/line whose ENDS ATTACH TO ELEMENTS (panels, icons,
// annotations) rather than to absolute coordinates. Each end stores a ref + a
// side; the on-screen path is resolved live from the elements' current boxes, so
// moving an element auto-reroutes the line. This is the BioRender signature.

export type ConnectorSide = "top" | "right" | "bottom" | "left";
export type ConnectorShape = "straight" | "elbow" | "curve";

/** One end of a connector: which element it attaches to, and on which side. */
export interface ConnectorEnd {
  ref: { kind: "panel" | "asset" | "annotation" | "shape"; id: string };
  side: ConnectorSide;
}

export interface Connector {
  connId: string;
  from: ConnectorEnd;
  to: ConnectorEnd;
  shape: ConnectorShape;
  /** 0 = plain line, 1 = arrowhead at `to`, 2 = arrowheads at both ends. */
  heads: 0 | 1 | 2;
  color: string;
  weightPt: number;
}

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
  /** Placed library assets (icons / illustrations). Absent on pre-asset pages. */
  assets?: PlacedAsset[];
  /** Smart connectors (element-anchored arrows). Absent on pre-connector pages. */
  connectors?: Connector[];
  /** Vector primitives (rectangles / ellipses). Absent on pre-shape pages. */
  shapes?: FigureShape[];
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

/** Deep-merge a partial style patch into one panel's style (recolor / hide / options). */
export function setPanelStyle(page: FigurePage, panelId: string, patch: PanelStyle): FigurePage {
  return {
    ...page,
    panels: page.panels.map((p) => {
      if (p.panelId !== panelId) return p;
      const prev = p.style ?? {};
      return {
        ...p,
        style: {
          targets: { ...prev.targets, ...patch.targets },
          options: { ...prev.options, ...patch.options },
        },
      };
    }),
  };
}

/** Patch ONE target's override (recolor / hide) within a panel's style. */
export function setPanelTarget(
  page: FigurePage,
  panelId: string,
  key: string,
  patch: { color?: string; hidden?: boolean },
): FigurePage {
  return {
    ...page,
    panels: page.panels.map((p) => {
      if (p.panelId !== panelId) return p;
      const prevTargets = p.style?.targets ?? {};
      return {
        ...p,
        style: {
          ...p.style,
          targets: { ...prevTargets, [key]: { ...prevTargets[key], ...patch } },
        },
      };
    }),
  };
}

/**
 * Clamp every panel into the current page's usable area, shrinking a panel
 * PROPORTIONALLY (aspect preserved) only when it no longer fits. Run this after
 * the paper changes (e.g. Letter -> a shorter Slide 16:9), so a panel that used
 * to fit never hangs off the new canvas. Returns the same object when nothing
 * moved, so it is cheap to call on every paper change. Pure.
 */
export function fitPanelsToPage(page: FigurePage): FigurePage {
  const { wIn, hIn } = pageSizeIn(page);
  const usableW = Math.max(0.1, wIn - 2 * PAGE_MARGIN_IN);
  const usableH = Math.max(0.1, hIn - 2 * PAGE_MARGIN_IN);
  let changed = false;
  const panels = page.panels.map((p) => {
    const fit = Math.min(1, usableW / p.wIn, usableH / p.hIn);
    const w = p.wIn * fit;
    const h = p.hIn * fit;
    // Keep the panel on the page: its far edge cannot pass the bottom/right margin.
    const x = Math.min(Math.max(PAGE_MARGIN_IN, p.xIn), wIn - PAGE_MARGIN_IN - w);
    const y = Math.min(Math.max(PAGE_MARGIN_IN, p.yIn), hIn - PAGE_MARGIN_IN - h);
    if (w === p.wIn && h === p.hIn && x === p.xIn && y === p.yIn) return p;
    changed = true;
    return { ...p, wIn: w, hIn: h, xIn: x, yIn: y };
  });
  return changed ? { ...page, panels } : page;
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
      // Keep the panel's size when it fits; if it is bigger than its cell,
      // shrink it PROPORTIONALLY (aspect preserved) so panels never overlap a
      // neighbor. Then center it in the cell.
      const fit = Math.min(1, cellW / cur.wIn, cellH / cur.hIn);
      const w = cur.wIn * fit;
      const h = cur.hIn * fit;
      byId.set(p.panelId, {
        ...cur,
        wIn: w,
        hIn: h,
        xIn: cellX + (cellW - w) / 2,
        yIn: cellY + (cellH - h) / 2,
      });
    }
  });
  // Preserve original array order, updated in place.
  return { ...page, panels: page.panels.map((p) => byId.get(p.panelId)!) };
}

// ── Annotations (the 3-tool layer: text, arrow, bracket) ──────────────────────

/** Append an annotation to the page. */
export function addAnnotation(page: FigurePage, ann: Annotation): FigurePage {
  return { ...page, annotations: [...page.annotations, ann] };
}

/** Patch one annotation by id (shallow merge within its kind). */
export function updateAnnotation(
  page: FigurePage,
  annId: string,
  patch: Partial<Annotation>,
): FigurePage {
  return {
    ...page,
    annotations: page.annotations.map((a) =>
      a.annId === annId ? ({ ...a, ...patch } as Annotation) : a,
    ),
  };
}

/** Remove one annotation by id. */
export function removeAnnotation(page: FigurePage, annId: string): FigurePage {
  return { ...page, annotations: page.annotations.filter((a) => a.annId !== annId) };
}

/** Translate an annotation by a delta in inches (moves all of its anchor points). */
export function moveAnnotation(
  page: FigurePage,
  annId: string,
  dxIn: number,
  dyIn: number,
): FigurePage {
  return {
    ...page,
    annotations: page.annotations.map((a) => {
      if (a.annId !== annId) return a;
      if (a.kind === "arrow") {
        return {
          ...a,
          x1In: Math.max(0, a.x1In + dxIn),
          y1In: Math.max(0, a.y1In + dyIn),
          x2In: Math.max(0, a.x2In + dxIn),
          y2In: Math.max(0, a.y2In + dyIn),
        };
      }
      return { ...a, xIn: Math.max(0, a.xIn + dxIn), yIn: Math.max(0, a.yIn + dyIn) };
    }),
  };
}

/** A new text annotation anchored at a click point (real inches). */
export function makeTextAnnotation(
  annId: string,
  xIn: number,
  yIn: number,
  variant: TextVariant = "label",
): Annotation {
  return { annId, kind: "text", xIn, yIn, text: "Text", fontPt: TEXT_VARIANT_PT[variant], variant };
}

/** A new arrow (1 head) starting at the click point, pointing right. */
export function makeArrowAnnotation(annId: string, xIn: number, yIn: number): Annotation {
  return { annId, kind: "arrow", x1In: xIn, y1In: yIn, x2In: xIn + 1.2, y2In: yIn, heads: 1 };
}

/** A new horizontal significance bracket anchored at the click point. */
export function makeBracketAnnotation(annId: string, xIn: number, yIn: number): Annotation {
  return { annId, kind: "bracket", xIn, yIn, spanIn: 1.5, orientation: "horizontal", label: "" };
}

// ── Placed assets (the open-asset icon / illustration layer) ──────────────────

/** Every placed asset, tolerating a pre-asset page where the field is absent. */
export function pageAssets(page: FigurePage): PlacedAsset[] {
  return page.assets ?? [];
}

/** Every placed asset that is not hidden (used for canvas render). */
export function visibleAssets(page: FigurePage): PlacedAsset[] {
  return pageAssets(page).filter((a) => !a.hidden);
}

/** Every panel that is not hidden (used for canvas render). */
export function visiblePanels(page: FigurePage): FigurePanel[] {
  return page.panels.filter((p) => !p.hidden);
}

/** Every annotation that is not hidden (used for canvas render). */
export function visibleAnnotations(page: FigurePage): Annotation[] {
  return page.annotations.filter((a) => !a.hidden);
}

/** Every shape that is not hidden (used for canvas render). */
export function visibleShapes(page: FigurePage): FigureShape[] {
  return pageShapes(page).filter((s) => !s.hidden);
}

// ── Connector model helpers ───────────────────────────────────────────────────

export function pageConnectors(page: FigurePage): Connector[] {
  return page.connectors ?? [];
}

// ── Shapes (rectangles / ellipses) ────────────────────────────────────────────
// Lightweight vector primitives for backgrounds, highlights, and grouping boxes.
// Box-based and first-class (selectable / draggable / recolorable / z-ordered).

export type ShapeKind = "rect" | "ellipse";

export interface FigureShape {
  shapeId: string;
  kind: ShapeKind;
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  /** Fill color or "none". */
  fill: string;
  /** Stroke color or "none". */
  stroke: string;
  /** Stroke width in points. */
  strokeWPt: number;
  /** Clockwise rotation in degrees (0 = upright). */
  rotation?: number;
  // ── QoL Tier-1 additions (all optional, defaults preserve old docs) ──────
  /** Shared group tag (flat, no nesting). Absent = ungrouped. */
  groupId?: string;
  /** Mirror horizontally about the element center. */
  flipX?: boolean;
  /** Mirror vertically about the element center. */
  flipY?: boolean;
  /** Locked elements cannot be selected, moved, or resized. */
  locked?: boolean;
  /** Hidden elements are not rendered on the canvas and excluded from export. */
  hidden?: boolean;
}

export function pageShapes(page: FigurePage): FigureShape[] {
  return page.shapes ?? [];
}

export function makeShape(shapeId: string, kind: ShapeKind, xIn: number, yIn: number): FigureShape {
  return {
    shapeId,
    kind,
    xIn,
    yIn,
    wIn: 1.5,
    hIn: kind === "ellipse" ? 1.5 : 1,
    fill: "#e3f4ec",
    stroke: "#1d9e75",
    strokeWPt: 1.5,
  };
}

export function addShape(page: FigurePage, shape: FigureShape): FigurePage {
  return { ...page, shapes: [...pageShapes(page), shape] };
}

export function removeShape(page: FigurePage, shapeId: string): FigurePage {
  return { ...page, shapes: pageShapes(page).filter((s) => s.shapeId !== shapeId) };
}

export function updateShape(
  page: FigurePage,
  shapeId: string,
  patch: Partial<Omit<FigureShape, "shapeId" | "kind">>,
): FigurePage {
  return {
    ...page,
    shapes: pageShapes(page).map((s) => (s.shapeId === shapeId ? { ...s, ...patch } : s)),
  };
}

export function moveShape(page: FigurePage, shapeId: string, dxIn: number, dyIn: number): FigurePage {
  return {
    ...page,
    shapes: pageShapes(page).map((s) =>
      s.shapeId !== shapeId
        ? s
        : { ...s, xIn: Math.max(0, s.xIn + dxIn), yIn: Math.max(0, s.yIn + dyIn) },
    ),
  };
}

export function makeConnector(
  connId: string,
  from: ConnectorEnd,
  to: ConnectorEnd,
): Connector {
  return { connId, from, to, shape: "elbow", heads: 1, color: "#1f2937", weightPt: 1.5 };
}

export function addConnector(page: FigurePage, conn: Connector): FigurePage {
  return { ...page, connectors: [...pageConnectors(page), conn] };
}

export function removeConnector(page: FigurePage, connId: string): FigurePage {
  return { ...page, connectors: pageConnectors(page).filter((c) => c.connId !== connId) };
}

export function updateConnector(
  page: FigurePage,
  connId: string,
  patch: Partial<Omit<Connector, "connId" | "from" | "to">>,
): FigurePage {
  return {
    ...page,
    connectors: pageConnectors(page).map((c) => (c.connId === connId ? { ...c, ...patch } : c)),
  };
}

/** Drop any connectors whose endpoints reference a now-deleted element. */
export function pruneConnectors(page: FigurePage): FigurePage {
  const alive = (ref: ConnectorEnd["ref"]) =>
    ref.kind === "panel"
      ? page.panels.some((p) => p.panelId === ref.id)
      : ref.kind === "asset"
        ? pageAssets(page).some((a) => a.assetId === ref.id)
        : ref.kind === "shape"
          ? pageShapes(page).some((s) => s.shapeId === ref.id)
          : page.annotations.some((a) => a.annId === ref.id);
  const kept = pageConnectors(page).filter((c) => alive(c.from.ref) && alive(c.to.ref));
  return kept.length === pageConnectors(page).length ? page : { ...page, connectors: kept };
}

/**
 * A new placed asset, sized to a sensible default square (1.2in) at a drop point.
 * `fields` carries the library asset's identity + provenance, cached on the page.
 */
export function makePlacedAsset(
  assetId: string,
  fields: {
    source: string;
    sourceId: string;
    svgPath: string;
    credit: string;
    requiresAttribution: boolean;
  },
  xIn: number,
  yIn: number,
  sizeIn = 1.2,
): PlacedAsset {
  return {
    assetId,
    ref: { source: fields.source, sourceId: fields.sourceId },
    svgPath: fields.svgPath,
    xIn,
    yIn,
    wIn: sizeIn,
    hIn: sizeIn,
    credit: fields.credit,
    requiresAttribution: fields.requiresAttribution,
  };
}

/** Append a placed asset to the page. */
export function addPlacedAsset(page: FigurePage, asset: PlacedAsset): FigurePage {
  return { ...page, assets: [...pageAssets(page), asset] };
}

/** Remove a placed asset by id. */
export function removePlacedAsset(page: FigurePage, assetId: string): FigurePage {
  return { ...page, assets: pageAssets(page).filter((a) => a.assetId !== assetId) };
}

/** Patch one placed asset (move / resize / tint / rotate), shallow merge. */
export function updatePlacedAsset(
  page: FigurePage,
  assetId: string,
  patch: Partial<Omit<PlacedAsset, "assetId" | "ref">>,
): FigurePage {
  return {
    ...page,
    assets: pageAssets(page).map((a) => (a.assetId === assetId ? { ...a, ...patch } : a)),
  };
}

/** Translate a placed asset by a delta in inches (clamped to >= 0). */
export function movePlacedAsset(
  page: FigurePage,
  assetId: string,
  dxIn: number,
  dyIn: number,
): FigurePage {
  return {
    ...page,
    assets: pageAssets(page).map((a) =>
      a.assetId === assetId
        ? { ...a, xIn: Math.max(0, a.xIn + dxIn), yIn: Math.max(0, a.yIn + dyIn) }
        : a,
    ),
  };
}

/**
 * The figure's auto-generated credit lines: the unique citation of every placed
 * asset whose license requires attribution (CC-BY / SA / MIT / BSD). Public-Domain
 * and CC0 assets need no credit, so they are omitted. De-duplicated (the same icon
 * used twice cites once) and stable in placement order. This is the legal
 * load-bearing piece, computed purely from the page.
 */
export function figureCredits(page: FigurePage): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of pageAssets(page)) {
    if (!a.requiresAttribution) continue;
    if (seen.has(a.credit)) continue;
    seen.add(a.credit);
    out.push(a.credit);
  }
  return out;
}
