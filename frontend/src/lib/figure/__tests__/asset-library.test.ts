import { describe, it, expect } from "vitest";

import {
  searchAssets,
  listCategories,
  listSources,
  assetSvgUrl,
  type LibraryAsset,
} from "@/lib/figure/asset-library";

function asset(over: Partial<LibraryAsset>): LibraryAsset {
  return {
    uid: "phylopic:1",
    source: "phylopic",
    sourceId: "1",
    title: "Octoglena sierra",
    creator: "T. Michael Keesey",
    license: "CC-BY",
    licenseUrl: null,
    requiresAttribution: true,
    sourceUrl: "https://www.phylopic.org/images/1",
    credit: "Octoglena sierra by T. Michael Keesey. PhyloPic. (CC-BY)",
    svgPath: "assets/phylopic/1.svg",
    tags: ["Octoglena"],
    category: "organism silhouette",
    fills: 1,
    hasViewBox: true,
    ...over,
  };
}

const lib = [
  asset({ uid: "phylopic:1", title: "Octoglena sierra", category: "organism silhouette", source: "phylopic" }),
  asset({ uid: "bioicons:alanine", title: "alanine", category: "Amino Acids", source: "bioicons", tags: ["Amino Acids"], creator: "Gideon Bergheim" }),
  asset({ uid: "bioicons:cell", title: "Generic Cell", category: "Cell biology", source: "bioicons", tags: ["Cell biology"] }),
];

describe("asset-library pure helpers", () => {
  it("assetSvgUrl builds an absolute CDN url", () => {
    expect(assetSvgUrl({ svgPath: "assets/phylopic/1.svg" })).toMatch(/\/assets\/phylopic\/1\.svg$/);
  });

  it("searchAssets: empty query returns all; filters by category + source", () => {
    expect(searchAssets(lib)).toHaveLength(3);
    expect(searchAssets(lib, { category: "Amino Acids" }).map((a) => a.title)).toEqual(["alanine"]);
    expect(searchAssets(lib, { source: "phylopic" })).toHaveLength(1);
  });

  it("searchAssets: multi-term query matches title/category/tags/creator, all terms required", () => {
    expect(searchAssets(lib, { query: "octoglena" }).map((a) => a.title)).toEqual(["Octoglena sierra"]);
    // matches creator
    expect(searchAssets(lib, { query: "gideon" }).map((a) => a.title)).toEqual(["alanine"]);
    // matches category words; both terms must hit
    expect(searchAssets(lib, { query: "cell biology" }).map((a) => a.title)).toEqual(["Generic Cell"]);
    expect(searchAssets(lib, { query: "cell nope" })).toHaveLength(0);
  });

  it("listCategories + listSources are sorted + de-duplicated", () => {
    expect(listCategories(lib)).toEqual(["Amino Acids", "Cell biology", "organism silhouette"]);
    expect(listSources(lib)).toEqual(["bioicons", "phylopic"]);
  });
});
