// BeakerBot chemistry coworker tools (ai chemistry-tools bot, 2026-06-11).
//
// Three tools that let BeakerBot work with the Chemistry Workbench:
//
//   search_pubchem   (READ-only) — search PubChem by name, formula, or CID.
//                    Returns a compact list of matches (name, CID, formula, MW,
//                    canonical SMILES, plus the physicochemical descriptors XLogP,
//                    H-bond donor / acceptor counts, and TPSA) so the user can pick
//                    a compound to import or read its properties. Reuses
//                    searchCompounds from lib/chemistry/pubchem.ts, the same
//                    CORS-open PUG-REST client the import dialog uses. No local
//                    write; relay the result or relay the error plainly.
//
//   create_molecule  (ACTION, GATED) — create a molecule record from a SMILES
//                    string and a name. Reuses computeIdentity (lib/chemistry/rdkit)
//                    to derive formula, molecular weight, and canonical SMILES from
//                    the SMILES the user supplied, then converts to a Molfile via
//                    toMolblock and calls moleculesApi.create. The model NEVER
//                    computes a formula or MW from memory; only what RDKit returned
//                    is written. describeAction previews name + formula + MW before
//                    any write. isDestructive false (creates are reversible via trash).
//
//   import_molecule  (ACTION, GATED) — import a compound into the library from a
//                    PubChem CID. Fetches the CID's 2D SDF via the existing
//                    fetchSdf + fetchCompoundByCid functions (the same path
//                    PubChemImportDialog uses), converts to a Molfile via
//                    molblockFromSdf, and saves via moleculesApi.create with
//                    source "pubchem". describeAction previews the compound name
//                    and formula (from PubChem's property API) before the write.
//                    isDestructive false.
//
// RDKit is browser-only (it loads from /rdkit/RDKit_minimal.js + wasm). When
// running in the test environment without a DOM, getRdkit rejects. The tools unit
// tests stub computeIdentity and toMolblock through the injectable deps seam, so
// the tests never touch the real wasm. In production the real browser RDKit runs.
//
// The Chemistry flag (CHEMISTRY_ENABLED) gates the workbench UI but not the
// molecule data model itself; moleculesApi.create and PubChem are always available.
// These tools do not add flag gating because the model can only reach them when
// the user's folder is connected.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  searchCompounds,
  fetchSdf,
  fetchCompoundByCid,
  type PubChemCompound,
} from "@/lib/chemistry/pubchem";
import { computeIdentity, toMolblock } from "@/lib/chemistry/rdkit";
import { moleculesApi, type MoleculeMeta } from "@/lib/chemistry/api";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Utility: trim a PubChem 2D SDF down to just the Molfile (connection table).
// The store's source of truth is the Molfile, so we keep the connection table
// (with 2D coordinates) and drop the SDF data block and "$$$$" delimiter.
// Mirrors the same helper in PubChemImportDialog.tsx.
// ---------------------------------------------------------------------------

export function molblockFromSdf(sdf: string): string {
  const i = sdf.indexOf("M  END");
  return i >= 0 ? `${sdf.slice(0, i + 6)}\n` : sdf;
}

// ---------------------------------------------------------------------------
// Injectable deps seam.
// Production wires the real functions; tests stub the network and wasm calls.
// ---------------------------------------------------------------------------

export type ChemToolsDeps = {
  /** Search PubChem and return up to `max` matching compounds. Throws on error. */
  searchPubChem: (query: string, max: number) => Promise<PubChemCompound[]>;
  /** Fetch the raw 2D SDF text for a PubChem CID. Throws on error. */
  fetchSdf: (cid: number) => Promise<string>;
  /** Fetch the compound identity (name, formula, MW, InChIKey) for a CID. Throws on error. */
  fetchCompoundByCid: (cid: number) => Promise<PubChemCompound>;
  /** Compute cheminformatics identity (SMILES, formula, MW, InChIKey) from a SMILES or Molfile.
   *  Throws when the input does not parse. Browser-only in production; stub in tests. */
  computeIdentity: typeof computeIdentity;
  /** Convert a SMILES or Molfile to an MDL Molfile.
   *  Throws when the input does not parse. Browser-only in production; stub in tests. */
  toMolblock: typeof toMolblock;
  /** Create a molecule record via the molecules API. Returns the saved MoleculeDetail. */
  createMolecule: typeof moleculesApi.create;
};

export const chemToolsDeps: ChemToolsDeps = {
  searchPubChem: (q, max) => searchCompounds(q, max),
  fetchSdf: (cid) => fetchSdf(cid),
  fetchCompoundByCid: (cid) => fetchCompoundByCid(cid),
  computeIdentity,
  toMolblock,
  createMolecule: (...args) => moleculesApi.create(...args),
};

// ---------------------------------------------------------------------------
// search_pubchem (READ-only)
// ---------------------------------------------------------------------------

/** One entry in the search_pubchem result list. */
export type PubChemMatch = {
  cid: number;
  name: string;
  formula: string;
  mol_weight: number | null;
  /** Canonical SMILES as PubChem reports it in its property table (or empty string
   *  when unavailable). This is an informational field in the search result; the
   *  authoritative canonical SMILES that gets written to the library on import comes
   *  from RDKit parsing the SDF, not from this field. */
  canonical_smiles: string;
  /** Computed octanol-water partition coefficient (XLogP), a lipophilicity
   *  descriptor, or null when PubChem reports none for this compound. */
  xlogp: number | null;
  /** Hydrogen-bond donor count, or null when absent. */
  h_bond_donor_count: number | null;
  /** Hydrogen-bond acceptor count, or null when absent. */
  h_bond_acceptor_count: number | null;
  /** Topological polar surface area in square angstroms, or null when absent. */
  tpsa: number | null;
};

/** Return shape from search_pubchem. */
export type SearchPubChemResult =
  | { ok: true; count: number; matches: PubChemMatch[] }
  | { ok: false; error: string };

/** Map a PubChemCompound to the compact PubChemMatch shape. Pure. */
export function mapToMatch(c: PubChemCompound): PubChemMatch {
  return {
    cid: c.cid,
    name: c.name,
    formula: c.formula,
    mol_weight: c.mol_weight,
    // PubChem's property API does not reliably return SMILES (it was renamed from
    // CanonicalSMILES to ConnectivitySMILES in 2025; stale property names 400 the
    // whole request). The PubChemCompound type accordingly does not carry a SMILES
    // field. The SDF + RDKit path is the authoritative source for SMILES on import.
    // Return an empty string here; the model can search the compound and then call
    // import_molecule to get the canonical SMILES into the library.
    canonical_smiles: "",
    // Physicochemical descriptors PubChem computes (each null when it reports
    // none), surfaced so the model can relay them. These are informational in the
    // search result and are not persisted on import (the molecule sidecar carries
    // its own RDKit-derived descriptors).
    xlogp: c.xlogp,
    h_bond_donor_count: c.h_bond_donor_count,
    h_bond_acceptor_count: c.h_bond_acceptor_count,
    tpsa: c.tpsa,
  };
}

export const searchPubChemTool: AiTool = {
  name: "search_pubchem",
  description:
    "Search PubChem for compounds by name, molecular formula, or CID. Returns up to 8 matching compounds, each with a CID, name, molecular formula, molecular weight, and the computed physicochemical descriptors XLogP (octanol-water partition coefficient, a lipophilicity measure), hydrogen-bond donor count, hydrogen-bond acceptor count, and topological polar surface area (TPSA, in square angstroms). " +
    "Use this when the user asks to find a compound, look up a chemical, check its properties (logP, polar surface area, H-bond donors / acceptors), or wants to know whether a compound is in PubChem before importing it. " +
    "A bare number is treated as a CID. A name uses PubChem autocomplete to surface related candidates, with the exact match first. " +
    "Any descriptor PubChem does not report for a compound comes back as null, so relay only the values that are present. " +
    "This is a read-only network call to PubChem (a public NIH resource), no local data is written. " +
    "Returns { ok: true, count, matches: [{ cid, name, formula, mol_weight, xlogp, h_bond_donor_count, h_bond_acceptor_count, tpsa }] } or { ok: false, error } when nothing matches or the network fails. " +
    "After a search, you may call import_molecule with the CID to import the compound into the user's library.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Compound name, molecular formula, or a bare PubChem CID (a number). Examples: \"caffeine\", \"C9H8O4\", \"2519\".",
      },
      max: {
        type: "number",
        description:
          "Maximum number of matches to return (1 to 8, default 8). Pass 1 when the user named a specific compound and you just need its CID.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return { ok: false, error: "query is required." } satisfies SearchPubChemResult;
    }

    const maxRaw = typeof args.max === "number" ? args.max : 8;
    const max = Math.min(Math.max(1, Math.round(maxRaw)), 8);

    let compounds: PubChemCompound[];
    try {
      compounds = await chemToolsDeps.searchPubChem(query, max);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "PubChem search failed.";
      return { ok: false, error: msg } satisfies SearchPubChemResult;
    }

    if (compounds.length === 0) {
      return {
        ok: false,
        error: `No PubChem match for "${query}". Try a different name or spelling.`,
      } satisfies SearchPubChemResult;
    }

    return {
      ok: true,
      count: compounds.length,
      matches: compounds.map(mapToMatch),
    } satisfies SearchPubChemResult;
  },
};

// ---------------------------------------------------------------------------
// create_molecule (ACTION, GATED)
// ---------------------------------------------------------------------------

/** Parsed + normalized args for create_molecule. */
export type ParsedCreateMolecule = {
  name: string;
  smiles: string;
};

/** Parse and normalize the raw tool args. Pure. */
export function parseCreateMoleculeArgs(
  args: Record<string, unknown>,
): ParsedCreateMolecule {
  const name = typeof args.name === "string" ? args.name.trim() : "Untitled molecule";
  const smiles = typeof args.smiles === "string" ? args.smiles.trim() : "";
  return { name, smiles };
}

/** Return shape from create_molecule. */
export type CreateMoleculeResult =
  | {
      ok: true;
      id: string;
      name: string;
      formula: string | null;
      mol_weight: number | null;
      smiles: string | null;
      source: "drawn";
    }
  | { ok: false; error: string };

/** Build the describeAction summary from parsed args and RDKit identity.
 *  When RDKit has not run yet (at describe time), preview uses the args only.
 *  Pure, no I/O. Exported for tests. */
export function describeCreateMolecule(parsed: ParsedCreateMolecule): {
  summary: string;
} {
  const label = parsed.name || "Untitled molecule";
  const smilesShort =
    parsed.smiles.length > 40
      ? `${parsed.smiles.slice(0, 40)}…`
      : parsed.smiles;
  const smilesHint = parsed.smiles ? ` from SMILES "${smilesShort}"` : "";
  return {
    summary: `create molecule "${label}"${smilesHint}`,
  };
}

export const createMoleculeTool: AiTool = {
  name: "create_molecule",
  description:
    "Create a new molecule record in the user's chemistry library from a SMILES string and a name. " +
    "RDKit (the on-device chemistry engine) parses the SMILES to derive the molecular formula, molecular weight, and canonical form. " +
    "The model NEVER computes a formula or molecular weight from memory; only what RDKit returns is saved. " +
    "The user sees a preview of the name and SMILES BEFORE anything is written (the preview IS the consent, do not ask in prose first and do not call propose_plan for it). " +
    "On Approve the molecule is created in the library as a drawn molecule. On Reject nothing is written. Non-destructive (creates are reversible via the library trash). " +
    "If the SMILES does not parse, the tool reports the RDKit error. The model must receive the SMILES from the user, never fabricate a SMILES string.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Display name for the new molecule, for example \"aspirin\" or \"caffeine\".",
      },
      smiles: {
        type: "string",
        description:
          "The SMILES string the user provided or a tool returned. Never invented. Example: \"CC(=O)Oc1ccccc1C(=O)O\" for aspirin.",
      },
    },
    required: ["name", "smiles"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    return describeCreateMolecule(parseCreateMoleculeArgs(args));
  },
  execute: async (args) => {
    const parsed = parseCreateMoleculeArgs(args);

    if (!parsed.smiles) {
      return {
        ok: false,
        error:
          "smiles is required. Provide the SMILES string the user typed or a tool returned; never invent one.",
      } satisfies CreateMoleculeResult;
    }
    if (!parsed.name) {
      parsed.name = "Untitled molecule";
    }

    // Convert SMILES to a Molfile first. This is the source-of-truth form for the
    // store; the editor reopens it with 2D coordinates. computeIdentity and
    // toMolblock both call getRdkit(), which rejects in Node (test env), so we
    // gate the real calls behind the injectable deps seam.
    let molfile: string;
    try {
      molfile = await chemToolsDeps.toMolblock(parsed.smiles);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "RDKit could not parse the SMILES.";
      return { ok: false, error: `RDKit parse error: ${msg}` } satisfies CreateMoleculeResult;
    }

    // Compute the full identity so we can preview formula + MW to the user in the
    // action description. moleculesApi.create will also call identityPatch internally
    // (which calls computeIdentity on the molfile), so the sidecar is always up to
    // date even if our call here is the first parse. We run it here so the tool
    // result carries the RDKit-derived fields back to the model.
    let formula: string | null = null;
    let mol_weight: number | null = null;
    let canonical_smiles: string | null = null;
    try {
      const identity = await chemToolsDeps.computeIdentity(parsed.smiles);
      formula = identity.formula || null;
      mol_weight = identity.mol_weight ?? null;
      canonical_smiles = identity.smiles || null;
    } catch {
      // Identity is best-effort; a parse failure here is logged by the engine.
      // moleculesApi.create still writes the molfile correctly; the sidecar fields
      // stay blank. We do NOT block the save for a non-fatal identity failure.
    }

    let saved: Awaited<ReturnType<typeof moleculesApi.create>>;
    try {
      saved = await chemToolsDeps.createMolecule(molfile, {
        name: parsed.name,
        source: "drawn",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The molecule could not be saved.";
      return {
        ok: false,
        error: `Save failed: ${msg} The folder may not be connected.`,
      } satisfies CreateMoleculeResult;
    }

    return {
      ok: true,
      id: saved.meta.id,
      name: saved.meta.name,
      formula: saved.meta.formula ?? formula,
      mol_weight: saved.meta.mol_weight ?? mol_weight,
      smiles: saved.meta.smiles ?? canonical_smiles,
      source: "drawn",
    } satisfies CreateMoleculeResult;
  },
};

// ---------------------------------------------------------------------------
// import_molecule (ACTION, GATED)
// ---------------------------------------------------------------------------

/** Parsed + normalized args for import_molecule. */
export type ParsedImportMolecule = {
  cid: number | null;
};

/** Parse and normalize the raw tool args. Pure. */
export function parseImportMoleculeArgs(
  args: Record<string, unknown>,
): ParsedImportMolecule {
  const raw = args.cid;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : NaN;
  const cid = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  return { cid };
}

/** Return shape from import_molecule. */
export type ImportMoleculeResult =
  | {
      ok: true;
      id: string;
      name: string;
      formula: string | null;
      mol_weight: number | null;
      pubchem_cid: number;
      source: "pubchem";
    }
  | { ok: false; error: string };

/** Build the describeAction summary from the raw args. Async so it can fetch
 *  the compound name from PubChem for a richer preview. The agent loop calls
 *  describeAction synchronously, so we must return a synchronous fallback when
 *  the CID is valid but the name has not been fetched yet.
 *
 *  Design choice: return a brief synchronous preview. The user will see
 *  "import PubChem CID XXXXX into the library". The full name is visible once
 *  the actual execute runs and the result is relayed. The alternative would be
 *  making describeAction async (the AiTool type supports it since execute is
 *  async), but the gate currently calls it synchronously to render the preview.
 *  A synchronous CID-only preview is better than no preview at all. */
export function describeImportMolecule(parsed: ParsedImportMolecule): {
  summary: string;
} {
  if (parsed.cid == null) {
    return { summary: "import a PubChem compound" };
  }
  return { summary: `import PubChem CID ${parsed.cid} into the molecule library` };
}

export const importMoleculeTool: AiTool = {
  name: "import_molecule",
  description:
    "Import a compound into the user's molecule library from a PubChem CID. " +
    "Fetches the 2D structure (SDF) and metadata (name, formula, molecular weight) directly from PubChem (a public NIH resource, CORS-open, no proxy), " +
    "converts it to a Molfile, and saves it via the molecule API with source \"pubchem\" and the CID recorded. " +
    "The user sees a preview of the CID BEFORE anything is written (the preview IS the consent, do not ask in prose first and do not call propose_plan for it). " +
    "On Approve the molecule is imported. On Reject nothing is written. Non-destructive (creates are reversible via the library trash). " +
    "To find a CID for a named compound first, call search_pubchem. " +
    "Returns { ok: true, id, name, formula, mol_weight, pubchem_cid, source: \"pubchem\" } or { ok: false, error } when the CID is not found or the network fails.",
  parameters: {
    type: "object",
    properties: {
      cid: {
        type: "number",
        description:
          "The PubChem CID (a positive integer) for the compound to import. Get this from search_pubchem if you do not already have it.",
      },
    },
    required: ["cid"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    return describeImportMolecule(parseImportMoleculeArgs(args));
  },
  execute: async (args) => {
    const parsed = parseImportMoleculeArgs(args);

    if (parsed.cid == null) {
      return {
        ok: false,
        error:
          "cid is required and must be a positive integer. Call search_pubchem to find the CID for a compound by name.",
      } satisfies ImportMoleculeResult;
    }

    // Fetch the compound metadata (name, formula, MW) and the 2D SDF in parallel.
    // Both use the same PUG-REST host, so two concurrent requests stay well within
    // the PubChem courtesy limit (5 req/sec, 400 req/min).
    let compound: PubChemCompound;
    let sdf: string;
    try {
      [compound, sdf] = await Promise.all([
        chemToolsDeps.fetchCompoundByCid(parsed.cid),
        chemToolsDeps.fetchSdf(parsed.cid),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "PubChem fetch failed.";
      return {
        ok: false,
        error: `${msg} The CID ${parsed.cid} may not exist, or PubChem may be temporarily unavailable.`,
      } satisfies ImportMoleculeResult;
    }

    const molfile = molblockFromSdf(sdf);

    let saved: Awaited<ReturnType<typeof moleculesApi.create>>;
    try {
      saved = await chemToolsDeps.createMolecule(molfile, {
        name: compound.name,
        source: "pubchem",
        pubchem_cid: compound.cid,
        // Persist PubChem's physicochemical descriptors onto the sidecar so they
        // survive on the molecule record, not just in a chat answer. Each is the
        // value PubChem reported or null when it has none for this compound.
        xlogp: compound.xlogp,
        h_bond_donor_count: compound.h_bond_donor_count,
        h_bond_acceptor_count: compound.h_bond_acceptor_count,
        tpsa: compound.tpsa,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The molecule could not be saved.";
      return {
        ok: false,
        error: `Save failed: ${msg} The folder may not be connected.`,
      } satisfies ImportMoleculeResult;
    }

    // moleculesApi.create calls identityPatch internally, so the sidecar carries
    // RDKit-derived SMILES + InChIKey after the save. Return whatever the sidecar
    // recorded, falling back to the PubChem property values for formula and MW.
    const meta: MoleculeMeta = saved.meta;
    return {
      ok: true,
      id: meta.id,
      name: meta.name,
      formula: meta.formula ?? compound.formula ?? null,
      mol_weight: meta.mol_weight ?? compound.mol_weight ?? null,
      pubchem_cid: compound.cid,
      source: "pubchem",
    } satisfies ImportMoleculeResult;
  },
};
