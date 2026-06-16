// Unit tests for phyloLayoutIssues -- the shared detection helper that drives BOTH
// the advisor card and the Shape-tab amber dot, so the two can never drift. It also
// pins the phylo fix filter (no canvas-height, no tilt -- tilt does not de-collide a
// vertical tip-label stack) and that a roomy figure stays quiet (no false positive).
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

  it("detects label-crowding when labels are on and offers shrink-font", () => {
    const { collisions, fixes } = issuesFor(60, 620, 460, LABELS_ON);
    expect(collisions.length).toBeGreaterThan(0);
    const ids = fixes.map((f) => f.id);
    expect(ids).toContain("shrink-label-font");
    // Tilt does not de-collide a vertical tip-label stack, and canvas height has no
    // Studio control here, so neither is offered.
    expect(ids).not.toContain("tilt-tip-labels");
    expect(ids).not.toContain("increase-canvas-height");
  });

  it("stays quiet on a roomy figure with labels on (no false positive)", () => {
    // Few tips with plenty of vertical room -> labels do not crowd.
    const { collisions, fixes } = issuesFor(6, 620, 460, LABELS_ON);
    expect(collisions.length).toBe(0);
    expect(fixes.length).toBe(0);
  });
});
