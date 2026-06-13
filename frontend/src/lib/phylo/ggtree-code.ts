// Phylo Tree Studio, ggtree / ggtreeExtra R code generator (Phase 4).
//
// The reproducibility twin of the native renderer: it emits a runnable R script
// that recreates the figure with ggtree + ggtreeExtra, the way Data Hub's
// show-code.ts / plot-code.ts emit the Python that reproduces a Data Hub result.
// Some journals require the plotting code, and ggtree is the field-standard, so
// we hand back the exact layers the figure spec implies. Pure string building,
// no engine call, no I/O. The on-screen figure and this script read from one
// spec, so they agree on layout, tracks, and colors.
//
// HONEST CAVEAT: the native SVG and ggtree are not pixel-identical (different
// layout engines). The Studio shows this caveat above the code panel, and the
// generated script repeats it as a header comment so a pasted script is honest
// on its own.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { RenderSpec } from "./render";

export const GGTREE_CAVEAT =
  "This script is generated from your figure. The ggtree output is close but not 100% pixel-identical to the Studio canvas, ggtree uses a different layout engine.";

/** Map a Studio layout to the ggtree layout string. */
function ggtreeLayout(spec: RenderSpec): string {
  if (spec.layout === "circular") return "circular";
  return "rectangular";
}

/** R-quote a string value (single-quoted, escaped). */
function rstr(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** A named-vector literal for scale_*_manual from a category -> color map. */
function rNamedColors(colors: Record<string, string>): string {
  const entries = Object.entries(colors).map(
    ([k, v]) => `${rNameKey(k)} = ${rstr(v)}`,
  );
  return `c(${entries.join(", ")})`;
}

/** R list names allow bare identifiers only, otherwise backtick-quote. */
function rNameKey(k: string): string {
  return /^[A-Za-z.][A-Za-z0-9._]*$/.test(k) ? k : `\`${k}\``;
}

/**
 * Generate the full ggtree + ggtreeExtra R script from the current figure spec.
 * The metadata join uses `%<+%`, the field-standard ggtree operator, and each
 * enabled track maps to its ggtree / ggtreeExtra layer.
 */
export function generateGgtreeCode(spec: RenderSpec): string {
  const t = spec.tracks;
  const cols = spec.columns;
  const lines: string[] = [];

  // Header: install hint + the honest caveat as a comment.
  lines.push(`# ${GGTREE_CAVEAT}`);
  lines.push(
    '# install once: BiocManager::install(c("ggtree", "ggtreeExtra", "treeio"))',
  );
  lines.push(
    "library(ggtree); library(ggtreeExtra); library(ggplot2); library(treeio)",
  );
  lines.push("");
  lines.push('tree <- read.tree("tree.nwk")');
  if (spec.metadata && spec.metadata.size > 0) {
    lines.push('meta <- read.csv("metadata.csv")');
  }
  lines.push("");

  // Base plot, with the metadata join when bound.
  const layout = ggtreeLayout(spec);
  if (spec.metadata && spec.metadata.size > 0) {
    lines.push(`p <- ggtree(tree, layout = ${rstr(layout)}) %<+% meta`);
  } else {
    lines.push(`p <- ggtree(tree, layout = ${rstr(layout)})`);
  }

  // Support values.
  if (t.support) {
    lines.push(
      "p <- p + geom_nodelab(aes(label = label), size = 2, hjust = -0.2)   # branch support",
    );
  }
  // Clade highlight.
  if (t.clade && spec.cladeHighlight) {
    lines.push(
      `p <- p + geom_hilight(node = ${spec.cladeHighlight.nodeId}, fill = ${rstr(spec.cladeHighlight.color)}, alpha = 0.12)   # ${spec.cladeHighlight.label}`,
    );
  }
  // Tip points (categorical color).
  if (t.points && cols.category) {
    lines.push(
      `p <- p + geom_tippoint(aes(color = ${rNameKey(cols.category)}), size = 2)`,
    );
  }
  // Tip labels.
  if (t.labels) {
    lines.push(
      `p <- p + geom_tiplab(${t.labelsItalic ? 'fontface = "italic", ' : ""}size = 3)`,
    );
  }
  // Color strip.
  if (t.strip && cols.category) {
    lines.push(
      `p <- p + geom_fruit(geom = geom_tile, mapping = aes(fill = ${rNameKey(cols.category)}), width = 0.05, offset = 0.05)   # color strip`,
    );
  }
  // Aligned bar chart.
  if (t.bars && cols.bar) {
    lines.push(
      `p <- p + geom_fruit(geom = geom_col, mapping = aes(x = ${rNameKey(cols.bar)}), offset = 0.1)   # aligned bar chart`,
    );
  }
  // Heatmap panel.
  if (t.heat && cols.heat && cols.heat.length > 0) {
    lines.push(
      `gene_matrix <- meta[, c(${cols.heat.map((c) => rstr(c)).join(", ")})]`,
    );
    lines.push(
      "p <- gheatmap(p, gene_matrix, width = 0.3, colnames_angle = 90)   # presence / absence panel",
    );
  }
  // Color scale.
  if (
    (t.points || t.strip) &&
    cols.category &&
    spec.categoryColors &&
    Object.keys(spec.categoryColors).length > 0
  ) {
    lines.push(
      `p <- p + scale_color_manual(values = ${rNamedColors(spec.categoryColors)})`,
    );
    lines.push(
      `p <- p + scale_fill_manual(values = ${rNamedColors(spec.categoryColors)})`,
    );
  }
  // Theme + scale bar.
  lines.push("p + theme_tree() + geom_treescale()");
  return lines.join("\n");
}
