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

  it("declares scale-bar / legend / root-edge toggles + a legend-placement select", () => {
    registerPhyloFigureSource();
    const schema = getFigureSource("phylo")?.styleSchema?.() ?? [];
    expect(schema.map((o) => o.key)).toEqual([
      "scaleBar",
      "legend",
      "rootEdge",
      "legendPlacement",
    ]);
    // Scale bar + legend default on; the root edge defaults off (matches FigureInputs).
    const byKey = Object.fromEntries(schema.map((o) => [o.key, o]));
    expect(byKey.scaleBar.kind).toBe("toggle");
    expect(byKey.scaleBar.default).toBe(true);
    expect(byKey.legend.default).toBe(true);
    expect(byKey.rootEdge.default).toBe(false);
    // The legend lever is a select (Right / Below), defaulting to the stored right.
    expect(byKey.legendPlacement.kind).toBe("select");
    if (byKey.legendPlacement.kind === "select") {
      expect(byKey.legendPlacement.default).toBe("right");
      expect(byKey.legendPlacement.choices.map((c) => c.value)).toEqual([
        "right",
        "bottom",
      ]);
    }
  });

  it("maps the relocate-legend fix to a below-the-figure legend, nothing else", () => {
    registerPhyloFigureSource();
    const src = getFigureSource("phylo");
    expect(src?.styleForFix?.("relocate-legend")).toEqual({
      options: { legendPlacement: "bottom" },
    });
    // The other advisor fixes are not composer-panel overrides for a tree.
    expect(src?.styleForFix?.("shrink-label-font")).toBeNull();
    expect(src?.styleForFix?.("drop-duplicate-overlay")).toBeNull();
  });
});
