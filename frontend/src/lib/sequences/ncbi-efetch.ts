// sequence editor master. NCBI E-utilities efetch client (browser-direct, no proxy).
//
// The Datasets gene endpoint serves FASTA only, so a gene download arrives with
// no features. efetch DOES serve fully annotated GenBank for any nuccore record
// (a transcript NM_, a RefSeqGene NG_, a chromosome NC_, a plasmid, a custom
// accession), and it is CORS-open. A browser fetch is a simple GET, so there is
// no preflight and this runs straight from the page with no server in the loop.
// We send tool=research-os and NO email, so zero personal data leaves the machine.
//
// SHAPE. The network call is thin. The two pure pieces, the "is this GenBank"
// guard and pulling the RefSeqGene accession out of a gene report, are unit
// tested against SAVED real responses (efetch GenBank + a gene report) with no
// network.
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

/** Base URL of the NCBI E-utilities efetch endpoint. */
export const NCBI_EFETCH_BASE =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

/** Base URL of the NCBI Datasets v2 REST API (the gene report lives here). */
const NCBI_DATASETS_BASE = "https://api.ncbi.nlm.nih.gov/datasets/v2";

/** A surfaced efetch network / service / not-GenBank failure for the UI. */
export class EfetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EfetchError";
  }
}

/** True when the text looks like a GenBank flat file (it carries a LOCUS line).
 *  efetch returns a plain-text error body with HTTP 200 for a bad id, so this
 *  guard is what separates a real record from an error before parsing. Pure. */
export function looksLikeGenbank(text: string): boolean {
  return /^LOCUS\s/m.test(text || "");
}

/** Build the efetch URL for one nuccore accession. Always gbwithparts + text so
 *  records that use CONTIG joins still carry the full sequence, and always
 *  tool=research-os with no email (zero personal data in the query string). */
export function efetchUrl(accession: string): string {
  const params = new URLSearchParams({
    db: "nuccore",
    id: accession,
    rettype: "gbwithparts",
    retmode: "text",
    tool: "research-os",
  });
  return `${NCBI_EFETCH_BASE}?${params.toString()}`;
}

/**
 * Fetch one nuccore accession as annotated GenBank text. Browser-direct over the
 * CORS-open efetch endpoint. Guards the body with a LOCUS check, so an efetch
 * error-as-200 plain-text body becomes a typed EfetchError instead of feeding
 * garbage to the GenBank parser. An aborted fetch propagates so a cancelled
 * import stops cleanly.
 */
export async function efetchGenbank(
  accession: string,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const acc = (accession || "").trim();
  if (!acc) throw new EfetchError("Enter an accession.");
  let res: Response;
  try {
    res = await fetch(efetchUrl(acc), {
      headers: { Accept: "text/plain" },
      signal: opts?.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new EfetchError("Could not reach NCBI to fetch that record.");
  }
  if (!res.ok) {
    throw new EfetchError(
      `NCBI returned an error (${res.status}) for that accession. Try again in a moment.`,
    );
  }
  const text = await res.text();
  if (!looksLikeGenbank(text)) {
    // efetch hands back a plain-text error body (no LOCUS) for an id it cannot
    // resolve. Surface a calm message rather than parse the error text.
    throw new EfetchError(
      `NCBI did not return a sequence record for "${acc}". Check the accession.`,
    );
  }
  return text;
}

// --- Cheap preview from the GenBank header (pure text) -----------------------
//
// One efetch IS the whole record, so we fetch once and read a calm preview
// (organism, total length, feature count) straight off the flat-file text rather
// than parsing the whole thing twice. The same text is then handed to the import
// pipeline, so there is no second network call.

/** A calm preview parsed from efetch GenBank text, for the confirm card. */
export interface EfetchPreview {
  /** The record name from the LOCUS line (the accession base). */
  name: string;
  /** Source organism from the ORGANISM line, when present. */
  organism?: string;
  /** Total length in bp / residues from the LOCUS line. */
  lengthBp?: number;
  /** Count of annotated features in the FEATURES table (source counts too). */
  featureCount: number;
}

/** Parse a calm preview out of efetch GenBank text. Pure. Reads the LOCUS line
 *  for the name + length, the ORGANISM line for the organism, and counts feature
 *  keys (lines with a key at column 6 inside the FEATURES table). */
export function parseEfetchPreview(genbank: string): EfetchPreview {
  const text = genbank || "";
  const locus = /^LOCUS\s+(\S+)\s+(\d+)\s+(?:bp|aa)/m.exec(text);
  const name = locus ? locus[1] : "Record";
  const lengthBp = locus ? Number(locus[2]) : undefined;

  const organismMatch = /^\s{2}ORGANISM\s+(.+)$/m.exec(text);
  const organism = organismMatch ? organismMatch[1].trim() : undefined;

  // Count feature keys: inside the FEATURES table, a feature line carries its
  // key at column 6 (five leading spaces then a non-space). Qualifier lines are
  // indented further (to column 21), so they do not match.
  let featureCount = 0;
  const lines = text.split("\n");
  let inFeatures = false;
  for (const line of lines) {
    if (/^FEATURES\s/.test(line)) {
      inFeatures = true;
      continue;
    }
    if (!inFeatures) continue;
    // A non-indented keyword (ORIGIN, //) ends the FEATURES table.
    if (/^[A-Z/]/.test(line)) break;
    if (/^ {5}\S/.test(line)) featureCount++;
  }

  return {
    name,
    organism,
    lengthBp: Number.isFinite(lengthBp) ? lengthBp : undefined,
    featureCount,
  };
}

// --- Gene symbol -> RefSeqGene accession -------------------------------------
//
// The Datasets gene report carries the RefSeqGene accession at
// reports[].gene.reference_standards[].gene_range.accession_version (the entry
// whose type is REFSEQ_GENE). That NG_ accession is the whole-gene curated
// record, which we then efetch as annotated GenBank. The report is snake_case
// JSON (reference_standards / gene_range / accession_version), matching the
// saved fixtures.

/** A surfaced "this gene has no RefSeqGene record" outcome, so the UI can fall
 *  back to the bulk FASTA path with a calm note instead of failing. */
export class NoRefSeqGeneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoRefSeqGeneError";
  }
}

/** The gene-report subset we read for the RefSeqGene accession. Every field is
 *  optional + validated, so a shape drift degrades to "no RefSeqGene" rather
 *  than a crash. */
interface RawGeneReportForRefSeq {
  reports?: Array<{
    gene?: {
      reference_standards?: Array<{
        type?: string;
        gene_range?: { accession_version?: string };
      }>;
    };
  }>;
}

/**
 * Pull the RefSeqGene NG_ accession out of a gene report, preferring the entry
 * whose type is REFSEQ_GENE. Returns null when the report carries no RefSeqGene
 * range (so the caller can fall back to FASTA). Pure, unit tested against a saved
 * TP53 report.
 */
export function extractRefSeqGeneAccession(report: unknown): string | null {
  const root = (report || {}) as RawGeneReportForRefSeq;
  const gene = Array.isArray(root.reports) ? root.reports[0]?.gene : undefined;
  const standards = gene?.reference_standards;
  if (!Array.isArray(standards) || standards.length === 0) return null;
  // Prefer the explicit REFSEQ_GENE entry; fall back to the first range that
  // carries an accession (older reports may not type the entry).
  const preferred =
    standards.find((s) => (s?.type || "").toUpperCase() === "REFSEQ_GENE") ||
    standards.find((s) => s?.gene_range?.accession_version);
  const acc = preferred?.gene_range?.accession_version;
  return typeof acc === "string" && acc.trim() !== "" ? acc.trim() : null;
}

/** Fetch a gene report by symbol + taxon, or by a numeric gene id. Thin network
 *  leg, separate from the parse so the parse stays pure. */
async function fetchGeneReport(
  geneSymbolOrId: string,
  taxon: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const id = (geneSymbolOrId || "").trim();
  const t = (taxon || "").trim();
  if (!id) throw new EfetchError("Enter a gene symbol or id.");
  // A purely numeric id resolves through /gene/id; a symbol needs the taxon.
  const url = /^\d+$/.test(id)
    ? `${NCBI_DATASETS_BASE}/gene/id/${encodeURIComponent(id)}/dataset_report`
    : `${NCBI_DATASETS_BASE}/gene/symbol/${encodeURIComponent(id)}/taxon/${encodeURIComponent(t)}/dataset_report`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new EfetchError("Could not reach NCBI to look up that gene.");
  }
  if (!res.ok) {
    throw new EfetchError(
      `NCBI returned an error (${res.status}) looking up that gene. Try again in a moment.`,
    );
  }
  return res.json();
}

/**
 * Resolve a gene (by symbol + taxon, or by a numeric gene id) to its RefSeqGene
 * NG_ accession, which the caller then efetches as the whole annotated gene
 * record. Throws NoRefSeqGeneError when the gene has no RefSeqGene range, so the
 * dialog can fall back to the bulk FASTA download with a calm note. Other
 * failures surface as EfetchError.
 */
export async function resolveGeneToAccession(
  geneSymbolOrId: string,
  taxon: string,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const report = await fetchGeneReport(geneSymbolOrId, taxon, opts?.signal);
  const acc = extractRefSeqGeneAccession(report);
  if (!acc) {
    throw new NoRefSeqGeneError(
      "This gene has no RefSeqGene record on NCBI, so there is no annotated whole-gene file to import.",
    );
  }
  return acc;
}
