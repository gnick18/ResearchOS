// Locks the Phase-0 layer schema (the contextual-inspector engine). These pure
// rules drive which controls + columns the inspector shows, so they are pinned
// before any UI moves.

import { describe, it, expect } from "vitest";
import type { AlignedPanel, AlignedPanelKind } from "./types";
import {
  layerCategory,
  isRemovableLayer,
  columnFilterFor,
  filterColumns,
  kindDrawsLegend,
  errorBarControl,
  usesScaleKindSelect,
  kindNeeds,
  kindAvailable,
  unmetReason,
  type LayerCapabilities,
} from "./layer-schema";

const panel = (kind: AlignedPanelKind, extra: Partial<AlignedPanel> = {}): AlignedPanel => ({
  id: "p",
  kind,
  visible: true,
  ...extra,
});

describe("layerCategory", () => {
  it("tags intrinsic tree rendering as tree-element", () => {
    for (const k of ["labels", "points", "support", "nodepoints"] as AlignedPanelKind[])
      expect(layerCategory(k)).toBe("tree-element");
  });
  it("tags attached-data panels as data-overlay", () => {
    for (const k of ["strip", "heat", "bars", "dots", "box", "violin", "scatter", "point", "msa", "datahubPlot"] as AlignedPanelKind[])
      expect(layerCategory(k)).toBe("data-overlay");
  });
  it("tags annotations as highlight", () => {
    for (const k of ["clade", "taxalink", "taxastrip", "nodepie", "noderange"] as AlignedPanelKind[])
      expect(layerCategory(k)).toBe("highlight");
  });
});

describe("isRemovableLayer", () => {
  it("tree elements cannot be removed (style + show/hide only)", () => {
    for (const k of ["labels", "points", "support", "nodepoints"] as AlignedPanelKind[])
      expect(isRemovableLayer(k)).toBe(false);
  });
  it("overlays and highlights can be removed", () => {
    for (const k of ["strip", "heat", "datahubPlot", "clade", "nodepie"] as AlignedPanelKind[])
      expect(isRemovableLayer(k)).toBe(true);
  });
});

describe("columnFilterFor", () => {
  it("size-by needs numeric, shape-by needs categorical", () => {
    expect(columnFilterFor("points", "sizeColumn")).toBe("numeric");
    expect(columnFilterFor("points", "shapeColumn")).toBe("categorical");
  });
  it("point value/error/replicate columns are numeric", () => {
    expect(columnFilterFor("point", "column")).toBe("numeric");
    expect(columnFilterFor("point", "errorColumn")).toBe("numeric");
    expect(columnFilterFor("point", "columns")).toBe("numeric");
  });
  it("bars/dots value + box/violin/scatter replicates are numeric", () => {
    expect(columnFilterFor("bars", "column")).toBe("numeric");
    expect(columnFilterFor("dots", "column")).toBe("numeric");
    expect(columnFilterFor("box", "columns")).toBe("numeric");
    expect(columnFilterFor("violin", "columns")).toBe("numeric");
    expect(columnFilterFor("scatter", "columns")).toBe("numeric");
  });
  it("color bindings stay unconstrained (any)", () => {
    expect(columnFilterFor("points", "column")).toBe("any"); // color-by
    expect(columnFilterFor("strip", "column")).toBe("any");
    expect(columnFilterFor("labels", "colorColumn")).toBe("any");
  });
});

describe("filterColumns", () => {
  const kinds = { gc: "numeric", size: "numeric", section: "categorical", clade: "categorical" } as const;
  const all = ["gc", "size", "section", "clade"];
  it("keeps only numeric for a numeric field", () => {
    expect(filterColumns(all, kinds, "numeric")).toEqual(["gc", "size"]);
  });
  it("keeps only categorical for a categorical field", () => {
    expect(filterColumns(all, kinds, "categorical")).toEqual(["section", "clade"]);
  });
  it("never drops the currently-bound column even if it mismatches", () => {
    expect(filterColumns(all, kinds, "numeric", "section")).toContain("section");
  });
  it("offers every column when no classification is available", () => {
    expect(filterColumns(all, undefined, "numeric")).toEqual(all);
    expect(filterColumns(all, {}, "numeric")).toEqual(all);
  });
  it("returns all for an 'any' field", () => {
    expect(filterColumns(all, kinds, "any")).toEqual(all);
  });
});

describe("kindDrawsLegend", () => {
  it("a boxplot draws no color key (legend toggle removed)", () => {
    expect(kindDrawsLegend("box")).toBe(false);
  });
  it("data + points/strip/msa kinds draw a legend", () => {
    for (const k of ["heat", "bars", "dots", "points", "strip", "msa"] as AlignedPanelKind[])
      expect(kindDrawsLegend(k)).toBe(true);
  });
  it("tree-shape-only kinds draw none", () => {
    expect(kindDrawsLegend("labels")).toBe(false);
    expect(kindDrawsLegend("clade")).toBe(false);
  });
});

describe("errorBarControl", () => {
  it("a value column => verbatim error column (sd/sem hidden)", () => {
    expect(errorBarControl(panel("point", { column: "mean" }))).toBe("verbatim");
  });
  it("no value column => replicate mode (sd/sem meaningful)", () => {
    expect(errorBarControl(panel("point"))).toBe("replicate");
  });
});

describe("usesScaleKindSelect", () => {
  it("points/strip/heat use the categorical/continuous select", () => {
    for (const k of ["points", "strip", "heat"] as AlignedPanelKind[])
      expect(usesScaleKindSelect(k)).toBe(true);
  });
  it("bars/dots do not (numeric-only color => a toggle instead)", () => {
    expect(usesScaleKindSelect("bars")).toBe(false);
    expect(usesScaleKindSelect("dots")).toBe(false);
  });
});

describe("Smart Add constraints", () => {
  const none: LayerCapabilities = {
    hasNumericColumn: false,
    hasAnyColumn: false,
    hasAlignment: false,
    hasAnnotations: false,
    hasDatahubTable: false,
  };
  const all: LayerCapabilities = {
    hasNumericColumn: true,
    hasAnyColumn: true,
    hasAlignment: true,
    hasAnnotations: true,
    hasDatahubTable: true,
  };

  it("tree elements + highlights need nothing", () => {
    for (const k of ["labels", "points", "support", "nodepoints", "clade", "taxalink", "taxastrip", "nodepie"] as AlignedPanelKind[]) {
      expect(kindNeeds(k)).toBeNull();
      expect(kindAvailable(k, none)).toBe(true);
      expect(unmetReason(k, none)).toBeNull();
    }
  });

  it("data panels need a numeric column", () => {
    for (const k of ["heat", "bars", "dots", "box", "violin", "scatter", "point"] as AlignedPanelKind[]) {
      expect(kindNeeds(k)).toBe("numericColumn");
      expect(kindAvailable(k, none)).toBe(false);
      expect(unmetReason(k, none)).toBe("needs a numeric column");
      expect(kindAvailable(k, all)).toBe(true);
    }
  });

  it("strip needs any column, msa an alignment, noderange annotations, datahubPlot a table", () => {
    expect(kindAvailable("strip", { ...none, hasAnyColumn: true })).toBe(true);
    expect(unmetReason("strip", none)).toBe("needs a metadata column");
    expect(kindAvailable("msa", { ...none, hasAlignment: true })).toBe(true);
    expect(unmetReason("msa", none)).toBe("needs an aligned FASTA");
    expect(kindAvailable("noderange", { ...none, hasAnnotations: true })).toBe(true);
    expect(unmetReason("noderange", none)).toBe("needs a timed tree");
    expect(kindAvailable("datahubPlot", { ...none, hasDatahubTable: true })).toBe(true);
    expect(unmetReason("datahubPlot", none)).toBe("needs a Data Hub table");
  });
});
