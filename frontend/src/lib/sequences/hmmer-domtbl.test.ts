// sequence editor master. HMMER --domtblout PARSER tests.
//
// The parser runs against a REAL --domtblout table. The fixture
// (__fixtures__/hmmer-cdk2-domtbl.txt) was produced by running the on-device
// WASM hmmsearch engine (tools/hmmer-wasm) on PF00069.hmm (Pfam Protein kinase
// domain) as the HMM file vs cdk2.fasta (human CDK2) as the sequence db, with
// `--max --domtblout`. That is the exact invocation the WebWorker uses, so the
// table is the real bytes the browser parser sees. The textbook Pkinase hit
// (PF00069, env ~4..286) is what native HMMER and the EBI path both return.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDomtblout } from "./hmmer-domtbl";
import type { DomainHit } from "./interproscan";

const fixture = readFileSync(
  fileURLToPath(
    new URL("./__fixtures__/hmmer-cdk2-domtbl.txt", import.meta.url),
  ),
  "utf8",
);

describe("parseDomtblout (real CDK2 hmmsearch --max --domtblout)", () => {
  it("returns the Pkinase domain over the right protein span", () => {
    const hits = parseDomtblout(fixture);
    expect(hits.length).toBe(1);
    const hit = hits[0] as DomainHit;
    expect(hit.db).toBe("Pfam");
    // The release-specific ".32" suffix is stripped to the stable accession.
    expect(hit.accession).toBe("PF00069");
    expect(hit.name).toBe("Pkinase");
    // env coords on OUR protein (the target), 1-based inclusive.
    expect(hit.start).toBe(4);
    expect(hit.end).toBe(286);
    // this-domain i-Evalue and bit score from the table.
    expect(hit.evalue).toBeCloseTo(7.1e-82, 83);
    expect(hit.score).toBeCloseTo(260.8, 1);
  });

  it("skips comment and header lines without throwing", () => {
    // The fixture is mostly comment lines (# header + footer); only one row is
    // a real domain, so a clean parse proves comments are skipped.
    const commentCount = fixture
      .split(/\r?\n/)
      .filter((l) => l.startsWith("#")).length;
    expect(commentCount).toBeGreaterThan(5);
    expect(parseDomtblout(fixture).length).toBe(1);
  });

  it("returns an empty list for empty or junk input", () => {
    expect(parseDomtblout("")).toEqual([]);
    expect(parseDomtblout("not a table\n# just comments\n")).toEqual([]);
    // A short / truncated row (fewer than the required columns) is skipped.
    expect(parseDomtblout("foo - 100 Bar PF00001.1 50")).toEqual([]);
  });

  it("derives the db label and accession from the query columns", () => {
    // A TIGRFAM-style accession is labeled NCBIfam; env coords still drive the
    // span and the version suffix is stripped.
    const row =
      "myprotein - 200 SomeFam TIGR00001.5 120 1e-30 100.0 0.0 1 1 " +
      "2e-30 2e-30 99.5 0.0 1 120 10 130 8 132 0.90 my protein description";
    const hits = parseDomtblout(row);
    expect(hits.length).toBe(1);
    expect(hits[0].db).toBe("NCBIfam");
    expect(hits[0].accession).toBe("TIGR00001");
    expect(hits[0].name).toBe("SomeFam");
    expect(hits[0].start).toBe(8);
    expect(hits[0].end).toBe(132);
  });
});
