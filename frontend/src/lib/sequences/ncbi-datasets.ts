// sequence editor master. NCBI Datasets v2 client (browser-direct, no proxy).
//
// A user fills a small form (a gene by symbol + organism, a genome by accession,
// or any accession) and we call the NCBI Datasets v2 API straight from the
// browser. The Datasets v2 API is CORS-open (the OPTIONS preflight reflects our
// origin, allows GET / POST, and permits an api-key header), so there is no
// server in the loop, matching the InterProScan / Zenodo browser-direct pattern.
// The OLDER E-utilities efetch is NOT CORS-open, so we deliberately build on the
// modern Datasets v2 API only.
//
// PRIVACY. The only thing that ever leaves the machine is the public identifier
// the user typed (a gene symbol + organism, or an accession) sent to a public
// government API; we receive a public sequence. No DNA, no file, no user data.
//
// SHAPE. The network calls are thin. The JSON-to-preview parsing and the cap
// logic are PURE and unit-tested against saved real dataset_report fixtures
// (a BRCA1 gene report + the E. coli GCF_000005845.2 genome report).
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

/** Base URL of the NCBI Datasets v2 REST API. */
export const NCBI_DATASETS_BASE = "https://api.ncbi.nlm.nih.gov/datasets/v2";

/** What kind of record a preview / download refers to. The generic "accession"
 *  box resolves to one of the concrete kinds by sniffing the accession class. */
export type NcbiKind = "gene" | "genome" | "protein";

/** The typed preview shown in the confirm + caps step, parsed from a cheap
 *  dataset_report call before any large download. */
export interface NcbiPreview {
  /** The resolved record kind (gene / genome / protein). */
  kind: NcbiKind;
  /** Gene symbol or assembly name, for the card title. */
  title: string;
  /** The canonical accession (GCF_..., NM_..., NP_..., or a gene id). */
  accession: string;
  /** Source organism name. */
  organism: string;
  /** NCBI taxonomy id, when the report carries one. */
  taxId?: string;
  /** total_sequence_length (genome) or the genomic span (gene), in bp. */
  lengthBp?: number;
  /** number_of_contigs (genome only). */
  contigs?: number;
  /** "Complete Genome", "Scaffold", ... (genome only). */
  assemblyLevel?: string;
}

/** The download payload to request, mapped to the Datasets `include_annotation_type`
 *  query parameter. Genome / assembly downloads request GBFF, an annotated GenBank
 *  flat file carrying genes, CDS, organism lineage, and references, so they import
 *  fully annotated through the existing GenBank parser. Gene-by-symbol and protein
 *  packages are not assembly-level and have no GBFF, so they stay FASTA. */
export type NcbiInclude =
  | "GENOME_GBFF"
  | "GENE_FASTA"
  | "PROT_FASTA";

// --- Caps (enforced on the cheap preview, before any large transfer) --------

/**
 * Guardrails enforced on the preview metadata. This feature is one gene / one
 * genome at a time, not a bulk tool, so we refuse anything that would choke the
 * editor BEFORE downloading it (the metadata call is cheap; the package is not).
 *
 *  - maxGenomeBp: ~50 Mb total sequence length. Covers bacteria and small
 *    eukaryotes; refuses large eukaryotic genomes (Gb-scale) with a clear
 *    message rather than freezing the browser.
 *  - maxContigs: ~500 contigs. A draft assembly with thousands of contigs would
 *    become thousands of sequence records (noise); we cap it.
 *  - maxPackages: 1. One package per action, never a batch / list download.
 */
export const NCBI_CAPS = {
  maxGenomeBp: 50_000_000,
  maxContigs: 500,
  maxPackages: 1,
} as const;

/** The result of checking a preview against the caps. `ok` false carries the
 *  exact, user-facing reason (the Download button shows it). */
export interface CapCheck {
  ok: boolean;
  reason?: string;
}

/** Format a bp count compactly for a cap message (e.g. "50 Mb"). */
function formatMb(bp: number): string {
  const mb = bp / 1_000_000;
  // Whole numbers read cleaner; keep one decimal under 10 Mb for precision.
  return mb >= 10 ? `${Math.round(mb)} Mb` : `${mb.toFixed(1)} Mb`;
}

/**
 * Check a preview against the caps. Pure: takes a preview, returns ok / reason.
 * Genes and proteins are single short records and always pass the size / contig
 * caps; the caps bite on genomes. Enforced on the preview, before download.
 */
export function checkCaps(preview: NcbiPreview): CapCheck {
  if (
    typeof preview.lengthBp === "number" &&
    preview.lengthBp > NCBI_CAPS.maxGenomeBp
  ) {
    return {
      ok: false,
      reason:
        `This genome is ${formatMb(preview.lengthBp)}, over the ` +
        `${formatMb(NCBI_CAPS.maxGenomeBp)} limit for an in-browser import. ` +
        `Large genomes would overwhelm the editor. For a genome this size, use ` +
        `the NCBI Datasets command-line tool.`,
    };
  }
  if (
    typeof preview.contigs === "number" &&
    preview.contigs > NCBI_CAPS.maxContigs
  ) {
    return {
      ok: false,
      reason:
        `This assembly has ${preview.contigs.toLocaleString()} contigs, over the ` +
        `${NCBI_CAPS.maxContigs} limit. A draft with this many pieces would become ` +
        `thousands of separate records. Pick a more complete assembly, or use the ` +
        `NCBI Datasets command-line tool.`,
    };
  }
  return { ok: true };
}

// --- Accession sniffing -----------------------------------------------------

/** A surfaced network / service / parse failure for the UI. */
export class NcbiDatasetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NcbiDatasetsError";
  }
}

/**
 * Classify a raw accession string into a record kind by its prefix:
 *  - GCF_ / GCA_  -> genome (assembly accession)
 *  - NM_ / NR_ / XM_ / XR_ / NG_  -> gene / RNA (a transcript or gene region)
 *  - NP_ / XP_  -> protein
 * Returns null when the prefix is unrecognized, so the caller can ask the user
 * to pick a specific kind instead of guessing wrong.
 */
export function sniffAccessionKind(accession: string): NcbiKind | null {
  const acc = (accession || "").trim().toUpperCase();
  if (/^GC[FA]_/.test(acc)) return "genome";
  if (/^(NM|NR|XM|XR|NG)_/.test(acc)) return "gene";
  if (/^(NP|XP|AP|YP|WP)_/.test(acc)) return "protein";
  return null;
}

// --- Report parsing (pure, unit-tested against real fixtures) ---------------

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // The Datasets API returns several numeric stats as STRINGS
  // (e.g. total_sequence_length "4641652", a genomic_range begin/end).
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** The genome dataset_report subset we read. Every field optional + validated,
 *  so a shape drift degrades to a sparse preview rather than a crash. */
interface RawGenomeReport {
  reports?: Array<{
    accession?: string;
    organism?: { tax_id?: number | string; organism_name?: string };
    assembly_info?: { assembly_level?: string; assembly_name?: string };
    assembly_stats?: {
      total_sequence_length?: number | string;
      number_of_contigs?: number | string;
    };
  }>;
  total_count?: number;
}

/** Parse a genome dataset_report JSON into an NcbiPreview. Throws a clear error
 *  when the report has no matching assembly. */
export function parseGenomeReport(raw: unknown): NcbiPreview {
  const root = (raw || {}) as RawGenomeReport;
  const report = Array.isArray(root.reports) ? root.reports[0] : undefined;
  if (!report || !report.accession) {
    throw new NcbiDatasetsError(
      "No genome assembly matched that accession on NCBI.",
    );
  }
  const stats = report.assembly_stats || {};
  const info = report.assembly_info || {};
  const org = report.organism || {};
  return {
    kind: "genome",
    title: asString(info.assembly_name) || report.accession,
    accession: report.accession,
    organism: asString(org.organism_name) || "Unknown organism",
    taxId: org.tax_id != null ? String(org.tax_id) : undefined,
    lengthBp: asNumber(stats.total_sequence_length),
    contigs: asNumber(stats.number_of_contigs),
    assemblyLevel: asString(info.assembly_level),
  };
}

/** The gene dataset_report subset we read. */
interface RawGeneReport {
  reports?: Array<{
    gene?: {
      gene_id?: number | string;
      symbol?: string;
      description?: string;
      tax_id?: number | string;
      taxname?: string;
      annotations?: Array<{
        genomic_locations?: Array<{
          genomic_range?: { begin?: number | string; end?: number | string };
        }>;
      }>;
    };
  }>;
  total_count?: number;
}

/** Derive a gene's genomic span (bp) from the first annotation's genomic_range,
 *  for the preview length. begin / end arrive as strings. Undefined when absent. */
function geneSpanBp(gene: NonNullable<RawGeneReport["reports"]>[number]["gene"]):
  | number
  | undefined {
  const loc = gene?.annotations?.[0]?.genomic_locations?.[0]?.genomic_range;
  const begin = asNumber(loc?.begin);
  const end = asNumber(loc?.end);
  if (begin === undefined || end === undefined) return undefined;
  return Math.abs(end - begin) + 1;
}

/** Parse a gene dataset_report JSON into an NcbiPreview. Throws when no gene
 *  matched the symbol + organism (a common typo case). */
export function parseGeneReport(raw: unknown): NcbiPreview {
  const root = (raw || {}) as RawGeneReport;
  const gene = Array.isArray(root.reports) ? root.reports[0]?.gene : undefined;
  if (!gene || (!gene.symbol && gene.gene_id == null)) {
    throw new NcbiDatasetsError(
      "No gene matched that symbol and organism on NCBI. Check the spelling and the organism.",
    );
  }
  const symbol = asString(gene.symbol);
  return {
    kind: "gene",
    title: symbol || (gene.gene_id != null ? `Gene ${gene.gene_id}` : "Gene"),
    accession: gene.gene_id != null ? String(gene.gene_id) : symbol || "",
    organism: asString(gene.taxname) || "Unknown organism",
    taxId: gene.tax_id != null ? String(gene.tax_id) : undefined,
    lengthBp: geneSpanBp(gene),
  };
}

// --- Network (thin) ---------------------------------------------------------

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new NcbiDatasetsError("Could not reach NCBI Datasets.");
  }
  if (res.status === 404) {
    throw new NcbiDatasetsError("NCBI Datasets found no match for that query.");
  }
  if (!res.ok) {
    throw new NcbiDatasetsError(
      `NCBI Datasets returned an error (${res.status}). Try again in a moment.`,
    );
  }
  return res.json();
}

/** Preview a gene by symbol + taxon (organism resolved to a tax id, or an NCBI
 *  taxon name the API accepts). */
export async function previewGeneBySymbol(
  symbol: string,
  taxon: string,
  signal?: AbortSignal,
): Promise<NcbiPreview> {
  const s = (symbol || "").trim();
  const t = (taxon || "").trim();
  if (!s || !t) {
    throw new NcbiDatasetsError("Enter both a gene symbol and an organism.");
  }
  const url =
    `${NCBI_DATASETS_BASE}/gene/symbol/${encodeURIComponent(s)}` +
    `/taxon/${encodeURIComponent(t)}/dataset_report`;
  return parseGeneReport(await getJson(url, signal));
}

/** Preview a gene by accession / gene id. */
export async function previewGeneByAccession(
  acc: string,
  signal?: AbortSignal,
): Promise<NcbiPreview> {
  const a = (acc || "").trim();
  if (!a) throw new NcbiDatasetsError("Enter a gene accession.");
  const url = `${NCBI_DATASETS_BASE}/gene/accession/${encodeURIComponent(a)}/dataset_report`;
  return parseGeneReport(await getJson(url, signal));
}

/** Preview a genome by assembly accession (GCF_... / GCA_...). */
export async function previewGenomeByAccession(
  acc: string,
  signal?: AbortSignal,
): Promise<NcbiPreview> {
  const a = (acc || "").trim();
  if (!a) throw new NcbiDatasetsError("Enter a genome accession.");
  const url = `${NCBI_DATASETS_BASE}/genome/accession/${encodeURIComponent(a)}/dataset_report`;
  return parseGenomeReport(await getJson(url, signal));
}

/**
 * Preview by a single accession box. Sniffs the accession class and routes:
 * GCF/GCA -> genome, NM/NR/XM/XR/NG -> gene, NP/XP -> protein. Protein is a
 * noted follow-up, so a protein accession is rejected with a clear message for
 * now. An unrecognized prefix asks the user to use the specific Gene / Genome
 * form.
 */
export async function previewByAccession(
  acc: string,
  signal?: AbortSignal,
): Promise<NcbiPreview> {
  const a = (acc || "").trim();
  if (!a) throw new NcbiDatasetsError("Enter an accession.");
  const kind = sniffAccessionKind(a);
  if (kind === "genome") return previewGenomeByAccession(a, signal);
  if (kind === "gene") return previewGeneByAccession(a, signal);
  if (kind === "protein") {
    throw new NcbiDatasetsError(
      "Protein downloads are coming soon. For now, use a gene or genome accession.",
    );
  }
  throw new NcbiDatasetsError(
    "That accession was not recognized. Use a genome accession (GCF_ / GCA_) or a gene / transcript accession (NM_, NR_, XM_, NG_), or switch to the Gene tab.",
  );
}

// --- Download (thin) --------------------------------------------------------

/** What to download, derived from a preview. */
export interface DownloadRequest {
  kind: NcbiKind;
  /** The identifier the download endpoint takes (accession or gene id). */
  id: string;
  /** The payload to request (annotated GBFF for genomes, FASTA otherwise). */
  include: NcbiInclude;
  /** Optional NCBI api-key header (the preflight confirmed it is allowed). v1
   *  is anonymous; a settings UI for this is a noted follow-up. */
  apiKey?: string;
  signal?: AbortSignal;
}

/** Build the download URL for a kind + id, requesting the chosen payload
 *  (annotated GBFF for genomes, FASTA for gene / protein). */
function downloadUrl(kind: NcbiKind, id: string, include: NcbiInclude): string {
  const enc = encodeURIComponent(id);
  const q = `include_annotation_type=${include}`;
  if (kind === "genome") {
    return `${NCBI_DATASETS_BASE}/genome/accession/${enc}/download?${q}`;
  }
  if (kind === "protein") {
    return `${NCBI_DATASETS_BASE}/protein/accession/${enc}/download?${q}`;
  }
  // Gene: a bare gene id routes through /gene/id, an accession through
  // /gene/accession. A purely numeric id is the gene id form.
  if (/^\d+$/.test(id)) {
    return `${NCBI_DATASETS_BASE}/gene/id/${enc}/download?${q}`;
  }
  return `${NCBI_DATASETS_BASE}/gene/accession/${enc}/download?${q}`;
}

/** Pick the right payload for a kind. Genome / assembly downloads request the
 *  annotated GBFF; gene and protein stay FASTA (no assembly-level GBFF exists). */
export function includeForKind(kind: NcbiKind): NcbiInclude {
  if (kind === "genome") return "GENOME_GBFF";
  if (kind === "protein") return "PROT_FASTA";
  return "GENE_FASTA";
}

/**
 * Download the Datasets ZIP package and return it as an ArrayBuffer. This stays
 * thin, the unzip + FASTA / GenBank parse live in ncbi-import.ts. Injects the
 * api-key header only when one is provided.
 */
export async function downloadPackage(req: DownloadRequest): Promise<ArrayBuffer> {
  const url = downloadUrl(req.kind, req.id, req.include);
  const headers: Record<string, string> = { Accept: "application/zip" };
  if (req.apiKey) headers["api-key"] = req.apiKey;
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: req.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new NcbiDatasetsError("Could not reach NCBI Datasets to download.");
  }
  if (!res.ok) {
    throw new NcbiDatasetsError(
      `NCBI Datasets download failed (${res.status}). Try again in a moment.`,
    );
  }
  return res.arrayBuffer();
}
