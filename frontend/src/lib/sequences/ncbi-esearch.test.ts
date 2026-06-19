// sequences / ncbi-esearch. Unit tests for the NCBI esearch + esummary pure
// parsers and URL builders. Network is NOT touched; all assertions run against
// saved real fixtures (fetched 2026-06-12 from the E-utilities API).

import { describe, it, expect } from "vitest";
import {
  EUTILS,
  esearchGeneIdsUrl,
  geneSummaryUrl,
  parseEsearchIds,
  parseGeneSummaries,
} from "./ncbi-esearch";
import esearchFixture from "./__fixtures__/ncbi/cyp51a-esearch.json";
import esummaryFixture from "./__fixtures__/ncbi/cyp51a-esummary.json";

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

describe("esearchGeneIdsUrl", () => {
  it("contains the EUTILS base and esearch.fcgi", () => {
    const url = esearchGeneIdsUrl("cyp51A", "Aspergillus fumigatus");
    expect(url).toContain(EUTILS);
    expect(url).toContain("esearch.fcgi");
  });

  it("encodes the [orgn] filter in the term", () => {
    const url = esearchGeneIdsUrl("cyp51A", "Aspergillus fumigatus");
    // The term parameter must contain %5Borgn%5D (URL-encoded [orgn]) so NCBI
    // applies the organism filter correctly.
    expect(url).toMatch(/\[orgn\]|%5Borgn%5D/i);
  });

  it("joins query and organism with AND", () => {
    const url = esearchGeneIdsUrl("cyp51A", "Aspergillus fumigatus");
    // After URL decoding the term should contain "AND".
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("AND");
    expect(decoded).toContain("cyp51A");
  });

  it("sets db=gene and retmode=json", () => {
    const url = esearchGeneIdsUrl("cyp51A", "Aspergillus fumigatus");
    expect(url).toContain("db=gene");
    expect(url).toContain("retmode=json");
  });

  it("sets tool=research-os", () => {
    const url = esearchGeneIdsUrl("cyp51A", "Aspergillus fumigatus");
    expect(url).toContain("tool=research-os");
  });
});

describe("geneSummaryUrl", () => {
  it("contains esummary.fcgi and db=gene", () => {
    const url = geneSummaryUrl(["3509526", "3505192"]);
    expect(url).toContain("esummary.fcgi");
    expect(url).toContain("db=gene");
  });

  it("comma-joins the ids", () => {
    const url = geneSummaryUrl(["3509526", "3505192"]);
    // URL-encoded comma is %2C; the URLSearchParams encoding preserves the
    // comma as-is in most runtimes, but we decode to be safe.
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("3509526,3505192");
  });
});

// ---------------------------------------------------------------------------
// parseEsearchIds
// ---------------------------------------------------------------------------

describe("parseEsearchIds (real cyp51A esearch fixture)", () => {
  it("returns the idlist as strings", () => {
    const ids = parseEsearchIds(esearchFixture);
    expect(ids).toContain("3509526");
  });

  it("returns all 4 ids from the fixture", () => {
    const ids = parseEsearchIds(esearchFixture);
    expect(ids.length).toBe(4);
  });

  it("returns empty array for an empty response", () => {
    expect(parseEsearchIds({})).toEqual([]);
    expect(parseEsearchIds({ esearchresult: { idlist: [] } })).toEqual([]);
    expect(parseEsearchIds(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseGeneSummaries
// ---------------------------------------------------------------------------

describe("parseGeneSummaries (real cyp51A esummary fixture)", () => {
  // Run once so all sub-tests share the same parsed output.
  const hits = parseGeneSummaries(esummaryFixture);

  it("parses the cyp51A hit", () => {
    const cyp51a = hits.find((h) => h.geneId === "3509526");
    expect(cyp51a).toBeDefined();
    expect(cyp51a?.symbol).toBe("cyp51A");
  });

  it("gives cyp51A the correct contig accession", () => {
    const cyp51a = hits.find((h) => h.geneId === "3509526")!;
    expect(cyp51a.contigAccession).toBe("NC_007197.1");
  });

  it("converts chrstart/chrstop to 1-based begin/end for cyp51A", () => {
    // Live API: chrstart=1781821, chrstop=1777374 (minus strand).
    // begin = min(1781821, 1777374) + 1 = 1777375
    // end   = max(1781821, 1777374) + 1 = 1781822
    const cyp51a = hits.find((h) => h.geneId === "3509526")!;
    expect(cyp51a.begin).toBe(1777375);
    expect(cyp51a.end).toBe(1781822);
  });

  it("detects minus orientation when chrstart > chrstop", () => {
    const cyp51a = hits.find((h) => h.geneId === "3509526")!;
    expect(cyp51a.orientation).toBe("minus");
  });

  it("carries the exon count", () => {
    const cyp51a = hits.find((h) => h.geneId === "3509526")!;
    expect(cyp51a.exonCount).toBe(2);
  });

  it("drops NEWENTRY junk records", () => {
    // The fixture contains uid 3503949 with name NEWENTRY; it must not appear.
    const junk = hits.find((h) => h.symbol === "NEWENTRY");
    expect(junk).toBeUndefined();
  });

  it("keeps real genes with valid symbols (hapE)", () => {
    const hapE = hits.find((h) => h.geneId === "3505192");
    expect(hapE).toBeDefined();
    expect(hapE?.symbol).toBe("hapE");
  });

  it("returns empty array for a missing or empty result block", () => {
    expect(parseGeneSummaries({})).toEqual([]);
    expect(parseGeneSummaries({ result: { uids: [] } })).toEqual([]);
    expect(parseGeneSummaries(null)).toEqual([]);
  });
});
