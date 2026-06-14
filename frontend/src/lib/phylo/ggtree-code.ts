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
import type { AlignedPanel, CladeAnnotation } from "./types";

export const GGTREE_CAVEAT =
  "This script is generated from your figure. The ggtree output is close but not 100% pixel-identical to the Studio canvas, ggtree uses a different layout engine.";

/**
 * True when every non-blank value of a column (across the matched tips) parses to
 * a finite number, so the figure colored it as a continuous scale and the R script
 * should emit a continuous scale too. Mirrors color-scale.ts classifyColumn but
 * reads the same metadata Map the exporter already has, no tree needed.
 */
function isNumericColumn(
  metadata: Map<number, Record<string, string>>,
  column: string,
): boolean {
  let sawValue = false;
  for (const row of metadata.values()) {
    const raw = row[column];
    if (raw === undefined || raw.trim() === "") continue;
    sawValue = true;
    if (!Number.isFinite(Number(raw.trim()))) return false;
  }
  return sawValue;
}

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
  if (spec.panels) return generateFromPanels(spec, spec.panels);
  return generateFromTracks(spec);
}

/** The Phase 0 track-driven generator (fallback for a hand-built spec). */
function generateFromTracks(spec: RenderSpec): string {
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
  // TODO(phylo Phase 0): the native renderer scales each heat column on its own
  // (numeric -> a continuous gradient, categorical -> categorical colors). gheatmap
  // applies one fill scale to the whole matrix, so a per-column continuous scale is
  // not emitted here yet. The presence / absence matrix below is the honest
  // approximation; a faithful multi-scale export would need one geom_fruit tile
  // layer per column with its own scale.
  if (t.heat && cols.heat && cols.heat.length > 0) {
    lines.push(
      `gene_matrix <- meta[, c(${cols.heat.map((c) => rstr(c)).join(", ")})]`,
    );
    lines.push(
      "p <- gheatmap(p, gene_matrix, width = 0.3, colnames_angle = 90)   # presence / absence panel",
    );
  }
  // Color scale. A numeric category column is a CONTINUOUS Viridis scale (the
  // native renderer's Phase 0 default), a categorical column the manual named
  // values. The chosen sequential palette id rides spec.scales when overridden.
  if ((t.points || t.strip) && cols.category) {
    const numeric =
      spec.metadata &&
      isNumericColumn(spec.metadata, cols.category);
    if (numeric) {
      lines.push(
        "p <- p + scale_color_viridis_c() + scale_fill_viridis_c()   # continuous scale (numeric column)",
      );
    } else if (
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
  }
  // Theme + scale bar.
  lines.push("p + theme_tree() + geom_treescale()");
  return lines.join("\n");
}

/**
 * The Phase 1 layer-stack generator: walk the ordered panels[] and emit one
 * ggtree / ggtreeExtra layer per panel, in draw order, the geom_fruit story made
 * honest. Each aligned data panel becomes a geom_fruit with the matching geom; a
 * numeric column adds a continuous scale, a categorical column the manual named
 * values. A multi-column heat panel uses gheatmap (one fill scale on the matrix,
 * the known approximation, noted in a comment). The box panel is the one geom we
 * cannot map cleanly (per-tip replicate columns), so it emits a clear TODO rather
 * than a wrong layer.
 */
function generateFromPanels(spec: RenderSpec, panels: AlignedPanel[]): string {
  const lines: string[] = [];
  const meta = spec.metadata;
  const hasMeta = !!meta && meta.size > 0;

  lines.push(`# ${GGTREE_CAVEAT}`);
  lines.push(
    '# install once: BiocManager::install(c("ggtree", "ggtreeExtra", "treeio"))',
  );
  lines.push(
    "library(ggtree); library(ggtreeExtra); library(ggplot2); library(treeio)",
  );
  lines.push("");
  lines.push('tree <- read.tree("tree.nwk")');
  if (hasMeta) lines.push('meta <- read.csv("metadata.csv")');
  lines.push("");

  const layout = ggtreeLayout(spec);
  lines.push(
    hasMeta
      ? `p <- ggtree(tree, layout = ${rstr(layout)}) %<+% meta`
      : `p <- ggtree(tree, layout = ${rstr(layout)})`,
  );
  if (spec.branchColorColumn) {
    lines.push(
      `p <- p + aes(color = ${rNameKey(spec.branchColorColumn)})   # color branches by trait`,
    );
  }

  let offset = 0.05;
  for (const panel of panels) {
    if (!panel.visible && panel.kind !== "labels") continue;
    const col = panel.column ?? panel.columns?.[0];
    const numeric = !!(meta && col && isNumericColumn(meta, col));
    switch (panel.kind) {
      case "support":
        lines.push(
          "p <- p + geom_nodelab(aes(label = label), size = 2, hjust = -0.2)   # branch support",
        );
        break;
      case "nodepoints": {
        const npo = panel.options ?? {};
        const size = Number(npo.size) || 3;
        const color = (typeof npo.color === "string" && npo.color) || "#374151";
        lines.push(
          `p <- p + geom_nodepoint(size = ${(size / 2).toFixed(1)}, colour = ${rstr(color)})   # internal node points`,
        );
        if (npo.showRoot) {
          lines.push(
            `p <- p + geom_rootpoint(size = ${(size / 2 + 0.5).toFixed(1)}, colour = ${rstr(color)})`,
          );
        }
        break;
      }
      case "clade": {
        const clades =
          (panel.options?.clades as CladeAnnotation[] | undefined) ?? [];
        if (clades.length > 0) {
          for (const c of clades) {
            // MRCA(tree, c("t1","t2")) is exactly how ggtree resolves a clade by
            // tip names; an explicit node id is emitted verbatim.
            const node =
              typeof c.node === "number"
                ? String(c.node)
                : `MRCA(tree, c(${(c.tips ?? []).map((t) => rstr(t)).join(", ")}))`;
            if (c.collapsed) {
              lines.push(
                `p <- collapse(p, node = ${node}, mode = "max", fill = ${rstr(c.color || "#1AA0E6")})${c.label ? `   # ${c.label}` : ""}`,
              );
            } else if (c.style === "label") {
              lines.push(
                `p <- p + geom_cladelab(node = ${node}, label = ${rstr(c.label || "")}, barcolour = ${rstr(c.color || "#1AA0E6")})`,
              );
            } else {
              lines.push(
                `p <- p + geom_hilight(node = ${node}, fill = ${rstr(c.color || "#1AA0E6")}, alpha = 0.12)${c.label ? `   # ${c.label}` : ""}`,
              );
            }
          }
        } else if (spec.cladeHighlight) {
          lines.push(
            `p <- p + geom_hilight(node = ${spec.cladeHighlight.nodeId}, fill = ${rstr(spec.cladeHighlight.color)}, alpha = 0.12)   # ${spec.cladeHighlight.label}`,
          );
        }
        break;
      }
      case "points":
        if (col) {
          lines.push(
            `p <- p + geom_tippoint(aes(color = ${rNameKey(col)}), size = 2)`,
          );
          lines.push(panelColorScale(spec, col, numeric, "color"));
        }
        break;
      case "labels": {
        const lo = panel.options ?? {};
        const face = (lo.italic ?? true) ? 'fontface = "italic", ' : "";
        const geomArg = lo.boxed ? 'geom = "label", ' : "";
        const colorArg =
          typeof lo.colorColumn === "string" && lo.colorColumn
            ? `aes(color = ${rNameKey(lo.colorColumn)}), `
            : "";
        const size = Number(lo.fontSize)
          ? (Number(lo.fontSize) / 3.7).toFixed(1)
          : "3";
        lines.push(
          `p <- p + geom_tiplab(${geomArg}${colorArg}${face}size = ${size})`,
        );
        break;
      }
      case "strip":
        if (col) {
          lines.push(
            `p <- p + geom_fruit(geom = geom_tile, mapping = aes(fill = ${rNameKey(col)}), width = 0.05, offset = ${offset.toFixed(2)})   # color strip`,
          );
          lines.push(panelColorScale(spec, col, numeric, "fill"));
          offset += 0.05;
        }
        break;
      case "bars":
        if (col) {
          lines.push(
            `p <- p + geom_fruit(geom = geom_col, mapping = aes(x = ${rNameKey(col)}${numeric ? `, fill = ${rNameKey(col)}` : ""}), offset = ${offset.toFixed(2)})   # aligned bar panel`,
          );
          if (numeric) lines.push("p <- p + scale_fill_viridis_c()");
          offset += 0.1;
        }
        break;
      case "dots":
        if (col) {
          lines.push(
            `p <- p + geom_fruit(geom = geom_point, mapping = aes(x = ${rNameKey(col)}${numeric ? `, color = ${rNameKey(col)}` : ""}), offset = ${offset.toFixed(2)})   # aligned dot panel`,
          );
          if (numeric) lines.push("p <- p + scale_color_viridis_c()");
          offset += 0.08;
        }
        break;
      case "heat":
        if (panel.columns && panel.columns.length > 0) {
          // gheatmap applies one fill scale to the whole matrix, so a per-column
          // continuous scale is not reproduced exactly (the known approximation).
          lines.push(
            `gene_matrix <- meta[, c(${panel.columns.map((c) => rstr(c)).join(", ")})]   # one fill scale on the matrix (approximation)`,
          );
          lines.push(
            "p <- gheatmap(p, gene_matrix, width = 0.3, colnames_angle = 90)",
          );
          offset += 0.1;
        }
        break;
      case "box":
        lines.push(
          "# TODO: a per-tip distribution (box) panel. ggtreeExtra can draw it with",
          "# geom_fruit(geom = geom_boxplot) from a LONG per-tip table (one row per",
          "# replicate). Reshape your replicate columns to long form, then add:",
          `#   p <- p + geom_fruit(data = long, geom = geom_boxplot, mapping = aes(x = value, group = label), offset = ${offset.toFixed(2)})`,
        );
        offset += 0.1;
        break;
      case "violin":
        lines.push(
          "# A per-tip distribution (violin) panel. From a LONG per-tip table (one",
          "# row per replicate), ggtreeExtra draws it with:",
          `#   p <- p + geom_fruit(data = long, geom = geom_violin, mapping = aes(x = value, group = label), offset = ${offset.toFixed(2)})`,
        );
        offset += 0.1;
        break;
      case "point":
        lines.push(
          "# A point + error (lollipop) panel. From a per-tip summary table with a",
          "# mean column and an error column (sd / sem), ggtreeExtra draws it with:",
          `#   p <- p + geom_fruit(data = summ, geom = geom_pointrange, mapping = aes(x = mean, xmin = mean - err, xmax = mean + err), offset = ${offset.toFixed(2)})`,
        );
        offset += 0.1;
        break;
      case "scatter":
        lines.push(
          "# A jitter-scatter panel of the individual replicates. From a LONG per-tip",
          "# table (one row per replicate), ggtreeExtra draws it with:",
          `#   p <- p + geom_fruit(data = long, geom = geom_jitter, mapping = aes(x = value), offset = ${offset.toFixed(2)})`,
        );
        offset += 0.1;
        break;
      case "msa":
        lines.push(
          "# A sequence-alignment track. ggtree draws an aligned FASTA next to the",
          "# tree with msaplot (the tip labels must match the FASTA headers):",
          `#   p <- msaplot(p, fasta = "alignment.fasta", offset = ${offset.toFixed(2)}, width = 2)`,
        );
        offset += 0.3;
        break;
      default:
        break;
    }
  }
  lines.push("p + theme_tree() + geom_treescale()");
  return lines.join("\n");
}

/** Emit the color / fill scale line for a panel's column. */
function panelColorScale(
  spec: RenderSpec,
  column: string,
  numeric: boolean,
  aes: "color" | "fill",
): string {
  if (numeric) {
    return `p <- p + scale_${aes}_viridis_c()   # continuous scale (numeric column)`;
  }
  if (spec.categoryColors && Object.keys(spec.categoryColors).length > 0) {
    return `p <- p + scale_${aes}_manual(values = ${rNamedColors(spec.categoryColors)})`;
  }
  return `p <- p + scale_${aes}_brewer(palette = "Set2")   # ${column}`;
}
