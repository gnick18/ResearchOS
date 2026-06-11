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
}

/** Shape of a single PUG-REST property record (the fields we request). */
export interface PugPropertyRecord {
  CID: number;
  Title?: string;
  IUPACName?: string;
  MolecularFormula?: string;
  MolecularWeight?: string | number;
  InChIKey?: string;
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
  };
}

/** Resolve a compound name to its primary CID, or null if there is no match. */
export async function resolveNameToCid(name: string): Promise<number | null> {
  const res = await fetch(
    `${PUG}/name/${encodeURIComponent(name)}/cids/JSON`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { IdentifierList?: { CID?: number[] } };
  return data.IdentifierList?.CID?.[0] ?? null;
}

/** Fetch the stable identity properties for a CID. */
export async function fetchCompoundByCid(
  cid: number,
): Promise<PubChemCompound> {
  const res = await fetch(
    `${PUG}/cid/${cid}/property/Title,MolecularFormula,MolecularWeight,InChIKey,IUPACName/JSON`,
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
  const res = await fetch(sdfUrl(cid));
  if (!res.ok) throw new Error(`PubChem SDF fetch failed (HTTP ${res.status})`);
  return res.text();
}
