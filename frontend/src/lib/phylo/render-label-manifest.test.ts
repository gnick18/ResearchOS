// The tip-label boxes in the layout manifest must reflect the ACTUAL rendered
// label ink (font size, reduced by tilt), not the full tip-row band. This is what
// lets the collision advisor's reversible label fixes -- shrink-label-font and
// tilt-tip-labels -- measurably reduce detected label-crowding. With the old
// full-band boxes, adjacent labels always touched, so crowding was over-reported
// and no reversible fix could ever clear it.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeWithManifest } from "./render";
import { detectCollisions } from "@/lib/figure/layout-collision";
import type { AlignedPanel, PhyloLayout } from "./types";

// A dense tree (many tips in a short canvas) so font-11 labels genuinely crowd.
const names = Array.from({ length: 48 }, (_, i) => `Isolate_${String(i).padStart(3, "0")}`);
function build(ns: string[]): string {
  if (ns.length === 1) return `${ns[0]}:0.2`;
  const m = Math.ceil(ns.length / 2);
  return `(${build(ns.slice(0, m))},${build(ns.slice(m))}):0.2`;
}
const TREE = parseNewick(`(${build(names)});`);
const NO_TRACKS = {
  labels: false, labelsItalic: false, points: false, strip: false,
  bars: false, heat: false, clade: false, support: false,
};

function specWithLabels(opts: Record<string, unknown>, layout: PhyloLayout = "rectangular") {
  const labels: AlignedPanel = { id: "lbl", kind: "labels", visible: true, options: opts };
  return figureToRenderSpec(
    TREE,
    { layout, phylogram: true, tracks: NO_TRACKS, panels: [labels] },
    { width: 480, height: 460 },
  );
}

const tipBoxes = (spec: ReturnType<typeof specWithLabels>) =>
  renderTreeWithManifest(TREE, spec).manifest.boxes.filter((b) => b.kind === "tipLabel");

describe("tip-label manifest box reflects the true oriented label ink", () => {
  it("box height equals the label font size (not the row band), at any tilt", () => {
    const flat = tipBoxes(specWithLabels({ fontSize: 11, tilt: 0 }));
    expect(flat.length).toBe(48);
    for (const b of flat) expect(b.h).toBeCloseTo(11, 5);
    // Tilt is carried as a real rotation, NOT a height shrink (the old cos proxy).
    const tilted = tipBoxes(specWithLabels({ fontSize: 11, tilt: -45 }));
    for (const b of tilted) expect(b.h).toBeCloseTo(11, 5);
  });

  it("a smaller font yields proportionally shorter boxes", () => {
    const big = tipBoxes(specWithLabels({ fontSize: 11 }))[0].h;
    const small = tipBoxes(specWithLabels({ fontSize: 7 }))[0].h;
    expect(small).toBeCloseTo(7, 5);
    expect(small).toBeLessThan(big);
  });

  it("tilting sets the box angle (the rotation), leaving width + height as the ink", () => {
    const flat = tipBoxes(specWithLabels({ fontSize: 11, tilt: 0 }))[0];
    const tilted = tipBoxes(specWithLabels({ fontSize: 11, tilt: -45 }))[0];
    expect(flat.angle ?? 0).toBe(0);
    expect(tilted.angle).toBe(-45);
    expect(tilted.h).toBeCloseTo(flat.h, 5); // height unchanged
    expect(tilted.w).toBeCloseTo(flat.w, 5); // width unchanged
  });
});

describe("shrinking the font is the lever that clears phylo label-crowding", () => {
  it("a smaller font clears crowding the full-band box could never clear", () => {
    const crowdedManifest = renderTreeWithManifest(TREE, specWithLabels({ fontSize: 11 })).manifest;
    const fixedManifest = renderTreeWithManifest(TREE, specWithLabels({ fontSize: 7 })).manifest;
    const crowded = detectCollisions(crowdedManifest).filter((c) => c.kind === "label-crowding");
    const fixed = detectCollisions(fixedManifest).filter((c) => c.kind === "label-crowding");
    expect(crowded.length).toBeGreaterThan(0); // dense font-11 labels really do crowd
    expect(fixed.length).toBeLessThan(crowded.length); // shrinking the font measurably helps
  });
});
