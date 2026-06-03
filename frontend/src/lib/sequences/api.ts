/**
 * Sequence library API — the SEAM between the sequence-editor arc (owner) and
 * the de-bloat arc's Workbench projects surface (consumer).
 *
 * Cross-arc decision (Grant, 2026-06-02): de-bloat builds the projects surface
 * NOW against this locked contract, with the seam returning nothing until the
 * sequence-editor Phase 1 lands the real persistence. See
 * docs/proposals/SEQUENCE_EDITOR_PROPOSAL.md ("Status update — the timing
 * signal") and docs/proposals/MINIMALISM_ARC_COORDINATION.md (collision zone 2).
 *
 * The SHAPE is locked: a sequence is a real `sequences/{id}.gb` GenBank file
 * plus a `sequences/{id}.meta.json` sidecar carrying `project_ids: string[]`
 * collection links. Phase 1 fills in the GenBank/meta read+write here; until
 * then `listByProject` is an empty seam — no disk reads, no on-disk shape is
 * created, so the data-shape review gate is NOT triggered yet. The on-disk
 * persistence in Phase 1 IS the flagged data-shape change (verify before merge).
 */

/**
 * Locked metadata sidecar shape (`sequences/{id}.meta.json`). Phase 1 owns the
 * on-disk read/write; this is the contract the projects surface reads against.
 */
export interface SequenceMeta {
  id: string;
  /** Display name shown in the library + the project surface. */
  name: string;
  /** Collection membership: the projects this sequence is linked to. */
  project_ids: string[];
  /** ISO timestamp the sequence was added. */
  added_at: string;
  /** Length in bp, for the library list column. Optional until Phase 1. */
  length_bp?: number;
}

/**
 * A sequence as the projects surface consumes it (metadata only; the `.gb`
 * bytes are read lazily by the editor, never by the project list).
 */
export type Sequence = SequenceMeta;

/**
 * List the sequences linked to a project (collection membership via
 * `project_ids`).
 *
 * SEAM: returns `[]` until the sequence-editor Phase 1 lands the `sequences/`
 * store + the GenBank/meta read path. The de-bloat projects surface maps over
 * this and renders a "Sequences" section; an empty result renders nothing, so
 * the surface ships now and sequences appear automatically once Phase 1 fills
 * this in. The signature is final, so wiring against it today is not guesswork.
 */
export async function listByProject(_projectId: string): Promise<Sequence[]> {
  return [];
}

/** Namespaced handle to mirror the other `*Api` modules in the codebase. */
export const sequencesApi = {
  listByProject,
};
