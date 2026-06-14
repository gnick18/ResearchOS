import { describe, it, expect, beforeEach } from "vitest";

import { registerSequenceFigureSource } from "@/lib/sequences/figure-source";
import { getFigureSource, _clearFigureSources } from "@/lib/figure/figure-source";

describe("sequence figure source", () => {
  beforeEach(() => _clearFigureSources());

  it("registers a sequence FigureSource in the registry", () => {
    registerSequenceFigureSource();
    const src = getFigureSource("sequence");
    expect(src?.type).toBe("sequence");
    expect(src?.label).toBe("Sequence map");
  });

  it("opens a sequence in the editor via the ?seq= contract", () => {
    registerSequenceFigureSource();
    const src = getFigureSource("sequence");
    expect(src?.editHref("12")).toBe("/sequences?seq=12");
  });

  it("declares thickness + ruler/label options (Phase 3 style schema)", () => {
    registerSequenceFigureSource();
    const schema = getFigureSource("sequence")?.styleSchema?.() ?? [];
    expect(schema.map((o) => o.key)).toEqual(["featureScale", "showTicks", "showLabels"]);
    const scale = schema.find((o) => o.key === "featureScale");
    expect(scale?.kind).toBe("range");
    if (scale?.kind === "range") {
      expect(scale.min).toBe(0.5);
      expect(scale.max).toBe(2);
      expect(scale.default).toBe(1);
    }
    // Both visibility toggles default on (matches the renderer's absent-means-on).
    expect(schema.filter((o) => o.kind === "toggle").every((o) => o.default === true)).toBe(true);
  });
});
