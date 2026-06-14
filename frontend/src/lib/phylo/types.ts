// Phylogenetics types (phylo Phase 0, 2026-06-12).
//
// DATA-SHAPE FLAGGED: new on-disk shape, additive, nothing else touched. A stored
// tree is a PAIR of files in the per-user store, mirroring molecule-store and
// sequence-store:
//   users/{username}/phylo/{id}.tree       ← the tree text (Newick / Nexus /
//                                             PhyloXML as imported), SOURCE OF TRUTH
//   users/{username}/phylo/{id}.meta.json  ← PhyloMeta sidecar
//
// The Tree Studio adds the optional `figure` and `metadata` fields when it lands
// (Phase 2+). They are absent on Phase 0 / Builder-saved records, which is why
// they are optional, older records simply omit them.

import type { ArtboardState } from "@/lib/figure/artboard";

/** The tree-text format as imported. */
export type PhyloFormat = "newick" | "nexus" | "phyloxml";

/** Where a stored tree came from. */
export type PhyloSource = "upload" | "paste" | "builder";

/** Studio layout shapes. */
export type PhyloLayout = "rectangular" | "circular" | "slanted" | "unrooted";

/**
 * The Studio figure spec, read by both the native SVG renderer and the ggtree
 * code exporter. Kept intentionally loose for Phase 0, the Tree Studio fleshes it
 * out (and any addition is an additive, back-compatible field on an optional
 * object, so it never breaks a Builder-saved record).
 */
export interface PhyloFigureSpec {
  layout: PhyloLayout;
  /** true = phylogram (use branch lengths), false = cladogram (uniform depths). */
  branchLengths: boolean;
  /** Annotation track key -> enabled. */
  tracks: Record<string, boolean>;
  /**
   * Draw legends for the colored tracks (Phase 0). Optional + additive: an older
   * record omits it and the renderer defaults legends ON, so a saved figure is
   * unchanged either way.
   */
  legend?: boolean;
  /**
   * Per-track sequential-palette overrides for numeric columns (Phase 0). Optional
   * + additive: an older record omits it and numeric columns default to Viridis,
   * categorical to the brand palette. Shape mirrors render.ts FigureScales:
   * { category?: string; bar?: string; heat?: Record<string, string> }.
   */
  scales?: {
    category?: string;
    bar?: string;
    heat?: Record<string, string>;
  };
  /**
   * The ordered LAYER stack (phylo Phase 1, the ggtree-class control model). Each
   * row in the Studio layers list is one AlignedPanel; the array order is the draw
   * order, inner (near the tips) to outer. OPTIONAL and additive: a saved figure
   * with no `panels` reads exactly as today, the load path projects its Phase 0
   * `tracks` / column bindings into a default layer set so nothing breaks. The
   * Studio writes `panels` going forward, and the ggtree-code exporter walks this
   * array to emit one geom per panel.
   */
  panels?: AlignedPanel[];
  /**
   * Color tree branches by a metadata column (ggtree `aes(color = trait)`).
   * Optional + additive (an older record omits it and branches draw in the
   * default ink). A branch is colored only where its whole descendant clade
   * shares one value (monophyletic), so transitions stay neutral; we do not
   * claim ancestral-state reconstruction.
   */
  branchColorColumn?: string;
  /**
   * The publication page-frame (artboard) config for this figure. Optional +
   * additive (an older record omits it and the artboard reads as disabled, so the
   * figure renders exactly as before). Normalized with readArtboardState on load.
   */
  artboard?: ArtboardState;
  /**
   * The figure's chosen width in inches when the artboard is used (height follows
   * the fixed tree aspect). Optional + additive, absent means the natural size.
   */
  figureWidthIn?: number;
}

/**
 * One highlighted / labeled clade, stored in the clade layer's `options.clades`.
 * Defined BY TIP NAME (the headline QOL: name the members, the MRCA resolves the
 * clade root, so you never hunt for a node on a large tree) or by an explicit
 * node id. Carried on the loose `AlignedPanel.options` seam, so no new on-disk
 * field. An empty / absent clades array falls back to the legacy single
 * auto-highlight, so an older figure is unchanged.
 */
export interface CladeAnnotation {
  /** Stable id within the figure (React key + edit target). */
  id: string;
  /** Clade members by tip NAME; the MRCA of these is the clade root. */
  tips?: string[];
  /** Or a direct node id (e.g. picked on the tree), taking precedence over tips. */
  node?: number;
  /** Highlight fill / label color. */
  color: string;
  /** A label drawn at the clade. */
  label: string;
  /**
   * How to annotate the clade. "highlight" = a shaded band over the clade
   * (ggtree geom_hilight, the default). "label" = a bracket spanning the clade's
   * tips with the label alongside, no shading (ggtree geom_cladelab).
   */
  style?: "highlight" | "label";
  /** Collapse the clade to a triangle (ggtree geom_collapse / collapse()). */
  collapsed?: boolean;
}

/** The geom catalog a layer can be, grows over phases. */
export type AlignedPanelKind =
  | "labels"
  | "points"
  | "strip"
  | "heat"
  | "bars"
  | "dots"
  | "box"
  | "violin"
  | "point"
  | "scatter"
  | "clade"
  | "support"
  | "msa";

/**
 * Error-whisker kind for the point (lollipop) geom, mirroring the Data Hub
 * ErrorBarKind concept (lib/datahub/plot-spec.ts) so the meaning is identical
 * across the two surfaces. "sd" / "sem" derive from the bound replicate columns
 * (or the explicit error column), "none" draws a bare point. We reuse the CONCEPT,
 * not the Data Hub renderer (the cross-lane boundary), the phylo panel renderer
 * draws the whisker against the TipAxis itself.
 */
export type PhyloErrorKind = "sd" | "sem" | "none";

/**
 * One layer in the figure stack: a tip decoration, an aligned data panel, a
 * highlight, or an alignment track. Rendered tip-for-tip against the shared
 * TipAxis (layout.ts) by renderPanel (panel-render.ts), so the same panel reads
 * the same in the rectangular columns and the circular rings. All data fields are
 * optional so a decoration layer (labels / clade / support) carries only what it
 * needs.
 */
export interface AlignedPanel {
  /** Stable id within the figure, the React key + the selection target. */
  id: string;
  kind: AlignedPanelKind;
  /** Hidden layers stay in the stack (keep their order + config) but do not draw. */
  visible: boolean;
  /** Bound metadata column for a single-column colored / data panel. */
  column?: string;
  /** Bound columns for a multi-column panel (a heat matrix, gheatmap-style). */
  columns?: string[];
  /**
   * Optional explicit error-magnitude column for the point (lollipop) geom, paired
   * with `column` (the value / mean). Additive + back-compatible (phylo Phase 2):
   * an older record omits it, and the point geom falls back to deriving the error
   * from the bound replicate `columns[]` (or draws no whisker when neither is set).
   * Used only by the point geom; every other geom ignores it.
   */
  errorColumn?: string;
  /** The color scale for the panel. Absent lets the renderer classify the column. */
  scale?: { kind: "continuous" | "categorical"; paletteId?: string };
  /** Draw a legend for this panel. */
  legend?: boolean;
  /** Panel thickness in px (a rectangular column width / a circular ring depth). */
  width?: number;
  /** Geom-specific options (bar width fraction, label italic, support cutoff, ...). */
  options?: Record<string, unknown>;
}

/**
 * A metadata table bound to a tree, either inline rows or a reference to a live
 * Data Hub table. The tip-id column maps rows to tree tips.
 */
export interface PhyloMetadataBinding {
  /** The metadata column whose values match tree tip labels. */
  tipColumn: string;
  /** Inline table when pasted / dropped as CSV. */
  rows?: Record<string, string>[];
  /** A linked Data Hub table id, when bound to a live table instead. */
  datahubTableId?: string;
  /**
   * Which metadata columns drive which annotation tracks, so a saved figure
   * reopens with the same tip-point / color-strip / bar / heatmap bindings it was
   * exported with. All optional and additive, older records simply omit them and
   * the Studio falls back to its on-import defaults.
   */
  categoryColumn?: string;
  barColumn?: string;
  heatColumns?: string[];
}

/**
 * Locked metadata sidecar shape (`phylo/{id}.meta.json`). This is the contract a
 * consumer surface (the hub library grid, the project surface, embeds) reads.
 */
export interface PhyloMeta {
  id: string;
  /** Display name shown in the library + the project surface. */
  name: string;
  /** Collection membership: the projects this tree is linked to. */
  project_ids: string[];
  /** ISO timestamp the tree was added. */
  added_at: string;
  /** The tree-text format as imported. */
  format: PhyloFormat;
  /** Where this tree came from. */
  source?: PhyloSource;
  /** Number of tips, for the library list. Computed on import. */
  tip_count?: number;
  /** Studio figure spec. Absent until the tree is opened + saved in the Studio. */
  figure?: PhyloFigureSpec;
  /** Bound metadata table. Absent until linked in the Studio. */
  metadata?: PhyloMetadataBinding;
}
