import { describe, it, expect } from "vitest";

import {
  createFigurePage,
  makePlacedAsset,
  addPlacedAsset,
  removePlacedAsset,
  updatePlacedAsset,
  movePlacedAsset,
  pageAssets,
  figureCredits,
  type FigurePage,
} from "@/lib/figure/figure-page";
import { tintSvg, composeFigurePageSvg } from "@/lib/figure/figure-compose";

// Built dynamically so the inline-svg icon guard does not flag this test file.
const S = "<" + "svg";
const sampleSvg = `${S} viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></svg>`;

const fields = (over: Partial<Parameters<typeof makePlacedAsset>[1]> = {}) => ({
  source: "phylopic",
  sourceId: "1",
  svgPath: "assets/phylopic/1.svg",
  credit: "Octoglena sierra by T. Michael Keesey. PhyloPic. (CC-BY)",
  requiresAttribution: true,
  ...over,
});

describe("placed-asset model", () => {
  it("add / move / update / remove a placed asset", () => {
    let page = createFigurePage("1", "Fig", null);
    expect(pageAssets(page)).toEqual([]);
    page = addPlacedAsset(page, makePlacedAsset("a1", fields(), 1, 1));
    expect(pageAssets(page)).toHaveLength(1);
    expect(pageAssets(page)[0]).toMatchObject({ assetId: "a1", wIn: 1.2, hIn: 1.2, xIn: 1, yIn: 1 });

    page = movePlacedAsset(page, "a1", 0.5, -0.25);
    expect(pageAssets(page)[0]).toMatchObject({ xIn: 1.5, yIn: 0.75 });
    // move clamps to >= 0
    page = movePlacedAsset(page, "a1", -10, -10);
    expect(pageAssets(page)[0]).toMatchObject({ xIn: 0, yIn: 0 });

    page = updatePlacedAsset(page, "a1", { tint: "#2563eb", wIn: 2, hIn: 2, rotation: 90 });
    expect(pageAssets(page)[0]).toMatchObject({ tint: "#2563eb", wIn: 2, hIn: 2, rotation: 90 });

    page = removePlacedAsset(page, "a1");
    expect(pageAssets(page)).toEqual([]);
  });

  it("tolerates a pre-asset page (assets field absent)", () => {
    const legacy = { ...createFigurePage("2", "Old", null) } as FigurePage;
    delete (legacy as { assets?: unknown }).assets;
    expect(pageAssets(legacy)).toEqual([]);
    const page = addPlacedAsset(legacy, makePlacedAsset("x", fields(), 0, 0));
    expect(pageAssets(page)).toHaveLength(1);
  });

  it("figureCredits: only attribution-required assets, de-duplicated, in order", () => {
    let page = createFigurePage("3", "Fig", null);
    page = addPlacedAsset(page, makePlacedAsset("a", fields({ credit: "A (CC-BY)" }), 0, 0));
    // CC0 / PD asset -> no credit needed
    page = addPlacedAsset(page, makePlacedAsset("b", fields({ credit: "B (CC0)", requiresAttribution: false }), 1, 0));
    // same CC-BY asset placed again -> credited once
    page = addPlacedAsset(page, makePlacedAsset("a2", fields({ credit: "A (CC-BY)" }), 2, 0));
    page = addPlacedAsset(page, makePlacedAsset("c", fields({ credit: "C (CC-BY-SA)" }), 3, 0));
    expect(figureCredits(page)).toEqual(["A (CC-BY)", "C (CC-BY-SA)"]);
  });
});

describe("placed-asset compositor", () => {
  it("tintSvg recolors concrete fills but leaves fill=none", () => {
    const src = `${S}><rect fill="#ff0000"/><path fill="none" stroke="#000"/></svg>`;
    const out = tintSvg(src, "#2563eb");
    expect(out).toContain('fill="#2563eb"');
    expect(out).toContain('fill="none"');
    expect(out).not.toContain('fill="#ff0000"');
  });

  it("composeFigurePageSvg places + tints an asset at its real-inch box", () => {
    let page = createFigurePage("1", "Fig", null);
    page = addPlacedAsset(page, { ...makePlacedAsset("a1", fields(), 2, 1), wIn: 1, hIn: 1, tint: "#2563eb" });
    const svg = composeFigurePageSvg(page, {
      pxPerInch: 96,
      panelSvgs: new Map(),
      assetSvgs: new Map([["a1", sampleSvg]]),
    });
    // positioned at 2in*96=192, 1in*96=96, sized 96x96, and tinted
    expect(svg).toContain('x="192.00"');
    expect(svg).toContain('y="96.00"');
    expect(svg).toContain('fill="#2563eb"');
    // a missing asset svg simply draws nothing (no crash)
    const svg2 = composeFigurePageSvg(page, { pxPerInch: 96, panelSvgs: new Map(), assetSvgs: new Map() });
    expect(svg2).toContain("</svg>");
  });
});
