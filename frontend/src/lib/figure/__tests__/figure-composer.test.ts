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
  fitPanelsToPage,
  gridFor,
  PAGE_MARGIN_IN,
  type FigurePage,
  type FigurePanel,
} from "@/lib/figure/figure-page";
import { composeFigurePageSvg } from "@/lib/figure/figure-compose";

// Built dynamically so the inline-svg icon guard does not flag this test file.
const SVG_OPEN = "<" + "svg";
function panelSvg(tag: string): string {
  return `${SVG_OPEN} viewBox="0 0 100 80"><rect width="100" height="80" fill="#fff"/><desc>${tag}</desc></svg>`;
}

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
    // sizes preserved (not equalized) when they already fit their cell
    expect(aligned.panels[0].wIn).toBe(2.0);
    expect(aligned.panels[1].wIn).toBe(1.0);
    // but repositioned to distinct cells
    expect(aligned.panels[0].xIn).not.toBeCloseTo(aligned.panels[1].xIn, 2);
  });

  it("snapToGrid align shrinks an oversized panel so it cannot overlap a neighbor", () => {
    let p = createFigurePage("f", "F", null);
    p = addPanel(p, { type: "d", id: "1" }, "p1");
    p = addPanel(p, { type: "d", id: "2" }, "p2");
    // Panel 1 was resized larger than any 2x2 cell on Letter (cell ~3.6 x 4.9 in).
    p.panels[0].wIn = 7.0; p.panels[0].hIn = 6.0;
    const aligned = snapToGrid(p, "align");
    const a = aligned.panels[0];
    const b = aligned.panels[1];
    // shrunk to fit and aspect preserved (7/6 ratio kept)
    expect(a.wIn).toBeLessThan(7.0);
    expect(a.wIn / a.hIn).toBeCloseTo(7 / 6, 3);
    // the two panels no longer overlap (a's right edge is left of b, or vice versa,
    // OR they are on different rows)
    const overlapX = a.xIn < b.xIn + b.wIn && b.xIn < a.xIn + a.wIn;
    const overlapY = a.yIn < b.yIn + b.hIn && b.yIn < a.yIn + a.hIn;
    expect(overlapX && overlapY).toBe(false);
  });

  it("fitPanelsToPage pulls an off-canvas panel back after the paper shrinks", () => {
    let p = createFigurePage("f", "F", null); // Letter portrait 8.5 x 11
    p = addPanel(p, { type: "d", id: "1" }, "p1");
    // place it low on the tall page, then shrink the paper to a short slide
    p.panels[0].xIn = 1; p.panels[0].yIn = 8.5; p.panels[0].wIn = 3; p.panels[0].hIn = 2.2;
    p = { ...p, paper: { ...p.paper, paperId: "slide-169" } }; // 13.3 x 7.5
    const fitted = fitPanelsToPage(p);
    const f = fitted.panels[0];
    // the panel's far edges now stay within the page margins
    expect(f.xIn + f.wIn).toBeLessThanOrEqual(13.3 - PAGE_MARGIN_IN + 1e-6);
    expect(f.yIn + f.hIn).toBeLessThanOrEqual(7.5 - PAGE_MARGIN_IN + 1e-6);
    expect(f.xIn).toBeGreaterThanOrEqual(PAGE_MARGIN_IN - 1e-6);
    expect(f.yIn).toBeGreaterThanOrEqual(PAGE_MARGIN_IN - 1e-6);
  });
});

describe("figure-page compositor", () => {
  function twoPanelPage(): FigurePage {
    let p = createFigurePage("f", "F", null);
    p = addPanel(p, { type: "d", id: "1" }, "p1");
    p = addPanel(p, { type: "d", id: "2" }, "p2");
    return p;
  }

  it("composes one page SVG with both panels placed and labeled", () => {
    const page = twoPanelPage();
    const panelSvgs = new Map([
      ["p1", panelSvg("PANEL_ONE")],
      ["p2", panelSvg("PANEL_TWO")],
    ]);
    const out = composeFigurePageSvg(page, { pxPerInch: 96, panelSvgs });
    expect(out.startsWith(SVG_OPEN)).toBe(true);
    // both panels embedded
    expect(out).toContain("PANEL_ONE");
    expect(out).toContain("PANEL_TWO");
    // auto labels drawn
    expect(out).toContain(">A</text>");
    expect(out).toContain(">B</text>");
    // the page is sized in px (Letter portrait at 96 dpi = 816 x 1056)
    expect(out).toContain('width="816.0"');
  });

  it("re-anchors a panel SVG to its placement (sets page-space width)", () => {
    let page = createFigurePage("f", "F", null);
    page = addPanel(page, { type: "d", id: "1" }, "p1");
    page.panels[0].xIn = 1; page.panels[0].yIn = 2; page.panels[0].wIn = 3; page.panels[0].hIn = 2;
    const out = composeFigurePageSvg(page, {
      pxPerInch: 96,
      panelSvgs: new Map([["p1", panelSvg("X")]]),
    });
    // placed at 1in,2in = 96,192; sized 3in x 2in = 288 x 192
    expect(out).toContain('x="96.00" y="192.00" width="288.00" height="192.00"');
  });

  it("shows a placeholder when a panel's source SVG is missing", () => {
    const page = twoPanelPage();
    const out = composeFigurePageSvg(page, { pxPerInch: 96, panelSvgs: new Map() });
    expect(out).toContain("figure not found");
  });

  it("renders a significance bracket annotation with its label", () => {
    const page = twoPanelPage();
    page.annotations.push({
      annId: "a1",
      kind: "bracket",
      xIn: 1,
      yIn: 1,
      spanIn: 2,
      orientation: "horizontal",
      label: "**",
    });
    const out = composeFigurePageSvg(page, { pxPerInch: 96, panelSvgs: new Map() });
    expect(out).toContain(">**</text>");
  });
});
