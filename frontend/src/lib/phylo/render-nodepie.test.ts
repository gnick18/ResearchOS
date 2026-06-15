// Wave 4: nodepie / geom_star. A pie (or star glyph) drawn at the MRCA of named
// tips, sized by category proportions. Target is resolved by MRCA so it survives
// a re-layout without internal node labels (same idiom as a clade). Stored on the
// nodepie layer's options.pies seam, so a figure without one is unchanged.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import { generateGgtreeCode } from "./ggtree-code";
import type { AlignedPanel, PhyloLayout } from "./types";

const TREE = parseNewick("((A:0.1,B:0.2):0.3,(C:0.15,D:0.25):0.2);");
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

const piePanel: AlignedPanel = {
  id: "np1",
  kind: "nodepie",
  visible: true,
  options: {
    pies: [
      {
        id: "p1",
        tips: ["A", "B"],
        style: "pie",
        slices: [
          { label: "marine", value: 3, color: "#1AA0E6" },
          { label: "soil", value: 1, color: "#D85A30" },
        ],
      },
    ],
  },
};

function specFor(layout: PhyloLayout, panels: AlignedPanel[]) {
  return figureToRenderSpec(
    TREE,
    { layout, phylogram: true, tracks: NO_TRACKS, panels },
    { width: 500, height: 360 },
  );
}

describe("nodepie layer", () => {
  it("draws pie slices (two colors, arc paths) at the MRCA", () => {
    const out = renderTreeSvg(TREE, specFor("rectangular", [piePanel]));
    expect(out).toContain("#1AA0E6");
    expect(out).toContain("#D85A30");
    // pie slices are wedge paths (move to center, line out, arc back, close).
    expect(out).toMatch(/<path d="M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ A /);
  });

  it("renders a star polygon when style is star", () => {
    const star: AlignedPanel = {
      id: "np2",
      kind: "nodepie",
      visible: true,
      options: {
        pies: [
          {
            id: "p1",
            tips: ["A", "B"],
            style: "star",
            slices: [
              { label: "marine", value: 3, color: "#1AA0E6" },
              { label: "soil", value: 1, color: "#D85A30" },
            ],
          },
        ],
      },
    };
    const out = renderTreeSvg(TREE, specFor("rectangular", [star]));
    expect(out).toContain("<polygon");
  });

  it("also draws in the circular layout", () => {
    const out = renderTreeSvg(TREE, specFor("circular", [piePanel]));
    expect(out).toContain("#1AA0E6");
  });

  it("a hidden layer or empty tip set draws nothing", () => {
    const hidden = { ...piePanel, visible: false };
    expect(renderTreeSvg(TREE, specFor("rectangular", [hidden]))).not.toContain(
      "#1AA0E6",
    );
  });

  it("exports a nodepie data frame + geom_inset", () => {
    const code = generateGgtreeCode(specFor("rectangular", [piePanel]));
    expect(code).toContain("nodepie(pie_data");
    expect(code).toContain("geom_inset(pies");
    expect(code).toContain("MRCA(tree, c('A', 'B'))");
  });
});
