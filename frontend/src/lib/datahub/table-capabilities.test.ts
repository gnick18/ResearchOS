import { describe, it, expect } from "vitest";
import { plotKindsForTable } from "./table-capabilities";

describe("plotKindsForTable — constraint-aware graph offers", () => {
  it("a column table with one group offers bar/scatter/qq but no estimation plot", () => {
    expect(plotKindsForTable("column", 1)).toEqual([
      "columnBar",
      "columnScatter",
      "qqPlot",
    ]);
  });

  it("a two-group column table adds the two-group estimation plot", () => {
    const kinds = plotKindsForTable("column", 2);
    expect(kinds).toContain("estimationGardnerAltman");
    expect(kinds).not.toContain("estimationCumming");
  });

  it("a three-or-more-group column table adds the multi-group estimation plot", () => {
    expect(plotKindsForTable("column", 3)).toContain("estimationCumming");
  });

  it("a column table with no groups offers no graph (nothing to draw)", () => {
    expect(plotKindsForTable("column", 0)).toEqual([]);
  });

  it("xy offers the scatter + residual, never a column bar", () => {
    const kinds = plotKindsForTable("xy", 0);
    expect(kinds).toEqual(["xyScatter", "residualPlot"]);
    expect(kinds).not.toContain("columnBar");
  });

  it("grouped offers the grouped bar only", () => {
    expect(plotKindsForTable("grouped", 4)).toEqual(["groupedBar"]);
  });

  it("survival offers the survival curve only", () => {
    expect(plotKindsForTable("survival", 2)).toEqual(["survivalCurve"]);
  });

  it("contingency offers no graph among the current kinds (never the undoable)", () => {
    expect(plotKindsForTable("contingency", 2)).toEqual([]);
  });

  it("parts-of-whole offers the proportional figures", () => {
    expect(plotKindsForTable("partsOfWhole", 1)).toEqual([
      "pie",
      "donut",
      "stackedBar",
    ]);
  });
});
