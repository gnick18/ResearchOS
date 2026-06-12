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
import {
  HISTORY_ENGINE_ENABLED,
  MOLECULES_ENTITY_TYPE,
  moleculePayload,
  recordMoleculeHistory,
  projectMoleculeState,
  type MoleculeTrackedState,
} from "./molecule-history";
import { historyEngine } from "@/lib/history/engine";

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
  // PubChem-sourced physicochemical descriptors. Present ONLY on
  // PubChem-imported molecules (source === "pubchem"). Hand-drawn and
  // file-imported molecules leave these undefined. Each is the value PubChem
  // reports, or null when PubChem has no value for the compound. These are
  // additive and back-compatible, every prior molecule simply omits them.
  /** Computed octanol-water partition coefficient (XLogP), a lipophilicity descriptor. */
  xlogp?: number | null;
  /** Hydrogen-bond donor count. */
  h_bond_donor_count?: number | null;
  /** Hydrogen-bond acceptor count. */
  h_bond_acceptor_count?: number | null;
  /** Topological polar surface area in square angstroms (TPSA). */
  tpsa?: number | null;
  // DATA-SHAPE FLAG (literature-explorer, 2026-06-12): additive, back-compatible.
  // Older molecules simply omit this field. Mirrors the xlogp/descriptor pattern.
  /**
   * Papers and patents starred by the user in the literature explorer for this
   * molecule. Saved into the sidecar so starred items persist across sessions
   * and show as a one-click strip when the molecule is reopened.
   */
  starred_papers?: StarredPaper[];
}

/**
 * A paper or patent the user has starred from the literature explorer for a
 * specific molecule. Persisted in MoleculeMeta.starred_papers[].
 *
 * DATA-SHAPE FLAG: new optional array field on molecules/{id}.meta.json.
 * Additive and back-compatible -- older molecules omit it.
 */
export interface StarredPaper {
  /** DOI for research / review papers (absent for patents). */
  doi?: string;
  /** PubChem patent id for patent items (absent for papers). */
  patent_id?: string;
  title: string;
  year: string;
  type: "research" | "review" | "patent";
  journal?: string;
  /** Europe PMC source (e.g. "MED"). */
  source?: string;
  /** Europe PMC article id. */
  id?: string;
  /** ISO timestamp when the user starred this item. */
  starred_at: string;
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
  // PubChem-sourced physicochemical descriptors, supplied only on a PubChem
  // import so they persist on the sidecar. Omit them for hand-drawn and
  // file-imported molecules so the fields stay undefined on disk.
  xlogp?: number | null;
  h_bond_donor_count?: number | null;
  h_bond_acceptor_count?: number | null;
  tpsa?: number | null;
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

/**
 * Build a sidecar patch carrying only the PubChem descriptors that were
 * actually supplied. Undefined inputs (the hand-drawn / file-imported path)
 * produce no keys, so non-PubChem molecules never get descriptor keys written
 * (no null-key spam). A descriptor PubChem reported as null IS written as null,
 * which records "PubChem has no value for this compound" rather than "unknown".
 */
function descriptorPatch(input: MoleculeInput): Partial<MoleculeMeta> {
  const patch: Partial<MoleculeMeta> = {};
  if (input.xlogp !== undefined) patch.xlogp = input.xlogp;
  if (input.h_bond_donor_count !== undefined)
    patch.h_bond_donor_count = input.h_bond_donor_count;
  if (input.h_bond_acceptor_count !== undefined)
    patch.h_bond_acceptor_count = input.h_bond_acceptor_count;
  if (input.tpsa !== undefined) patch.tpsa = input.tpsa;
  return patch;
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
    // PubChem descriptors only when supplied; a non-PubChem create passes
    // nothing so we never write undefined keys onto the sidecar.
    ...descriptorPatch(input),
  });
  // chem-history bot: record genesis checkpoint AFTER the .mol is written.
  // Best-effort; a history write failure must never block the save.
  if (HISTORY_ENGINE_ENABLED) {
    const owner = await getCurrentUserCached();
    const nextState = moleculePayload(raw.meta, raw.molfile);
    void recordMoleculeHistory({
      type: "create",
      id: raw.meta.id,
      owner,
      actor: owner,
      prevState: null,
      nextState,
    });
  }
  return { meta: raw.meta, molfile: raw.molfile };
}

/** Patch a molecule. A new Molfile re-runs identity; metadata fields patch directly. */
export async function update(
  id: string,
  patch: { molfile?: string } & Partial<Omit<MoleculeMeta, "id">>,
): Promise<MoleculeMeta | null> {
  const username = await getCurrentUserCached();
  const { molfile, ...metaPatch } = patch;

  // chem-history bot: capture prevState BEFORE the write when a Molfile is
  // being replaced (that is the structural Save checkpoint). Best-effort: if
  // the read fails, we skip the history write rather than blocking the save.
  let prevState: MoleculeTrackedState | null = null;
  if (molfile != null && HISTORY_ENGINE_ENABLED) {
    try {
      const existing = await moleculeStore.getRawForUser(id, username);
      if (existing) {
        prevState = moleculePayload(existing.meta, existing.molfile);
      }
    } catch {
      // prevState stays null; history skipped gracefully.
    }
  }

  if (molfile != null) {
    await moleculeStore.writeMolfile(id, molfile, username);
    Object.assign(metaPatch, await identityPatch(molfile));
  }
  const updatedMeta = await moleculeStore.updateMeta(id, metaPatch, username);

  // chem-history bot: record checkpoint AFTER the write. Gated on a Molfile
  // being present (metadata-only updates like project_ids re-links do not
  // constitute a structural Save that warrants a version checkpoint).
  if (molfile != null && HISTORY_ENGINE_ENABLED && updatedMeta) {
    const nextState = moleculePayload(updatedMeta, molfile);
    void recordMoleculeHistory({
      type: "update",
      id,
      owner: username,
      actor: username,
      prevState,
      nextState,
    });
  }

  return updatedMeta;
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

// ── History read + restore (chem-history bot) ────────────────────────────────

/**
 * Read the raw history rows for a molecule. Returns an empty array when there
 * is no history yet (molecule predates versioning or first Save not yet made).
 */
export async function getHistory(
  id: string,
  owner?: string,
) {
  const username = owner ?? (await getCurrentUserCached());
  try {
    return await historyEngine.readHistory(MOLECULES_ENTITY_TYPE, username, id);
  } catch {
    return [];
  }
}

/**
 * Reconstruct the tracked state at a given version index and return the
 * projected shape (including the molfile). The panel uses this to preview an
 * earlier version and to seed the restore write.
 */
export async function reconstructMoleculeAt(
  id: string,
  owner: string,
  versionIndex: number,
  headCanonical?: string,
): Promise<import("./molecule-history").MoleculeProjection | null> {
  try {
    const canonical = await historyEngine.reconstructState(
      MOLECULES_ENTITY_TYPE,
      owner,
      id,
      versionIndex,
      headCanonical,
    );
    return projectMoleculeState(canonical);
  } catch {
    return null;
  }
}

/**
 * Restore a molecule to a prior version by index. Reads the reconstructed state
 * at that index, writes the recovered Molfile back via `update` (which itself
 * records a forward "restore" checkpoint), and returns the updated meta. Returns
 * null when the version cannot be reconstructed or the write fails.
 */
export async function restoreVersion(
  id: string,
  versionIndex: number,
  owner?: string,
): Promise<MoleculeMeta | null> {
  const username = owner ?? (await getCurrentUserCached());
  // Need the current HEAD canonical so bare-genesis anchors resolve correctly.
  const existing = await moleculeStore.getRawForUser(id, username);
  if (!existing) return null;
  const headCanonical = JSON.stringify(moleculePayload(existing.meta, existing.molfile));

  const proj = await reconstructMoleculeAt(id, username, versionIndex, headCanonical);
  if (!proj || !proj.molfile) return null;

  // Write recovered molfile + record a "revert" checkpoint (update wires history).
  // We pass the revert kind directly through the history recorder so the timeline
  // shows "Restored an earlier version" rather than "edited structure".
  try {
    // Write via the store directly so we can stamp the revert kind ourselves
    // rather than triggering a second identityPatch call through update.
    await moleculeStore.writeMolfile(id, proj.molfile, username);
    const identity = await identityPatch(proj.molfile);
    const restoredMeta = await moleculeStore.updateMeta(id, identity, username);
    if (restoredMeta && HISTORY_ENGINE_ENABLED) {
      const prevState = moleculePayload(existing.meta, existing.molfile);
      const nextState = moleculePayload(restoredMeta, proj.molfile);
      void recordMoleculeHistory({
        type: "revert",
        id,
        owner: username,
        actor: username,
        prevState,
        nextState,
        revertTargetVersion: versionIndex,
      });
    }
    return restoredMeta;
  } catch {
    return null;
  }
}

/**
 * Write the starred_papers list for a molecule. Replaces the whole array so the
 * caller owns the merge (add or remove). Metadata-only update, does not touch the
 * Molfile or trigger a history checkpoint (starring is not a structural save).
 * Returns the updated MoleculeMeta, or null when the molecule does not exist.
 */
export async function setStarredPapers(
  id: string,
  papers: StarredPaper[],
): Promise<MoleculeMeta | null> {
  const username = await getCurrentUserCached();
  return moleculeStore.updateMeta(id, { starred_papers: papers }, username);
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
  getHistory,
  reconstructMoleculeAt,
  restoreVersion,
  setStarredPapers,
};
