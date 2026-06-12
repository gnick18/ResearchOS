// sequences / ncbi-esearch. NCBI E-utilities esearch + esummary client.
//
// A user who knows a gene SYMBOL, locus tag, or protein/common name but NOT
// the accession can type it here and receive a ranked list of matching genes
// with their genomic placements. Two sibling E-utilities endpoints do the work:
//
//   esearch.fcgi  -> freetext query -> gene ids (idlist)
//   esummary.fcgi -> gene ids       -> gene summaries with genomicinfo
//
// Both are on the same CORS-open host as efetch, so all calls are browser-
// direct with no proxy and no email in the query string (same privacy posture
// as the rest of the NCBI lib).
//
// SHAPE. Network is thin. All parsing is PURE and unit-tested against saved
// real fixtures with no network. An AbortSignal propagates so a cancelled
// search stops cleanly. Network errors surface as NcbiSearchError; junk records
// (NEWENTRY, discontinued, secondary) are silently dropped.
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

/** Base URL shared by all NCBI E-utilities endpoints. */
export const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/** A surfaced esearch / esummary network or service failure. */
export class NcbiSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NcbiSearchError";
  }
}

// --- One gene search hit -----------------------------------------------------

/** A gene search result with its genomic placement, ready for the caller to
 *  pass to geneWindow + efetchGenbank. Placement fields are undefined when the
 *  summary carries no genomicinfo (a real gene with no chromosome-level
 *  annotation, not a junk record). */
export interface GeneSearchHit {
  /** NCBI gene id (numeric string, e.g. "3509526"). */
  geneId: string;
  /** Gene symbol (e.g. "cyp51A"). */
  symbol: string;
  /** Free-text description (e.g. "cytochrome P450"). */
  description: string;
  /** Chromosome name from the genomicinfo chrloc (e.g. "4"). */
  chrName?: string;
  /** RefSeq contig accession (e.g. "NC_007197.1"). */
  contigAccession?: string;
  /** 1-based inclusive start position on the contig. */
  begin?: number;
  /** 1-based inclusive end position on the contig. */
  end?: number;
  /** Strand orientation derived from the chrstart / chrstop relationship. */
  orientation?: "plus" | "minus";
  /** Exon count from the genomicinfo block, when present. */
  exonCount?: number;
}

// --- URL builders (pure) -----------------------------------------------------

/**
 * Build the esearch URL that maps a free-text gene query + organism to a list
 * of NCBI gene ids. The organism filter is appended as "<organism>[orgn]" and
 * the whole term is URL-encoded. tool=research-os, no email.
 */
export function esearchGeneIdsUrl(query: string, organism: string): string {
  // The term is "query AND organism[orgn]" encoded as one parameter value.
  const term = `${query.trim()} AND ${organism.trim()}[orgn]`;
  const params = new URLSearchParams({
    db: "gene",
    term,
    retmode: "json",
    tool: "research-os",
  });
  return `${EUTILS}/esearch.fcgi?${params.toString()}`;
}

/**
 * Build the esummary URL for a batch of gene ids. The ids are comma-joined
 * (the E-utilities batch-by-comma convention). tool=research-os, no email.
 */
export function geneSummaryUrl(ids: string[]): string {
  const params = new URLSearchParams({
    db: "gene",
    id: ids.join(","),
    retmode: "json",
    tool: "research-os",
  });
  return `${EUTILS}/esummary.fcgi?${params.toString()}`;
}

// --- Pure parsers ------------------------------------------------------------

/** The raw esearch JSON shape we read. Fields optional so a shape drift
 *  degrades to an empty result rather than a crash. */
interface RawEsearchResult {
  esearchresult?: {
    idlist?: unknown[];
  };
}

/**
 * Extract the gene id list from an esearch JSON response. Returns an empty
 * array when the response is absent, malformed, or carries no hits. Pure.
 */
export function parseEsearchIds(raw: unknown): string[] {
  const root = (raw || {}) as RawEsearchResult;
  const idlist = root.esearchresult?.idlist;
  if (!Array.isArray(idlist)) return [];
  return idlist
    .map((v) => String(v).trim())
    .filter((v) => v !== "" && v !== "undefined");
}

/** One genomicinfo entry from the esummary gene block. */
interface RawGenomicInfo {
  chrloc?: string;
  chraccver?: string;
  chrstart?: number;
  chrstop?: number;
  exoncount?: number;
}

/** The raw esummary gene record subset we read. */
interface RawGeneSummaryEntry {
  uid?: string;
  name?: string;
  description?: string;
  status?: string;
  genomicinfo?: RawGenomicInfo[];
}

/** The raw esummary response shape. */
interface RawEsummaryResult {
  result?: {
    uids?: unknown[];
    [key: string]: unknown;
  };
}

/**
 * Determine whether a gene summary record is a junk record we should drop.
 * NCBI uses the symbol "NEWENTRY" for provisional placeholder records; status
 * values "discontinued" and "secondary" mark retired / replaced entries. We
 * drop all three silently. Real genes with no genomicinfo (not yet placed on
 * a chromosome assembly) are kept but returned with undefined placement fields.
 */
function isJunk(entry: RawGeneSummaryEntry): boolean {
  const name = (entry.name || "").trim().toUpperCase();
  if (name === "NEWENTRY") return true;
  const status = (entry.status || "").trim().toLowerCase();
  if (status === "discontinued" || status === "secondary") return true;
  return false;
}

/**
 * Parse the genomicinfo[0] block into placement fields for a GeneSearchHit.
 * NCBI stores positions as 0-based and swaps chrstart / chrstop on the minus
 * strand (chrstart > chrstop when minus). We convert to 1-based inclusive:
 *   begin = min(chrstart, chrstop) + 1
 *   end   = max(chrstart, chrstop) + 1
 * Verified against the live cyp51A record (gene id 3509526):
 *   chrstart=1781821, chrstop=1777374 -> begin=1777375, end=1781822, minus.
 */
function parsePlacement(
  info: RawGenomicInfo,
): Pick<
  GeneSearchHit,
  "chrName" | "contigAccession" | "begin" | "end" | "orientation" | "exonCount"
> {
  const chrstart = typeof info.chrstart === "number" ? info.chrstart : undefined;
  const chrstop = typeof info.chrstop === "number" ? info.chrstop : undefined;
  const hasPosition =
    chrstart !== undefined && chrstop !== undefined && !isNaN(chrstart) && !isNaN(chrstop);

  let begin: number | undefined;
  let end: number | undefined;
  let orientation: "plus" | "minus" | undefined;

  if (hasPosition) {
    begin = Math.min(chrstart!, chrstop!) + 1;
    end = Math.max(chrstart!, chrstop!) + 1;
    orientation = chrstart! > chrstop! ? "minus" : "plus";
  }

  return {
    chrName: info.chrloc ? String(info.chrloc) : undefined,
    contigAccession: info.chraccver ? String(info.chraccver) : undefined,
    begin,
    end,
    orientation,
    exonCount:
      typeof info.exoncount === "number" && !isNaN(info.exoncount)
        ? info.exoncount
        : undefined,
  };
}

/**
 * Parse an esummary gene response into GeneSearchHit records. Drops junk
 * records (NEWENTRY, discontinued, secondary). Real genes with no genomicinfo
 * are kept with placement fields set to undefined. Pure.
 */
export function parseGeneSummaries(raw: unknown): GeneSearchHit[] {
  const root = (raw || {}) as RawEsummaryResult;
  const result = root.result;
  if (!result || typeof result !== "object") return [];

  const uids = Array.isArray(result.uids)
    ? result.uids.map((v) => String(v).trim()).filter((v) => v !== "")
    : [];

  const hits: GeneSearchHit[] = [];

  for (const uid of uids) {
    const entry = result[uid] as RawGeneSummaryEntry | undefined;
    if (!entry || typeof entry !== "object") continue;
    if (isJunk(entry)) continue;

    const symbol = (entry.name || "").trim();
    const geneId = (entry.uid || uid).trim();

    // First genomicinfo entry carries the primary chromosome placement.
    const info =
      Array.isArray(entry.genomicinfo) && entry.genomicinfo.length > 0
        ? entry.genomicinfo[0]
        : undefined;

    const placement = info ? parsePlacement(info) : {};

    hits.push({
      geneId,
      symbol,
      description: (entry.description || "").trim(),
      ...placement,
    });
  }

  return hits;
}

// --- Network (thin) ----------------------------------------------------------

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new NcbiSearchError("Could not reach NCBI to search for genes.");
  }
  if (!res.ok) {
    throw new NcbiSearchError(
      `NCBI returned an error (${res.status}) during gene search. Try again in a moment.`,
    );
  }
  return res.json();
}

// --- High-level search -------------------------------------------------------

/** Maximum gene ids to fetch summaries for in one search. Keeps the esummary
 *  payload small and the results focused on the most relevant hits. */
const ESEARCH_ID_CAP = 12;

/**
 * Search NCBI for genes matching a free-text query within an organism, then
 * fetch gene summaries including genomic placements. Returns a ranked list of
 * GeneSearchHit records ready for the caller. The organism can be a scientific
 * name, common name, or tax id (all accepted by the [orgn] filter). Returns an
 * empty array when no genes match. Let network failures propagate as
 * NcbiSearchError so the UI can show a calm message. An AbortSignal stops a
 * stale search cleanly.
 */
export async function esearchGenes(
  query: string,
  organism: string,
  signal?: AbortSignal,
): Promise<GeneSearchHit[]> {
  const q = (query || "").trim();
  const o = (organism || "").trim();
  if (!q || !o) return [];

  const searchRaw = await getJson(esearchGeneIdsUrl(q, o), signal);
  const allIds = parseEsearchIds(searchRaw);
  if (allIds.length === 0) return [];

  const ids = allIds.slice(0, ESEARCH_ID_CAP);
  const summaryRaw = await getJson(geneSummaryUrl(ids), signal);
  return parseGeneSummaries(summaryRaw);
}
