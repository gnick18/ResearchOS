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
});
