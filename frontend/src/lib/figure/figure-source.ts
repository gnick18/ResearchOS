// The FigureSource registry: the one seam that makes the figure composer
// universal. Each surface that can draw a figure (Data Hub plots, phylo trees,
// sequence maps, chem structures) registers a FigureSource so its figures become
// composable panels. The composer walks the registry and never imports a surface
// directly, so a new surface lights up by registering, with zero composer change.
//
// Keep this contract small and stable. Adapters are owned by other lanes, so a
// change here churns every lane. See
// docs/proposals/2026-06-14-universal-figure-composer.md (section 3).
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { LayoutManifest } from "./layout-manifest";

/** One figure a source offers, enough to list + reference it. */
export interface FigureRef {
  /** Stable id within the source (e.g. a PlotSpec id, a PhyloFigureSpec id). */
  id: string;
  /** The source type, matching FigureSource.type. */
  type: string;
  name: string;
  /**
   * Optional sub-group the figure belongs to within its source, for the picker's
   * "Group by" view (e.g. the Data Hub document / table it came from). Absent =
   * the source's own label is used.
   */
  group?: string;
  /**
   * Optional short plot-type label for the picker's "Filter" chips + "Group by
   * type" view (e.g. "XY", "bar", "column scatter"). Absent = "Other".
   */
  kind?: string;
  /** Optional small preview for the add-figure picker. */
  thumbnailSvg?: string;
}

/** Where a source should look for figures (the project / collection in view). */
export interface FigureScope {
  /** The collection a Figure page belongs to, or null for unfiled. */
  collectionId: string | null;
}

/**
 * A styleable element inside a figure (a sequence feature, later a plot series, a
 * tree clade...), for the composer's per-panel style inspector. Surface-agnostic.
 */
export interface StyleTarget {
  /** Stable key the source recognizes in PanelStyle.targets. */
  key: string;
  /** Human label shown in the style list. */
  label: string;
  /** The current color, so the inspector can seed its swatch. */
  color?: string;
}

/**
 * Composition-local style a panel carries, written by the composer's style
 * inspector and interpreted by the source. Generic so every source can opt in:
 *  - `targets`: per-element overrides (recolor / hide), keyed by StyleTarget.key.
 *  - `options`: source-specific scalar options (e.g. thickness, ring/label toggles).
 */
export interface PanelStyle {
  targets?: Record<string, { color?: string; hidden?: boolean }>;
  options?: Record<string, unknown>;
}

/**
 * One source-specific option control the composer's Style inspector should
 * render (a slider, a checkbox, a dropdown). A source declares these via
 * `styleSchema()` so the composer offers them generically, keyed by `key` into
 * PanelStyle.options, with NO per-source special-casing. `default` is the value
 * the source uses when the option is unset, so the control shows the live state.
 */
export type StyleOption =
  | {
      kind: "toggle";
      key: string;
      label: string;
      /** The value used when PanelStyle.options[key] is unset. */
      default: boolean;
    }
  | {
      kind: "range";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      default: number;
    }
  | {
      kind: "select";
      key: string;
      label: string;
      choices: { value: string; label: string }[];
      default: string;
    };

/** What the composer asks a source to render a panel at. */
export interface RenderOpts {
  /** Target size in real publication units (inches), so the panel is exact. */
  widthIn: number;
  heightIn: number;
  /** Export dpi (the page sets it; the source may use it for raster fallbacks). */
  dpi: number;
  /** The page theme, so every panel renders consistently in one document. */
  theme: "light" | "dark";
  /**
   * Composition-local tweaks that never mutate the source figure. A composed
   * multi-panel figure hides each plot's own title by default (the panel letter
   * + figure caption carry it); a source applies these when it can.
   */
  overrides?: { hideTitle?: boolean; hideLegend?: boolean };
  /** Per-panel style written by the composer's style inspector (recolor, hide, options). */
  style?: PanelStyle;
}

/** A rendered panel: a self-contained SVG plus its natural aspect for fitting. */
export interface RenderedFigure {
  /** A standalone SVG string (own width/height + viewBox), placed by the composer. */
  svg: string;
  /** Natural width / height of the source figure, for aspect-preserving fit. */
  naturalAspect: number;
  /** True when the referenced figure no longer resolves (deleted / moved). */
  missing?: boolean;
}

/** The adapter a surface registers. The composer only ever calls these. */
export interface FigureSource {
  /** "datahub" | "phylo" | "sequence" | "chemistry" ... */
  type: string;
  /** Human label for the add-figure picker grouping. */
  label: string;
  /** List the figures the user can add, scoped to a collection. */
  list(scope: FigureScope): Promise<FigureRef[]>;
  /** Render ONE figure to a self-contained SVG at a requested real size. Pure of DOM. */
  render(id: string, opts: RenderOpts): Promise<RenderedFigure>;
  /** Where to open the figure's own editor (double-click a panel to edit it). */
  editHref(id: string): string;
  /**
   * Optional: the styleable elements of a figure (e.g. its features), so the
   * composer's per-panel style inspector can offer recolor / hide. A source with
   * no styling omits this and gets no style controls.
   */
  styleTargets?(id: string): Promise<StyleTarget[]>;
  /**
   * Optional: the source-specific OPTION controls (sliders / toggles / dropdowns)
   * the composer should render in the Style inspector, written into
   * PanelStyle.options. Declarative so the composer offers them with no
   * per-source special-casing. A source with no scalar options omits this. The
   * schema is static per source, so it takes no figure id.
   */
  styleSchema?(): StyleOption[];
  /**
   * Optional: persist a panel's style as the object's CANONICAL default (saved on
   * the object, so it becomes the starting point for any future figure of it).
   * When present, the composer offers a "Save as default" action. A source with no
   * canonical-style store omits this.
   */
  saveDefaultStyle?(id: string, style: PanelStyle): Promise<void>;
  /**
   * Optional: emit the placed-element geometry (bounding boxes) of the figure as
   * it would render at `opts`, so the collision-aware layout advisor can detect
   * legend-over-content / label-crowding / duplicate overlays on this surface and
   * preview fixes. Same id + opts as render(), so the boxes are the exact numbers
   * the SVG was drawn from. A source with no collision support omits this and gets
   * no advisor. Returns null when the figure does not resolve. See
   * docs/proposals/2026-06-15-collision-aware-layout-advisor.md (Phase 5).
   */
  getLayoutManifest?(id: string, opts: RenderOpts): Promise<LayoutManifest | null>;
}

// Module-level registry. Surfaces register once at startup (registerSources()).
const registry = new Map<string, FigureSource>();

/** Register a source. Re-registering the same type replaces it (HMR-safe). */
export function registerFigureSource(source: FigureSource): void {
  registry.set(source.type, source);
}

/** The source for a type, or undefined when no surface has registered it. */
export function getFigureSource(type: string): FigureSource | undefined {
  return registry.get(type);
}

/** Every registered source, for the add-figure picker. */
export function listFigureSources(): FigureSource[] {
  return [...registry.values()];
}

/** Test-only reset so a test starts from an empty registry. */
export function _clearFigureSources(): void {
  registry.clear();
}

/** A placeholder rendered when a panel's source is missing or unregistered. */
export function missingPanelSvg(widthIn: number, heightIn: number): RenderedFigure {
  const w = Math.max(1, widthIn * 96);
  const h = Math.max(1, heightIn * 96);
  const svg =
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="4 4"/>` +
    `<text x="${w / 2}" y="${h / 2}" font-size="11" fill="#94a3b8" text-anchor="middle" font-family="sans-serif">figure not found</text>` +
    `</svg>`;
  return { svg, naturalAspect: widthIn / heightIn, missing: true };
}
