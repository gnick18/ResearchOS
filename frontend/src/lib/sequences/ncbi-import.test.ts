// sequence editor master. Tests for the NCBI package -> ImportedSequence glue.
// Two fixtures, no network. The FASTA fixture is a REAL Datasets ZIP package
// (fetched during the build), the E. coli `acs` gene (gene id 948572), a single
// FASTA record of 1959 bp under `ncbi_dataset/data/gene.fna`. The GBFF fixture is
// a small hand-written annotated GenBank packaged like a real genome download
// (`ncbi_dataset/data/<acc>/genomic.gbff`), one gene + one CDS. unzipNcbiPackage
// finds each file, and ncbiPackageToImports hands it to the EXISTING importer.
// The FASTA imports as bare sequence (no regression), the GBFF imports ANNOTATED
// with its CDS feature intact.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { genbankToJson } from "@/vendor/bio-parsers";
import {
  unzipNcbiPackage,
  ncbiPackageToImports,
  type NcbiProvenance,
} from "./ncbi-import";

const FIXTURE_DIR = join(__dirname, "__fixtures__", "ncbi");
const ZIP_PATH = join(FIXTURE_DIR, "ecoli-acs-gene-package.zip");
const GBFF_ZIP_PATH = join(FIXTURE_DIR, "ecoli-mini-genome-gbff-package.zip");

function readZip(): ArrayBuffer {
  const buf = readFileSync(ZIP_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function readGbffZip(): ArrayBuffer {
  const buf = readFileSync(GBFF_ZIP_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const PROVENANCE: NcbiProvenance = {
  source: "ncbi-datasets",
  ncbi_accession: "948572",
  organism: "Escherichia coli str. K-12 substr. MG1655",
  tax_id: "511145",
};

describe("unzipNcbiPackage (real E. coli acs gene package)", () => {
  it("finds the FASTA under ncbi_dataset/data/", () => {
    const entries = unzipNcbiPackage(readZip());
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe("ncbi_dataset/data/gene.fna");
    expect(entries[0].bytes.byteLength).toBeGreaterThan(0);
  });

  it("ignores non-FASTA entries (README, JSONL report, catalog)", () => {
    const entries = unzipNcbiPackage(readZip());
    // Only the .fna survives; the README.md / data_report.jsonl /
    // dataset_catalog.json / md5sum.txt are filtered out.
    expect(entries.every((e) => /\.(fna|fa|faa|fasta)$/i.test(e.name))).toBe(true);
  });
});

describe("ncbiPackageToImports (real package -> the expected record)", () => {
  it("yields one DNA record of 1959 bp tagged with provenance", async () => {
    const imports = await ncbiPackageToImports(readZip(), PROVENANCE);
    expect(imports.length).toBe(1);
    const seq = imports[0];
    expect(seq.length).toBe(1959);
    expect(seq.seq_type).toBe("dna");
    expect(seq.genbank).toMatch(/^LOCUS/m);
    expect(seq.display_name.length).toBeGreaterThan(0);
    // Provenance rides along for the persistence step.
    expect(seq.provenance).toEqual(PROVENANCE);
  });

  it("throws when the ZIP holds no sequence file", async () => {
    // A valid ZIP with only a JSONL report (no FASTA and no GenBank).
    const { zipSync, strToU8 } = await import("fflate");
    const empty = zipSync({
      "ncbi_dataset/data/data_report.jsonl": strToU8("{}\n"),
    });
    const buf = empty.buffer.slice(
      empty.byteOffset,
      empty.byteOffset + empty.byteLength,
    ) as ArrayBuffer;
    await expect(ncbiPackageToImports(buf, PROVENANCE)).rejects.toThrow(
      /no sequence file/i,
    );
  });
});

// The annotated-genome path. The fixture is a small hand-written GenBank flat
// file (360 bp, one gene + one CDS with a product) packaged exactly like a real
// Datasets GBFF download (`ncbi_dataset/data/<acc>/genomic.gbff`). The whole
// point is to prove the genome download arrives ANNOTATED, so the imported
// record's GenBank re-serializes with its CDS feature, not as bare sequence.
const GBFF_PROVENANCE: NcbiProvenance = {
  source: "ncbi-datasets",
  ncbi_accession: "MINI_CHR",
  organism: "Escherichia coli",
};

describe("unzipNcbiPackage (annotated GBFF genome package)", () => {
  it("extracts the genomic.gbff under ncbi_dataset/data/", () => {
    const entries = unzipNcbiPackage(readGbffZip());
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe(
      "ncbi_dataset/data/MINI_CHR/genomic.gbff",
    );
    expect(entries[0].bytes.byteLength).toBeGreaterThan(0);
  });
});

describe("ncbiPackageToImports (annotated GBFF -> a record WITH features)", () => {
  it("imports an annotated record whose features include the CDS", async () => {
    const imports = await ncbiPackageToImports(readGbffZip(), GBFF_PROVENANCE);
    expect(imports.length).toBe(1);
    const seq = imports[0];
    expect(seq.seq_type).toBe("dna");
    expect(seq.length).toBe(360);
    expect(seq.provenance).toEqual(GBFF_PROVENANCE);

    // Re-parse the stored GenBank and assert it carries real annotations, not
    // bare sequence. The GBFF carried a source, a gene, and a CDS, so the import
    // must round-trip with several features including a located CDS. This is the
    // proof the genome download arrives annotated rather than as raw sequence.
    const parsed = genbankToJson(seq.genbank, {});
    expect(parsed[0]?.success).toBe(true);
    const features = parsed[0]?.parsedSequence?.features ?? [];
    expect(features.length).toBeGreaterThan(0);
    const cds = features.find(
      (f) => String(f.type).toLowerCase() === "cds",
    );
    expect(cds).toBeTruthy();
    // A real located feature (the CDS spans bases 10..330), not a bare contig.
    expect(cds?.start).toBe(9); // 0-based start of the 1-based 10..330 location
    expect(cds?.end).toBe(329);
  });
});
