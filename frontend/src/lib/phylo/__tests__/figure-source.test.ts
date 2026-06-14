import { describe, it, expect, beforeEach } from "vitest";

import { registerPhyloFigureSource } from "@/lib/phylo/figure-source";
import { getFigureSource, _clearFigureSources } from "@/lib/figure/figure-source";

describe("phylo figure source", () => {
  beforeEach(() => _clearFigureSources());

  it("registers a phylo FigureSource in the registry", () => {
    registerPhyloFigureSource();
    const src = getFigureSource("phylo");
    expect(src?.type).toBe("phylo");
    expect(src?.label).toBe("Phylogenetic tree");
  });

  it("opens a tree in the studio via the ?doc= contract", () => {
    registerPhyloFigureSource();
    const src = getFigureSource("phylo");
    expect(src?.editHref("42")).toBe("/phylo?doc=42");
    // ids are url-encoded so a spaced/odd id stays a valid link
    expect(src?.editHref("a b")).toBe("/phylo?doc=a%20b");
  });
});
