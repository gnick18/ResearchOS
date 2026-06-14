import { describe, it, expect } from "vitest";

import {
  createFigurePage,
  addPanel,
  setPanelStyle,
  setPanelTarget,
} from "@/lib/figure/figure-page";

function pageWithPanel() {
  return addPanel(createFigurePage("f", "F", null), { type: "sequence", id: "1" }, "p1");
}

describe("per-panel style helpers", () => {
  it("merges options without dropping prior options", () => {
    let p = pageWithPanel();
    p = setPanelStyle(p, "p1", { options: { showTicks: false } });
    p = setPanelStyle(p, "p1", { options: { featureScale: 1.5 } });
    expect(p.panels[0].style?.options).toEqual({ showTicks: false, featureScale: 1.5 });
  });

  it("merges a target override without dropping other targets or fields", () => {
    let p = pageWithPanel();
    p = setPanelTarget(p, "p1", "AmpR:1:9", { color: "#ff0000" });
    p = setPanelTarget(p, "p1", "ori:20:30", { hidden: true });
    p = setPanelTarget(p, "p1", "AmpR:1:9", { hidden: true }); // add to existing
    expect(p.panels[0].style?.targets).toEqual({
      "AmpR:1:9": { color: "#ff0000", hidden: true },
      "ori:20:30": { hidden: true },
    });
  });

  it("only touches the addressed panel", () => {
    let p = addPanel(pageWithPanel(), { type: "sequence", id: "2" }, "p2");
    p = setPanelStyle(p, "p1", { options: { showLabels: false } });
    expect(p.panels[0].style?.options).toEqual({ showLabels: false });
    expect(p.panels[1].style).toBeUndefined();
  });
});
