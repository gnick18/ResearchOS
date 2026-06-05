/**
 * The store facade: the single seam that UI code (and, later, the relay
 * backend) attaches to.
 *
 * Design invariant: local edits and (future) remote edits are the SAME change
 * applied to the SAME LoroDoc through this handle. The facade must not bake in
 * any single-user assumption that would block adding a relay backend later.
 *
 * Phase 1 scope: single-user, local-only. No relay, no live collab, no VC UI.
 *
 * The seam later phases extend:
 *   - openNote returns a NoteHandle; the relay backend adds itself as a
 *     subscriber and fans changes out over the wire using the same commit path.
 *   - handle.commit() stamps note-level updated_at and calls persistNote;
 *     Phase 3 replaces or augments this with a relay push.
 *   - handle.subscribe() is the notification hook for the mirror writer and
 *     eventually the relay; Phase 3 attaches its outbound sender here.
 */

import { LoroDoc } from "loro-crdt";
import { LoroSyncPlugin } from "loro-codemirror";
import type { Extension } from "@codemirror/state";
import { loadOrRebuild, persistNote } from "./sidecar-store";
import { classifyExternalEdit, ingestExternalEdit } from "./external-edit";
import { getDevicePeerId } from "./device-peer";
import { recordActor } from "./actors";
import { getEntryContentText, syncNoteMetadataToDoc, syncEntrySet } from "./note-doc";
import { projectToNote } from "./mirror";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// NoteHandle
// ---------------------------------------------------------------------------

export interface NoteHandle {
  /** The live LoroDoc. Read-only access for the caller; mutations go through
   *  the editor extensions or explicit helpers (e.g., setEntryContent). */
  readonly doc: LoroDoc;

  /**
   * Build the LoroExtensions wiring for the entry at `activeIndex`.
   *
   * Returns a CodeMirror Extension array. The caller mounts this into a new
   * EditorView; when the entry switches, tear down the view and call
   * bindEditorExtension again with the new index to get fresh extensions.
   *
   * Why rebind on entry switch (not a stable binding): LoroExtensions defaults
   * to a fixed text container ("codemirror"). Switching entries requires
   * pointing the CM6 plugin at a different LoroText; there is no runtime
   * rebind API, so we tear down and recreate the EditorView. This matches
   * the existing LiveMarkdownEditor behavior (it already fully remounts on
   * entry switch).
   */
  bindEditorExtension(activeIndex: number): Extension;

  /**
   * Reconcile the doc's entry set to the note (add new entries, drop deleted
   * ones), matched by id. Entry add/delete in a running-log note goes through
   * the legacy UI, so the doc does not learn about a new entry on its own;
   * binding to a missing entry crashes. The editor calls this before it binds
   * a (possibly new) entry index. No-op when the set already matches.
   */
  ensureEntries(note: Note): void;

  /**
   * Debounced-to-idle commit (~600 ms trailing edge).
   *
   * Stamps note-level updated_at on the mirror projection, then calls
   * persistNote (sidecar THEN mirror). The debounce is intentional: tight
   * keystroke loops would produce a sidecar write on every character otherwise.
   *
   * Pass the current `base` Note so the mirror projection has access to all
   * untracked fields (comments, flagged, etc.).
   */
  commit(base: Note, message?: string): Promise<void>;

  /**
   * Force any pending debounced commit to run immediately.
   *
   * Called by close() and by the React component's unmount path to flush
   * before the handle is released.
   */
  flush(): Promise<void>;

  /**
   * Subscribe to any committed change in the doc.
   *
   * Fires after a Loro commit (local edit or, later, remote import). Returns
   * an unsubscribe function. The mirror writer attaches here in Phase 1;
   * the relay outbound sender attaches here in Phase 3.
   */
  subscribe(cb: () => void): () => void;

  /**
   * Flush any pending commit, unsubscribe internal listeners, drop from cache.
   *
   * Does NOT destroy the EditorView; the React component owns the view
   * lifecycle and calls view.destroy() before calling handle.close().
   */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal handle implementation
// ---------------------------------------------------------------------------

class NoteHandleImpl implements NoteHandle {
  readonly doc: LoroDoc;
  private readonly _owner: string;
  private _pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingBase: Note | null = null;
  private _pendingMessage: string | undefined;
  // Resolve callbacks for any in-flight flush() promises.
  private _flushWaiters: Array<() => void> = [];
  // Subscription cleanup functions registered by external callers.
  private _externalUnsubs: Array<() => void> = [];
  // The Loro doc.subscribe() unsubscribe handle (returned by LoroDoc.subscribe).
  private _docUnsub: (() => void) | null = null;

  constructor(doc: LoroDoc, owner: string) {
    this.doc = doc;
    this._owner = owner;
  }

  // ---------------------------------------------------------------------------
  // Editor binding
  // ---------------------------------------------------------------------------

  bindEditorExtension(activeIndex: number): Extension {
    // Phase 1 (single-user) binds ONLY the Loro sync plugin, so Loro owns the
    // document content (for persistence, history-from-CRDT, and future collab)
    // while CodeMirror keeps its NATIVE undo (history()) and native cursor.
    //
    // We deliberately do NOT use LoroExtensions' bundled LoroUndoPlugin or
    // LoroEphemeralPlugin here. Both reconstruct Loro text cursors and throw
    // "No tile at position N" from the text rope when a stored cursor maps past
    // the shortened text on undo. Neither is needed without live collaborators:
    // remote-cursor awareness and collab-aware undo are Phase 3 concerns. CM6's
    // own history + cursor are robust and handle the single-user case cleanly.
    //
    // The custom text accessor binds the editor to the SPECIFIC entry's nested
    // LoroText (not the default "codemirror" root), so one note-doc serves
    // multiple entries by rebinding the active entry's Text on entry switch.
    return LoroSyncPlugin(
      this.doc,
      (d) => getEntryContentText(d, activeIndex)!,
    );
  }

  ensureEntries(note: Note): void {
    if (syncEntrySet(this.doc, note)) {
      this.doc.commit({ message: "reconcile-entries" });
    }
  }

  // ---------------------------------------------------------------------------
  // Commit (debounced ~600 ms trailing edge)
  // ---------------------------------------------------------------------------

  async commit(base: Note, message?: string): Promise<void> {
    // Store the latest base so the trailing-edge write uses the freshest
    // version of untracked fields (comments, flagged, etc.).
    this._pendingBase = base;
    this._pendingMessage = message;

    if (this._pendingTimer !== null) {
      clearTimeout(this._pendingTimer);
    }

    this._pendingTimer = setTimeout(() => {
      void this._runCommit();
    }, 600);
  }

  async flush(): Promise<void> {
    if (this._pendingTimer === null && this._pendingBase === null) {
      // Nothing pending.
      return;
    }

    // If there is an active timer, cancel it and run immediately.
    if (this._pendingTimer !== null) {
      clearTimeout(this._pendingTimer);
      this._pendingTimer = null;
    }

    await this._runCommit();
  }

  private async _runCommit(): Promise<void> {
    this._pendingTimer = null;

    const base = this._pendingBase;
    if (!base) return;
    this._pendingBase = null;

    // Stamp note-level updated_at to the current wall-clock ISO string.
    // The CRDT does NOT track note-level updated_at (only entry-level
    // updated_at is inside the doc; the note-level field is a mirror-only
    // concern). We inject it into the base before projection so the
    // readable mirror always has a fresh timestamp after each save.
    const stampedBase: Note = {
      ...base,
      updated_at: new Date().toISOString(),
    };

    // Keep the doc's entry SET in step with the note (entry add/delete goes
    // through the legacy UI). Runs before the metadata sync so a removed entry
    // is gone before we project, and a newly-added entry is captured.
    const entrySetChanged = syncEntrySet(this.doc, stampedBase);

    // Phase 1: the note title/description/is_running_log and per-entry
    // title/date are edited through the legacy UI, not the Loro editor (only
    // the entry content text is Loro-bound). Push those legacy edits INTO the
    // CRDT before projecting, otherwise projectToNote would overwrite a rename
    // with the stale seeded value on the next content commit. Content is left
    // to the editor binding. Commit only when something actually changed.
    if (syncNoteMetadataToDoc(this.doc, stampedBase) || entrySetChanged) {
      this.doc.commit({ message: "metadata-sync" });
    }

    await persistNote(this._owner, this.doc, stampedBase);

    // Notify flush waiters (set by close() before it awaits flush()).
    const waiters = this._flushWaiters;
    this._flushWaiters = [];
    for (const resolve of waiters) resolve();
  }

  // ---------------------------------------------------------------------------
  // Subscribe
  // ---------------------------------------------------------------------------

  subscribe(cb: () => void): () => void {
    // Attach to LoroDoc's change stream if this is the first subscriber.
    // All external subscribers share one LoroDoc.subscribe() listener to
    // avoid N wasm callbacks for N subscribers.
    if (this._docUnsub === null) {
      this._docUnsub = this.doc.subscribe(() => {
        for (const unsub of this._externalSubscriberCallbacks) {
          unsub();
        }
      });
    }

    this._externalSubscriberCallbacks.push(cb);

    return () => {
      this._externalSubscriberCallbacks = this._externalSubscriberCallbacks.filter(
        (c) => c !== cb,
      );
      // If no more subscribers, tear down the doc listener.
      if (this._externalSubscriberCallbacks.length === 0 && this._docUnsub) {
        this._docUnsub();
        this._docUnsub = null;
      }
    };
  }

  // External subscriber callbacks tracked separately for clarity.
  private _externalSubscriberCallbacks: Array<() => void> = [];

  // ---------------------------------------------------------------------------
  // Close
  // ---------------------------------------------------------------------------

  async close(): Promise<void> {
    // Flush any pending commit.
    await this.flush();

    // Unsubscribe from the doc.
    if (this._docUnsub) {
      this._docUnsub();
      this._docUnsub = null;
    }

    // Tear down any external subscribers.
    this._externalSubscriberCallbacks = [];

    // Call any explicitly registered external unsub hooks.
    for (const unsub of this._externalUnsubs) {
      unsub();
    }
    this._externalUnsubs = [];
  }
}

// ---------------------------------------------------------------------------
// Handle cache (one doc per note per owner)
// ---------------------------------------------------------------------------

/**
 * Cache key: `${owner}/${noteId}`. Re-renders and entry switches that call
 * openNote() with the same owner+id get the same in-memory handle without
 * rebuilding the doc from disk.
 */
const _handleCache = new Map<string, NoteHandleImpl>();

function cacheKey(owner: string, noteId: number): string {
  return `${owner}/${noteId}`;
}

// ---------------------------------------------------------------------------
// openNote (the public entry point)
// ---------------------------------------------------------------------------

/**
 * Open (or retrieve the cached) NoteHandle for a note.
 *
 * 1. Check cache; if hit, return cached handle (same in-memory doc).
 * 2. Load or rebuild the LoroDoc from disk (loadOrRebuild).
 * 3. Run external-edit detection ONCE at open: if the mirror's updated_at is
 *    newer than the sidecar's last projection, ingest the external edit as a
 *    single commit before the user starts typing. This covers the case where
 *    the note was edited outside ResearchOS while the app was closed.
 *    Concurrent in-app edits (conflict copy) are NOT triggered here; there are
 *    no pending in-app edits at cold open. That case is deferred to Phase 4.
 * 4. Store handle in cache and return.
 */
export async function openNote(base: Note, owner: string): Promise<NoteHandle> {
  const key = cacheKey(owner, base.id);
  const cached = _handleCache.get(key);
  if (cached) return cached;

  // Load from sidecar or rebuild from mirror.
  const doc = await loadOrRebuild(owner, base);

  // Set this device's stable peer id on the loaded doc BEFORE any edit (the
  // external-edit ingest below, and every live keystroke) so changes attribute
  // to a consistent actor. loadOrRebuild imports into a doc whose peer is random
  // per load, which would break attribution + session grouping. The fixed seed
  // peer (BigInt(0)) stays seed-only; this is the live-edit peer.
  doc.setPeerId(getDevicePeerId());

  // External-edit detection at open time (design doc section 7).
  const kind = classifyExternalEdit(doc, base);
  if (kind === "clean" || kind === "unclean") {
    ingestExternalEdit(doc, base, kind);
  }

  const handle = new NoteHandleImpl(doc, owner);
  _handleCache.set(key, handle);

  // Record this device's peer -> identity for version-history attribution.
  // Best-effort, fire-and-forget so the open is not blocked on disk I/O.
  // Phase 1/2 is single-user, so `owner` is the editing user; Phase 3 passes
  // the real editing identity instead of the note owner.
  void recordActor(owner, getDevicePeerId(), owner);

  return handle;
}

/**
 * Remove a handle from the cache.
 * Called by close() via the public NoteHandle.close() API.
 * Exposed as a module-level helper so tests can reset state between runs.
 */
export function _evictFromCache(owner: string, noteId: number): void {
  _handleCache.delete(cacheKey(owner, noteId));
}

/**
 * Clear the entire handle cache.
 * For test teardown only; do not call in production code.
 */
export function _clearCache(): void {
  _handleCache.clear();
}

// Patch close() to evict from cache on close so re-opening creates a fresh handle.
// We do this by wrapping NoteHandleImpl.close after construction inside openNote,
// but it is cleaner to override at the prototype level for testability.
const _originalClose = NoteHandleImpl.prototype.close;
NoteHandleImpl.prototype.close = async function (this: NoteHandleImpl) {
  await _originalClose.call(this);
  // Evict from cache using the projectToNote-derived note id approach.
  // We need the owner and noteId; they are available on the instance.
  // Access them via a type assertion since they are private.
  const impl = this as NoteHandleImpl & { _owner: string; doc: LoroDoc };
  // Find and remove this handle from the cache.
  for (const [k, v] of _handleCache) {
    if (v === impl) {
      _handleCache.delete(k);
      break;
    }
  }
};

// Re-export projectToNote for store tests that need to inspect projected state.
export { projectToNote } from "./mirror";
