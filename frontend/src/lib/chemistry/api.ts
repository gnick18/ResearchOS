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
 * Phase 0 leaves `listByProject` an EMPTY SEAM: no disk reads, no on-disk shape
 * is created, so the data-shape review gate is NOT triggered yet. A consumer
 * surface can render a "Molecules" section against this locked contract today
 * and have it populate automatically once Phase 1 lands the real persistence.
 * The on-disk read/write in Phase 1 IS the flagged data-shape change (verify
 * before merge).
 *
 * See docs/proposals/CHEMISTRY_WORKBENCH_PROPOSAL.md (sections 4 and 9).
 */

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

/**
 * List the molecules linked to a project (collection membership via
 * `project_ids`).
 *
 * SEAM: returns `[]` until the chemistry-workbench Phase 1 lands the `molecules/`
 * store + the Molfile/meta read path. The project surface maps over this and
 * renders a "Molecules" section; an empty result renders nothing, so the surface
 * ships now and molecules appear automatically once Phase 1 fills this in. The
 * signature is final, so wiring against it today is not guesswork.
 */
export async function listByProject(_projectId: string): Promise<Molecule[]> {
  return [];
}

/** Namespaced handle to mirror the other `*Api` modules in the codebase. */
export const moleculesApi = {
  listByProject,
};
