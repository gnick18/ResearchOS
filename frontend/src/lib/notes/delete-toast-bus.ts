// Lab head UX polish manager Bug 3 (2026-05-24): tiny event bus that
// decouples "I just soft-deleted a note" callers from the toast surface
// rendered by AppShell. Lets NotesPanel and NoteDetailPopup both kick
// the same toast without prop-drilling a shared handler through three
// layers of components.

export interface NoteDeleteToastPayload {
  noteId: number;
  noteTitle: string;
  /** Owner whose folder holds the trash entry. Mirrors the same
   *  `owner` arg used by notesApi.delete / notesApi.restore. */
  owner?: string;
  /** Fired after a successful restore so the toast surface can also
   *  invalidate the caller's relevant React Query caches. The caller
   *  passes the cache-bust handler in via `onRestored`. */
  onRestored?: () => void;
}

type Listener = (payload: NoteDeleteToastPayload) => void;

const listeners = new Set<Listener>();

export function emitNoteDeleted(payload: NoteDeleteToastPayload): void {
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch (err) {
      console.warn("[note-delete-toast-bus] listener threw", err);
    }
  }
}

export function subscribeNoteDeleted(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
