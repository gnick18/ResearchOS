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

  it("exposes no style controls yet (renderSvg takes only a size, Phase 3 honest omission)", () => {
    // RDKit's renderSvg has no per-element or option knob to map a PanelStyle onto,
    // so the chemistry source declares neither styleTargets nor styleSchema. The
    // composer simply shows no Style section for a molecule panel.
    registerChemistryFigureSource();
    const src = getFigureSource("chemistry");
    expect(src?.styleTargets).toBeUndefined();
    expect(src?.styleSchema).toBeUndefined();
    expect(src?.saveDefaultStyle).toBeUndefined();
  });
});
