// sequence editor master. Tests for the NCBI package -> ImportedSequence glue.
// The fixture is a REAL Datasets ZIP package (fetched during the build): the
// E. coli `acs` gene (gene id 948572), a single FASTA record of 1959 bp under
// `ncbi_dataset/data/gene.fna`. unzipNcbiPackage finds the FASTA, and
// ncbiPackageToImports hands it to the EXISTING importer and yields the expected
// record (name, length, seq_type), tagged with provenance. No network here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  unzipNcbiPackage,
  ncbiPackageToImports,
  type NcbiProvenance,
} from "./ncbi-import";

const ZIP_PATH = join(
  __dirname,
  "__fixtures__",
  "ncbi",
  "ecoli-acs-gene-package.zip",
);

function readZip(): ArrayBuffer {
  const buf = readFileSync(ZIP_PATH);
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

  it("throws when the ZIP holds no FASTA", async () => {
    // A valid (empty) ZIP: a tiny fflate-zipped package with no .fna.
    const { zipSync, strToU8 } = await import("fflate");
    const empty = zipSync({
      "ncbi_dataset/data/data_report.jsonl": strToU8("{}\n"),
    });
    const buf = empty.buffer.slice(
      empty.byteOffset,
      empty.byteOffset + empty.byteLength,
    ) as ArrayBuffer;
    await expect(ncbiPackageToImports(buf, PROVENANCE)).rejects.toThrow(
      /no FASTA/i,
    );
  });
});
