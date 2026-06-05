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

// --- Taxonomy (organism -> named lineage) -----------------------------------
//
// The taxonomy endpoint is browser-direct / CORS-open (the OPTIONS preflight
// reflects our origin), so the organism-to-lineage lookup runs straight from the
// browser with no proxy. A query may be an organism name ("Escherichia coli") or
// a numeric tax id ("9606"). The single-taxon response carries the tax id, the
// scientific name, the rank, and a `lineage` array of ANCESTOR TAX IDS (root ->
// parent order), but NOT their names. To show a named lineage we resolve those
// ids to { name, rank } with one batch call (the endpoint takes a comma-separated
// id list). Pure parsing is unit-tested against saved real responses; no network
// in the tests.

/** One node of a resolved taxonomy lineage. */
export interface TaxonomyNode {
  taxId: string;
  name: string;
  rank: string;
}

/** A resolved taxonomy result: the organism plus its named lineage (root ->
 *  organism order, the organism itself as the final node). */
export interface TaxonomyResult {
  taxId: string;
  name: string;
  rank: string;
  lineage: TaxonomyNode[];
}

/** The major taxonomic ranks we surface on the calm inline line, in canonical
 *  root -> leaf order. NCBI labels the top tier "DOMAIN" (Bacteria, Eukaryota,
 *  Archaea) and historically "SUPERKINGDOM"; we accept either as the superkingdom
 *  slot. The rest map one-to-one to NCBI rank strings. */
const MAJOR_RANK_ORDER = [
  "superkingdom",
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species",
] as const;

/** Map an NCBI rank string (any case) to one of our canonical major-rank slots,
 *  or null when it is not a major rank we show inline. DOMAIN folds into the
 *  superkingdom slot so Bacteria / Eukaryota / Archaea read as the top tier. */
function majorRankSlot(rank: string | undefined): string | null {
  const r = (rank || "").trim().toLowerCase();
  if (!r) return null;
  if (r === "domain" || r === "superkingdom") return "superkingdom";
  return (MAJOR_RANK_ORDER as readonly string[]).includes(r) ? r : null;
}

/**
 * Pick only the major-rank nodes from a full lineage, in canonical
 * superkingdom -> species order, keeping at most one node per slot (the first
 * match wins). Pure: takes a lineage, returns the calm inline subset. A lineage
 * with no major ranks (a sparse / clade-only chain) returns an empty array, and
 * the display self-hides.
 */
export function majorRanks(lineage: TaxonomyNode[]): TaxonomyNode[] {
  const bySlot = new Map<string, TaxonomyNode>();
  for (const node of lineage) {
    const slot = majorRankSlot(node.rank);
    if (slot && !bySlot.has(slot)) bySlot.set(slot, node);
  }
  const out: TaxonomyNode[] = [];
  for (const slot of MAJOR_RANK_ORDER) {
    const node = bySlot.get(slot);
    if (node) out.push(node);
  }
  return out;
}

/** The taxonomy endpoint response subset we read. Every field optional +
 *  validated, so a shape drift degrades rather than crashes. */
interface RawTaxonomyResponse {
  taxonomy_nodes?: Array<{
    taxonomy?: {
      tax_id?: number | string;
      organism_name?: string;
      rank?: string;
      lineage?: Array<number | string>;
    };
  }>;
}

/** Pull the first taxonomy node out of a single-taxon response, normalized to
 *  strings. Throws a clear error when nothing matched (a typo / unknown name). */
export function parseTaxonNode(raw: unknown): {
  taxId: string;
  name: string;
  rank: string;
  lineageIds: string[];
} {
  const root = (raw || {}) as RawTaxonomyResponse;
  const tax = Array.isArray(root.taxonomy_nodes)
    ? root.taxonomy_nodes[0]?.taxonomy
    : undefined;
  if (!tax || tax.tax_id == null) {
    throw new NcbiDatasetsError(
      "No organism matched that name or tax id on NCBI. Check the spelling.",
    );
  }
  return {
    taxId: String(tax.tax_id),
    name: asString(tax.organism_name) || `Taxon ${tax.tax_id}`,
    rank: (asString(tax.rank) || "").toLowerCase(),
    lineageIds: Array.isArray(tax.lineage)
      ? tax.lineage.map((v) => String(v))
      : [],
  };
}

/** Parse a BATCH taxonomy response into a tax-id -> { name, rank } map. The batch
 *  endpoint returns nodes in arbitrary order, so the caller must look up by id,
 *  not by position. Pure. */
export function parseTaxonNodeMap(raw: unknown): Map<string, TaxonomyNode> {
  const root = (raw || {}) as RawTaxonomyResponse;
  const map = new Map<string, TaxonomyNode>();
  for (const node of root.taxonomy_nodes || []) {
    const tax = node.taxonomy;
    if (!tax || tax.tax_id == null) continue;
    const id = String(tax.tax_id);
    map.set(id, {
      taxId: id,
      name: asString(tax.organism_name) || `Taxon ${id}`,
      rank: (asString(tax.rank) || "").toLowerCase(),
    });
  }
  return map;
}

/** Assemble a TaxonomyResult from a parsed leaf node and a resolved id -> node
 *  map. Pure, so the full resolve is unit-tested against the two saved fixtures
 *  (a single-taxon response + a batch lineage response) with no network. The
 *  lineage is the leaf's ancestor ids in their given root -> parent order, each
 *  resolved to a name + rank, with the organism itself appended as the final
 *  node. Ids that did not resolve are dropped from the named lineage. */
export function assembleTaxonomy(
  leaf: { taxId: string; name: string; rank: string; lineageIds: string[] },
  nameMap: Map<string, TaxonomyNode>,
): TaxonomyResult {
  const lineage: TaxonomyNode[] = [];
  for (const id of leaf.lineageIds) {
    const node = nameMap.get(id);
    if (node) lineage.push(node);
  }
  // The organism itself is the leaf of its own lineage.
  lineage.push({ taxId: leaf.taxId, name: leaf.name, rank: leaf.rank });
  return { taxId: leaf.taxId, name: leaf.name, rank: leaf.rank, lineage };
}

/** A simple in-memory cache of resolved tax id -> node, shared across resolves
 *  in a session so repeated lookups (and a multi-record genome import that hits
 *  the same lineage) do not re-resolve the same ids. */
const taxonNameCache = new Map<string, TaxonomyNode>();

/**
 * Resolve an organism name or tax id to its scientific name, rank, and named
 * lineage (root -> organism order). Browser-direct over the CORS-open taxonomy
 * endpoint. Two calls at most: one to resolve the query to a leaf (+ ancestor
 * ids), one batch call to name the ancestors that are not already cached. The
 * batch fetch is best-effort, so a transient names failure still returns the
 * organism with a lineage of whatever resolved (never throws on the second leg).
 */
export async function resolveTaxonomy(
  query: string,
  opts?: { signal?: AbortSignal },
): Promise<TaxonomyResult> {
  const q = (query || "").trim();
  if (!q) throw new NcbiDatasetsError("Enter an organism name or tax id.");
  const signal = opts?.signal;
  const leafUrl = `${NCBI_DATASETS_BASE}/taxonomy/taxon/${encodeURIComponent(q)}`;
  const leaf = parseTaxonNode(await getJson(leafUrl, signal));

  // Which ancestor ids still need a name. The leaf itself is named already.
  const missing = leaf.lineageIds.filter((id) => !taxonNameCache.has(id));
  if (missing.length > 0) {
    try {
      const batchUrl =
        `${NCBI_DATASETS_BASE}/taxonomy/taxon/` +
        missing.map((id) => encodeURIComponent(id)).join(",");
      const batch = parseTaxonNodeMap(await getJson(batchUrl, signal));
      for (const [id, node] of batch) taxonNameCache.set(id, node);
    } catch (e) {
      // Best-effort: an abort still propagates so a cancelled lookup stops; any
      // other names failure degrades to the resolved-so-far lineage.
      if ((e as Error)?.name === "AbortError") throw e;
    }
  }
  return assembleTaxonomy(leaf, taxonNameCache);
}

// --- Tree explorer (one node, its neighbors, autocomplete) -------------------
//
// The taxonomy tree explorer walks UP to a parent, SIDEWAYS to siblings, and
// DOWN to children. The same CORS-open Datasets taxonomy endpoint carries
// everything a tree node needs in one dataset_report call: the node's parents
// (ancestor lineage, root -> parent order), its direct children, the named
// major-rank classification, and a counts array. We normalize that report into
// a flat ExplorerTaxonNode the UI can render directly. Pure parsing is unit
// tested against saved real reports; no network in the tests.

/** A toggleable set of tallies for a node, mapped from the report counts array
 *  to named fields. species is absent on the live path (it comes from the
 *  backbone), present here only when a future report carries it. */
export interface ExplorerCounts {
  /** Assemblies under the node (COUNT_TYPE_ASSEMBLY). */
  assemblies?: number;
  /** Genes under the node (COUNT_TYPE_GENE). */
  genes?: number;
  /** Species under the node, when the source carries it (the live report does
   *  not, so this stays undefined on the live path). */
  species?: number;
}

/** One normalized tree node. childIds and a parentId let the UI walk in every
 *  direction; classification maps a major rank to its name for the breadcrumb. */
export interface ExplorerTaxonNode {
  taxId: string;
  name: string;
  rank: string;
  /** The nearest ancestor's tax id (the last entry of the report parents), or
   *  null at a root. */
  parentId: string | null;
  /** Direct child tax ids (resolved to names in a batch by the caller). */
  childIds: string[];
  /** Major rank -> name, for the breadcrumb (e.g. domain, phylum, family). */
  classification: Record<string, string>;
  /** Named tallies, toggled in the count badge. */
  counts: ExplorerCounts;
}

/** One autocomplete suggestion from taxon_suggest. */
export interface TaxonSuggestion {
  taxId: string;
  name: string;
  rank: string;
}

/** The dataset_report taxonomy subset the explorer reads. Every field optional
 *  and validated so a shape drift degrades rather than crashes. */
interface RawTaxonReport {
  reports?: Array<{
    taxonomy?: {
      tax_id?: number | string;
      rank?: string;
      current_scientific_name?: { name?: string } | string;
      classification?: Record<string, { name?: string; id?: number | string }>;
      parents?: Array<number | string>;
      children?: Array<number | string>;
      counts?: Array<{ type?: string; count?: number | string }>;
    };
  }>;
}

/** Read the scientific name out of the report, which carries it as an object
 *  ({ name, authority }) on the modern endpoint or, defensively, as a string. */
function readScientificName(
  v: { name?: string } | string | undefined,
  taxId: string,
): string {
  if (typeof v === "string") return asString(v) || `Taxon ${taxId}`;
  if (v && typeof v === "object") return asString(v.name) || `Taxon ${taxId}`;
  return `Taxon ${taxId}`;
}

/** Map the report counts array to the named ExplorerCounts fields. Unknown
 *  count types are ignored; the two the UI surfaces are assemblies and genes. */
function readCounts(
  arr: Array<{ type?: string; count?: number | string }> | undefined,
): ExplorerCounts {
  const out: ExplorerCounts = {};
  if (!Array.isArray(arr)) return out;
  for (const entry of arr) {
    const n = asNumber(entry?.count);
    if (n === undefined) continue;
    if (entry.type === "COUNT_TYPE_ASSEMBLY") out.assemblies = n;
    else if (entry.type === "COUNT_TYPE_GENE") out.genes = n;
  }
  return out;
}

/** Map the report classification block to a major-rank -> name map. */
function readClassification(
  raw: Record<string, { name?: string; id?: number | string }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [rank, entry] of Object.entries(raw)) {
    const name = asString(entry?.name);
    if (name) out[rank.toLowerCase()] = name;
  }
  return out;
}

/** Parse a single-taxon dataset_report into a normalized ExplorerTaxonNode.
 *  Pure. Throws a clear error when the report carries no taxon. The parentId is
 *  the LAST entry of parents (root -> parent order), or null at a root. */
export function parseExplorerNode(raw: unknown): ExplorerTaxonNode {
  const root = (raw || {}) as RawTaxonReport;
  const tax = Array.isArray(root.reports) ? root.reports[0]?.taxonomy : undefined;
  if (!tax || tax.tax_id == null) {
    throw new NcbiDatasetsError("No taxon matched that id on NCBI.");
  }
  const taxId = String(tax.tax_id);
  const parents = Array.isArray(tax.parents) ? tax.parents.map((v) => String(v)) : [];
  const childIds = Array.isArray(tax.children)
    ? tax.children.map((v) => String(v))
    : [];
  return {
    taxId,
    name: readScientificName(tax.current_scientific_name, taxId),
    rank: (asString(tax.rank) || "").toLowerCase(),
    parentId: parents.length > 0 ? parents[parents.length - 1] : null,
    childIds,
    classification: readClassification(tax.classification),
    counts: readCounts(tax.counts),
  };
}

/** Parse a BATCH dataset_report (a comma-separated id list) into a tax-id ->
 *  { taxId, name, rank } map, so a node's children or siblings get their names
 *  and ranks in one call. Pure. */
export function parseExplorerNodeMap(raw: unknown): Map<string, TaxonSuggestion> {
  const root = (raw || {}) as RawTaxonReport;
  const map = new Map<string, TaxonSuggestion>();
  for (const report of root.reports || []) {
    const tax = report.taxonomy;
    if (!tax || tax.tax_id == null) continue;
    const id = String(tax.tax_id);
    map.set(id, {
      taxId: id,
      name: readScientificName(tax.current_scientific_name, id),
      rank: (asString(tax.rank) || "").toLowerCase(),
    });
  }
  return map;
}

/** The taxon_suggest autocomplete response subset we read. */
interface RawSuggestResponse {
  sci_name_and_ids?: Array<{
    tax_id?: number | string;
    sci_name?: string;
    rank?: string;
  }>;
}

/** Parse a taxon_suggest response into a list of suggestions. Pure. Entries with
 *  no tax id are dropped. */
export function parseTaxonSuggestions(raw: unknown): TaxonSuggestion[] {
  const root = (raw || {}) as RawSuggestResponse;
  const out: TaxonSuggestion[] = [];
  for (const entry of root.sci_name_and_ids || []) {
    if (entry?.tax_id == null) continue;
    const id = String(entry.tax_id);
    out.push({
      taxId: id,
      name: asString(entry.sci_name) || `Taxon ${id}`,
      rank: (asString(entry.rank) || "").toLowerCase(),
    });
  }
  return out;
}

/**
 * Fetch one tree node (parents, children, counts, classification), normalized.
 * Browser-direct over the CORS-open taxonomy endpoint, one call. Used for nodes
 * below the curated backbone (genus / species / strain) and for the live
 * assemblies count on any centered node.
 */
export async function getTaxonNode(
  taxId: string | number,
  opts?: { signal?: AbortSignal },
): Promise<ExplorerTaxonNode> {
  const id = String(taxId).trim();
  if (!id) throw new NcbiDatasetsError("Enter a tax id.");
  const url = `${NCBI_DATASETS_BASE}/taxonomy/taxon/${encodeURIComponent(id)}/dataset_report`;
  return parseExplorerNode(await getJson(url, opts?.signal));
}

/** Resolve a batch of tax ids to { taxId, name, rank } in one call, for naming a
 *  node's children or siblings. An empty input returns an empty map with no
 *  network. */
export async function resolveTaxonNames(
  taxIds: Array<string | number>,
  opts?: { signal?: AbortSignal },
): Promise<Map<string, TaxonSuggestion>> {
  const ids = taxIds.map((v) => String(v).trim()).filter((v) => v !== "");
  if (ids.length === 0) return new Map();
  const url =
    `${NCBI_DATASETS_BASE}/taxonomy/taxon/` +
    ids.map((id) => encodeURIComponent(id)).join(",");
  return parseExplorerNodeMap(await getJson(url, opts?.signal));
}

/** Autocomplete organism search over taxon_suggest. An empty / whitespace query
 *  returns an empty list with no network. */
export async function suggestTaxa(
  query: string,
  opts?: { signal?: AbortSignal },
): Promise<TaxonSuggestion[]> {
  const q = (query || "").trim();
  if (!q) return [];
  const url = `${NCBI_DATASETS_BASE}/taxonomy/taxon_suggest/${encodeURIComponent(q)}`;
  return parseTaxonSuggestions(await getJson(url, opts?.signal));
}

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

// --- GenBank source-feature round-trip (pure text) --------------------------
//
// The enrich apply writes the organism into the GenBank `source` feature's
// /organism and /db_xref="taxon:<id>" qualifiers so it survives export. We do
// this as a PURE TEXT transform on the flat file (the export source of truth),
// not on the feature model, so it touches only the source block and leaves every
// other feature byte-for-byte. GenBank qualifiers are indented to column 21.

const GB_QUALIFIER_INDENT = " ".repeat(21);

/** Pull the GenBank ACCESSION value (the first token of the ACCESSION line), or
 *  null when the record has none. Pure. Used by the enrich flow to resolve a
 *  sequence's own accession before falling back to provenance / a typed value. */
export function extractAccession(genbank: string): string | null {
  const m = /^ACCESSION\s+(\S+)/m.exec(genbank || "");
  const acc = m ? m[1] : null;
  // A record with no assigned accession uses a placeholder ("ACCESSION   ."), so
  // treat any token with no alphanumeric character as no accession at all.
  return acc && /[A-Za-z0-9]/.test(acc) ? acc : null;
}

/** Escape a value for a quoted GenBank qualifier (quotes are doubled). */
function gbQuoteValue(v: string): string {
  return v.replace(/"/g, '""');
}

/**
 * Write the organism into the GenBank `source` feature's /organism and (when a
 * tax id is given) /db_xref="taxon:<id>" qualifiers, so an enriched sequence
 * round-trips the classification on export. Pure text transform:
 *  - If a `source` feature exists, its existing /organism and taxon /db_xref
 *    qualifier lines are replaced (or added right under the source location).
 *  - If there is no `source` feature, one spanning 1..<length> is inserted at the
 *    top of the FEATURES table.
 *  - If there is no FEATURES table at all, the input is returned unchanged (a
 *    degenerate record we do not rewrite; the sidecar still carries the data).
 * Other features are left untouched.
 */
export function setSourceOrganismInGenbank(
  genbank: string,
  organism: string,
  taxId?: string,
): string {
  const text = genbank || "";
  const org = (organism || "").trim();
  if (!org) return text;

  const orgLine = `${GB_QUALIFIER_INDENT}/organism="${gbQuoteValue(org)}"`;
  const xrefLine = taxId
    ? `${GB_QUALIFIER_INDENT}/db_xref="taxon:${gbQuoteValue(String(taxId))}"`
    : null;

  const lines = text.split("\n");

  // Locate the FEATURES header line.
  const featuresIdx = lines.findIndex((l) => /^FEATURES\s/.test(l));
  if (featuresIdx === -1) return text;

  // Locate the `source` feature line (a feature key at column 6, key "source").
  let sourceIdx = -1;
  for (let i = featuresIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    // A new top-level section (ORIGIN, //, or a non-indented keyword) ends the
    // FEATURES table.
    if (/^[A-Z/]/.test(l)) break;
    if (/^ {5}source\b/.test(l)) {
      sourceIdx = i;
      break;
    }
  }

  if (sourceIdx === -1) {
    // No source feature. Insert one spanning the whole molecule, derived from
    // the LOCUS length (fallback 1..1 when the length is unreadable).
    const locus = /^LOCUS\s+\S+\s+(\d+)/m.exec(text);
    const length = locus ? locus[1] : "1";
    const block = [`     source          1..${length}`, orgLine];
    if (xrefLine) block.push(xrefLine);
    lines.splice(featuresIdx + 1, 0, ...block);
    return lines.join("\n");
  }

  // The source feature exists. Find the span of its qualifier lines (the
  // indented lines following the source location, up to the next feature key or
  // the end of the table), strip any existing /organism and taxon /db_xref, and
  // insert the fresh qualifiers right after the source location line.
  let end = sourceIdx + 1;
  const kept: string[] = [];
  for (; end < lines.length; end++) {
    const l = lines[end];
    // The next feature key sits at column 6 with a non-space; the table ends at
    // a top-level keyword. Either stops the source block.
    if (/^ {5}\S/.test(l) || /^[A-Z/]/.test(l)) break;
    const trimmed = l.trim();
    if (/^\/organism=/.test(trimmed)) continue;
    if (/^\/db_xref="taxon:/.test(trimmed)) continue;
    kept.push(l);
  }

  const fresh = [orgLine];
  if (xrefLine) fresh.push(xrefLine);
  const rebuilt = [
    ...lines.slice(0, sourceIdx + 1),
    ...fresh,
    ...kept,
    ...lines.slice(end),
  ];
  return rebuilt.join("\n");
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
