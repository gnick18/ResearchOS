// sequence editor master. InterProScan PARSER tests.
//
// The parser runs against a REAL InterProScan response. The fixture
// (interproscan-cdk2-pfam.json) is the actual JSON EBI returned for a live
// PfamA run on human CDK2 (UniProt P24941), trimmed to the match-relevant shape
// (the giant InterPro entry cross-ref graph the parser never reads was stubbed
// to keep the file small). The job returned the textbook Pkinase hit, exactly as
// the spike predicted. See docs/spikes/hmmer-wasm-spike-result.md.

import { describe, it, expect } from "vitest";
import { parseInterProScanResult, type DomainHit } from "./interproscan";
import realCdk2 from "./__fixtures__/interproscan-cdk2-pfam.json";

describe("parseInterProScanResult (real CDK2 PfamA response)", () => {
  it("returns the Pkinase domain over the right residue span", () => {
    const hits = parseInterProScanResult(realCdk2);
    expect(hits.length).toBe(1);
    const hit = hits[0] as DomainHit;
    expect(hit.db).toBe("Pfam");
    expect(hit.accession).toBe("PF00069");
    expect(hit.name).toBe("Pkinase");
    expect(hit.description).toBe("Protein kinase domain");
    // The spike's residues 4-286 (the whole kinase fold), 1-based inclusive.
    expect(hit.start).toBe(4);
    expect(hit.end).toBe(286);
    // The textbook strong E-value / bit score from the real run.
    expect(hit.evalue).toBeCloseTo(3.8e-74, 80);
    expect(hit.score).toBeCloseTo(260.9, 1);
  });
});

describe("parseInterProScanResult (synthetic shape coverage)", () => {
  it("emits one hit per location of a multi-region match, sorted by start", () => {
    const raw = {
      results: [
        {
          matches: [
            {
              signature: {
                accession: "PF00071",
                name: "Ras",
                description: "Ras family",
                signatureLibraryRelease: { library: "PFAM" },
              },
              evalue: 1e-10,
              score: 50,
              locations: [
                { start: 200, end: 260 },
                { start: 10, end: 80 },
              ],
            },
          ],
        },
      ],
    };
    const hits = parseInterProScanResult(raw);
    expect(hits.map((h) => [h.start, h.end])).toEqual([
      [10, 80],
      [200, 260],
    ]);
    expect(hits.every((h) => h.accession === "PF00071" && h.db === "Pfam")).toBe(true);
  });

  it("falls back to model-ac when the signature accession is missing", () => {
    const raw = {
      results: [
        {
          matches: [
            {
              signature: { name: "X", signatureLibraryRelease: { library: "PFAM" } },
              "model-ac": "PF12345",
              locations: [{ start: 1, end: 30 }],
            },
          ],
        },
      ],
    };
    const hits = parseInterProScanResult(raw);
    expect(hits).toHaveLength(1);
    expect(hits[0].accession).toBe("PF12345");
  });

  it("normalizes reversed start/end and skips locations without coordinates", () => {
    const raw = {
      results: [
        {
          matches: [
            {
              signature: { accession: "PF00001", name: "A", signatureLibraryRelease: { library: "PFAM" } },
              locations: [{ start: 90, end: 20 }, { start: 5 } /* no end => skipped */],
            },
          ],
        },
      ],
    };
    const hits = parseInterProScanResult(raw);
    expect(hits).toHaveLength(1);
    expect(hits[0].start).toBe(20);
    expect(hits[0].end).toBe(90);
  });

  it("labels non-Pfam libraries and carries the db through", () => {
    const raw = {
      results: [
        {
          matches: [
            {
              signature: { accession: "TIGR00001", name: "T", signatureLibraryRelease: { library: "NCBIFAM" } },
              locations: [{ start: 1, end: 10 }],
            },
          ],
        },
      ],
    };
    expect(parseInterProScanResult(raw)[0].db).toBe("NCBIfam");
  });

  it("returns an empty list for malformed / empty input rather than throwing", () => {
    expect(parseInterProScanResult(null)).toEqual([]);
    expect(parseInterProScanResult({})).toEqual([]);
    expect(parseInterProScanResult({ results: [] })).toEqual([]);
    expect(parseInterProScanResult({ results: [{ matches: [{}] }] })).toEqual([]);
  });
});
