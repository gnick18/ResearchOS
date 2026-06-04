// seq delete trash bot (2026-06-04): tiny event bus that decouples "I just
// soft-deleted one or more sequences" callers (the /sequences page) from the
// Undo-toast surface rendered by AppShell. Mirrors the Notes delete-toast-bus
// pattern so a single delete OR a bulk delete kicks one shared toast without
// prop-drilling a handler.

export interface SequenceDeleteToastPayload {
  /** The sequence ids that were just trashed (one for single delete, several
   *  for a bulk delete). Undo restores every id in this list. */
  ids: number[];
  /** A human label for the toast. For a single delete this is the sequence
   *  name; for a bulk delete it is e.g. "3 sequences". */
  label: string;
  /** Owner whose folder holds the trash entries. Mirrors the same `owner`
   *  arg used by sequencesApi.delete / sequencesApi.restore. */
  owner?: string;
  /** Fired after a successful restore so the toast surface can invalidate the
   *  caller's relevant React Query caches and reselect. */
  onRestored?: () => void;
}

type Listener = (payload: SequenceDeleteToastPayload) => void;

const listeners = new Set<Listener>();

export function emitSequenceDeleted(payload: SequenceDeleteToastPayload): void {
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch (err) {
      console.warn("[sequence-delete-toast-bus] listener threw", err);
    }
  }
}

export function subscribeSequenceDeleted(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
