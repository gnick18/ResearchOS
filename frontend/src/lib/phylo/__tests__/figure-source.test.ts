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

  it("declares scale-bar / legend / root-edge toggles (Phase 3 style schema)", () => {
    registerPhyloFigureSource();
    const schema = getFigureSource("phylo")?.styleSchema?.() ?? [];
    expect(schema.every((o) => o.kind === "toggle")).toBe(true);
    expect(schema.map((o) => o.key)).toEqual(["scaleBar", "legend", "rootEdge"]);
    // Scale bar + legend default on; the root edge defaults off (matches FigureInputs).
    const byKey = Object.fromEntries(schema.map((o) => [o.key, o]));
    expect(byKey.scaleBar.default).toBe(true);
    expect(byKey.legend.default).toBe(true);
    expect(byKey.rootEdge.default).toBe(false);
  });
});
