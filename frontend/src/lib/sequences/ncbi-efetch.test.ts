// sequence editor master. Tests for the efetch annotated-import client. Pure
// parsing only, no network. Fixtures are REAL responses saved during the build:
//  - efetch/NM_000546.6.gb : the TP53 MANE transcript GenBank (1 CDS, 11 exons).
//  - efetch/NG_017013.2.gb : the TP53 RefSeqGene GenBank (multiple genes / CDS).
//  - efetch/error-bad-id.txt : a real efetch error body (HTTP 200, no LOCUS).
//  - efetch-gene-report/tp53-gene-report.json : the Datasets gene report whose
//    reference_standards carries the RefSeqGene NG_017013.2 accession.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { genbankToJson } from "@/vendor/bio-parsers";
import {
  looksLikeGenbank,
  efetchUrl,
  parseEfetchPreview,
  extractRefSeqGeneAccession,
} from "./ncbi-efetch";
import { efetchGenbankToImports } from "./ncbi-import";

const FIXTURE_DIR = join(__dirname, "__fixtures__");
const NM_PATH = join(FIXTURE_DIR, "efetch", "NM_000546.6.gb");
const NG_PATH = join(FIXTURE_DIR, "efetch", "NG_017013.2.gb");
const ERROR_PATH = join(FIXTURE_DIR, "efetch", "error-bad-id.txt");
const TP53_REPORT_PATH = join(
  FIXTURE_DIR,
  "efetch-gene-report",
  "tp53-gene-report.json",
);

const nmText = readFileSync(NM_PATH, "utf-8");
const ngText = readFileSync(NG_PATH, "utf-8");
const errorText = readFileSync(ERROR_PATH, "utf-8");
const tp53Report = JSON.parse(readFileSync(TP53_REPORT_PATH, "utf-8"));

describe("efetchUrl", () => {
  it("builds a tool=research-os nuccore gbwithparts URL with no email", () => {
    const url = efetchUrl("NM_000546.6");
    expect(url).toContain("db=nuccore");
    expect(url).toContain("id=NM_000546.6");
    expect(url).toContain("rettype=gbwithparts");
    expect(url).toContain("retmode=text");
    expect(url).toContain("tool=research-os");
    expect(url.toLowerCase()).not.toContain("email");
  });
});

describe("looksLikeGenbank (the LOCUS guard)", () => {
  it("accepts a real efetch GenBank record", () => {
    expect(looksLikeGenbank(nmText)).toBe(true);
    expect(looksLikeGenbank(ngText)).toBe(true);
  });

  it("rejects an efetch error body (HTTP 200, no LOCUS)", () => {
    expect(looksLikeGenbank(errorText)).toBe(false);
  });

  it("rejects empty / junk input", () => {
    expect(looksLikeGenbank("")).toBe(false);
    expect(looksLikeGenbank("not a record")).toBe(false);
  });
});

describe("parseEfetchPreview", () => {
  it("reads the NM_000546.6 transcript preview", () => {
    const p = parseEfetchPreview(nmText);
    expect(p.name).toBe("NM_000546");
    expect(p.organism).toBe("Homo sapiens");
    expect(p.lengthBp).toBe(2512);
    // The transcript carries a source, a gene, a CDS, and 11 exons (plus misc).
    expect(p.featureCount).toBeGreaterThanOrEqual(13);
  });

  it("reads the NG_017013.2 gene-region preview", () => {
    const p = parseEfetchPreview(ngText);
    expect(p.name).toBe("NG_017013");
    expect(p.organism).toBe("Homo sapiens");
    expect(p.lengthBp).toBe(32772);
    expect(p.featureCount).toBeGreaterThan(20);
  });
});

describe("the import pipeline parses the efetch record annotated", () => {
  it("NM_000546.6 -> 1 CDS, 11 exons, a gene, organism present", () => {
    const results = genbankToJson(nmText, {});
    const parsed = results[0]?.parsedSequence;
    expect(parsed).toBeTruthy();
    const features = parsed!.features || [];
    const cds = features.filter((f) => (f.type || "").toLowerCase() === "cds");
    const exons = features.filter((f) => (f.type || "").toLowerCase() === "exon");
    const genes = features.filter((f) => (f.type || "").toLowerCase() === "gene");
    expect(cds.length).toBe(1);
    expect(exons.length).toBe(11);
    expect(genes.length).toBeGreaterThanOrEqual(1);
  });

  it("NG_017013.2 -> multiple CDS and exons", () => {
    const results = genbankToJson(ngText, {});
    const parsed = results[0]?.parsedSequence;
    expect(parsed).toBeTruthy();
    const features = parsed!.features || [];
    const cds = features.filter((f) => (f.type || "").toLowerCase() === "cds");
    const exons = features.filter((f) => (f.type || "").toLowerCase() === "exon");
    expect(cds.length).toBeGreaterThan(1);
    expect(exons.length).toBeGreaterThan(1);
  });
});

describe("efetchGenbankToImports (the import glue)", () => {
  it("imports the NM record as one annotated ImportedSequence tagged ncbi-efetch", async () => {
    const imports = await efetchGenbankToImports(nmText, {
      source: "ncbi-efetch",
      ncbi_accession: "NM_000546.6",
      organism: "Homo sapiens",
    });
    expect(imports.length).toBe(1);
    expect(imports[0].provenance.source).toBe("ncbi-efetch");
    expect(imports[0].provenance.ncbi_accession).toBe("NM_000546.6");
    expect(imports[0].length).toBe(2512);
    // The GenBank round-trips through the importer with its features intact.
    expect(imports[0].genbank).toContain("LOCUS");
  });
});

describe("extractRefSeqGeneAccession", () => {
  it("pulls the REFSEQ_GENE NG_ accession from a TP53 gene report", () => {
    expect(extractRefSeqGeneAccession(tp53Report)).toBe("NG_017013.2");
  });

  it("returns null when there is no reference_standards entry", () => {
    expect(extractRefSeqGeneAccession({ reports: [{ gene: {} }] })).toBeNull();
    expect(extractRefSeqGeneAccession({})).toBeNull();
    expect(extractRefSeqGeneAccession(null)).toBeNull();
  });

  it("prefers the REFSEQ_GENE entry over an untyped range", () => {
    const report = {
      reports: [
        {
          gene: {
            reference_standards: [
              { type: "OTHER", gene_range: { accession_version: "XX_000000.0" } },
              {
                type: "REFSEQ_GENE",
                gene_range: { accession_version: "NG_999999.9" },
              },
            ],
          },
        },
      ],
    };
    expect(extractRefSeqGeneAccession(report)).toBe("NG_999999.9");
  });
});
