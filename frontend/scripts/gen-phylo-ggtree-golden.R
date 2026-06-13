#!/usr/bin/env Rscript
##
## Generate INDEPENDENT ground-truth layout coordinates for the phylo
## transparency domain (frontend/src/lib/transparency/datasets/phylo-ggtree.ts).
##
## WHY THIS EXISTS
## ---------------
## The /phylo Tree Studio lays trees out with our own native-SVG layout math
## (frontend/src/lib/phylo/layout.ts). A test that checks our layout against our
## layout proves nothing. ggtree is the de-facto standard tree-plotting package in
## R, so the honest claim is "our native layout reproduces ggtree's tip ordering
## and depth structure". ggtree is R and cannot run in CI, so (exactly like the
## scipy goldens in gen-datahub-stats-golden.py) this script is run ONCE, offline,
## by a human in a real R + ggtree environment. It reads the committed source
## trees, asks ggtree for its node coordinate table, and writes a committed golden
## JSON per tree. The TypeScript gate then compares OUR coordinates to that frozen
## golden with no R at test time.
##
## WHAT IT PRODUCES (commit all of these to activate the gate)
## -----------------------------------------------------------
##   frontend/src/lib/transparency/datasets/phylo-ggtree-golden/<tree>.json
##     per-node {label, x, y, isTip} from ggtree's plot data, plus a small
##     provenance header (tree id, ggtree version, layout, tip count).
##   frontend/public/transparency/phylo/<tree>-ggtree.png
##     the rendered ggtree reference figure, shown side by side with our render on
##     the /transparency page.
##
## After running, set "pending": false in each <tree>.json (the script already
## writes false), rebuild, and remove the it.skip guard note in
## phylo-plots.gate.test.ts (the gate auto-activates once pending is false on all
## seeded trees).
##
## HOW TO RUN
## ----------
##   Rscript frontend/scripts/gen-phylo-ggtree-golden.R
## from the repository root. Required R packages (Bioconductor + CRAN):
##   install.packages("BiocManager")
##   BiocManager::install(c("ggtree", "treeio"))
##   install.packages(c("ape", "ggplot2", "jsonlite"))
## Pin the versions you used into oracles.ts (the GGTREE oracle `version` field)
## so the committed golden stays reproducible.
##
## No em-dashes, no emojis, no mid-sentence colons.

suppressPackageStartupMessages({
  library(ape)       # read.tree (Newick parser)
  library(ggtree)    # the reference layout + plot
  library(ggplot2)   # ggsave for the reference figure
  library(jsonlite)  # write the golden JSON
})

## Repo-relative paths. Run from the repository root.
sources_dir <- "frontend/src/lib/phylo/__seed__/sources"
golden_dir  <- "frontend/src/lib/transparency/datasets/phylo-ggtree-golden"
figure_dir  <- "frontend/public/transparency/phylo"

dir.create(golden_dir, showWarnings = FALSE, recursive = TRUE)
dir.create(figure_dir, showWarnings = FALSE, recursive = TRUE)

ggtree_version <- as.character(packageVersion("ggtree"))

## One tree per seeded source. `layout` is the ggtree layout we compare our
## rectangular phylogram against (rectangular = the default tip-on-the-right tree).
trees <- list(
  list(id = "candida_auris", layout = "rectangular"),
  list(id = "hmp",           layout = "rectangular"),
  list(id = "hpv58",         layout = "rectangular")
)

for (t in trees) {
  nwk_path <- file.path(sources_dir, t$id, "tree.nwk")
  message("Reading ", nwk_path)
  phylo <- read.tree(nwk_path)

  ## Build the ggtree plot and pull its node coordinate table. ggtree stores one
  ## row per node in p$data with: node (id), x, y, isTip, label. x is cumulative
  ## branch-length depth, y is the tip-ordering slot. This is exactly the frame
  ## our layout.ts produces (x = depth, y = tip order), so the two are comparable
  ## up to scale and orientation.
  p <- ggtree(phylo, layout = t$layout)
  d <- p$data

  nodes <- lapply(seq_len(nrow(d)), function(i) {
    list(
      label  = if (is.na(d$label[i])) "" else as.character(d$label[i]),
      x      = as.numeric(d$x[i]),
      y      = as.numeric(d$y[i]),
      isTip  = as.logical(d$isTip[i])
    )
  })

  golden <- list(
    ## pending = FALSE marks this as a REAL ggtree golden (not the placeholder the
    ## repo ships). The gate activates only when every seeded tree is non-pending.
    pending      = FALSE,
    tree         = t$id,
    layout       = t$layout,
    oracle       = "ggtree",
    ggtreeVersion = ggtree_version,
    tipCount     = sum(d$isTip, na.rm = TRUE),
    nodeCount    = nrow(d),
    nodes        = nodes
  )

  json_path <- file.path(golden_dir, paste0(t$id, ".json"))
  write_json(golden, json_path, auto_unbox = TRUE, digits = 10, pretty = TRUE)
  message("Wrote ", json_path, " (", nrow(d), " nodes)")

  ## Save the reference figure for the side-by-side on /transparency. A tip-count
  ## aware height keeps large trees legible. Tip labels are dropped on the big
  ## trees so the shape (the thing we are validating) reads clearly.
  show_tips <- sum(d$isTip, na.rm = TRUE) <= 100
  fig <- p +
    geom_tree() +
    theme_tree() +
    (if (show_tips) geom_tiplab(size = 1.6) else NULL)
  png_path <- file.path(figure_dir, paste0(t$id, "-ggtree.png"))
  ggsave(
    png_path, plot = fig,
    width = 6, height = max(4, sum(d$isTip, na.rm = TRUE) * 0.05),
    units = "in", dpi = 150, limitsize = FALSE
  )
  message("Wrote ", png_path)
}

message("\nDone. Commit the JSON goldens under ", golden_dir,
        " and the PNG figures under ", figure_dir,
        ", then rebuild. The phylo-plots gate activates automatically once every ",
        "seeded tree's golden has pending = false.")
