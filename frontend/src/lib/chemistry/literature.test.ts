import { describe, expect, it } from "vitest";

import {
  patentGoogleUrl,
  europePmcArticleUrl,
  surechemblUrl,
  mapEpmcResult,
  mapSureChemblStructure,
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
