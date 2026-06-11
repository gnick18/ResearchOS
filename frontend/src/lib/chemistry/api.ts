/**
 * Molecule library API — the SEAM between the chemistry-workbench arc (owner)
 * and any consumer surface (the project "Molecules" section, the `/chemistry`
 * hub library grid).
 *
 * Mirrors `lib/sequences/api.ts`. The SHAPE is locked: a molecule is a real
 * `molecules/{id}.mol` MDL Molfile (the canonical on-disk form, which keeps the
 * 2D drawing coordinates so the editor reopens it faithfully) plus a
 * `molecules/{id}.meta.json` sidecar carrying `project_ids: string[]` collection
 * links and the RDKit-computed identity (SMILES / InChIKey / formula / MW) used
 * for the library list and search.
 *
 * Phase 1 (2026-06-10) lands the real persistence behind `moleculeStore`
 * (users/<u>/molecules/<id>.mol + <id>.meta.json). This module is the orchestrator
 * over that pure-IO store: it computes the RDKit identity on save (RDKit is
 * browser-only, so it lives here, not in the SSR-safe store) and maps the on-disk
 * pair to the shapes the hub library grid and the project surface consume.
 *
 * See docs/proposals/CHEMISTRY_WORKBENCH_PROPOSAL.md (sections 4 and 9).
 */

import { moleculeStore } from "./molecule-store";
import { getCurrentUserCached } from "../storage/json-store";
import { computeIdentity } from "./rdkit";
import { trashEntity, restoreMoleculeFromTrash } from "../trash";

/** Provenance of a stored molecule, shown as a chip in the library. */
export type MoleculeSource = "drawn" | "imported" | "pubchem";

/**
 * Locked metadata sidecar shape (`molecules/{id}.meta.json`). Phase 1 owns the
 * on-disk read/write; this is the contract a consumer surface reads against.
 */
export interface MoleculeMeta {
  id: string;
  /** Display name shown in the library + the project surface. */
  name: string;
  /** Collection membership: the projects this molecule is linked to. */
  project_ids: string[];
  /** ISO timestamp the molecule was added. */
  added_at: string;
  /** Canonical SMILES, computed once on save by RDKit.js. Optional until Phase 1. */
  smiles?: string;
  /** InChIKey, for dedup + literature lookup. Optional until Phase 1. */
  inchikey?: string;
  /** Hill molecular formula, for the library list column. */
  formula?: string;
  /** Average molecular weight in g/mol. */
  mol_weight?: number;
  /** Where this molecule came from. */
  source?: MoleculeSource;
  /** PubChem CID when `source === "pubchem"`. */
  pubchem_cid?: number;
}

/**
 * A molecule as a consumer surface sees it (metadata only; the `.mol` bytes are
 * read lazily by the editor, never by the project list).
 */
export type Molecule = MoleculeMeta;

/** A molecule plus its Molfile bytes, as the editor opens it. */
export interface MoleculeDetail {
  meta: MoleculeMeta;
  /** The MDL Molfile text (2D coordinates preserved). */
  molfile: string;
}

/** Fields a caller supplies when saving a new molecule; identity is computed. */
export interface MoleculeInput {
  name: string;
  project_ids?: string[];
  source?: MoleculeSource;
  pubchem_cid?: number;
}

/**
 * Compute the RDKit identity for a structure and fold it into a meta patch.
 * Best-effort: a parse failure leaves the identity fields unset rather than
 * blocking the save (a user can still keep a structure RDKit cannot canonicalize).
 */
async function identityPatch(
  structure: string,
): Promise<Partial<MoleculeMeta>> {
  try {
    const id = await computeIdentity(structure);
    return {
      smiles: id.smiles || undefined,
      inchikey: id.inchikey || undefined,
      formula: id.formula || undefined,
      mol_weight: id.mol_weight ?? undefined,
    };
  } catch {
    return {};
  }
}

/** List every molecule in the current user's library (metadata only). */
export async function list(): Promise<Molecule[]> {
  return moleculeStore.listMeta();
}

/**
 * List the molecules linked to a project (collection membership via
 * `project_ids`). The project "Molecules" section maps over this; an empty
 * result renders nothing. Pass the project OWNER so a shared project read by a
 * non-owner lists the owner's molecules, not the viewer's (the store otherwise
 * defaults to the current user).
 */
export async function listByProject(
  projectId: string,
  owner?: string,
): Promise<Molecule[]> {
  const all = owner
    ? await moleculeStore.listMetaForUser(owner)
    : await moleculeStore.listMeta();
  return all.filter((m) => m.project_ids.includes(projectId));
}

/** Read one molecule (sidecar + Molfile) for the editor. */
export async function get(id: string): Promise<MoleculeDetail | null> {
  const raw = await moleculeStore.getRaw(id);
  return raw ? { meta: raw.meta, molfile: raw.molfile } : null;
}

/**
 * Save a new molecule. Stores the Molfile as the source of truth and computes
 * the RDKit identity (SMILES / InChIKey / formula / MW) into the sidecar so the
 * library list and search work without re-parsing every structure.
 */
export async function create(
  molfile: string,
  input: MoleculeInput,
): Promise<MoleculeDetail> {
  const identity = await identityPatch(molfile);
  const raw = await moleculeStore.create(molfile, {
    name: input.name,
    project_ids: input.project_ids ?? [],
    added_at: new Date().toISOString(),
    source: input.source ?? "drawn",
    pubchem_cid: input.pubchem_cid,
    ...identity,
  });
  return { meta: raw.meta, molfile: raw.molfile };
}

/** Patch a molecule. A new Molfile re-runs identity; metadata fields patch directly. */
export async function update(
  id: string,
  patch: { molfile?: string } & Partial<Omit<MoleculeMeta, "id">>,
): Promise<MoleculeMeta | null> {
  const username = await getCurrentUserCached();
  const { molfile, ...metaPatch } = patch;
  if (molfile != null) {
    await moleculeStore.writeMolfile(id, molfile, username);
    Object.assign(metaPatch, await identityPatch(molfile));
  }
  return moleculeStore.updateMeta(id, metaPatch, username);
}

/** Soft-delete a molecule into the recoverable trash. chem-trash bot
 *  (2026-06-11): this moves BOTH `{id}.mol` + `{id}.meta.json` into
 *  `_trash/molecules/` (the Molfile embedded inside the trash record) and
 *  records one index entry. It does NOT hard-delete — recovery is via
 *  `moleculesApi.restore` (Undo toast) or the /trash page. The hard
 *  `moleculeStore.delete` survives ONLY as the trash-expiry purge primitive.
 *  Returns true when a molecule was trashed. */
export async function remove(id: string): Promise<boolean> {
  const username = await getCurrentUserCached();
  const trashed = await trashEntity({
    owner: username,
    entityType: "molecule",
    id,
    deletedBy: username,
  });
  return trashed != null;
}

/** Inverse of `remove`. Restores both files of a trashed molecule back to
 *  the live library and returns the restored sidecar record (or null when
 *  the trash entry was missing). Callers expose this via the Undo toast and
 *  the /trash page Restore button. */
export async function restore(
  id: string,
  owner?: string,
): Promise<MoleculeMeta | null> {
  const username = owner ?? (await getCurrentUserCached());
  const restoredBy = await getCurrentUserCached();
  const sidecar = await restoreMoleculeFromTrash(username, id, restoredBy);
  if (!sidecar) return null;
  // The sidecar is the live MoleculeMeta object (all fields round-trip).
  return sidecar as unknown as MoleculeMeta;
}

/** Namespaced handle to mirror the other `*Api` modules in the codebase. */
export const moleculesApi = {
  list,
  listByProject,
  get,
  create,
  update,
  remove,
  restore,
};
