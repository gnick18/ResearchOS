"use client";

// The Tree Studio (phylo). Phase 1 ships a placeholder: the figure editor (the
// iTOL alternative) is the next build chunk. This is a calm "in progress" surface
// so the tab never reads as broken, not a dead control. The real Studio renders a
// native SVG tree, links a metadata table, toggles annotation tracks, and exports
// SVG / PNG plus ggtree code. Design: docs/proposals/2026-06-12-phylogenetics-page.md.

import { Icon } from "@/components/icons";

export function PhyloStudio() {
  return (
    <div className="border border-dashed border-border rounded-2xl bg-surface-raised p-10 text-center max-w-2xl mx-auto">
      <Icon name="tree" className="w-10 h-10 text-brand-sky mx-auto mb-3" />
      <h2 className="text-heading font-extrabold text-foreground mb-2">
        Tree Studio is on the way
      </h2>
      <p className="text-body text-foreground-muted">
        The figure editor is the next build. You will bring a finished tree, link
        a metadata table, auto-annotate (tip colors, strips, bars, heatmaps, clade
        highlights), and edit the figure right here, then export SVG and PNG plus
        the ggtree code that recreates it.
      </p>
      <p className="text-sm text-foreground-muted mt-3">
        For now, use Tree Builder to generate the script that produces your tree.
      </p>
    </div>
  );
}
