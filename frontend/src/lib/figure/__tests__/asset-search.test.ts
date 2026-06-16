import { describe, it, expect } from "vitest";
import { rankAssets, expandQuery, trigramSimilarity } from "@/lib/figure/asset-search";
import type { LibraryAsset } from "@/lib/figure/asset-library";

function mk(over: Partial<LibraryAsset>): LibraryAsset {
  return {
    uid: over.uid ?? "s:" + (over.title ?? "x"),
    source: "test",
    sourceId: over.sourceId ?? "1",
    title: over.title ?? "",
    creator: null,
    license: "CC0",
    licenseUrl: null,
    requiresAttribution: false,
    sourceUrl: "",
    credit: "",
    svgPath: "x.svg",
    tags: over.tags ?? [],
    category: over.category ?? null,
    fills: 1,
    hasViewBox: true,
  };
}

const CORPUS: LibraryAsset[] = [
  mk({ title: "House mouse", category: "Mammals", tags: ["mouse", "rodent", "animal"] }),
  mk({ title: "Brown rat", category: "Mammals", tags: ["rat", "rodent"] }),
  mk({ title: "Zebrafish", category: "Fishes", tags: ["fish", "danio"] }),
  mk({ title: "E. coli", category: "Microbiology", tags: ["bacteria", "rod", "gram-negative"] }),
  mk({ title: "Apoptotic cell", category: "Cell types", tags: ["apoptosis", "cell death"] }),
  mk({ title: "Erlenmeyer flask", category: "Lab apparatus", tags: ["flask", "glassware"] }),
  mk({ title: "DNA double helix", category: "Nucleic acids", tags: ["dna", "genome"] }),
  mk({ title: "Potted plant", category: "Plants & algae", tags: ["plant", "leaf"] }),
];

describe("asset-search: trigram similarity", () => {
  it("scores identical strings 1 and tolerates a one-char typo", () => {
    expect(trigramSimilarity("mouse", "mouse")).toBe(1);
    expect(trigramSimilarity("mouse", "moose")).toBeGreaterThan(0.4);
    expect(trigramSimilarity("mouse", "elephant")).toBeLessThan(0.2);
  });
});

describe("asset-search: synonym expansion", () => {
  it("expands a query to its synonym group", () => {
    const terms = expandQuery("mouse");
    expect(terms).toContain("rodent");
    expect(terms).toContain("mammal");
  });
  it("expands a multi-word domain term", () => {
    expect(expandQuery("cell death")).toContain("apoptosis");
  });
  it("expands lab-equipment terms (extended groups)", () => {
    expect(expandQuery("centrifuge")).toContain("rotor");
    expect(expandQuery("pcr")).toContain("thermocycler");
    expect(expandQuery("gel")).toContain("western blot");
  });
  it("expands anatomy terms (extended groups)", () => {
    expect(expandQuery("blood")).toContain("erythrocyte");
    expect(expandQuery("crispr")).toContain("cas9");
  });
});

describe("asset-search: rankAssets", () => {
  it("exact title/tag match ranks first", () => {
    const r = rankAssets(CORPUS, "mouse");
    expect(r[0].asset.title).toBe("House mouse");
  });

  it("tolerates a typo (moose -> mouse)", () => {
    const r = rankAssets(CORPUS, "moose");
    expect(r.map((s) => s.asset.title)).toContain("House mouse");
  });

  it("finds via synonym the literal term misses (rodent -> rat + mouse)", () => {
    const titles = rankAssets(CORPUS, "rodent").map((s) => s.asset.title);
    expect(titles).toContain("House mouse");
    expect(titles).toContain("Brown rat");
    // A fish must not surface for "rodent".
    expect(titles).not.toContain("Zebrafish");
  });

  it("maps a domain concept to a non-literal asset (cell death -> apoptosis)", () => {
    const titles = rankAssets(CORPUS, "cell death").map((s) => s.asset.title);
    expect(titles).toContain("Apoptotic cell");
  });

  it("maps 'bacteria' to a microbe whose title never says bacteria", () => {
    const titles = rankAssets(CORPUS, "bacteria").map((s) => s.asset.title);
    expect(titles).toContain("E. coli");
  });

  it("an empty query returns nothing (caller shows the category view)", () => {
    expect(rankAssets(CORPUS, "")).toEqual([]);
    expect(rankAssets(CORPUS, "   ")).toEqual([]);
  });

  it("a literal match outranks a synonym match of the same term", () => {
    const r = rankAssets(CORPUS, "mouse");
    const mouse = r.find((s) => s.asset.title === "House mouse")!;
    const rat = r.find((s) => s.asset.title === "Brown rat");
    expect(mouse).toBeTruthy();
    if (rat) expect(mouse.score).toBeGreaterThan(rat.score);
  });

  it("an unrelated query returns no junk", () => {
    expect(rankAssets(CORPUS, "automobile")).toHaveLength(0);
  });
});
