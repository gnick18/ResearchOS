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

import { LoroDoc, type EphemeralStore } from "loro-crdt";
import { LoroSyncPlugin, type UserState, type EphemeralState } from "loro-codemirror";
import type { Extension } from "@codemirror/state";
import { loadOrRebuild, persistNote } from "./sidecar-store";
import { classifyExternalEdit, ingestExternalEdit } from "./external-edit";
import { getDevicePeerId } from "./device-peer";
import { recordActor } from "./actors";
import { getEntryContentText, syncNoteMetadataToDoc, syncEntrySet } from "./note-doc";
import { projectToNote } from "./mirror";
import { safeLoroEphemeralPlugin } from "./collab/safe-ephemeral-plugin";
import { LORO_PILOT_ENABLED } from "./config";
import { getCollabDocId } from "@/lib/collab/client/doc-id";
import { buildCollabBaseDoc } from "@/lib/collab/client/sync-hooks";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// [freeze-diag] OBSERVE-ONLY commit-rate instrumentation (2026-06-18).
//
// Diagnostic for a reported ~90s main-thread freeze in the Loro Lab Notes
// editor on prod (research-os.app). One suspect is a high-iteration commit
// feedback loop. This is pure counters + a throttled console.warn: it adds NO
// throttling, debouncing, or early-return to the real commit path and never
// changes what _runCommit does. It only emits a log line when the observed
// commit rate exceeds ~20/sec (which never happens during normal editing), so
// it is safe to ship live. Remove once the runaway path is named.
// ---------------------------------------------------------------------------
const _freezeDiagCommitTimes: number[] = [];
let _freezeDiagPersistNoteCalls = 0;
let _freezeDiagLastCommitWarn = 0;

/** Record one _runCommit tick and warn (throttled) if the 1s rate is high. */
function freezeDiagRecordCommit(message: string | undefined, note: string): void {
  if (typeof performance === "undefined") return;
  const now = performance.now();
  _freezeDiagCommitTimes.push(now);
  // Drop timestamps older than the 1000ms sliding window.
  while (
    _freezeDiagCommitTimes.length > 0 &&
    now - _freezeDiagCommitTimes[0] > 1000
  ) {
    _freezeDiagCommitTimes.shift();
  }
  if (
    _freezeDiagCommitTimes.length > 20 &&
    now - _freezeDiagLastCommitWarn > 500
  ) {
    _freezeDiagLastCommitWarn = now;
    console.warn(
      `[freeze-diag] _runCommit fired ${_freezeDiagCommitTimes.length} times in last 1s; ` +
        `persistNote total=${_freezeDiagPersistNoteCalls}; ` +
        `lastMessage=${message ?? "<none>"}; note=${note}`,
    );
  }
}

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
   *
   * When `collabEphemeral` and `collabUser` are provided (a live collab session
   * is active), LoroEphemeralPlugin is also installed alongside LoroSyncPlugin.
   * When absent the editor is sync-only (single-user, unchanged behavior).
   */
  bindEditorExtension(
    activeIndex: number,
    collabEphemeral?: EphemeralStore<EphemeralState>,
    collabUser?: UserState,
  ): Extension;

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
   * Register an unsubscribe/cleanup function that will be called on close().
   * Used internally by the Phase 3c push-on-edit wiring to ensure the push
   * subscriber is torn down when the note closes.
   */
  _registerUnsub(unsub: () => void): void;

  /**
   * Flush any pending commit, unsubscribe internal listeners, drop from cache.
   *
   * Does NOT destroy the EditorView; the React component owns the view
   * lifecycle and calls view.destroy() before calling handle.close().
   */
  close(): Promise<void>;

  /**
   * True while a debounced commit is queued or a _runCommit is in flight.
   *
   * Used by the Google-Docs-style auto-save status indicator in
   * NoteDetailPopup (auto-save bot, 2026-06-05) to show "Saving..." while
   * pending and "Saved" once settled. Subscribers are notified via
   * subscribeCommitPending whenever this flips. Never read on the legacy path
   * (flag off) so flag-off behavior is unchanged.
   */
  readonly commitPending: boolean;

  /**
   * Subscribe to commitPending changes. Fires once immediately with the
   * current value, then again whenever commitPending flips.
   *
   * Returns an unsubscribe function. Callers must unsubscribe on unmount
   * to avoid memory leaks.
   */
  subscribeCommitPending(cb: (pending: boolean) => void): () => void;
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

  // Auto-save status (auto-save bot, 2026-06-05). True while a debounced
  // commit is queued or _runCommit is in flight. Subscribers (the popup's
  // Saving/Saved indicator) are notified whenever this flips.
  private _commitPending = false;
  private _commitPendingSubs: Array<(pending: boolean) => void> = [];

  private _setCommitPending(v: boolean): void {
    if (this._commitPending === v) return;
    this._commitPending = v;
    for (const cb of this._commitPendingSubs) cb(v);
  }

  get commitPending(): boolean {
    return this._commitPending;
  }

  subscribeCommitPending(cb: (pending: boolean) => void): () => void {
    // Fire immediately with current state so the subscriber can initialise.
    cb(this._commitPending);
    this._commitPendingSubs.push(cb);
    return () => {
      this._commitPendingSubs = this._commitPendingSubs.filter((c) => c !== cb);
    };
  }

  constructor(doc: LoroDoc, owner: string) {
    this.doc = doc;
    this._owner = owner;
  }

  // ---------------------------------------------------------------------------
  // Editor binding
  // ---------------------------------------------------------------------------

  bindEditorExtension(
    activeIndex: number,
    collabEphemeral?: EphemeralStore<EphemeralState>,
    collabUser?: UserState,
  ): Extension {
    // Always bind LoroSyncPlugin so Loro owns document content.
    // CM6 keeps its NATIVE undo (we do NOT use LoroUndoPlugin) because
    // LoroUndoPlugin throws "No tile at position N" when a stored cursor maps
    // past the shortened text after an undo or concurrent remote delete.
    //
    // LoroEphemeralPlugin is added ONLY when a live collab session is active
    // (collabEphemeral + collabUser both provided). It is guarded by
    // safeLoroEphemeralPlugin which clamps out-of-range remote cursor positions
    // before CM6's RectangleMarker.forRange sees them, preventing that same
    // "No tile" crash from the cursor/selection layer.
    //
    // Flag-off and no-session = sync-only, zero regression for single-user.
    const textAccessor = (d: LoroDoc) => getEntryContentText(d, activeIndex)!;
    const syncExtension = LoroSyncPlugin(this.doc, textAccessor);

    if (collabEphemeral && collabUser) {
      return [
        syncExtension,
        ...safeLoroEphemeralPlugin(
          this.doc,
          collabEphemeral,
          collabUser,
          textAccessor,
        ),
      ];
    }

    return syncExtension;
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

    // Signal that a commit is queued so the auto-save status shows "Saving...".
    this._setCommitPending(true);

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
    if (!base) {
      // Nothing to commit; clear the pending flag so the indicator settles.
      this._setCommitPending(false);
      return;
    }
    this._pendingBase = null;

    // [freeze-diag] OBSERVE-ONLY: record this commit tick. No control-flow effect.
    freezeDiagRecordCommit(this._pendingMessage, `${this._owner}/${base.id}`);

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

    // [freeze-diag] OBSERVE-ONLY: count persistNote invocations (running total
    // is reported in the commit-rate warn above). No control-flow effect.
    _freezeDiagPersistNoteCalls++;
    await persistNote(this._owner, this.doc, stampedBase);

    // Commit complete: clear the pending flag so the auto-save indicator
    // settles to "Saved". Only clear if no NEW commit was queued while we
    // were persisting (which would have set a new timer and kept the flag true).
    if (this._pendingTimer === null) {
      this._setCommitPending(false);
    }

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
  // _registerUnsub (Phase 3c chunk 2)
  // ---------------------------------------------------------------------------

  _registerUnsub(unsub: () => void): void {
    this._externalUnsubs.push(unsub);
  }

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

    // Clear the commit-pending subs so callbacks cannot fire after close.
    this._commitPendingSubs = [];
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
  const localDoc = await loadOrRebuild(owner, base);

  // Phase 3c chunk 3a fork fix: for a COLLAB doc the server history is canonical
  // (Option B). Adopt it as the working base instead of merging our locally
  // seeded copy into it. Merging two unrelated op-sets for the same text
  // interleaves ("Connect" -> "Connnectct"); adopting the canonical avoids that.
  // When the server has nothing yet (this client makes the note collaborative
  // first) or the fetch fails, buildCollabBaseDoc returns localDoc unchanged.
  const collabDocId = LORO_PILOT_ENABLED ? getCollabDocId(localDoc) : undefined;
  let doc = localDoc;
  let collabAdopted = false;
  // For a collab doc, adopt the DO's canonical snapshot as the working base
  // (the fork fix, now served by the relay GET /snapshot endpoint, not Neon).
  // No identity needed: the session id derived from the doc id is the
  // capability. Falls back to the local doc when the room is empty or the relay
  // is unreachable, so opening a note is never blocked.
  if (collabDocId) {
    // Pass the base note so buildCollabBaseDoc can detect a revoke (a 401 on a
    // materialized external note) and mark it read-only via the revocation
    // registry. The local copy is kept intact either way (Grant's locked
    // decision: revoke never deletes the recipient's note).
    const adopt = await buildCollabBaseDoc(localDoc, collabDocId, base);
    doc = adopt.doc;
    collabAdopted = adopt.adopted;
  }

  // Set this device's stable peer id on the working doc BEFORE any edit (the
  // external-edit ingest below, and every live keystroke) so changes attribute
  // to a consistent actor. The fixed seed peer (BigInt(0)) stays seed-only;
  // this is the live-edit peer. For an adopted collab doc, future edits append
  // to the canonical history under this peer (no fork).
  doc.setPeerId(getDevicePeerId());

  // External-edit detection at open time (design doc section 7). Skip it for an
  // adopted collab doc: the server canonical IS the truth, there is no separate
  // mirror edit to reconcile.
  if (!collabAdopted) {
    const kind = classifyExternalEdit(doc, base);
    if (kind === "clean" || kind === "unclean") {
      ingestExternalEdit(doc, base, kind);
    }
  }

  const handle = new NoteHandleImpl(doc, owner);
  _handleCache.set(key, handle);

  // Record this device's peer -> identity for version-history attribution.
  // Best-effort, fire-and-forget so the open is not blocked on disk I/O.
  void recordActor(owner, getDevicePeerId(), owner);

  // When the note is collaborative and we adopted the DO canonical, align the
  // local sidecar with it so the next open loads the canonical and never forks
  // again. Edits themselves persist to the DO over the live session (the relay
  // provider sends every local update and pushes full state on connect), so
  // there is no separate server push here. Best-effort, fire-and-forget.
  if (collabDocId && collabAdopted) {
    void persistNote(owner, doc, base);
  }

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
