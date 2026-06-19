// Phylo Phase 1: the layer-stack projection (migration) + value / scale resolve.
//
// Uses only inline trees + the committed seed source fixtures (never the external
// ggtree corpus), so CI never reaches off-repo data.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNewick } from "./parse";
import { parseCsv, matchMetadataToTips } from "./layout";
import {
  projectTracksToPanels,
  extractPanelValues,
  buildPanelScales,
  reorderPanels,
} from "./panels";
import type { AlignedPanel } from "./types";
import { figureInputsFromStored, figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";

const HERE = dirname(fileURLToPath(import.meta.url));
function seed(rel: string): string {
  return readFileSync(join(HERE, "__seed__", "sources", rel), "utf8");
}

const TREE = parseNewick("((A:0.1,B:0.2)90:0.3,(C:0.15,D:0.25)80:0.2);");
const ROWS = [
  { tip: "A", clade: "I", ab: "10", load: "5" },
  { tip: "B", clade: "I", ab: "40", load: "8" },
  { tip: "C", clade: "II", ab: "70", load: "2" },
  { tip: "D", clade: "II", ab: "95", load: "9" },
];
const META = matchMetadataToTips(TREE, ROWS, "tip").matched;

const ALL_OFF = {
  labels: false,
  labelsItalic: false,
  points: false,
  strip: false,
  bars: false,
  heat: false,
  clade: false,
  support: false,
};

describe("projectTracksToPanels (Phase 0 -> layer stack migration)", () => {
  it("projects each enabled track into a layer, in draw order", () => {
    const panels = projectTracksToPanels({
      tracks: {
        ...ALL_OFF,
        labels: true,
        labelsItalic: true,
        points: true,
        strip: true,
        bars: true,
        heat: true,
        clade: true,
        support: true,
      },
      category: "clade",
      bar: "load",
      heat: ["ab"],
    });
    const kinds = panels.map((p) => p.kind);
    // Highlights + decorations first, aligned columns inner->outer, labels last.
    expect(kinds).toEqual([
      "clade",
      "support",
      "points",
      "strip",
      "heat",
      "bars",
      "labels",
    ]);
    expect(panels.every((p) => p.id)).toBe(true); // every layer has a stable id
    expect(panels.find((p) => p.kind === "strip")?.column).toBe("clade");
    expect(panels.find((p) => p.kind === "bars")?.column).toBe("load");
    expect(panels.find((p) => p.kind === "heat")?.columns).toEqual(["ab"]);
    expect(panels.find((p) => p.kind === "labels")?.options?.italic).toBe(true);
  });

  it("omits a track with no bound column (no orphan layer)", () => {
    const panels = projectTracksToPanels({
      tracks: { ...ALL_OFF, strip: true, bars: true },
      // no category, no bar column
    });
    expect(panels).toEqual([]);
  });

  it("a bare labels-only figure projects to one labels layer", () => {
    const panels = projectTracksToPanels({
      tracks: { ...ALL_OFF, labels: true },
    });
    expect(panels.map((p) => p.kind)).toEqual(["labels"]);
  });

  it("carries the Phase 0 palette override onto the strip scale", () => {
    const panels = projectTracksToPanels({
      tracks: { ...ALL_OFF, strip: true },
      category: "clade",
      scales: { category: "cb-blues" },
    });
    expect(panels[0].scale).toEqual({
      kind: "continuous",
      paletteId: "cb-blues",
    });
  });
});

describe("extractPanelValues", () => {
  it("single-column panel maps tip id -> raw cell", () => {
    const v = extractPanelValues(
      { id: "s", kind: "strip", visible: true, column: "clade" },
      TREE,
      META,
    );
    const tipA = [...META.entries()].find(([, r]) => r.tip === "A")![0];
    expect(v.single?.get(tipA)).toBe("I");
  });

  it("heat matrix maps tip id -> one cell per column", () => {
    const v = extractPanelValues(
      { id: "h", kind: "heat", visible: true, columns: ["ab", "load"] },
      TREE,
      META,
    );
    const tipC = [...META.entries()].find(([, r]) => r.tip === "C")![0];
    expect(v.matrix?.get(tipC)).toEqual(["70", "2"]);
  });

  it("box panel parses replicate columns to numbers", () => {
    const v = extractPanelValues(
      { id: "b", kind: "box", visible: true, columns: ["ab", "load"] },
      TREE,
      META,
    );
    const tipD = [...META.entries()].find(([, r]) => r.tip === "D")![0];
    expect(v.replicates?.get(tipD)).toEqual([95, 9]);
  });

  // Phase 2: violin + scatter share the box's replicate binding.
  for (const kind of ["violin", "scatter"] as const) {
    it(`${kind} panel reads the same replicate columns as box`, () => {
      const v = extractPanelValues(
        { id: kind, kind, visible: true, columns: ["ab", "load"] },
        TREE,
        META,
      );
      const tipB = [...META.entries()].find(([, r]) => r.tip === "B")![0];
      expect(v.replicates?.get(tipB)).toEqual([40, 8]);
    });
  }

  it("point panel from replicate columns derives mean + sample SD", () => {
    const v = extractPanelValues(
      {
        id: "pt",
        kind: "point",
        visible: true,
        columns: ["ab", "load"],
        options: { errorKind: "sd" },
      },
      TREE,
      META,
    );
    const tipA = [...META.entries()].find(([, r]) => r.tip === "A")![0];
    const st = v.pointStats!.get(tipA)!;
    // ab=10, load=5 -> mean 7.5, sample sd = sqrt(((2.5)^2+(2.5)^2)/1) = 3.5355...
    expect(st.mean).toBeCloseTo(7.5, 6);
    expect(st.error).toBeCloseTo(Math.sqrt(((2.5) ** 2 + (2.5) ** 2) / 1), 6);
  });

  it("point panel error kind sem scales SD by 1/sqrt(n)", () => {
    const sd = extractPanelValues(
      { id: "p", kind: "point", visible: true, columns: ["ab", "load"], options: { errorKind: "sd" } },
      TREE,
      META,
    );
    const sem = extractPanelValues(
      { id: "p", kind: "point", visible: true, columns: ["ab", "load"], options: { errorKind: "sem" } },
      TREE,
      META,
    );
    const tipA = [...META.entries()].find(([, r]) => r.tip === "A")![0];
    const sdErr = sd.pointStats!.get(tipA)!.error;
    const semErr = sem.pointStats!.get(tipA)!.error;
    expect(semErr).toBeCloseTo(sdErr / Math.sqrt(2), 6);
  });

  it("point panel error kind none zeroes the whisker", () => {
    const v = extractPanelValues(
      { id: "p", kind: "point", visible: true, columns: ["ab", "load"], options: { errorKind: "none" } },
      TREE,
      META,
    );
    const tipA = [...META.entries()].find(([, r]) => r.tip === "A")![0];
    expect(v.pointStats!.get(tipA)!.error).toBe(0);
  });

  it("point panel from a value + explicit error column reads them straight", () => {
    const rows = [
      { tip: "A", val: "12", err: "1.5" },
      { tip: "B", val: "20", err: "3" },
    ];
    const tree = parseNewick("(A:1,B:1);");
    const meta = matchMetadataToTips(tree, rows, "tip").matched;
    const v = extractPanelValues(
      {
        id: "p",
        kind: "point",
        visible: true,
        column: "val",
        errorColumn: "err",
        options: { errorKind: "sd" },
      },
      tree,
      meta,
    );
    const tipB = [...meta.entries()].find(([, r]) => r.tip === "B")![0];
    expect(v.pointStats!.get(tipB)).toEqual({ mean: 20, error: 3 });
  });
});

describe("buildPanelScales", () => {
  it("a numeric column resolves a continuous scale + domain for bars", () => {
    const sc = buildPanelScales(
      { id: "x", kind: "bars", visible: true, column: "load" },
      TREE,
      META,
    );
    expect(sc.scale?.kind).toBe("numeric");
    expect(sc.domain).toEqual({ min: 0, max: 9 }); // bars anchor at 0
  });

  it("a categorical column resolves a categorical scale", () => {
    const sc = buildPanelScales(
      { id: "x", kind: "strip", visible: true, column: "clade" },
      TREE,
      META,
    );
    expect(sc.scale?.kind).toBe("categorical");
    expect(sc.scale?.categories).toEqual(["I", "II"]);
  });

  it("a heat matrix resolves one scale per column", () => {
    const sc = buildPanelScales(
      { id: "x", kind: "heat", visible: true, columns: ["ab", "load"] },
      TREE,
      META,
    );
    expect(sc.multi).toHaveLength(2);
    expect(sc.multi?.every((s) => s.kind === "numeric")).toBe(true);
  });
});

describe("back-compat: a pre-Phase-1 saved figure renders through panels", () => {
  it("a stored figure with NO panels projects + renders a non-empty figure", () => {
    // The shape a Phase 0 record carried: track booleans + column bindings, no panels.
    const inputs = figureInputsFromStored(
      {
        layout: "rectangular",
        branchLengths: true,
        tracks: { labels: true, points: true, strip: true, bars: true },
      },
      {
        tipColumn: "tip",
        rows: ROWS,
        categoryColumn: "clade",
        barColumn: "load",
      },
    );
    // The adapter projected a layer stack from the legacy fields.
    expect(inputs.panels).toBeUndefined(); // none stored
    const spec = figureToRenderSpec(TREE, inputs, { width: 560, height: 420 });
    expect(spec.panels && spec.panels.length).toBeGreaterThan(0);
    expect(spec.panels?.map((p) => p.kind)).toContain("strip");
    expect(spec.panels?.map((p) => p.kind)).toContain("bars");
    const svg = renderTreeSvg(TREE, spec);
    expect(svg.startsWith("<" + "svg")).toBe(true); // document shell
    expect(svg).toContain("<rect"); // strip / bar cells drew
  });

  it("a stored figure WITH panels uses them verbatim", () => {
    const inputs = figureInputsFromStored(
      {
        layout: "circular",
        branchLengths: true,
        tracks: {},
        panels: [
          { id: "p1", kind: "labels", visible: true },
          { id: "p2", kind: "heat", visible: true, columns: ["ab"], legend: true },
        ],
      },
      { tipColumn: "tip", rows: ROWS },
    );
    expect(inputs.panels?.map((p) => p.kind)).toEqual(["labels", "heat"]);
    const spec = figureToRenderSpec(TREE, inputs, { width: 560, height: 420 });
    expect(spec.panels).toBe(inputs.panels); // passed through, not re-projected
  });
});

describe("a committed seed tree projects + binds cleanly", () => {
  it("the Candida auris seed tree + metadata builds real panel values", () => {
    const tree = parseNewick(seed("candida_auris/tree.nwk"));
    const csv = parseCsv(seed("candida_auris/metadata.csv"));
    const tipCol = csv.columns[0];
    const matched = matchMetadataToTips(tree, csv.rows, tipCol).matched;
    expect(matched.size).toBeGreaterThan(0);
    // A categorical column drives a strip; values are non-empty for matched tips.
    const cat = csv.columns.find((c) => c !== tipCol)!;
    const v = extractPanelValues(
      { id: "s", kind: "strip", visible: true, column: cat },
      tree,
      matched,
    );
    const nonEmpty = [...(v.single?.values() ?? [])].filter(
      (x) => x.trim() !== "",
    );
    expect(nonEmpty.length).toBeGreaterThan(0);
  });
});

// BUG A regression: the drag-reorder commit transform. The setState-in-render
// warning is fixed in the component (commit from the pointerup event), but the
// resulting order must stay correct. reorderPanels is the shared pure transform.
describe("reorderPanels", () => {
  const mk = (id: string): AlignedPanel =>
    ({ id, kind: "strip", visible: true });
  const base = [mk("a"), mk("b"), mk("c"), mk("d")];

  it("moves a layer down to the new index", () => {
    const out = reorderPanels(base, 0, 2);
    expect(out.map((p) => p.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a layer up to the new index", () => {
    const out = reorderPanels(base, 3, 1);
    expect(out.map((p) => p.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the array unchanged for a no-op or out-of-range move", () => {
    expect(reorderPanels(base, 1, 1)).toBe(base);
    expect(reorderPanels(base, -1, 2)).toBe(base);
    expect(reorderPanels(base, 0, 9)).toBe(base);
  });

  it("does not mutate the input array", () => {
    const snapshot = base.map((p) => p.id);
    reorderPanels(base, 0, 3);
    expect(base.map((p) => p.id)).toEqual(snapshot);
  });
});
