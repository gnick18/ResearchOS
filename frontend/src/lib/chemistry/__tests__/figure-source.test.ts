import { describe, it, expect, beforeEach } from "vitest";

import { registerChemistryFigureSource } from "@/lib/chemistry/figure-source";
import { getFigureSource, _clearFigureSources } from "@/lib/figure/figure-source";

describe("chemistry figure source", () => {
  beforeEach(() => _clearFigureSources());

  it("registers a chemistry FigureSource in the registry", () => {
    registerChemistryFigureSource();
    const src = getFigureSource("chemistry");
    expect(src?.type).toBe("chemistry");
    expect(src?.label).toBe("Molecule structure");
  });

  it("opens a molecule in the workbench via the ?molecule= contract", () => {
    registerChemistryFigureSource();
    const src = getFigureSource("chemistry");
    expect(src?.editHref("7")).toBe("/chemistry?molecule=7");
    expect(src?.editHref("a b")).toBe("/chemistry?molecule=a%20b");
  });
});
