// External-collab chunk 5, PIECE 2: recipient-side revoke detection.
//
// When an owner revokes an outside collaborator (chunk 1), the relay DELETEs the
// member row but the doc stays ENFORCED. The next time the revoked recipient
// tries to connect (the /snapshot GET in buildCollabBaseDoc, and the /ws upgrade
// in useCollabSession), the DO answers 401 "not a member". This module turns
// that 401 into a stable "revoked" signal the UI reads to render a read-only
// banner and stop reconnecting.
//
// GRANT'S LOCKED DECISION. Revoke NEVER deletes the recipient's note. The
// recipient keeps their last-synced snapshot as a READ-ONLY local copy. So this
// module only flips a runtime flag; it touches no files. The recipient's note
// stays exactly as it was on disk.
//
// WHY RUNTIME-ONLY. A revoke is only meaningful for a MATERIALIZED external note
// (one with a collab_doc_id AND a received_from provenance marker, the shape
// acceptInvite writes). Such a note already exists locally with its last
// content, so we never need to persist a "revoked" flag to keep the data; we
// just detect the 401 each session and refuse to reconnect for that doc id. The
// registry below is an in-memory Set keyed by collab doc id, scoped to the page
// session.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { Note } from "@/lib/types";

/** Collab doc ids known to be revoked for this device, this page session. A
 *  revoked id stops the connect path from hammering the relay and tells the UI
 *  to show the read-only banner. Cleared on reload (the next session re-detects
 *  if still revoked, or connects normally if the owner re-granted). */
const revokedDocIds = new Set<string>();

/** Listeners notified when a doc id is newly marked revoked, so a mounted UI can
 *  re-render without polling. */
type RevokeListener = (docId: string) => void;
const listeners = new Set<RevokeListener>();

/**
 * True when this note is a MATERIALIZED external note, the only shape a revoke
 * applies to. It must carry a collab doc id (it is collaborative) AND a
 * received_from marker (it was materialized from someone else's grant, not a
 * note this device owns or shares in-lab). An owner's own note or an in-lab
 * shared note is never "revoked" from the recipient's point of view.
 */
export function isMaterializedExternalNote(note: Pick<Note, "collab_doc_id" | "received_from">): boolean {
  return Boolean(note.collab_doc_id) && Boolean(note.received_from);
}

/**
 * Decides whether a connect-time HTTP status means the recipient was revoked.
 *
 * Only a 401 (the DO's "not a member" / "auth required" on an enforced doc)
 * counts, AND only for a materialized external note. A 403/404/204/5xx is NOT a
 * revoke: those are other states (open doc, empty room, relay down) the existing
 * fallback already handles, and treating them as revoke would wrongly lock a
 * note read-only on a transient outage.
 */
export function isRevokedStatus(
  status: number,
  note: Pick<Note, "collab_doc_id" | "received_from">,
): boolean {
  return status === 401 && isMaterializedExternalNote(note);
}

/** Marks a collab doc id revoked and notifies listeners. Idempotent. */
export function markRevoked(docId: string): void {
  if (revokedDocIds.has(docId)) return;
  revokedDocIds.add(docId);
  for (const fn of listeners) {
    try {
      fn(docId);
    } catch {
      // A listener throwing must not block the others or the connect path.
    }
  }
}

/** True when this collab doc id has been detected as revoked this session. The
 *  UI reads this to render the read-only banner; the connect path reads it to
 *  skip reconnecting. */
export function isRevoked(docId: string | undefined | null): boolean {
  return typeof docId === "string" && revokedDocIds.has(docId);
}

/** Subscribe to newly-revoked doc ids. Returns an unsubscribe function. */
export function onRevoked(fn: RevokeListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test-only reset of the in-memory registry. */
export function _resetRevocationRegistry(): void {
  revokedDocIds.clear();
  listeners.clear();
}
