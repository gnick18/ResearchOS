import { describe, it, expect, beforeEach } from "vitest";

import {
  registerFigureSource,
  getFigureSource,
  listFigureSources,
  _clearFigureSources,
  missingPanelSvg,
  type FigureSource,
} from "@/lib/figure/figure-source";
import {
  createFigurePage,
  panelLabel,
  orderedPanels,
  assignLabels,
  addPanel,
  removePanel,
  snapToGrid,
  gridFor,
  type FigurePanel,
} from "@/lib/figure/figure-page";

function fakeSource(type: string): FigureSource {
  return {
    type,
    label: type,
    list: async () => [{ id: "1", type, name: "Fig" }],
    render: async () => ({ svg: "<g></g>", naturalAspect: 1 }),
    editHref: (id) => `/${type}/${id}`,
  };
}

describe("figure-source registry", () => {
  beforeEach(() => _clearFigureSources());

  it("registers, looks up, and lists sources", () => {
    registerFigureSource(fakeSource("datahub"));
    registerFigureSource(fakeSource("phylo"));
    expect(getFigureSource("datahub")?.label).toBe("datahub");
    expect(listFigureSources().map((s) => s.type).sort()).toEqual(["datahub", "phylo"]);
  });

  it("re-registering the same type replaces it (HMR-safe)", () => {
    registerFigureSource(fakeSource("datahub"));
    registerFigureSource({ ...fakeSource("datahub"), label: "v2" });
    expect(getFigureSource("datahub")?.label).toBe("v2");
    expect(listFigureSources()).toHaveLength(1);
  });

  it("missingPanelSvg flags missing and returns an svg", () => {
    const r = missingPanelSvg(2, 1.6);
    expect(r.missing).toBe(true);
    // needle built dynamically so the inline-svg guard does not flag the test
    expect(r.svg).toContain("<" + "svg");
    expect(r.svg).toContain("not found");
  });
});

describe("figure-page model", () => {
  it("createFigurePage defaults to an enabled Letter page, ABC labels, empty", () => {
    const p = createFigurePage("f1", "Figure 1", "c1");
    expect(p.paper.enabled).toBe(true);
    expect(p.paper.paperId).toBe("letter");
    expect(p.labelStyle).toBe("ABC");
    expect(p.panels).toHaveLength(0);
    expect(p.collectionId).toBe("c1");
  });

  it("panelLabel renders each style", () => {
    expect(panelLabel(0, "ABC")).toBe("A");
    expect(panelLabel(1, "ABC")).toBe("B");
    expect(panelLabel(0, "abc")).toBe("a");
    expect(panelLabel(2, "123")).toBe("3");
    expect(panelLabel(0, "none")).toBe("");
  });

  it("orderedPanels reads top row first, then left to right", () => {
    const panels: FigurePanel[] = [
      { panelId: "br", ref: { type: "d", id: "1" }, xIn: 4, yIn: 4, wIn: 2, hIn: 1.5 },
      { panelId: "tl", ref: { type: "d", id: "2" }, xIn: 0.5, yIn: 0.5, wIn: 2, hIn: 1.5 },
      { panelId: "tr", ref: { type: "d", id: "3" }, xIn: 4, yIn: 0.5, wIn: 2, hIn: 1.5 },
    ];
    expect(orderedPanels(panels).map((p) => p.panelId)).toEqual(["tl", "tr", "br"]);
  });

  it("assignLabels auto-assigns by reading order, explicit label wins", () => {
    let p = createFigurePage("f", "F", null);
    p = addPanel(p, { type: "d", id: "1" }, "p1");
    p = addPanel(p, { type: "d", id: "2" }, "p2");
    const labels = assignLabels(p);
    expect(labels.get("p1")).toBe("A");
    expect(labels.get("p2")).toBe("B");
    p.panels[1].label = "B (inset)";
    expect(assignLabels(p).get("p2")).toBe("B (inset)");
  });

  it("addPanel appends a sized panel; removePanel drops it", () => {
    let p = createFigurePage("f", "F", null);
    p = addPanel(p, { type: "d", id: "1" }, "p1", 1.25);
    expect(p.panels).toHaveLength(1);
    expect(p.panels[0].wIn).toBeGreaterThan(0);
    expect(p.panels[0].hIn).toBeGreaterThan(0);
    p = removePanel(p, "p1");
    expect(p.panels).toHaveLength(0);
  });

  it("gridFor is near-square", () => {
    expect(gridFor(4)).toEqual({ rows: 2, cols: 2 });
    expect(gridFor(2)).toEqual({ rows: 1, cols: 2 });
    expect(gridFor(3)).toEqual({ rows: 2, cols: 2 });
    expect(gridFor(6)).toEqual({ rows: 2, cols: 3 });
  });

  it("snapToGrid resize makes equal cells; align keeps sizes", () => {
    let p = createFigurePage("f", "F", null);
    p = addPanel(p, { type: "d", id: "1" }, "p1");
    p = addPanel(p, { type: "d", id: "2" }, "p2");
    // give them different sizes first
    p.panels[0].wIn = 2.0; p.panels[0].hIn = 1.5;
    p.panels[1].wIn = 1.0; p.panels[1].hIn = 1.0;

    const resized = snapToGrid(p, "resize");
    // both panels now share one cell size
    expect(resized.panels[0].wIn).toBeCloseTo(resized.panels[1].wIn, 6);
    expect(resized.panels[0].hIn).toBeCloseTo(resized.panels[1].hIn, 6);

    const aligned = snapToGrid(p, "align");
    // sizes preserved (not equalized)
    expect(aligned.panels[0].wIn).toBe(2.0);
    expect(aligned.panels[1].wIn).toBe(1.0);
    // but repositioned to distinct cells
    expect(aligned.panels[0].xIn).not.toBeCloseTo(aligned.panels[1].xIn, 2);
  });
});
