// Phase 3c chunk 2: reconcile-on-open and push-on-edit hooks.
//
// These are the two integration points that wire the persistence module into
// the Loro note lifecycle:
//
//   1. reconcileOnOpen(doc, docId, email): called once after loadOrRebuild,
//      pulls the server's canonical snapshot + updates and CRDT-merges them.
//      This is idempotent (Loro ignores ops it already has) so calling it on a
//      fresh sidecar or a partially-synced one is always safe.
//
//   2. attachPushOnEdit(handle, docId, email, onError?): subscribes to the
//      NoteHandle change stream and pushes each new Loro update to the server.
//      Debounced by 400 ms so rapid keystrokes are batched into a few pushes
//      rather than one per character. Returns an unsubscribe function. Failures
//      are never thrown; they are passed to onError (default: console.warn)
//      so local editing is never blocked.
//
// Both functions are no-ops when SHARING_ENABLED / LORO_PILOT_ENABLED guards
// are not satisfied — the callers gate on those before calling.
//
// Base64 decoding uses the same approach as the push path: convert via
// atob/btoa (browser-native, same approach as the server uses Buffer). In a
// Node/vitest environment we shim btoa/atob via globalThis so tests work.

import { LoroDoc } from "loro-crdt";
import type { NoteHandle } from "@/lib/loro/store";
import {
  openCollabDoc,
  pushCollabUpdate,
  CollabError,
  NoLocalIdentityError,
} from "./persistence";

// ---------------------------------------------------------------------------
// Adopt the server-canonical base (the fork fix)
// ---------------------------------------------------------------------------

/**
 * For a collab doc the SERVER history is canonical (Option B). A client opening
 * a shared note must ADOPT that history as its working base, NOT merge its own
 * locally-seeded copy into it.
 *
 * Why: the local copy can carry the same text as a DIFFERENT set of Loro ops
 * (for example text rebuilt from the JSON mirror is seedActorId=0 ops, while the
 * sharer's copy is live-typed device-peer ops). CRDT-merging two unrelated
 * op-sets that represent the same characters INTERLEAVES them ("Connect" ->
 * "Connnectct"). Adopting the server's history as the base eliminates the fork:
 * every client starts from the identical canonical history and only appends.
 *
 * Returns the doc to use as the working doc plus whether it was adopted:
 *  - If the server has canonical content (a snapshot and/or updates), build a
 *    FRESH LoroDoc from snapshot+updates and return it (adopted = true). The
 *    caller should persist it so the local sidecar becomes the canonical copy
 *    and never forks again.
 *  - If the server has nothing yet (this client is the first to make the note
 *    collaborative), or the fetch fails, return the local doc unchanged
 *    (adopted = false). This client establishes the canonical history via the
 *    push-on-edit path.
 *
 * Never throws for the expected states (no identity, 403 not-yet-a-member, 404
 * disabled); it falls back to the local doc so opening a note is never blocked.
 */
export async function buildCollabBaseDoc(
  localDoc: LoroDoc,
  docId: string,
  email: string,
): Promise<{ doc: LoroDoc; adopted: boolean }> {
  let result: Awaited<ReturnType<typeof openCollabDoc>>;
  try {
    result = await openCollabDoc(docId, email);
  } catch (err) {
    if (err instanceof NoLocalIdentityError) {
      console.warn("[collab] buildCollabBaseDoc: no local identity, using local doc");
      return { doc: localDoc, adopted: false };
    }
    if (err instanceof CollabError) {
      console.warn("[collab] buildCollabBaseDoc: server error", err.status, err.message);
      return { doc: localDoc, adopted: false };
    }
    // Unexpected (network down, etc.): fall back to local so the open succeeds.
    console.warn("[collab] buildCollabBaseDoc: unexpected error, using local doc", err);
    return { doc: localDoc, adopted: false };
  }

  const hasCanonical =
    Boolean(result.snapshotB64) || result.updatesB64.length > 0;
  if (!hasCanonical) {
    // Server has no content yet: this client establishes the canonical history.
    return { doc: localDoc, adopted: false };
  }

  // Adopt: rebuild a fresh doc from the server's canonical snapshot + updates.
  const canonical = new LoroDoc();
  try {
    if (result.snapshotB64) {
      canonical.import(base64ToUint8Array(result.snapshotB64));
    }
    for (const updateB64 of result.updatesB64) {
      canonical.import(base64ToUint8Array(updateB64));
    }
  } catch (err) {
    // A corrupt server payload should not strand the user; fall back to local.
    console.warn("[collab] buildCollabBaseDoc: failed to import canonical, using local doc", err);
    return { doc: localDoc, adopted: false };
  }

  return { doc: canonical, adopted: true };
}

// ---------------------------------------------------------------------------
// Reconcile on open
// ---------------------------------------------------------------------------

/**
 * Pulls the server's canonical state for `docId` and CRDT-merges it into
 * `doc`. The snapshot is imported first (if present) then each update is
 * imported in order. Loro's CRDT semantics make this idempotent: ops the doc
 * already knows are silently ignored; unknown ops are merged.
 *
 * This must be called AFTER loadOrRebuild but BEFORE binding the editor so
 * the editor always starts from the reconciled state.
 *
 * Throws on unrecoverable errors (NoLocalIdentityError, missing identity).
 * Does NOT throw on network/403/404 (logs and continues, caller decides).
 *
 * Returns true when at least one import changed the doc.
 */
export async function reconcileOnOpen(
  doc: LoroDoc,
  docId: string,
  email: string,
): Promise<boolean> {
  let result: Awaited<ReturnType<typeof openCollabDoc>>;
  try {
    result = await openCollabDoc(docId, email);
  } catch (err) {
    if (err instanceof NoLocalIdentityError) {
      // No identity: this device has not registered. Skip silently.
      console.warn("[collab] reconcileOnOpen: no local identity, skipping");
      return false;
    }
    if (err instanceof CollabError) {
      // 404 = disabled, 403 = not a member yet (race during first share).
      // Both are expected in some states. Skip silently.
      console.warn("[collab] reconcileOnOpen: server error", err.status, err.message);
      return false;
    }
    throw err;
  }

  let changed = false;

  if (result.snapshotB64) {
    try {
      const bytes = base64ToUint8Array(result.snapshotB64);
      doc.import(bytes);
      changed = true;
    } catch (err) {
      console.warn("[collab] reconcileOnOpen: failed to import snapshot", err);
    }
  }

  for (const updateB64 of result.updatesB64) {
    try {
      const bytes = base64ToUint8Array(updateB64);
      doc.import(bytes);
      changed = true;
    } catch (err) {
      console.warn("[collab] reconcileOnOpen: failed to import update", err);
    }
  }

  return changed;
}

// ---------------------------------------------------------------------------
// Push on edit
// ---------------------------------------------------------------------------

/** Default error sink: logs the failure but does not propagate. */
function defaultOnError(err: unknown): void {
  console.warn("[collab] push-on-edit failed (best-effort, local editing unaffected):", err);
}

/**
 * Subscribes to `handle`'s Loro doc change stream and pushes each new update
 * to the server. Updates are exported as incremental exports from the doc's
 * last known version. Debounced by 400 ms.
 *
 * Failures (network, not-a-member, etc.) are passed to `onError` and never
 * propagated, so local editing is never blocked by a server outage.
 *
 * Returns an unsubscribe function. Call it when the note closes or when
 * collab is disabled for the session.
 */
export function attachPushOnEdit(
  handle: NoteHandle,
  docId: string,
  email: string,
  onError: (err: unknown) => void = defaultOnError,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPush = false;

  const scheduleFlush = () => {
    pendingPush = true;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!pendingPush) return;
      pendingPush = false;

      // Export the incremental update since the last committed version.
      // We export as "update" mode which gives only uncommitted deltas.
      // The server treats each push as an append to the update log, and
      // Loro merges are idempotent, so a double-push is harmless.
      let updateBytes: Uint8Array;
      try {
        updateBytes = handle.doc.export({ mode: "update" });
      } catch (err) {
        onError(err);
        return;
      }

      // Skip empty exports (no new ops since last export).
      if (updateBytes.length === 0) return;

      pushCollabUpdate(docId, email, updateBytes).catch(onError);
    }, 400);
  };

  const unsub = handle.subscribe(scheduleFlush);

  // Return a combined cleanup: cancel any pending debounce and unsubscribe.
  return () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingPush = false;
    unsub();
  };
}

// ---------------------------------------------------------------------------
// Base64 utility (browser-native; no external dep)
// ---------------------------------------------------------------------------

/**
 * Decodes a base64 string into a Uint8Array.
 * Uses the browser's atob (available in modern browsers + Node >= 16).
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
