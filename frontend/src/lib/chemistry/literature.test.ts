import { describe, expect, it } from "vitest";

import {
  patentGoogleUrl,
  europePmcArticleUrl,
  surechemblUrl,
  mapEpmcResult,
  mapSureChemblStructure,
  makePatentItem,
  paperToExplorerItem,
  explorerBinSize,
  buildYearBins,
  applyExplorerFilters,
  type ExplorerItem,
} from "./literature";
import { mapPropertyRecord, sdfUrl, pngUrl } from "./pubchem";

// Pure-helper contract tests for the literature companion and PubChem client.
// The network calls are exercised live in the mockup; these pin the parsing and
// URL construction so a response-shape or id-format change fails loudly.

describe("PubChem client helpers", () => {
  it("maps a property record, coercing the string molecular weight", () => {
    const c = mapPropertyRecord({
      CID: 2244,
      Title: "Aspirin",
      MolecularFormula: "C9H8O4",
      MolecularWeight: "180.16",
      InChIKey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
    });
    expect(c.cid).toBe(2244);
    expect(c.name).toBe("Aspirin");
    expect(c.formula).toBe("C9H8O4");
    expect(c.mol_weight).toBeCloseTo(180.16);
    expect(c.pngUrl).toContain("/cid/2244/PNG");
  });

  it("falls back to IUPACName, then CID, for the display name", () => {
    expect(mapPropertyRecord({ CID: 5, IUPACName: "methane" }).name).toBe("methane");
    expect(mapPropertyRecord({ CID: 7 }).name).toBe("CID 7");
  });

  it("returns null weight rather than NaN when unparseable", () => {
    expect(mapPropertyRecord({ CID: 1, MolecularWeight: "n/a" }).mol_weight).toBeNull();
    expect(mapPropertyRecord({ CID: 1 }).mol_weight).toBeNull();
  });

  it("builds the 2D SDF and PNG URLs", () => {
    expect(sdfUrl(2244)).toContain("/cid/2244/record/SDF?record_type=2d");
    expect(pngUrl(2244)).toContain("/cid/2244/PNG");
  });
});

describe("literature URL builders", () => {
  it("strips dashes for the Google Patents slug", () => {
    expect(patentGoogleUrl("US-4681893-A")).toBe(
      "https://patents.google.com/patent/US4681893A/en",
    );
  });
  it("builds Europe PMC and SureChEMBL URLs", () => {
    expect(europePmcArticleUrl("MED", "31653027")).toBe(
      "https://europepmc.org/article/MED/31653027",
    );
    expect(surechemblUrl("1331740")).toBe(
      "https://www.surechembl.org/chemical/1331740",
    );
  });
});

describe("literature response mappers", () => {
  it("maps a Europe PMC result with sensible defaults", () => {
    const p = mapEpmcResult({
      id: "42230302",
      source: "MED",
      title: "Caffeine pharmacokinetics",
      authorString: "Masters C, Ali A.",
      journalTitle: "Eur J Sport Sci",
      pubYear: "2026",
      citedByCount: 3,
      doi: "10.1002/ejsc.70203",
    });
    expect(p.title).toBe("Caffeine pharmacokinetics");
    expect(p.year).toBe("2026");
    expect(p.citedBy).toBe(3);
    expect(p.url).toBe("https://europepmc.org/article/MED/42230302");
    expect(p.isReview).toBe(false);
    expect(p.pubType).toBeUndefined();
  });

  it("sets isReview=true when pubTypeList.pubType contains a review string", () => {
    // Fixture: Europe PMC core result for a review article (field verified live
    // 2026-06-12: result.pubTypeList.pubType is a string[]).
    const p = mapEpmcResult({
      id: "11223344",
      source: "MED",
      title: "Gliotoxin and the epipolythiodioxopiperazines, a review",
      authorString: "Gardiner DM",
      journalTitle: "Microbiology",
      pubYear: "2005",
      citedByCount: 520,
      doi: "10.1099/mic.0.27847-0",
      pubTypeList: { pubType: ["Review", "Journal Article"] },
    });
    expect(p.isReview).toBe(true);
    expect(p.pubType).toBe("Review");
    expect(p.citedBy).toBe(520);
  });

  it("isReview is false when pubTypeList is absent or empty", () => {
    expect(mapEpmcResult({ id: "1", source: "MED" }).isReview).toBe(false);
    expect(
      mapEpmcResult({
        id: "2",
        source: "MED",
        pubTypeList: { pubType: ["Journal Article"] },
      }).isReview,
    ).toBe(false);
  });

  it("maps a SureChEMBL structure, preferring chemical_id", () => {
    const h = mapSureChemblStructure({
      chemical_id: "1331740",
      name: "2-(acetyloxy)benzoic acid",
      smiles: "CC(=O)Oc1ccccc1C(=O)O",
      mol_formula: "C9H8O4",
    });
    expect(h.chemical_id).toBe("1331740");
    expect(h.url).toContain("/chemical/1331740");
    expect(h.smiles).toContain("CC(=O)O");
  });
});

describe("makePatentItem + paperToExplorerItem", () => {
  it("builds a patent item with Google Patents URL", () => {
    const p = makePatentItem("US-7625931-B2");
    expect(p.type).toBe("patent");
    expect(p.id).toBe("US-7625931-B2");
    expect(p.url).toContain("patents.google.com");
    expect(p.url).toContain("US7625931B2");
  });

  it("lifts a research paper to type=research", () => {
    const paper = mapEpmcResult({ id: "1", source: "MED", title: "test", pubYear: "2020" });
    const item = paperToExplorerItem(paper);
    expect(item.type).toBe("research");
  });

  it("lifts a review paper to type=review", () => {
    const paper = mapEpmcResult({
      id: "2",
      source: "MED",
      title: "a review",
      pubYear: "2010",
      pubTypeList: { pubType: ["Review"] },
    });
    const item = paperToExplorerItem(paper);
    expect(item.type).toBe("review");
  });
});

describe("explorerBinSize", () => {
  it("returns 1 for spans up to 15", () => {
    expect(explorerBinSize(1)).toBe(1);
    expect(explorerBinSize(15)).toBe(1);
  });
  it("returns 2 for spans 16-30", () => {
    expect(explorerBinSize(16)).toBe(2);
    expect(explorerBinSize(30)).toBe(2);
  });
  it("returns 5 for spans 31-75", () => {
    expect(explorerBinSize(31)).toBe(5);
    expect(explorerBinSize(75)).toBe(5);
  });
  it("returns 25 for very large spans", () => {
    expect(explorerBinSize(376)).toBe(25);
  });
});

describe("buildYearBins", () => {
  const makeResearch = (year: string): ExplorerItem => ({
    type: "research",
    ...mapEpmcResult({ id: year, source: "MED", pubYear: year }),
  });
  const makeReview = (year: string): ExplorerItem => ({
    type: "review",
    ...mapEpmcResult({
      id: year + "r",
      source: "MED",
      pubYear: year,
      pubTypeList: { pubType: ["Review"] },
    }),
  });

  it("bins items into the expected year range", () => {
    const items: ExplorerItem[] = [makeResearch("2020"), makeResearch("2021"), makeReview("2021"), makeResearch("2022")];
    const bins = buildYearBins(items, 2020, 2022);
    expect(bins.length).toBeGreaterThan(0);
    const totals = bins.reduce((s, b) => s + b.total, 0);
    expect(totals).toBe(4);
  });

  it("counts reviews separately in reviewCount", () => {
    const items: ExplorerItem[] = [makeResearch("2021"), makeReview("2021")];
    const bins = buildYearBins(items, 2021, 2021);
    expect(bins[0].reviewCount).toBe(1);
    expect(bins[0].total).toBe(2);
  });

  it("skips items outside the year range", () => {
    const items: ExplorerItem[] = [makeResearch("2018"), makeResearch("2025")];
    const bins = buildYearBins(items, 2020, 2022);
    const totals = bins.reduce((s, b) => s + b.total, 0);
    expect(totals).toBe(0);
  });

  it("skips patents (no year in patent items)", () => {
    const patent: ExplorerItem = makePatentItem("US-123");
    const bins = buildYearBins([patent], 2010, 2030);
    const totals = bins.reduce((s, b) => s + b.total, 0);
    expect(totals).toBe(0);
  });
});

describe("applyExplorerFilters", () => {
  const research = (doi: string, year: string, title = "Research"): ExplorerItem => ({
    type: "research",
    ...mapEpmcResult({ id: doi, source: "MED", title, pubYear: year, doi, citedByCount: 10 }),
  });
  const review = (doi: string, year: string): ExplorerItem => ({
    type: "review",
    ...mapEpmcResult({
      id: doi,
      source: "MED",
      title: "A Review",
      pubYear: year,
      doi,
      citedByCount: 50,
      pubTypeList: { pubType: ["Review"] },
    }),
  });
  const patent = (id: string): ExplorerItem => makePatentItem(id);

  const baseFilters = {
    showResearch: true,
    showReviews: true,
    showPatents: true,
    starredOnly: false,
    minYear: 2000,
    maxYear: 2030,
    query: "",
    sort: "year" as const,
  };

  it("returns all items when no filter is active", () => {
    const items = [research("doi1", "2020"), review("doi2", "2018"), patent("US-1")];
    expect(applyExplorerFilters(items, baseFilters, new Set())).toHaveLength(3);
  });

  it("excludes reviews when showReviews=false", () => {
    const items = [research("doi1", "2020"), review("doi2", "2018")];
    const result = applyExplorerFilters(items, { ...baseFilters, showReviews: false }, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("research");
  });

  it("excludes patents when showPatents=false", () => {
    const items = [research("doi1", "2020"), patent("US-1")];
    const result = applyExplorerFilters(items, { ...baseFilters, showPatents: false }, new Set());
    expect(result).toHaveLength(1);
  });

  it("filters by year window", () => {
    const items = [research("doi1", "2015"), research("doi2", "2020"), research("doi3", "2025")];
    const result = applyExplorerFilters(items, { ...baseFilters, minYear: 2018, maxYear: 2022 }, new Set());
    expect(result).toHaveLength(1);
  });

  it("filters by text query against title/authors/journal", () => {
    const items = [research("doi1", "2020", "Aspirin pharmacology"), research("doi2", "2019", "Gliotoxin biosynthesis")];
    const result = applyExplorerFilters(items, { ...baseFilters, query: "aspirin" }, new Set());
    expect(result).toHaveLength(1);
  });

  it("filters to starred-only using the starred key set", () => {
    const items = [research("doi1", "2020"), research("doi2", "2021"), patent("US-1")];
    const starred = new Set(["doi1", "US-1"]);
    const result = applyExplorerFilters(items, { ...baseFilters, starredOnly: true }, starred);
    expect(result).toHaveLength(2);
  });

  it("sorts by year descending", () => {
    const items = [research("doi1", "2015"), research("doi3", "2023"), research("doi2", "2019")];
    const result = applyExplorerFilters(items, { ...baseFilters, sort: "year" }, new Set());
    expect((result[0] as { year: string }).year).toBe("2023");
    expect((result[2] as { year: string }).year).toBe("2015");
  });

  it("sorts by citedBy descending", () => {
    const r1 = { ...research("doi1", "2020"), citedBy: 10 } as ExplorerItem;
    const r2 = { ...research("doi2", "2019"), citedBy: 100 } as ExplorerItem;
    const result = applyExplorerFilters([r1, r2], { ...baseFilters, sort: "cited" }, new Set());
    expect((result[0] as { citedBy: number }).citedBy).toBe(100);
  });

  it("sorts by title A-Z", () => {
    const items = [research("doi1", "2020", "Zebra"), research("doi2", "2019", "Apple")];
    const result = applyExplorerFilters(items, { ...baseFilters, sort: "title" }, new Set());
    expect((result[0] as { title: string }).title).toBe("Apple");
  });
});
