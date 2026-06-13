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
