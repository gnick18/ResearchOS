// chem-history bot (2026-06-11): version-control wiring for the molecule editor.
// Each explicit Save now records a permanent, restorable version of the molecule
// into the shared delta store. Mirrors sequences-history.ts (the seq history bot,
// 2026-06-03) — read that file and engine.ts before modifying this one.
//
// ENGINE MODEL FIT: the engine versions a CANONICAL STRING. A molecule is another
// entity kind. We do NOT version the raw Molfile bytes verbatim (a re-export can
// vary atom ordering, trailing whitespace, or header timestamps and churn the diff
// on a no-op save). Instead we version a STRUCTURED PROJECTION of the molecule:
// name, formula, mol_weight, smiles, inchikey, and the trimmed molfile. The
// molfile IS kept (it carries the 2D coordinates the editor needs for restore),
// but it is whitespace-normalized so a load-save round-trip on an unchanged
// structure does not produce a phantom version.
//
// ADDITIVE ONLY: touches no existing Note / Sequence / Task versioning and
// migrates no existing files. A molecule whose .mol predates this simply starts
// versioning from its next Save (the genesis row anchors the pre-edit state).

import type { EntityViewerAdapter } from "@/lib/history/entity-viewer";
import { historyEngine } from "@/lib/history/engine";
import { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED } from "@/lib/history/notes-history";
import type { HistoryEditKind } from "@/lib/history/types";

// Re-export the SHARED flags so molecule call sites read them from one place.
// These are the SAME consts the Notes / Sequences pilots use (single source of
// truth); the flag posture is one global pair, not per-entity.
export { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED };

/** History-file namespace: users/<owner>/_history/molecules/<id>.jsonl */
export const MOLECULES_ENTITY_TYPE = "molecules";

/**
 * The slice of the molecule we version. Kept structural (not the raw Molfile
 * bytes) so the canonical is deterministic and the diff is meaningful.
 *
 * `molfile` is normalized (trim trailing whitespace on every line + trim the
 * whole string) so a load-save round-trip on an unchanged structure does not
 * produce a phantom version. The identity fields (smiles, inchikey, formula,
 * mol_weight) are the stable human-readable summary; they make the diff
 * meaningful to read without re-parsing the Molfile.
 */
export interface MoleculeTrackedState {
  /** Display name shown in the library. */
  name: string;
  /** Hill molecular formula (e.g. "C9H8O4"). Empty string when unknown. */
  formula: string;
  /** Average molecular weight in g/mol. null when unknown. */
  mol_weight: number | null;
  /** Canonical SMILES, for a quick structural fingerprint in the diff. */
  smiles: string;
  /** InChIKey, for dedup + literature lookup. */
  inchikey: string;
  /** MDL Molfile, whitespace-normalized, the structural source of truth. */
  molfile: string;
}

/**
 * Normalize an MDL Molfile so a load-save round-trip on an unchanged structure
 * produces the same string. Trims trailing whitespace on each line and trims
 * the whole string; does NOT reorder atoms (that would be a deeper parse).
 */
function normalizeMolfile(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * The minimal shape `moleculePayload` accepts. The sidecar MoleculeMeta is a
 * structural superset; we accept the loose shape so callers can pass either a
 * live MoleculeMeta or a reconstructed plain object without a hard dependency
 * on the full MoleculeMeta type from api.ts.
 */
export interface MoleculeMetaLike {
  name?: unknown;
  formula?: unknown;
  mol_weight?: unknown;
  smiles?: unknown;
  inchikey?: unknown;
}

/**
 * Build the tracked state from a molecule sidecar + Molfile. Normalizes the
 * molfile so the canonical is stable across load-save round-trips.
 */
export function moleculePayload(
  meta: MoleculeMetaLike,
  molfile: string,
): MoleculeTrackedState {
  const mw = meta.mol_weight;
  return {
    name: asString(meta.name),
    formula: asString(meta.formula),
    mol_weight: typeof mw === "number" ? mw : null,
    smiles: asString(meta.smiles),
    inchikey: asString(meta.inchikey),
    molfile: normalizeMolfile(molfile),
  };
}

/**
 * Best-effort: append a molecule Save to the delta store. A history-write
 * failure must NEVER throw into the user's save path (PROPOSAL.md 3j), so this
 * swallows every error after logging. The .mol file has already been written by
 * the time this runs; history is a side-channel.
 *
 * No-op when the flag is off. The engine's own empty-delta short-circuit drops a
 * no-op Save (prev === next) once history exists, so re-saving an unchanged
 * molecule never mints a phantom version.
 */
export async function recordMoleculeHistory(args: {
  type: HistoryEditKind;
  /** Molecule id (string per-user counter, e.g. "14"). */
  id: string;
  /** Owner folder the history file lives under. */
  owner: string;
  /** The user performing the edit. */
  actor: string;
  /** Tracked state BEFORE the Save. null for brand-new. */
  prevState: MoleculeTrackedState | null;
  /** Tracked state AFTER the Save (what was just written). */
  nextState: MoleculeTrackedState;
  /** For a "revert" / "undo-revert" row: the target version index. */
  revertTargetVersion?: number;
}): Promise<void> {
  if (!HISTORY_ENGINE_ENABLED) return;
  try {
    await historyEngine.appendEdit({
      type: args.type,
      entityType: MOLECULES_ENTITY_TYPE,
      id: args.id,
      owner: args.owner,
      actor: args.actor,
      prevState: args.prevState,
      nextState: args.nextState,
      revertTargetVersion: args.revertTargetVersion,
    });
  } catch (err) {
    console.warn(
      `[history] recordMoleculeHistory failed for ${MOLECULES_ENTITY_TYPE}/${args.id} (molecule saved, history skipped):`,
      err,
    );
  }
}

// ── Viewer adapter (consumes reconstructed canonical states) ────────────────

/**
 * The projection the version viewer summarizes for a molecule version. Carries
 * the headline identity (name / formula / SMILES) plus a `body` string to
 * satisfy the generic EntityViewerAdapter contract. The molfile is kept for
 * restore and thumbnail preview.
 */
export interface MoleculeProjection {
  /** One-line digest, e.g. "Aspirin, C9H8O4, 180.16 g/mol". Satisfies EntityProjection. */
  body: string;
  name: string;
  formula: string;
  mol_weight: number | null;
  smiles: string;
  inchikey: string;
  /** The full molfile, used for the preview thumbnail on the selected version row. */
  molfile: string;
}

const EMPTY_PROJECTION: MoleculeProjection = {
  body: "",
  name: "",
  formula: "",
  mol_weight: null,
  smiles: "",
  inchikey: "",
  molfile: "",
};

/**
 * Parse a reconstructed canonical state string into a MoleculeProjection.
 * Tolerant: a malformed / empty canonical projects to the empty shape so the
 * viewer degrades gracefully.
 */
export function projectMoleculeState(
  canonical: string | null | undefined,
): MoleculeProjection {
  if (!canonical || canonical.trim().length === 0) {
    return EMPTY_PROJECTION;
  }
  let parsed: MoleculeTrackedState;
  try {
    parsed = JSON.parse(canonical) as MoleculeTrackedState;
  } catch {
    return EMPTY_PROJECTION;
  }
  const proj: MoleculeProjection = {
    body: "",
    name: asString(parsed.name),
    formula: asString(parsed.formula),
    mol_weight: typeof parsed.mol_weight === "number" ? parsed.mol_weight : null,
    smiles: asString(parsed.smiles),
    inchikey: asString(parsed.inchikey),
    molfile: asString(parsed.molfile),
  };
  proj.body = moleculeDigest(proj);
  return proj;
}

/**
 * Build the compact one-line digest for a projection, e.g.
 * "Aspirin, C9H8O4, 180.16 g/mol". Falls back gracefully when fields are absent.
 */
export function moleculeDigest(p: MoleculeProjection): string {
  const parts: string[] = [];
  if (p.name) parts.push(p.name);
  if (p.formula) parts.push(p.formula);
  if (p.mol_weight != null) parts.push(`${p.mol_weight.toFixed(2)} g/mol`);
  return parts.join(", ");
}

/**
 * One-line, molecule-appropriate change summary comparing a version's projection
 * against its predecessor's. A molecule is not line-diffable like prose, so the
 * summary is a brief label:
 *
 *   - restore row (kind "revert")    -> "Restored an earlier version"
 *   - undo row (kind "undo-revert")  -> "Undid a restore"
 *   - first version                  -> "created structure"
 *   - name changed                   -> "renamed to <name>"
 *   - structure changed (SMILES/mol) -> "edited structure"
 *   - identity changed (formula/MW)  -> "updated identity"
 *   - no detected change             -> "saved (no change)"
 *
 * Pure (no Date.now, no engine calls).
 */
export function summarizeMoleculeChange(
  before: MoleculeProjection | null,
  after: MoleculeProjection,
  kind?: HistoryEditKind,
): string {
  if (kind === "revert") return "Restored an earlier version";
  if (kind === "undo-revert") return "Undid a restore";
  if (before === null) return "created structure";

  const parts: string[] = [];

  if (before.name !== after.name) {
    parts.push(after.name ? `renamed to ${after.name}` : "cleared name");
  }
  // Structure comparison: use SMILES when available (stable canonical), fall
  // back to normalized molfile (the structural source of truth).
  const structureChanged =
    (after.smiles && before.smiles ? after.smiles !== before.smiles : false) ||
    (after.molfile !== before.molfile);
  if (structureChanged) parts.push("edited structure");

  if (parts.length === 0) {
    // Formula / MW changed but structure stayed the same: identity recomputed
    // (e.g. the RDKit pipeline updated a field without a structural edit).
    if (before.formula !== after.formula || before.mol_weight !== after.mol_weight) {
      return "updated identity";
    }
    return "saved (no change)";
  }
  return parts.join(", ");
}

/**
 * The molecule EntityViewerAdapter. Mirrors sequenceAdapter; the
 * MoleculeHistoryPanel consumes projectBody + summarize to build its version
 * list. `projectBody` returns the projection (which carries `body` = the digest).
 */
export const moleculeAdapter: EntityViewerAdapter<MoleculeProjection> = {
  projectBody: projectMoleculeState,
  summarize: summarizeMoleculeChange,
};
