// sequence editor master. Build the tiny annotated-GenBank ZIP fixture used by
// ncbi-import.test.ts. A hand-written single-LOCUS GenBank with one CDS feature
// (a few hundred bp), packaged exactly like a Datasets GBFF download
// (`ncbi_dataset/data/<acc>/genomic.gbff`). Run once with `node make-gbff-fixture.mjs`;
// the committed artifact is `ecoli-mini-genome-gbff-package.zip`.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { zipSync, strToU8 } from "fflate";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// A minimal but real GenBank flat file: 360 bp, one ORGANISM with lineage, one
// gene + one CDS feature carrying a product. The CDS is the proof that the
// GBFF import path yields annotations, not bare sequence.
const GBFF = `LOCUS       MINI_CHR                 360 bp    DNA     linear   BCT 05-JUN-2026
DEFINITION  Synthetic mini chromosome for the GBFF import fixture.
ACCESSION   MINI_CHR
VERSION     MINI_CHR.1
SOURCE      Escherichia coli (fixture)
  ORGANISM  Escherichia coli
            Bacteria; Pseudomonadota; Gammaproteobacteria; Enterobacterales;
            Enterobacteriaceae; Escherichia.
REFERENCE   1  (bases 1 to 360)
  AUTHORS   Fixture,A.
  TITLE     A hand-written GenBank record for testing
  JOURNAL   Unpublished
FEATURES             Location/Qualifiers
     source          1..360
                     /organism="Escherichia coli"
                     /mol_type="genomic DNA"
     gene            10..330
                     /gene="fixA"
                     /locus_tag="MINI_0001"
     CDS             10..330
                     /gene="fixA"
                     /locus_tag="MINI_0001"
                     /codon_start=1
                     /transl_table=11
                     /product="fixture dehydrogenase"
                     /protein_id="MINI_0001.1"
ORIGIN
        1 atgaaacgca ttgcaggcct gctgctgctg gcaggcctgc tgctgagcgc aggcctgctg
       61 agcgcaggcc tgctgagcgc aggcctgctg agcgcaggcc tgctgagcgc aggcctgctg
      121 agcgcaggcc tgctgagcgc aggcctgctg agcgcaggcc tgctgagcgc aggcctgctg
      181 agcgcaggcc tgctgagcgc aggcctgctg agcgcaggcc tgctgagcgc aggcctgctg
      241 agcgcaggcc tgctgagcgc aggcctgctg agcgcaggcc tgctgagcgc aggcctgctg
      301 agcgcaggcc tgctgagcgc aggcctgctg agcgcaggcc tgctgagcgc aggcctgtaa
//
`;

// Mirror the real Datasets layout: a README, the JSONL report, the catalog, and
// the GBFF under data/<acc>/. unzipNcbiPackage keeps only the GBFF.
const pkg = {
  "README.md": strToU8("# fixture package\n"),
  "ncbi_dataset/data/dataset_catalog.json": strToU8('{"assemblies":[]}\n'),
  "ncbi_dataset/data/assembly_data_report.jsonl": strToU8('{"accession":"MINI_CHR"}\n'),
  "ncbi_dataset/data/MINI_CHR/genomic.gbff": strToU8(GBFF),
};

const zipped = zipSync(pkg, { level: 6 });
const out = join(here, "ecoli-mini-genome-gbff-package.zip");
writeFileSync(out, zipped);
console.log(`wrote ${out} (${zipped.byteLength} bytes)`);
