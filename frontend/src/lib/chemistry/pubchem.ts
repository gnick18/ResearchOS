// PubChem PUG-REST client (chemistry-workbench Phase 1, editor-independent).
//
// Browser-direct, no proxy. PUG-REST is CORS-open (access-control-allow-origin: *,
// verified live 2026-06-10), so this mirrors the NCBI sequence-import pattern: the
// only thing sent out is a public identifier the user typed (a name or CID) to a
// public NIH database, and we receive back a public structure. No key, no account.
//
// The import flow resolves a name to a CID, fetches the stable identity properties
// and the 2D structure (SDF), and hands the SDF to RDKit (lib/chemistry/rdkit) to
// derive the canonical SMILES + InChIKey + draw the thumbnail. We deliberately do
// NOT request SMILES from the property endpoint: PubChem renamed CanonicalSMILES to
// ConnectivitySMILES in 2025 and a stale property name 400s the whole request, so
// the SDF + RDKit path is the robust source of truth for SMILES.
//
// Honors PubChem's courtesy limits (~5 req/sec, 400 req/min) at the call site.

import { cachedFetch } from "./fetch-cache";

const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";

/** Identity a PubChem compound carries into the library on import. */
export interface PubChemCompound {
  cid: number;
  /** Best display name (Title, falling back to IUPACName). */
  name: string;
  formula: string;
  mol_weight: number | null;
  inchikey: string;
  /** PubChem 2D depiction PNG, for an instant preview before RDKit renders. */
  pngUrl: string;
  /** Computed octanol-water partition coefficient (XLogP), or null when PubChem
   *  does not report one for this compound. A lipophilicity descriptor. */
  xlogp: number | null;
  /** Hydrogen-bond donor count, or null when absent. */
  h_bond_donor_count: number | null;
  /** Hydrogen-bond acceptor count, or null when absent. */
  h_bond_acceptor_count: number | null;
  /** Topological polar surface area in square angstroms, or null when absent. */
  tpsa: number | null;
}

/**
 * Shape of a single PUG-REST property record (the fields we request). The
 * descriptor counts (XLogP, the H-bond counts, TPSA) arrive as JSON numbers, but
 * PubChem has historically sent some numeric properties as strings, so the parser
 * coerces and tolerates either. Field names are PubChem's EXACT, case-sensitive
 * PUG-REST property names and must not be renamed (a stale name 400s the request).
 */
export interface PugPropertyRecord {
  CID: number;
  Title?: string;
  IUPACName?: string;
  MolecularFormula?: string;
  MolecularWeight?: string | number;
  InChIKey?: string;
  XLogP?: string | number;
  HBondDonorCount?: string | number;
  HBondAcceptorCount?: string | number;
  TPSA?: string | number;
}

/** The exact PUG-REST property list every property lookup requests. Centralized
 *  so the search and the single-compound path always ask for the same fields and
 *  the descriptor names never drift between the two. These are PubChem's EXACT,
 *  case-sensitive property names. */
export const PUG_PROPERTY_LIST =
  "Title,MolecularFormula,MolecularWeight,InChIKey,IUPACName,XLogP,HBondDonorCount,HBondAcceptorCount,TPSA";

/** Coerce a raw PUG-REST numeric property (number or string) to a finite number,
 *  or null when it is missing, blank, or unparseable. Never returns NaN. */
function numProp(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  const v = typeof raw === "string" ? raw.trim() : raw;
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 2D SDF record URL for a CID (the structure we persist + feed to RDKit). */
export function sdfUrl(cid: number): string {
  return `${PUG}/cid/${cid}/record/SDF?record_type=2d`;
}

/** 2D depiction PNG URL for a CID. */
export function pngUrl(cid: number): string {
  return `${PUG}/cid/${cid}/PNG`;
}

/**
 * Map a raw PUG-REST property record to our compound shape. Pure, so it is unit
 * tested without the network. MolecularWeight arrives as a string in JSON, so we
 * coerce it; a missing or unparseable weight becomes null rather than NaN.
 */
export function mapPropertyRecord(r: PugPropertyRecord): PubChemCompound {
  // PubChem sends MolecularWeight as a string; an empty string coerces to 0, so
  // treat blank/whitespace as missing rather than a real 0 g/mol.
  const mwRaw =
    typeof r.MolecularWeight === "string"
      ? r.MolecularWeight.trim()
      : r.MolecularWeight;
  const mw = mwRaw == null || mwRaw === "" ? null : Number(mwRaw);
  return {
    cid: r.CID,
    name: r.Title || r.IUPACName || `CID ${r.CID}`,
    formula: r.MolecularFormula ?? "",
    mol_weight: mw != null && Number.isFinite(mw) ? mw : null,
    inchikey: r.InChIKey ?? "",
    pngUrl: pngUrl(r.CID),
    // Physicochemical descriptors. A compound PubChem has no value for (a salt,
    // an inorganic, an incomplete record) yields null per field, never a throw.
    xlogp: numProp(r.XLogP),
    h_bond_donor_count: numProp(r.HBondDonorCount),
    h_bond_acceptor_count: numProp(r.HBondAcceptorCount),
    tpsa: numProp(r.TPSA),
  };
}

/** Resolve a compound name to its primary CID, or null if there is no match. */
export async function resolveNameToCid(name: string): Promise<number | null> {
  const res = await cachedFetch(
    `${PUG}/name/${encodeURIComponent(name)}/cids/JSON`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { IdentifierList?: { CID?: number[] } };
  return data.IdentifierList?.CID?.[0] ?? null;
}

/** Resolve a name to up to `max` candidate CIDs (the search grid shows several). */
export async function resolveNameToCids(
  name: string,
  max = 8,
): Promise<number[]> {
  const res = await cachedFetch(`${PUG}/name/${encodeURIComponent(name)}/cids/JSON`);
  if (!res.ok) return [];
  const data = (await res.json()) as { IdentifierList?: { CID?: number[] } };
  return (data.IdentifierList?.CID ?? []).slice(0, max);
}

/** Fetch identity properties for several CIDs in one call (preserves PubChem order). */
export async function fetchCompoundsByCids(
  cids: number[],
): Promise<PubChemCompound[]> {
  if (cids.length === 0) return [];
  const res = await cachedFetch(
    `${PUG}/cid/${cids.join(",")}/property/${PUG_PROPERTY_LIST}/JSON`,
  );
  if (!res.ok) throw new Error(`PubChem property lookup failed (HTTP ${res.status})`);
  const data = (await res.json()) as {
    PropertyTable?: { Properties?: PugPropertyRecord[] };
  };
  return (data.PropertyTable?.Properties ?? []).map(mapPropertyRecord);
}

const AUTOCOMPLETE =
  "https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound";

/**
 * PubChem name autocomplete: related compound names for a query (exact match
 * first), e.g. caffeine -> [caffeine, Caffeine citrate, Caffeine benzoate, ...].
 * CORS-open, same host as PUG-REST. Returns [] on any failure.
 */
export async function autocompleteNames(
  query: string,
  max = 8,
): Promise<string[]> {
  const res = await cachedFetch(
    `${AUTOCOMPLETE}/${encodeURIComponent(query)}/json?limit=${max}`,
  ).catch(() => null);
  if (!res || !res.ok) return [];
  const data = (await res.json().catch(() => null)) as {
    dictionary_terms?: { compound?: string[] };
  } | null;
  return (data?.dictionary_terms?.compound ?? []).slice(0, max);
}

/**
 * Search PubChem and return up to `max` candidate compounds for the import grid.
 * A bare CID returns just that one; a name uses autocomplete to surface related
 * candidates (the exact match first), resolves each to a CID, dedups, and fetches
 * their properties in one call. Throws if nothing matches.
 */
export async function searchCompounds(
  query: string,
  max = 8,
): Promise<PubChemCompound[]> {
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) {
    const one = await fetchCompoundsByCids([Number(trimmed)]);
    if (one.length === 0) throw new Error(`No PubChem match for "${trimmed}"`);
    return one;
  }
  const names = await autocompleteNames(trimmed, max);
  const seeds = names.length > 0 ? names : [trimmed];
  const resolved = await Promise.all(
    seeds.map((n) => resolveNameToCid(n).catch(() => null)),
  );
  const cids: number[] = [];
  for (const c of resolved) {
    if (c != null && !cids.includes(c)) cids.push(c);
  }
  if (cids.length === 0) throw new Error(`No PubChem match for "${trimmed}"`);
  const wanted = cids.slice(0, max);
  const compounds = await fetchCompoundsByCids(wanted);
  if (compounds.length === 0) throw new Error(`No PubChem match for "${trimmed}"`);
  // Restore the autocomplete order (exact match first); the batch property
  // endpoint does not guarantee it.
  const byCid = new Map(compounds.map((c) => [c.cid, c]));
  const ordered = wanted
    .map((c) => byCid.get(c))
    .filter((c): c is PubChemCompound => c != null);
  return ordered.length > 0 ? ordered : compounds;
}

/** Fetch the stable identity properties for a CID. */
export async function fetchCompoundByCid(
  cid: number,
): Promise<PubChemCompound> {
  const res = await cachedFetch(
    `${PUG}/cid/${cid}/property/${PUG_PROPERTY_LIST}/JSON`,
  );
  if (!res.ok) throw new Error(`PubChem property lookup failed (HTTP ${res.status})`);
  const data = (await res.json()) as {
    PropertyTable: { Properties: PugPropertyRecord[] };
  };
  const rec = data.PropertyTable.Properties[0];
  if (!rec) throw new Error("PubChem returned no compound");
  return mapPropertyRecord(rec);
}

/**
 * Search PubChem by a free-text query (a name, or a bare CID). Returns the
 * resolved compound identity, or throws if nothing matches.
 */
export async function searchCompound(query: string): Promise<PubChemCompound> {
  const trimmed = query.trim();
  const cid = /^\d+$/.test(trimmed)
    ? Number(trimmed)
    : await resolveNameToCid(trimmed);
  if (cid == null) throw new Error(`No PubChem match for "${trimmed}"`);
  return fetchCompoundByCid(cid);
}

/** Fetch the raw 2D SDF for a CID (the structure to persist + render). */
export async function fetchSdf(cid: number): Promise<string> {
  const res = await cachedFetch(sdfUrl(cid));
  if (!res.ok) throw new Error(`PubChem SDF fetch failed (HTTP ${res.status})`);
  return res.text();
}
