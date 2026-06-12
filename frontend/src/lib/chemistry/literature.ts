// Literature + patent discovery (chemistry-workbench Phase 1, editor-independent).
//
// The free answer to the SciFinder feature chemists pay for: pick a compound or
// draw a fragment, see the papers and patents that mention it. Assembled entirely
// browser-direct (no backend) from three CORS-open, no-key sources, each verified
// live 2026-06-10:
//   - PubChem xrefs: a compound's linked PubMed papers + patents (curated).
//   - Europe PMC: full-text chemical mentions across open-access literature.
//   - SureChEMBL: compounds extracted from 28M patents, substructure-searchable.
//
// Honest limit (state it in the UI): PubChem links are curated depositor +
// co-occurrence data, Europe PMC mines open-access + CC full text plus abstracts
// (not every paywalled paper), SureChEMBL indexes specific extracted compounds,
// not the generic Markush claims CAS deconstructs. This is the free 90 percent,
// not a replacement for CAS curation.
//
// A common compound returns tens of thousands of results (aspirin: 26k papers,
// 111k patents), so callers must rank + paginate and surface the total, never dump.

import { cachedFetch } from "./fetch-cache";

const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";
const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const SURECHEMBL = "https://www.surechembl.org/api";

// ---- PubChem compound -> linked papers + patents ----

export interface PubChemLinks {
  /** Count of linked PubMed papers, or null if none/unavailable. */
  papers: number | null;
  /** Linked patent identifiers (e.g. "US-4681893-A"), full list. */
  patents: string[];
}

/** Google Patents URL for a PubChem patent id (dashes stripped for the slug). */
export function patentGoogleUrl(id: string): string {
  return `https://patents.google.com/patent/${id.replace(/-/g, "")}/en`;
}

/** Europe PMC article page URL for a result. */
export function europePmcArticleUrl(source: string, id: string): string {
  return `https://europepmc.org/article/${source}/${id}`;
}

/** Fetch a compound's linked PubMed papers (count) and patents (list) from PubChem. */
export async function pubchemLinks(cid: number): Promise<PubChemLinks> {
  const [pm, pat] = await Promise.allSettled([
    cachedFetch(`${PUG}/cid/${cid}/xrefs/PubMedID/JSON`).then((r) =>
      r.ok ? (r.json() as Promise<XrefResponse>) : null,
    ),
    cachedFetch(`${PUG}/cid/${cid}/xrefs/PatentID/JSON`).then((r) =>
      r.ok ? (r.json() as Promise<XrefResponse>) : null,
    ),
  ]);
  const pmVal = pm.status === "fulfilled" ? pm.value : null;
  const patVal = pat.status === "fulfilled" ? pat.value : null;
  return {
    papers: pmVal?.InformationList?.Information?.[0]?.PubMedID?.length ?? null,
    patents: patVal?.InformationList?.Information?.[0]?.PatentID ?? [],
  };
}

interface XrefResponse {
  InformationList?: {
    Information?: Array<{ PubMedID?: number[]; PatentID?: string[] }>;
  };
}

// ---- Europe PMC full-text chemical mentions ----

export interface Paper {
  title: string;
  authors: string;
  journal: string;
  year: string;
  citedBy: number;
  source: string;
  id: string;
  doi: string;
  url: string;
  /** First entry of pubTypeList.pubType from Europe PMC core result (e.g. "Journal Article", "Review"). */
  pubType?: string;
  /**
   * True when any entry in pubTypeList.pubType matches /review/i.
   * Populated from the Europe PMC resultType=core field: pubTypeList.pubType (string[]).
   */
  isReview: boolean;
}

interface EpmcResult {
  id?: string;
  source?: string;
  title?: string;
  authorString?: string;
  journalTitle?: string;
  pubYear?: string;
  citedByCount?: number;
  doi?: string;
  /** Europe PMC core: pubTypeList.pubType is a string[] (e.g. ["Review", "Journal Article"]). */
  pubTypeList?: { pubType?: string[] };
}

/** Map a raw Europe PMC result to our Paper shape. Pure, unit tested. */
export function mapEpmcResult(r: EpmcResult): Paper {
  const source = r.source ?? "MED";
  const id = r.id ?? "";
  const pubTypes: string[] = r.pubTypeList?.pubType ?? [];
  const isReview = pubTypes.some((t) => /review/i.test(t));
  return {
    title: r.title ?? "",
    authors: r.authorString ?? "",
    journal: r.journalTitle ?? "",
    year: r.pubYear ?? "",
    citedBy: r.citedByCount ?? 0,
    source,
    id,
    doi: r.doi ?? "",
    url: europePmcArticleUrl(source, id),
    pubType: pubTypes[0],
    isReview,
  };
}

export interface EpmcPapers {
  hitCount: number;
  papers: Paper[];
}

/**
 * A lightweight patent item suitable for mixing into the explorer list.
 * Patents come from PubChem xrefs (pubchemLinks) and have no DOI or citation
 * count, only an id (e.g. "US-4681893-A") and a Google Patents url.
 */
export interface PatentItem {
  type: "patent";
  id: string;
  url: string;
}

/** Build a PatentItem from a raw PubChem patent id string. */
export function makePatentItem(patentId: string): PatentItem {
  return { type: "patent", id: patentId, url: patentGoogleUrl(patentId) };
}

/**
 * A mixed list item in the explorer -- either a Paper (research or review) or
 * a PatentItem. Discriminated by `type` (paper) vs `type` (patent). Papers do
 * not carry a `type` field on the existing shape, so we add a discriminant on
 * the union here without mutating Paper itself.
 */
export type ExplorerItem =
  | ({ type: "research" | "review" } & Paper)
  | PatentItem;

/** Lift a Paper to an ExplorerItem, deriving type from isReview. */
export function paperToExplorerItem(p: Paper): ExplorerItem {
  return { ...p, type: p.isReview ? "review" : "research" };
}

/** Find papers that mention a compound, most-cited first. */
export async function europePmcPapers(
  query: string,
  pageSize = 15,
): Promise<EpmcPapers> {
  const res = await cachedFetch(
    `${EPMC}?query=${encodeURIComponent(query)}&format=json&pageSize=${pageSize}&resultType=core&sort=CITED desc`,
  );
  if (!res.ok) return { hitCount: 0, papers: [] };
  const data = (await res.json()) as {
    hitCount?: number;
    resultList?: { result?: EpmcResult[] };
  };
  return {
    hitCount: data.hitCount ?? 0,
    papers: (data.resultList?.result ?? []).map(mapEpmcResult),
  };
}

// ---- SureChEMBL substructure -> patent compounds ----

export interface SureChemblHit {
  chemical_id: string;
  name: string;
  smiles: string;
  mol_formula: string;
  /** SureChEMBL compound page (its patents). */
  url: string;
}

export interface SureChemblResult {
  resultCount: number;
  hits: SureChemblHit[];
}

/** SureChEMBL compound page URL for a chemical id. */
export function surechemblUrl(chemicalId: string): string {
  return `https://www.surechembl.org/chemical/${chemicalId}`;
}

interface SureChemblStructure {
  chemical_id?: string;
  id?: string;
  name?: string;
  smiles?: string;
  mol_formula?: string;
}

/** Map a raw SureChEMBL result structure to our hit shape. Pure, unit tested. */
export function mapSureChemblStructure(s: SureChemblStructure): SureChemblHit {
  const chemicalId = s.chemical_id ?? s.id ?? "";
  return {
    chemical_id: chemicalId,
    name: s.name ?? "",
    smiles: s.smiles ?? "",
    mol_formula: s.mol_formula ?? "",
    url: surechemblUrl(chemicalId),
  };
}

/**
 * Find compounds in patents that contain a substructure (SMILES or SMARTS).
 * SureChEMBL is async: submit returns a search hash, poll status until the search
 * finishes, then fetch a page of results. `onStatus` reports progress for the UI.
 * The body root must be wrapped as `StructureSearchRequest` (Jackson root name);
 * an un-wrapped body 400s.
 */
export async function surechemblSubstructure(
  struct: string,
  opts: {
    maxResults?: number;
    pageSize?: number;
    pollMs?: number;
    maxPolls?: number;
    onStatus?: (message: string, count: number) => void;
  } = {},
): Promise<SureChemblResult> {
  const {
    maxResults = 50,
    pageSize = 12,
    pollMs = 1200,
    maxPolls = 18,
    onStatus,
  } = opts;

  const submit = (await fetch(`${SURECHEMBL}/search/structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      StructureSearchRequest: {
        struct,
        structSearchType: "substructure",
        maxResults,
        query: "",
      },
    }),
  }).then((r) => r.json())) as { data?: { hash?: string } };

  const hash = submit?.data?.hash;
  if (!hash) throw new Error("SureChEMBL returned no search id");

  let count = 0;
  let finished = false;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const st = (await fetch(`${SURECHEMBL}/search/${hash}/status`).then((r) =>
      r.json(),
    )) as { data?: { message?: string; resultCount?: number } };
    const message = st?.data?.message ?? "";
    count = st?.data?.resultCount ?? count;
    onStatus?.(message, count);
    if (/finish/i.test(message)) {
      finished = true;
      break;
    }
  }
  // If the search never reported "finished" within the poll budget, the results
  // page would be partial or empty; surface that as a timeout rather than
  // presenting incomplete data as the final answer.
  if (!finished) {
    throw new Error("SureChEMBL search did not finish in time");
  }

  const res = (await fetch(
    `${SURECHEMBL}/search/${hash}/results?page=1&start_on=0&max_results=${pageSize}`,
  ).then((r) => r.json())) as {
    data?: { results?: { structures?: SureChemblStructure[] } };
  };
  const structures = res?.data?.results?.structures ?? [];
  return { resultCount: count, hits: structures.map(mapSureChemblStructure) };
}

// ---- Literature explorer pure helpers (unit tested) ----

export interface ExplorerFilters {
  showResearch: boolean;
  showReviews: boolean;
  showPatents: boolean;
  starredOnly: boolean;
  minYear: number;
  maxYear: number;
  query: string;
  sort: "year" | "cited" | "title";
}

export interface YearBin {
  year: number;
  /** Inclusive end year of the bin (equals year when binSize=1). */
  yearEnd: number;
  total: number;
  /** How many of `total` are reviews. */
  reviewCount: number;
}

/**
 * Choose a histogram bin size so the active year span renders 8-15 bars max.
 * Pure, no side effects.
 */
export function explorerBinSize(span: number): number {
  for (const s of [1, 2, 5, 10, 25]) {
    if (Math.ceil(span / s) <= 15) return s;
  }
  return 25;
}

/**
 * Build the papers-per-year histogram bins from a list of explorer items.
 * Uses the active [minYear, maxYear] window so the plot zooms with the filter.
 * Pure, no side effects.
 */
export function buildYearBins(
  items: ExplorerItem[],
  minYear: number,
  maxYear: number,
): YearBin[] {
  const lo = Math.min(minYear, maxYear);
  const hi = Math.max(minYear, maxYear);
  const span = hi - lo + 1;
  const size = explorerBinSize(span);
  const start = Math.floor(lo / size) * size;
  const bins: YearBin[] = [];
  for (let y = start; y <= hi; y += size) {
    bins.push({ year: y, yearEnd: Math.min(hi, y + size - 1), total: 0, reviewCount: 0 });
  }
  for (const item of items) {
    const itemYear = item.type === "patent" ? null : parseInt(item.year, 10);
    if (itemYear == null || isNaN(itemYear) || itemYear < lo || itemYear > hi) continue;
    const idx = Math.floor((itemYear - start) / size);
    if (bins[idx]) {
      bins[idx].total++;
      if (item.type === "review") bins[idx].reviewCount++;
    }
  }
  return bins;
}

/**
 * Filter and sort the explorer corpus according to the current filter state.
 * `starredKeys` is the Set of DOIs/patent-ids the user has starred for this molecule.
 * Pure, no side effects.
 */
export function applyExplorerFilters(
  items: ExplorerItem[],
  filters: ExplorerFilters,
  starredKeys: Set<string>,
): ExplorerItem[] {
  const { showResearch, showReviews, showPatents, starredOnly, minYear, maxYear, query, sort } = filters;
  const lo = Math.min(minYear, maxYear);
  const hi = Math.max(minYear, maxYear);
  const q = query.trim().toLowerCase();

  let result = items.filter((item) => {
    if (item.type === "research" && !showResearch) return false;
    if (item.type === "review" && !showReviews) return false;
    if (item.type === "patent" && !showPatents) return false;
    if (starredOnly) {
      const key = item.type === "patent" ? item.id : item.doi;
      if (!starredKeys.has(key)) return false;
    }
    if (item.type !== "patent") {
      const yr = parseInt(item.year, 10);
      if (!isNaN(yr) && (yr < lo || yr > hi)) return false;
    }
    if (q) {
      if (item.type === "patent") {
        return item.id.toLowerCase().includes(q);
      }
      const haystack = `${item.title} ${item.authors} ${item.journal}`.toLowerCase();
      return haystack.includes(q);
    }
    return true;
  });

  if (sort === "year") {
    result = result.slice().sort((a, b) => {
      const ya = a.type === "patent" ? 0 : parseInt(a.year, 10) || 0;
      const yb = b.type === "patent" ? 0 : parseInt(b.year, 10) || 0;
      return yb - ya;
    });
  } else if (sort === "cited") {
    result = result.slice().sort((a, b) => {
      const ca = a.type === "patent" ? 0 : a.citedBy;
      const cb = b.type === "patent" ? 0 : b.citedBy;
      return cb - ca;
    });
  } else {
    // title A-Z
    result = result.slice().sort((a, b) => {
      const ta = a.type === "patent" ? a.id : a.title;
      const tb = b.type === "patent" ? b.id : b.title;
      return ta.localeCompare(tb);
    });
  }
  return result;
}
