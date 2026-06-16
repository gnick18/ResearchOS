import { describe, it, expect, beforeEach } from "vitest";

import {
  splitFigureId,
  plotNaturalAspect,
  registerDataHubFigureSource,
} from "@/lib/datahub/figure-source";
import {
  getFigureSource,
  _clearFigureSources,
} from "@/lib/figure/figure-source";
import type { PlotSpec } from "@/lib/datahub/model/types";

function specWithSize(w?: number, h?: number): PlotSpec {
  return {
    id: "p",
    type: "columnBar",
    style: {
      kind: "columnBar",
      ...(w !== undefined ? { width: w } : {}),
      ...(h !== undefined ? { height: h } : {}),
      sizeUnit: "in",
    } as unknown as Record<string, unknown>,
    source: {} as unknown as Record<string, unknown>,
  };
}

describe("data hub figure source", () => {
  beforeEach(() => _clearFigureSources());

  it("splits a docId:plotId figure id", () => {
    expect(splitFigureId("doc1:plot2")).toEqual({ docId: "doc1", plotId: "plot2" });
    expect(splitFigureId("solo")).toEqual({ docId: "solo", plotId: "" });
  });

  it("reads the natural aspect from the plot size, else the FIG default", () => {
    expect(plotNaturalAspect(specWithSize(4, 3))).toBeCloseTo(4 / 3, 6);
    // no size -> the Data Hub default 430/340
    expect(plotNaturalAspect(specWithSize())).toBeCloseTo(430 / 340, 6);
  });

  it("registers a datahub FigureSource in the registry", () => {
    registerDataHubFigureSource();
    const src = getFigureSource("datahub");
    expect(src?.type).toBe("datahub");
    expect(src?.label).toBe("Data Hub plot");
    expect(src?.editHref("d1:p1")).toBe("/datahub?doc=d1");
  });

  it("declares a palette select (Phase 3 style schema) with a plot-default escape", () => {
    registerDataHubFigureSource();
    const schema = getFigureSource("datahub")?.styleSchema?.() ?? [];
    const palette = schema.find((o) => o.key === "palette");
    expect(palette?.kind).toBe("select");
    // The first choice keeps the plot's stored palette (empty value = no override).
    if (palette?.kind === "select") {
      expect(palette.default).toBe("");
      expect(palette.choices[0]).toEqual({ value: "", label: "Plot default" });
      expect(palette.choices.length).toBeGreaterThan(1);
    }
  });

  it("offers a manual legend-placement select (the composer escape for relocate)", () => {
    registerDataHubFigureSource();
    const schema = getFigureSource("datahub")?.styleSchema?.() ?? [];
    const legend = schema.find((o) => o.key === "legendPlacement");
    expect(legend?.kind).toBe("select");
    if (legend?.kind === "select") {
      expect(legend.default).toBe("overlay");
      expect(legend.choices.map((c) => c.value)).toEqual(["overlay", "right"]);
    }
  });

  it("maps the relocate-legend fix to a legendPlacement override, nothing else", () => {
    registerDataHubFigureSource();
    const src = getFigureSource("datahub");
    expect(src?.styleForFix?.("relocate-legend")).toEqual({
      options: { legendPlacement: "right" },
    });
    // No Data Hub lever for the phylo-only fixes, so the composer won't offer them.
    expect(src?.styleForFix?.("tilt-tip-labels")).toBeNull();
    expect(src?.styleForFix?.("increase-column-gap")).toBeNull();
  });
});
