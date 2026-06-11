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
    fetch(`${PUG}/cid/${cid}/xrefs/PubMedID/JSON`).then((r) =>
      r.ok ? (r.json() as Promise<XrefResponse>) : null,
    ),
    fetch(`${PUG}/cid/${cid}/xrefs/PatentID/JSON`).then((r) =>
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
}

/** Map a raw Europe PMC result to our Paper shape. Pure, unit tested. */
export function mapEpmcResult(r: EpmcResult): Paper {
  const source = r.source ?? "MED";
  const id = r.id ?? "";
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
  };
}

export interface EpmcPapers {
  hitCount: number;
  papers: Paper[];
}

/** Find papers that mention a compound, most-cited first. */
export async function europePmcPapers(
  query: string,
  pageSize = 15,
): Promise<EpmcPapers> {
  const res = await fetch(
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
