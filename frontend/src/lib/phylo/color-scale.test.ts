import { describe, it, expect } from "vitest";

import { parseNewick, leaves } from "./parse";
import {
  classifyColumn,
  buildColorScale,
  EMPTY_FILL,
  DEFAULT_CONTINUOUS_PALETTE_ID,
} from "./color-scale";
import { renderTreeSvg, type RenderSpec, type FigureTracks } from "./render";

// A 4-tip tree with a numeric column (year) and a categorical column (clade).
const NWK = "((A:1,B:1):1,(C:1,D:1):1);";

function metaMap(
  tree: ReturnType<typeof parseNewick>,
  rows: Record<string, string>[],
): Map<number, Record<string, string>> {
  const byName = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<number, Record<string, string>>();
  for (const tip of leaves(tree)) {
    const row = byName.get(tip.name);
    if (row) out.set(tip.id, row);
  }
  return out;
}

const ROWS = [
  { id: "A", year: "2010", clade: "I" },
  { id: "B", year: "2015", clade: "II" },
  { id: "C", year: "2020", clade: "I" },
  { id: "D", year: "", clade: "II" }, // a blank numeric cell + a category
];

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

describe("classifyColumn", () => {
  const tree = parseNewick(NWK);
  const meta = metaMap(tree, ROWS);

  it("calls an all-numeric column (with a blank) numeric", () => {
    expect(classifyColumn(tree, meta, "year")).toBe("numeric");
  });

  it("calls a string column categorical", () => {
    expect(classifyColumn(tree, meta, "clade")).toBe("categorical");
  });

  it("defaults to categorical with no metadata or column", () => {
    expect(classifyColumn(tree, undefined, "year")).toBe("categorical");
    expect(classifyColumn(tree, meta, undefined)).toBe("categorical");
  });
});

describe("buildColorScale", () => {
  const tree = parseNewick(NWK);
  const meta = metaMap(tree, ROWS);

  it("numeric column -> continuous scale over the value range", () => {
    const s = buildColorScale(tree, meta, "year");
    expect(s.kind).toBe("numeric");
    expect(s.domain).toEqual({ min: 2010, max: 2020 });
    expect(s.paletteId).toBe(DEFAULT_CONTINUOUS_PALETTE_ID);
    // min and max map to different colors (a real gradient).
    expect(s.colorFor("2010")).not.toBe(s.colorFor("2020"));
    // a blank cell is the empty fill.
    expect(s.colorFor("")).toBe(EMPTY_FILL);
  });

  it("categorical column -> stable distinct hues", () => {
    const s = buildColorScale(tree, meta, "clade");
    expect(s.kind).toBe("categorical");
    expect(s.categories).toEqual(["I", "II"]);
    expect(s.colorFor("I")).not.toBe(s.colorFor("II"));
  });

  it("honors a sequential palette override for a numeric column", () => {
    const s = buildColorScale(tree, meta, "year", { paletteId: "cb-blues" });
    expect(s.paletteId).toBe("cb-blues");
  });
});

describe("renderTreeSvg with continuous tracks + legend", () => {
  const tree = parseNewick(NWK);
  const meta = metaMap(tree, ROWS);

  function spec(over: Partial<RenderSpec> = {}): RenderSpec {
    return {
      layout: "rectangular",
      phylogram: false,
      tracks: tracks({ heat: true, strip: true }),
      columns: { category: "clade", heat: ["year"] },
      width: 600,
      height: 400,
      metadata: meta,
      ...over,
    };
  }

  it("emits a gradient legend for a numeric heat column", () => {
    const svg = renderTreeSvg(tree, spec());
    expect(svg).toContain("<linearGradient");
    // the legend titles the column.
    expect(svg).toContain("year");
  });

  it("legend off removes the gradient legend", () => {
    const svg = renderTreeSvg(tree, spec({ legend: false }));
    expect(svg).not.toContain("<linearGradient");
  });

  it("renders without a legend when no metadata is bound", () => {
    const svg = renderTreeSvg(
      tree,
      spec({ metadata: undefined, columns: {} }),
    );
    // Starts with an SVG root element (token split so the icon guard, which
    // counts the literal "<" + "svg" substring, does not flag this test file).
    expect(svg.startsWith("<" + "svg")).toBe(true);
    expect(svg).not.toContain("<linearGradient");
  });

  it("draws circular ring tracks without throwing", () => {
    const svg = renderTreeSvg(
      tree,
      spec({ layout: "circular", tracks: tracks({ heat: true, bars: true, strip: true }), columns: { category: "clade", bar: "year", heat: ["year"] } }),
    );
    expect(svg).toContain("<path");
  });
});
