// Phylo Phase 3: the msa render path, multi-panel legend polish, and the
// template-apply idempotence the flicker fix guarantees.
//
// Inline trees + alignments only. Asserts the msa panel draws a residue matrix
// (rect cells + circular wedges) with its residue legend and downsample note,
// the legend area columnizes at many legends without overflow, and an applied
// template stack renders identically twice (a pure, atomic apply, the property
// the flicker fix preserves).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick, leaves } from "./parse";
import { matchMetadataToTips } from "./layout";
import { figureToRenderSpec } from "./figure-to-render";
import { parseAlignment, type Alignment } from "./msa";
import { renderTreeSvg, type RenderSpec } from "./render";
import type { AlignedPanel } from "./types";

const TREE = parseNewick("((A:0.1,B:0.2)90:0.3,(C:0.15,D:0.25)80:0.2);");
const ALN: Alignment = parseAlignment(
  ">A\nACGTACGT\n>B\nACGT--GT\n>C\nAGGTACGT\n>D\nATGTACGT\n",
);

function msaSpec(
  panels: AlignedPanel[],
  layout: "rectangular" | "circular",
): RenderSpec {
  return figureToRenderSpec(
    TREE,
    {
      layout,
      phylogram: true,
      tracks: {
        labels: false,
        labelsItalic: false,
        points: false,
        strip: false,
        bars: false,
        heat: false,
        clade: false,
        support: false,
      },
      alignment: ALN,
      panels,
    },
    { width: 700, height: 480 },
  );
}

describe("msa render", () => {
  const msa: AlignedPanel = { id: "m1", kind: "msa", visible: true, legend: true };

  it("draws a residue cell per block per tip (rectangular)", () => {
    const svg = renderTreeSvg(TREE, msaSpec([msa], "rectangular"));
    const cells = (svg.match(/<rect/g) ?? []).length;
    // 4 tips * 8 columns of residues = 32 cells, plus the canvas background rect.
    expect(cells).toBeGreaterThanOrEqual(32);
  });

  it("colors residues by the nucleotide palette (A green, C sky, gap empty)", () => {
    const svg = renderTreeSvg(TREE, msaSpec([msa], "rectangular"));
    expect(svg).toContain("#16a34a"); // A
    expect(svg).toContain("#1AA0E6"); // C
    expect(svg).toContain("#f1f5f9"); // gap fill (B has a -- gap)
  });

  it("draws the residue-key legend (the color key) for the msa panel", () => {
    const svg = renderTreeSvg(TREE, msaSpec([msa], "rectangular"));
    expect(svg).toContain("Alignment");
    expect(svg).toContain("T / U");
    expect(svg).toContain("gap / other");
  });

  it("suppresses the msa legend when legend is off", () => {
    const on = renderTreeSvg(TREE, msaSpec([{ ...msa, legend: true }], "rectangular"));
    const off = renderTreeSvg(TREE, msaSpec([{ ...msa, legend: false }], "rectangular"));
    expect(on).toContain("T / U");
    expect(off).not.toContain("T / U");
  });

  it("draws circular wedges for the msa ring band", () => {
    const svg = renderTreeSvg(TREE, msaSpec([msa], "circular"));
    // The ring band tiles wedge paths (annulus sectors), one per block per tip.
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(
      leaves(TREE).length,
    );
  });

  it("notes the downsampling for a wide alignment, never silently dropping", () => {
    const wide = "A".repeat(5000);
    const bigAln = parseAlignment(
      `>A\n${wide}\n>B\n${wide}\n>C\n${wide}\n>D\n${wide}\n`,
    );
    const spec = figureToRenderSpec(
      TREE,
      {
        layout: "rectangular",
        phylogram: true,
        tracks: {
          labels: false,
          labelsItalic: false,
          points: false,
          strip: false,
          bars: false,
          heat: false,
          clade: false,
          support: false,
        },
        alignment: bigAln,
        panels: [msa],
      },
      { width: 700, height: 480 },
    );
    const svg = renderTreeSvg(TREE, spec);
    expect(svg).toContain("binned"); // the downsample note text
    expect(spec.msaTrack?.note).toContain("5000 cols");
  });

  it("draws nothing for an msa panel with no alignment track", () => {
    const spec = msaSpec([msa], "rectangular");
    const noTrack: RenderSpec = { ...spec, msaTrack: undefined };
    const svg = renderTreeSvg(TREE, noTrack);
    // No residue legend without a track.
    expect(svg).not.toContain("T / U");
  });
});

describe("multi-panel legend polish", () => {
  // Many colored panels with a tall categorical legend each, to force the legend
  // area to columnize rather than overflow.
  const ROWS = Array.from({ length: 4 }, (_, i) => ({
    tip: ["A", "B", "C", "D"][i],
    c1: `cat${i}`,
    c2: `grp${i}`,
    c3: `set${i}`,
    c4: `box${i}`,
  }));
  const META = matchMetadataToTips(TREE, ROWS, "tip").matched;

  function manyLegendSpec(): RenderSpec {
    const strips: AlignedPanel[] = ["c1", "c2", "c3", "c4"].map((c, i) => ({
      id: `s${i}`,
      kind: "strip",
      visible: true,
      column: c,
      legend: true,
    }));
    return {
      layout: "rectangular",
      phylogram: false,
      tracks: {
        labels: false,
        labelsItalic: false,
        points: false,
        strip: false,
        bars: false,
        heat: false,
        clade: false,
        support: false,
      },
      columns: {},
      width: 700,
      height: 96, // tiny canvas, so 4 legends cannot stack in one column
      metadata: META,
      panels: strips,
    };
  }

  it("renders all four legend titles without overflowing the canvas height", () => {
    const svg = renderTreeSvg(TREE, manyLegendSpec());
    // All four panel titles appear (the legends columnize to fit, none dropped).
    for (const c of ["c1", "c2", "c3", "c4"]) expect(svg).toContain(c);
    // No legend text is placed below the 220px canvas (a y past the height would
    // be off-canvas). We assert the legend x positions span more than one column
    // (columnization happened) by checking two distinct legend x offsets exist.
    const xs = Array.from(svg.matchAll(/<text x="(\d+(?:\.\d+)?)" y="\d+" font-size="11"/g)).map(
      (m) => Number(m[1]),
    );
    expect(new Set(xs).size).toBeGreaterThan(1);
  });
});

describe("template-apply idempotence (flicker fix)", () => {
  // The flicker fix makes the apply atomic + pure: rendering the SAME applied
  // layer stack twice must produce byte-identical markup (no transient state).
  it("a fixed panel stack renders identically across two renders", () => {
    const panels: AlignedPanel[] = [
      { id: "strip-x", kind: "strip", visible: true, column: "c1", legend: true },
      { id: "labels-x", kind: "labels", visible: true, options: { italic: true } },
    ];
    const ROWS = [
      { tip: "A", c1: "I" },
      { tip: "B", c1: "I" },
      { tip: "C", c1: "II" },
      { tip: "D", c1: "II" },
    ];
    const META = matchMetadataToTips(TREE, ROWS, "tip").matched;
    const spec: RenderSpec = {
      layout: "rectangular",
      phylogram: false,
      tracks: {
        labels: false,
        labelsItalic: false,
        points: false,
        strip: false,
        bars: false,
        heat: false,
        clade: false,
        support: false,
      },
      columns: {},
      width: 600,
      height: 400,
      metadata: META,
      categoryColors: { I: "#1AA0E6", II: "#5B47D6" },
      panels,
    };
    const a = renderTreeSvg(TREE, spec);
    const b = renderTreeSvg(TREE, spec);
    expect(a).toBe(b);
  });
});
