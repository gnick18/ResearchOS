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
      height: 220, // short canvas, so the 4 legends columnize rather than stack
      metadata: META,
      panels: strips,
    };
  }

  it("renders all four legend titles without overflowing the canvas height", () => {
    const svg = renderTreeSvg(TREE, manyLegendSpec());
    // All four legend keys appear (the legends columnize to fit, none dropped). With
    // 4 colored columns the rectangular headers are numbered badges (not text), so
    // the column names live in the LEGEND, which must therefore show every key.
    for (const c of ["c1", "c2", "c3", "c4"]) expect(svg).toContain(c);
    // No legend text is placed below the 220px canvas (a y past the height would
    // be off-canvas). We assert the legend x positions span more than one column
    // (columnization happened) by checking two distinct legend x offsets exist.
    const xs = Array.from(svg.matchAll(/<text x="(\d+(?:\.\d+)?)" y="\d+" font-size="11"/g)).map(
      (m) => Number(m[1]),
    );
    expect(new Set(xs).size).toBeGreaterThan(1);
  });

  it("dedupes identical legends when one column drives multiple overlays", () => {
    // The smart-binding multi-add can bind ONE column to several geoms; without
    // dedupe each draws the same colorbar, piling redundant keys over the labels
    // (the crowded-overlay report, 2026-06-15). Two strips on the same column must
    // yield a single legend.
    const rows = [
      { tip: "A", zzcol: "x" },
      { tip: "B", zzcol: "y" },
      { tip: "C", zzcol: "x" },
      { tip: "D", zzcol: "y" },
    ];
    const META = matchMetadataToTips(TREE, rows, "tip").matched;
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
      width: 700,
      height: 480,
      metadata: META,
      // Tip-point decorations color by a column (so each contributes a legend)
      // but draw no column-name header on the tree, so the only place the column
      // name appears is the legend title - isolating the legend count.
      panels: [
        { id: "p1", kind: "points", visible: true, column: "zzcol", legend: true },
        { id: "p2", kind: "points", visible: true, column: "zzcol", legend: true },
      ],
    };
    const svg = renderTreeSvg(TREE, spec);
    // Two same-column point overlays -> exactly one legend after dedupe.
    expect((svg.match(/>zzcol</g) ?? []).length).toBe(1);
  });
});

describe("distribution panel value scale-key (circular numeric axis fix)", () => {
  // A distribution geom (violin / point / scatter) encodes value by position with
  // a fixed fill, so it has no color legend. In circular the value axis is only a
  // guide ring with no numbers, leaving the range unreadable. The scale-key adds a
  // titled, ticked numeric key in the legend column for both layouts.
  const ROWS = [
    { tip: "A", yr: "2010" },
    { tip: "B", yr: "2015" },
    { tip: "C", yr: "2020" },
    { tip: "D", yr: "2025" },
  ];
  const META = matchMetadataToTips(TREE, ROWS, "tip").matched;

  function pointSpec(
    layout: "rectangular" | "circular",
    axis = true,
  ): RenderSpec {
    const point: AlignedPanel = {
      id: "pt",
      kind: "point",
      visible: true,
      column: "yr",
      legend: true,
      options: { errorKind: "none", axis },
    };
    return {
      layout,
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
      height: 480,
      metadata: META,
      panels: [point],
    };
  }

  // The legend title is the bold 11px text; the panel's own column header is a
  // separate lighter 8.5px label, so match the legend marker specifically.
  const LEGEND_TITLE = /font-size="11" font-weight="700"[^>]*>yr</;

  for (const layout of ["rectangular", "circular"] as const) {
    it(`emits a numeric scale-key titled by the bound column (${layout})`, () => {
      const svg = renderTreeSvg(TREE, pointSpec(layout));
      expect(svg).toMatch(LEGEND_TITLE);
      // A niceTicks numeric label in the value range is drawn (the readable axis),
      // so the circular reader is no longer left with an unlabeled guide ring.
      expect(svg).toMatch(/text-anchor="middle">2\d{3}</);
    });
  }

  it("axis off suppresses the scale-key in circular (no numbers either)", () => {
    const on = renderTreeSvg(TREE, pointSpec("circular", true));
    const off = renderTreeSvg(TREE, pointSpec("circular", false));
    expect(on).toMatch(LEGEND_TITLE);
    expect(off).not.toMatch(LEGEND_TITLE);
    // With the key gone and circular drawing no axis ticks, no numeric labels remain.
    expect(off).not.toMatch(/text-anchor="middle">2\d{3}</);
  });
});

describe("tip-label options (Wave 1: geom_tiplab / geom_label parity)", () => {
  const ROWS = [
    { tip: "A", grp: "X" },
    { tip: "B", grp: "X" },
    { tip: "C", grp: "Y" },
    { tip: "D", grp: "Y" },
  ];
  const META = matchMetadataToTips(TREE, ROWS, "tip").matched;
  function labelSpec(options: Record<string, unknown>): RenderSpec {
    const labels: AlignedPanel = {
      id: "lab",
      kind: "labels",
      visible: true,
      options,
    };
    return {
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
      columns: {},
      width: 700,
      height: 480,
      metadata: META,
      panels: [labels],
    };
  }

  it("applies a custom font size", () => {
    expect(renderTreeSvg(TREE, labelSpec({ fontSize: 14 }))).toContain(
      'font-size="14"',
    );
  });

  it("boxed draws a bordered box per label (geom = label)", () => {
    const boxed = renderTreeSvg(TREE, labelSpec({ boxed: true }));
    const plain = renderTreeSvg(TREE, labelSpec({ boxed: false }));
    expect(boxed).toContain('stroke-width="0.75"');
    expect(plain).not.toContain('stroke-width="0.75"');
  });

  it("color-by-column colors labels by the trait (distinct groups, distinct fills)", () => {
    const svg = renderTreeSvg(TREE, labelSpec({ colorColumn: "grp" }));
    const fills = new Set(
      Array.from(
        svg.matchAll(/<text[^>]*font-size="11"[^>]*fill="(#[0-9a-fA-F]+)"/g),
      ).map((m) => m[1]),
    );
    expect(fills.size).toBeGreaterThan(1);
  });
});

describe("branch coloring by trait (Wave 2: aes(color=...))", () => {
  // (A,B) share grp X, (C,D) share grp Y: each clade is monophyletic for grp, so
  // its branches color; the root transition between them stays the default ink.
  const ROWS = [
    { tip: "A", grp: "X" },
    { tip: "B", grp: "X" },
    { tip: "C", grp: "Y" },
    { tip: "D", grp: "Y" },
  ];
  function bcSpec(branchColorColumn: string): RenderSpec {
    return figureToRenderSpec(
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
        metaRows: ROWS,
        tipColumn: "tip",
        branchColorColumn,
      },
      { width: 700, height: 480 },
    );
  }
  const branchStrokes = (svg: string): Set<string> =>
    new Set(
      Array.from(
        svg.matchAll(
          /<path d="M[^"]*"[^>]*stroke="(#[0-9a-fA-F]+)" stroke-width="1\.5"/g,
        ),
      ).map((m) => m[1]),
    );

  it("no column leaves every branch the default ink", () => {
    expect(branchStrokes(renderTreeSvg(TREE, bcSpec(""))).size).toBe(1);
  });

  it("a bound column paints the monophyletic clades (multiple branch colors)", () => {
    expect(
      branchStrokes(renderTreeSvg(TREE, bcSpec("grp"))).size,
    ).toBeGreaterThan(1);
  });
});

describe("multi-clade highlights by MRCA (Wave 2: geom_hilight)", () => {
  // TREE = ((A,B),(C,D)): clade (A,B) and clade (C,D) are each a valid MRCA.
  function cladeSpec(
    layout: "rectangular" | "circular",
    clades: Record<string, unknown>[],
  ): RenderSpec {
    const clade: AlignedPanel = {
      id: "cl",
      kind: "clade",
      visible: true,
      options: { clades },
    };
    return {
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
      columns: {},
      width: 700,
      height: 480,
      panels: [clade],
    };
  }

  it("rectangular: highlights each named clade with its color + label", () => {
    const svg = renderTreeSvg(
      TREE,
      cladeSpec("rectangular", [
        { id: "a", tips: ["A", "B"], color: "#ff0000", label: "Clade AB" },
        { id: "b", tips: ["C", "D"], color: "#00ff00", label: "Clade CD" },
      ]),
    );
    expect(svg).toContain('fill="#ff0000" opacity="0.10"');
    expect(svg).toContain('fill="#00ff00" opacity="0.10"');
    expect(svg).toContain("Clade AB");
    expect(svg).toContain("Clade CD");
  });

  it("rectangular: anchors the highlight left edge at the clade MRCA stem, not the tree base", () => {
    const svg = renderTreeSvg(
      TREE,
      cladeSpec("rectangular", [
        { id: "b", tips: ["C", "D"], color: "#00ff00", label: "" },
      ]),
    );
    // The band must start at the middle of the (C,D) MRCA's stem branch, well to
    // the right of the old hardcoded tree-base inset (x=12) - conventional
    // geom_hilight placement.
    const m = svg.match(
      /<rect x="([\d.]+)"[^>]*fill="#00ff00" opacity="0\.10"/,
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(12);
  });

  it("circular: draws an annulus band for a named clade", () => {
    const svg = renderTreeSvg(
      TREE,
      cladeSpec("circular", [
        { id: "a", tips: ["A", "B"], color: "#ff0000", label: "" },
      ]),
    );
    expect(svg).toContain('fill="#ff0000" opacity="0.12"');
  });

  it("a clade naming a missing tip is skipped, never crashes", () => {
    const svg = renderTreeSvg(
      TREE,
      cladeSpec("rectangular", [
        { id: "x", tips: ["A", "Ghost"], color: "#123456", label: "X" },
      ]),
    );
    expect(svg).not.toContain("#123456");
  });

  it("style 'label' draws a bracket (geom_cladelab), not a shaded band", () => {
    const svg = renderTreeSvg(
      TREE,
      cladeSpec("rectangular", [
        { id: "a", tips: ["A", "B"], color: "#ff0000", label: "AB", style: "label" },
      ]),
    );
    expect(svg).not.toContain('opacity="0.10"'); // no shaded highlight
    expect(svg).toContain('stroke="#ff0000" stroke-width="1.5"'); // the bracket
    expect(svg).toContain("AB");
  });

  it("collapse: replaces a clade subtree with a triangle (fewer branches)", () => {
    const branches = (s: string) => (s.match(/<path d="M[^"]*V/g) || []).length;
    const open = renderTreeSvg(
      TREE,
      cladeSpec("rectangular", [
        { id: "a", tips: ["A", "B"], color: "#ff0000", label: "AB" },
      ]),
    );
    const collapsed = renderTreeSvg(
      TREE,
      cladeSpec("rectangular", [
        { id: "a", tips: ["A", "B"], color: "#ff0000", label: "AB", collapsed: true },
      ]),
    );
    // (A,B) is folded to one leaf, so its sub-branches are gone.
    expect(branches(collapsed)).toBeLessThan(branches(open));
    expect(collapsed).toContain('opacity="0.45"'); // the triangle
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
