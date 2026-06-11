// chem-trash bot (2026-06-11): tiny event bus that decouples "I just
// soft-deleted a molecule" callers (MoleculeDetail, ChemistryHub) from the
// Undo-toast surface rendered by AppShell. Mirrors the sequence and note
// delete-toast-bus patterns so a single delete kicks one shared toast without
// prop-drilling a handler.

export interface MoleculeDeleteToastPayload {
  /** The molecule ids that were just trashed. */
  ids: string[];
  /** A human label for the toast (the molecule name for a single delete). */
  label: string;
  /** Owner whose folder holds the trash entries. Defaults to current user. */
  owner?: string;
  /** Fired after a successful restore so the toast surface can invalidate the
   *  caller's relevant React Query caches and reselect. */
  onRestored?: () => void;
}

type Listener = (payload: MoleculeDeleteToastPayload) => void;

const listeners = new Set<Listener>();

export function emitMoleculeDeleted(payload: MoleculeDeleteToastPayload): void {
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch (err) {
      console.warn("[molecule-delete-toast-bus] listener threw", err);
    }
  }
}

export function subscribeMoleculeDeleted(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
