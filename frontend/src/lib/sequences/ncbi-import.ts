// sequence editor master. NCBI Datasets package -> ImportedSequence[].
//
// The glue between the browser-direct Datasets download (a ZIP ArrayBuffer) and
// the EXISTING file importer. A Datasets package unzips to
// `ncbi_dataset/data/...` holding one or more sequence files (plus a JSONL report
// and a catalog we ignore). Genome / assembly downloads arrive as an annotated
// GenBank flat file (`genomic.gbff`), gene and protein downloads arrive as FASTA.
// We pull those bytes out with fflate and hand each FASTA or GenBank file to the
// EXISTING `importSequenceFile(name, bytes)`, so the parse / GenBank-conversion
// path is shared with file import (no new parser). Each record becomes one
// ImportedSequence (a multi-LOCUS genome GBFF imports as one annotated record per
// chromosome or plasmid, a multi-record FASTA as one record per contig), tagged
// with NCBI provenance.
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

import { unzipSync } from "fflate";
import { importSequenceFile, type ImportedSequence } from "./import";

/** NCBI provenance carried onto each imported record (mirrors the additive
 *  SequenceMeta fields). Threaded into persistence so the library can show a
 *  "From NCBI" badge and the accession stays linkable. */
export interface NcbiProvenance {
  source: "ncbi-datasets";
  /** The accession or gene id the user resolved (GCF_..., a gene id, ...). */
  ncbi_accession?: string;
  organism?: string;
  tax_id?: string;
}

/** An ImportedSequence with the NCBI provenance attached. */
export interface NcbiImportedSequence extends ImportedSequence {
  provenance: NcbiProvenance;
}

/** FASTA extensions a Datasets package uses (genome.fna, gene.fna, protein.faa). */
const FASTA_RE = /\.(fna|fa|faa|fasta|frn|ffn)$/i;

/** GenBank extensions a Datasets package uses. Annotated genome / assembly
 *  downloads arrive as `genomic.gbff`; `.gbk` / `.gb` are accepted for safety. */
const GENBANK_RE = /\.(gbff|gbk|gb)$/i;

/** The Datasets package roots the data under this prefix. */
const DATA_PREFIX = "ncbi_dataset/data/";

/** One sequence file found in the package: its entry name and decoded bytes.
 *  The file is FASTA or annotated GenBank; the importer routes by extension. */
export interface NcbiFastaEntry {
  /** The full path inside the ZIP, e.g. "ncbi_dataset/data/gene.fna". */
  name: string;
  /** The raw FASTA or GenBank bytes. */
  bytes: Uint8Array;
}

/**
 * Unzip a Datasets package and return the FASTA or GenBank entries under
 * `ncbi_dataset/data/`. Pure over the bytes (fflate is synchronous, no network).
 * Entries are returned in a stable name order so a multi-file package imports
 * deterministically.
 */
export function unzipNcbiPackage(zip: ArrayBuffer): NcbiFastaEntry[] {
  const files = unzipSync(new Uint8Array(zip));
  const entries: NcbiFastaEntry[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.startsWith(DATA_PREFIX)) continue;
    if (!FASTA_RE.test(name) && !GENBANK_RE.test(name)) continue;
    entries.push({ name, bytes });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/** Strip the `ncbi_dataset/data/` prefix for a readable importer file name (the
 *  importer uses the name only for the extension + a display fallback). */
function shortName(entryName: string): string {
  return entryName.startsWith(DATA_PREFIX)
    ? entryName.slice(DATA_PREFIX.length)
    : entryName;
}

/**
 * Turn a downloaded Datasets ZIP into ImportedSequence records, tagged with the
 * given NCBI provenance. Each FASTA or GenBank file is parsed by the EXISTING
 * `importSequenceFile`, which already yields one ImportedSequence per record (so
 * a multi-contig genome FASTA fans out to one record per contig, and an annotated
 * multi-LOCUS genome GBFF to one annotated record per chromosome or plasmid).
 * Throws when the package holds no sequence file, or when nothing parses.
 */
export async function ncbiPackageToImports(
  zip: ArrayBuffer,
  provenance: NcbiProvenance,
): Promise<NcbiImportedSequence[]> {
  const entries = unzipNcbiPackage(zip);
  if (entries.length === 0) {
    throw new Error("The NCBI package contained no sequence file.");
  }
  const out: NcbiImportedSequence[] = [];
  for (const entry of entries) {
    const bytes = entry.bytes;
    // Pass a real ArrayBuffer slice (the importer reads bytes via TextDecoder).
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const result = await importSequenceFile(shortName(entry.name), buf);
    for (const seq of result.sequences) {
      out.push({ ...seq, provenance });
    }
  }
  if (out.length === 0) {
    throw new Error("Could not read any sequence from the NCBI package.");
  }
  return out;
}
