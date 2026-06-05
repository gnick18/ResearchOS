// sequence editor master. Tests for the NCBI Datasets client's PURE parts: the
// dataset_report -> NcbiPreview parsing and the caps gate. The fixtures are REAL
// JSON the Datasets v2 API returned (fetched during the build): a BRCA1 gene
// report and the E. coli GCF_000005845.2 genome report. Network is not touched
// here (only the pure parsers + checkCaps run).

import { describe, it, expect } from "vitest";
import {
  parseGeneReport,
  parseGenomeReport,
  checkCaps,
  sniffAccessionKind,
  includeForKind,
  NCBI_CAPS,
  NcbiDatasetsError,
  type NcbiPreview,
} from "./ncbi-datasets";
import brca1Report from "./__fixtures__/ncbi/brca1-gene-report.json";
import ecoliReport from "./__fixtures__/ncbi/ecoli-genome-report.json";

describe("parseGeneReport (real BRCA1 fixture)", () => {
  const p = parseGeneReport(brca1Report);

  it("parses the gene symbol, organism, and tax id", () => {
    expect(p.kind).toBe("gene");
    expect(p.title).toBe("BRCA1");
    expect(p.organism).toBe("Homo sapiens");
    expect(p.taxId).toBe("9606");
    // The gene id (672) is the download identifier.
    expect(p.accession).toBe("672");
  });

  it("derives the genomic span as the length", () => {
    // BRCA1 spans NC_000017.11:43044295-43170327 (minus strand) ⇒ ~126 kb.
    expect(p.lengthBp).toBeGreaterThan(120_000);
    expect(p.lengthBp).toBeLessThan(130_000);
  });

  it("throws on a report with no matching gene", () => {
    expect(() => parseGeneReport({ reports: [] })).toThrow(NcbiDatasetsError);
    expect(() => parseGeneReport({})).toThrow(NcbiDatasetsError);
  });
});

describe("parseGenomeReport (real E. coli fixture)", () => {
  const p = parseGenomeReport(ecoliReport);

  it("parses organism, accession, length, contigs, and assembly level", () => {
    expect(p.kind).toBe("genome");
    expect(p.accession).toBe("GCF_000005845.2");
    expect(p.organism).toBe("Escherichia coli str. K-12 substr. MG1655");
    expect(p.taxId).toBe("511145");
    // total_sequence_length arrives as a STRING in the API; we coerce to number.
    expect(p.lengthBp).toBe(4_641_652);
    expect(p.contigs).toBe(1);
    expect(p.assemblyLevel).toBe("Complete Genome");
    expect(p.title).toBe("ASM584v2");
  });

  it("throws on a report with no matching assembly", () => {
    expect(() => parseGenomeReport({ reports: [] })).toThrow(NcbiDatasetsError);
  });
});

describe("checkCaps", () => {
  const genome = (over: Partial<NcbiPreview>): NcbiPreview => ({
    kind: "genome",
    title: "x",
    accession: "GCF_x",
    organism: "x",
    lengthBp: 4_000_000,
    contigs: 1,
    ...over,
  });

  it("passes a real bacterial genome (E. coli, ~4.6 Mb, 1 contig)", () => {
    const p = parseGenomeReport(ecoliReport);
    expect(checkCaps(p).ok).toBe(true);
  });

  it("passes a gene (no length / contig fields trip the caps)", () => {
    const p = parseGeneReport(brca1Report);
    expect(checkCaps(p).ok).toBe(true);
  });

  it("refuses a genome just over the size cap", () => {
    const res = checkCaps(genome({ lengthBp: NCBI_CAPS.maxGenomeBp + 1 }));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/over the.*limit/i);
  });

  it("passes a genome exactly at the size cap", () => {
    expect(checkCaps(genome({ lengthBp: NCBI_CAPS.maxGenomeBp })).ok).toBe(true);
  });

  it("refuses a genome just over the contig cap", () => {
    const res = checkCaps(
      genome({ lengthBp: 1_000_000, contigs: NCBI_CAPS.maxContigs + 1 }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/contigs/i);
  });

  it("passes an assembly exactly at the contig cap", () => {
    expect(
      checkCaps(genome({ lengthBp: 1_000_000, contigs: NCBI_CAPS.maxContigs }))
        .ok,
    ).toBe(true);
  });
});

describe("sniffAccessionKind", () => {
  it("routes assembly accessions to genome", () => {
    expect(sniffAccessionKind("GCF_000005845.2")).toBe("genome");
    expect(sniffAccessionKind("gca_900618355.1")).toBe("genome");
  });

  it("routes transcript / gene accessions to gene", () => {
    expect(sniffAccessionKind("NM_007294.4")).toBe("gene");
    expect(sniffAccessionKind("NG_005905.2")).toBe("gene");
    expect(sniffAccessionKind("XM_011520956")).toBe("gene");
  });

  it("routes protein accessions to protein", () => {
    expect(sniffAccessionKind("NP_009225.1")).toBe("protein");
    expect(sniffAccessionKind("XP_011519258")).toBe("protein");
  });

  it("returns null for an unrecognized prefix", () => {
    expect(sniffAccessionKind("BRCA1")).toBeNull();
    expect(sniffAccessionKind("")).toBeNull();
  });
});

describe("includeForKind", () => {
  it("maps each kind to its FASTA payload", () => {
    expect(includeForKind("genome")).toBe("GENOME_FASTA");
    expect(includeForKind("gene")).toBe("GENE_FASTA");
    expect(includeForKind("protein")).toBe("PROT_FASTA");
  });
});
