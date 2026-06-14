import { describe, it, expect } from "vitest";
import { generateGgtreeCode, GGTREE_CAVEAT } from "./ggtree-code";
import type { RenderSpec, FigureTracks } from "./render";

function tracks(over: Partial<FigureTracks> = {}): FigureTracks {
  return {
    labels: false,
    labelsItalic: false,
    points: false,
    strip: false,
    bars: false,
    heat: false,
    clade: false,
    support: false,
    ...over,
  };
}

function spec(over: Partial<RenderSpec> = {}): RenderSpec {
  return {
    layout: "rectangular",
    phylogram: true,
    tracks: tracks(),
    columns: {},
    width: 560,
    height: 420,
    ...over,
  };
}

describe("generateGgtreeCode", () => {
  it("always emits the honest caveat and the standard library header", () => {
    const code = generateGgtreeCode(spec());
    expect(code).toContain(GGTREE_CAVEAT);
    expect(code).toContain("library(ggtree)");
    expect(code).toContain("library(ggtreeExtra)");
    expect(code).toContain('read.tree("tree.nwk")');
    expect(code).toContain("theme_tree()");
    expect(code).toContain("geom_treescale()");
  });

  it("uses the metadata join only when metadata is bound", () => {
    const none = generateGgtreeCode(spec());
    expect(none).not.toContain("%<+%");
    expect(none).not.toContain("read.csv");

    const bound = generateGgtreeCode(
      spec({
        metadata: new Map([[0, { tip: "A", section: "Fumigati" }]]),
      }),
    );
    expect(bound).toContain("%<+%");
    expect(bound).toContain('read.csv("metadata.csv")');
  });

  it("emits geom_tiplab with fontface italic when labels are italic", () => {
    const code = generateGgtreeCode(
      spec({ tracks: tracks({ labels: true, labelsItalic: true }) }),
    );
    expect(code).toContain("geom_tiplab(");
    expect(code).toContain('fontface = "italic"');
  });

  it("emits geom_tippoint mapped to the category column", () => {
    const code = generateGgtreeCode(
      spec({
        tracks: tracks({ points: true }),
        columns: { category: "section" },
        metadata: new Map([[0, { section: "Fumigati" }]]),
      }),
    );
    expect(code).toContain("geom_tippoint(aes(color = section)");
  });

  it("emits geom_fruit for the color strip and the bar chart", () => {
    const code = generateGgtreeCode(
      spec({
        tracks: tracks({ strip: true, bars: true }),
        columns: { category: "section", bar: "genome" },
        metadata: new Map([[0, { section: "Fumigati", genome: "29.4" }]]),
      }),
    );
    expect(code).toContain("geom_fruit(geom = geom_tile");
    expect(code).toContain("geom_fruit(geom = geom_col");
    expect(code).toContain("aes(x = genome)");
  });

  it("emits a geom_fruit template for a datahubPlot panel, position by barMode", () => {
    const dodge = generateGgtreeCode(
      spec({
        panels: [
          {
            id: "d1",
            kind: "datahubPlot",
            visible: true,
            options: { title: "Abundance" },
          },
        ],
      }),
    );
    expect(dodge).toContain("geom_fruit(data = dat, geom = geom_col");
    expect(dodge).toContain("position = position_dodge2()");
    expect(dodge).toContain("Abundance");

    const relative = generateGgtreeCode(
      spec({
        panels: [
          {
            id: "d1",
            kind: "datahubPlot",
            visible: true,
            options: { barMode: "stack100" },
          },
        ],
      }),
    );
    expect(relative).toContain("position = position_fill()");
  });

  it("emits gheatmap with the selected gene columns", () => {
    const code = generateGgtreeCode(
      spec({
        tracks: tracks({ heat: true }),
        columns: { heat: ["gliP", "fumR"] },
        metadata: new Map([[0, { gliP: "1", fumR: "0" }]]),
      }),
    );
    expect(code).toContain("gheatmap(p");
    expect(code).toContain("'gliP'");
    expect(code).toContain("'fumR'");
  });

  it("emits geom_hilight with the clade node and label", () => {
    const code = generateGgtreeCode(
      spec({
        tracks: tracks({ clade: true }),
        cladeHighlight: { nodeId: 3, label: "Fumigati", color: "#1AA0E6" },
      }),
    );
    expect(code).toContain("geom_hilight(node = 3");
    expect(code).toContain("Fumigati");
  });

  it("emits manual color scales from the category color map", () => {
    const code = generateGgtreeCode(
      spec({
        tracks: tracks({ points: true }),
        columns: { category: "section" },
        categoryColors: { Fumigati: "#1AA0E6", Flavi: "#5B47D6" },
        metadata: new Map([[0, { section: "Fumigati" }]]),
      }),
    );
    expect(code).toContain("scale_color_manual(values = c(");
    expect(code).toContain('Fumigati = ');
    expect(code).toContain("#1AA0E6");
  });

  it("uses the circular layout string for a circular figure", () => {
    const code = generateGgtreeCode(spec({ layout: "circular" }));
    expect(code).toContain("layout = 'circular'");
  });

  it("backtick-quotes a column name that is not a bare R identifier", () => {
    const code = generateGgtreeCode(
      spec({
        tracks: tracks({ points: true }),
        columns: { category: "host species" },
        metadata: new Map([[0, { "host species": "bat" }]]),
      }),
    );
    expect(code).toContain("aes(color = `host species`)");
  });
});
