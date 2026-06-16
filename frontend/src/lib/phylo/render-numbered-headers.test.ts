// Numbered rectangular column headers (Grant 2026-06-16). When 2+ colored columns
// share the header band their text titles collide ("CLADE" over "FCZ +2"), so each
// column gets a small numbered badge keyed to the matching legend entry (which is
// prefixed with the same badge). A single colored column keeps its text title.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { matchMetadataToTips } from "./layout";
import { renderTreeSvg } from "./render";
import type { RenderSpec } from "./render";
import type { AlignedPanel } from "./types";

const TREE = parseNewick("((A:0.1,B:0.2):0.3,(C:0.15,D:0.25):0.2);");
const ROWS = Array.from({ length: 4 }, (_, i) => ({
  tip: ["A", "B", "C", "D"][i],
  CLADE: `clade${i % 2}`,
  FCZ: `fcz${i % 2}`,
}));
const META = matchMetadataToTips(TREE, ROWS, "tip").matched;

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

function specWithStrips(cols: string[]): RenderSpec {
  const panels: AlignedPanel[] = cols.map((c, i) => ({
    id: `s${i}`,
    kind: "strip",
    visible: true,
    column: c,
    legend: true,
  }));
  return {
    layout: "rectangular",
    phylogram: false,
    tracks: NO_TRACKS,
    columns: {},
    width: 500,
    height: 360,
    metadata: META,
    panels,
  };
}

// The number badge is a white disc with a black ring (numberBadge).
const BADGE = /r="6\.5" fill="#ffffff" stroke="#111111"/g;

describe("numbered column headers", () => {
  it("draws a badge per column AND per legend key when 2+ colored columns", () => {
    const svg = renderTreeSvg(TREE, specWithStrips(["CLADE", "FCZ"]));
    // 2 column headers + 2 legend keys = 4 badges.
    expect((svg.match(BADGE) || []).length).toBe(4);
    // The badges carry the numbers 1 and 2.
    expect(svg).toContain(">1</text>");
    expect(svg).toContain(">2</text>");
    // The column names still appear (in the legend keys, which the badges point to).
    expect(svg).toContain("CLADE");
    expect(svg).toContain("FCZ");
  });

  it("keeps a text title and no badge for a single colored column", () => {
    const svg = renderTreeSvg(TREE, specWithStrips(["CLADE"]));
    expect((svg.match(BADGE) || []).length).toBe(0);
    // The header text title (font-weight 600) is drawn instead.
    expect(svg).toContain('font-weight="600"');
    expect(svg).toContain("CLADE");
  });

  it("does not number a circular figure (it uses gutter callouts instead)", () => {
    const svg = renderTreeSvg(TREE, {
      ...specWithStrips(["CLADE", "FCZ"]),
      layout: "circular",
    });
    expect((svg.match(BADGE) || []).length).toBe(0);
  });
});
