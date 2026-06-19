// Unit tests for phyloLayoutIssues -- the shared detection helper that drives BOTH
// the advisor card and the Shape-tab amber dot, so the two can never drift. It also
// pins the phylo fix filter (no tilt -- tilt does not de-collide a vertical tip-label
// stack), that the "make it taller" fix IS offered with a height that actually clears
// the crowding, and that a roomy figure stays quiet (no false positive).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "@/lib/phylo/parse";
import { figureToRenderSpec } from "@/lib/phylo/figure-to-render";
import type { AlignedPanel } from "@/lib/phylo/types";
import { phyloLayoutIssues } from "./PhyloLayoutAdvisor";

const NO_TRACKS = {
  labels: false,
  labelsItalic: false,
  points: false,
  strip: false,
  bars: false,
  heat: false,
  clade: false,
  support: false,
};

/** A balanced-ish newick with `n` long-named tips (long names so they crowd). */
function bigTree(n: number): string {
  const tips = Array.from(
    { length: n },
    (_, i) => `Strain_${String(i).padStart(3, "0")}_long_taxon_name:0.1`,
  );
  return `(${tips.join(",")});`;
}

const LABELS_ON: AlignedPanel[] = [
  { id: "labels", kind: "labels", visible: true, options: { tilt: 0 } } as AlignedPanel,
];

function issuesFor(n: number, w: number, h: number, panels: AlignedPanel[]) {
  const tree = parseNewick(bigTree(n));
  const spec = figureToRenderSpec(
    tree,
    { layout: "rectangular", phylogram: true, tracks: NO_TRACKS, panels } as never,
    { width: w, height: h },
  );
  return phyloLayoutIssues(tree, spec as never);
}

describe("phyloLayoutIssues", () => {
  it("is quiet when tip labels are off (nothing to crowd)", () => {
    const { collisions, fixes } = issuesFor(60, 620, 460, []);
    expect(collisions.length).toBe(0);
    expect(fixes.length).toBe(0);
  });

  it("detects label-crowding when labels are on and offers taller + shrink", () => {
    const { collisions, fixes } = issuesFor(60, 620, 460, LABELS_ON);
    expect(collisions.length).toBeGreaterThan(0);
    const ids = fixes.map((f) => f.id);
    expect(ids).toContain("shrink-label-font");
    // The figure height IS a Studio control now (the advisor drives it), so the only
    // honest fix for a dense stack is offered. Tilt still does not de-collide a
    // vertical tip-label stack, so it stays filtered out.
    expect(ids).toContain("increase-canvas-height");
    expect(ids).not.toContain("tilt-tip-labels");
  });

  it("recommends a height that actually clears the crowding (the real fix)", () => {
    // The HPV58-shaped case: ~90 tips in the default height crowd badly, and a font
    // shrink alone cannot separate them. Applying the recommended height to the spec
    // and re-detecting must drop the count to zero.
    const tree = parseNewick(bigTree(90));
    const base = figureToRenderSpec(
      tree,
      { layout: "rectangular", phylogram: true, tracks: NO_TRACKS, panels: LABELS_ON } as never,
      { width: 620, height: 460 },
    );
    const before = phyloLayoutIssues(tree, base as never);
    expect(before.collisions.length).toBeGreaterThan(50);
    expect(before.recommendedHeight).toBeGreaterThan(460);

    // Re-render at the recommended height (exactly what applyAdvisorDelta does).
    const taller = figureToRenderSpec(
      tree,
      { layout: "rectangular", phylogram: true, tracks: NO_TRACKS, panels: LABELS_ON } as never,
      { width: 620, height: before.recommendedHeight },
    );
    const after = phyloLayoutIssues(tree, taller as never);
    expect(after.collisions.length).toBe(0);
  });

  it("a font shrink alone does NOT clear a dense stack (why height is the fix)", () => {
    // Shrinking the tip font from 11 to its 7px floor still leaves the 90-tip stack
    // crowded in the default height -- this is the regression the height fix cures.
    const tree = parseNewick(bigTree(90));
    const SMALL: AlignedPanel[] = [
      { id: "labels", kind: "labels", visible: true, options: { tilt: 0, fontSize: 7 } } as AlignedPanel,
    ];
    const spec = figureToRenderSpec(
      tree,
      { layout: "rectangular", phylogram: true, tracks: NO_TRACKS, panels: SMALL } as never,
      { width: 620, height: 460 },
    );
    expect(phyloLayoutIssues(tree, spec as never).collisions.length).toBeGreaterThan(0);
  });

  it("stays quiet on a roomy figure with labels on (no false positive)", () => {
    // Few tips with plenty of vertical room -> labels do not crowd.
    const { collisions, fixes } = issuesFor(6, 620, 460, LABELS_ON);
    expect(collisions.length).toBe(0);
    expect(fixes.length).toBe(0);
  });
});
