// Phase 3c chunk 2: collab doc id management.
//
// Every shared note has a stable doc id that lives in the Loro meta map under
// the key "collab_doc_id". The id is minted once (crypto.randomUUID()) and
// never changes, even if the note is renamed. It travels with the note because
// the meta map is part of the CRDT doc that is snapshotted and shared.
//
// FLAG (data-shape change): this module adds a NEW key "collab_doc_id" to the
// Loro meta map. It is ADDITIVE and backward-compatible. Unshared notes never
// get this key, and code that does not know about it simply reads it as
// undefined. The key is purely Loro-internal (like "collab_retired_at"), it is
// NOT persisted in the JSON mirror or the Note type; only the sidecar (.loro
// binary) carries it.
//
// The mirror projection (loro/mirror.ts) ignores extra meta keys, so there is
// zero risk of the id leaking into the readable JSON or the Note interface.
//
// Lifecycle:
//   - getOrMintCollabDocId(doc): read the key if present; mint + write if absent.
//     Minting triggers a Loro commit (the CRDT records the key write) so the id
//     is durable in the sidecar on the next persistNote call.
//   - getCollabDocId(doc): read-only, returns undefined when the key is not set.
//     The caller treats undefined as "this note is not shared" and skips all
//     server calls.

import { type LoroDoc } from "loro-crdt";

const COLLAB_DOC_ID_KEY = "collab_doc_id";

/**
 * Returns the collab doc id stored in the doc's meta map, or undefined when
 * the note has never been shared. This is the read-only fast path for the
 * reconcile-on-open and push-on-edit guards.
 */
export function getCollabDocId(doc: LoroDoc): string | undefined {
  const raw = doc.getMap("meta").get(COLLAB_DOC_ID_KEY);
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * Returns the collab doc id for this doc, minting a new one if absent.
 *
 * Minting writes the id into the Loro meta map and issues a Loro commit so
 * the write is recorded in the doc's history. The caller is responsible for
 * persisting the sidecar after this call (the debounced commit in the store
 * facade handles that in normal flow).
 *
 * The id is a standard UUID (crypto.randomUUID), stable across restarts and
 * devices once the sidecar is saved. The same id is used as the collab server
 * doc room key.
 *
 * Returns the id string.
 */
export function getOrMintCollabDocId(doc: LoroDoc): string {
  const existing = getCollabDocId(doc);
  if (existing !== undefined) return existing;

  const id = crypto.randomUUID();
  doc.getMap("meta").set(COLLAB_DOC_ID_KEY, id);
  // Commit so the id is part of the CRDT history, not a floating uncommitted op.
  doc.commit({ message: "mint-collab-doc-id" });
  return id;
}
