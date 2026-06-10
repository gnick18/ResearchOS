/**
 * datahub-store.ts
 *
 * Open path plus handle for a Data Hub document's Loro doc, the grid analogue of
 * purchase-store.ts openPurchaseDoc / PurchaseDocHandle. The handle exposes the
 * doc plus the debounced commit / flush / subscribe / close surface the later
 * read / write wiring chunks (and the eventual UI) will consume.
 *
 * The collab path is entity-agnostic and reused as-is: getCollabDocId reads the
 * "collab_doc_id" key from the doc's meta map (the same key notes / tasks /
 * purchases use), and buildCollabBaseDoc adopts the DO canonical. A shared Data
 * Hub document auto-connects to the DO exactly like a note, gated by the local
 * DATAHUB_LORO_COLLAB_ENABLED flag. Keeping the flag local (not in the shared
 * loro/config.ts) keeps this Phase 0 strictly new-files-only; the flag moves
 * into config.ts when the collab wiring chunk lands.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

"use client";

import { LoroDoc } from "loro-crdt";
import {
  loadOrRebuildDataHubDoc,
  persistDataHubDoc,
} from "./datahub-sidecar-store";
import { getDevicePeerId } from "./device-peer";
import { getCollabDocId } from "@/lib/collab/client/doc-id";
import { buildCollabBaseDoc } from "@/lib/collab/client/sync-hooks";

/**
 * Whether a shared Data Hub document adopts the DO canonical on open. Default
 * OFF and local to this module (Phase 0 is new-files-only). Mirrors the role
 * PURCHASE_LORO_ENABLED plays for openPurchaseDoc. Moves into loro/config.ts when
 * the collab wiring chunk lands.
 */
export const DATAHUB_LORO_COLLAB_ENABLED = false;

export interface DataHubDocHandle {
  readonly doc: LoroDoc;
  /** Debounced persist (~600 ms trailing edge). */
  commit(): Promise<void>;
  flush(): Promise<void>;
  subscribe(cb: () => void): () => void;
  _registerUnsub(unsub: () => void): void;
  close(): Promise<void>;
  readonly commitPending: boolean;
  subscribeCommitPending(cb: (pending: boolean) => void): () => void;
}

class DataHubDocHandleImpl implements DataHubDocHandle {
  readonly doc: LoroDoc;
  private readonly _owner: string;
  private readonly _id: string;
  private _pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private _pending = false;
  private _flushWaiters: Array<() => void> = [];
  private _externalUnsubs: Array<() => void> = [];
  private _subs: Array<() => void> = [];
  private _docUnsub: (() => void) | null = null;
  private _commitPending = false;
  private _commitPendingSubs: Array<(p: boolean) => void> = [];

  constructor(doc: LoroDoc, owner: string, id: string) {
    this.doc = doc;
    this._owner = owner;
    this._id = id;
  }

  private _setCommitPending(v: boolean): void {
    if (this._commitPending === v) return;
    this._commitPending = v;
    for (const cb of this._commitPendingSubs) cb(v);
  }
  get commitPending(): boolean {
    return this._commitPending;
  }
  subscribeCommitPending(cb: (pending: boolean) => void): () => void {
    cb(this._commitPending);
    this._commitPendingSubs.push(cb);
    return () => {
      this._commitPendingSubs = this._commitPendingSubs.filter((c) => c !== cb);
    };
  }

  async commit(): Promise<void> {
    this._pending = true;
    if (this._pendingTimer !== null) clearTimeout(this._pendingTimer);
    this._setCommitPending(true);
    this._pendingTimer = setTimeout(() => {
      void this._runCommit();
    }, 600);
  }

  async flush(): Promise<void> {
    if (this._pendingTimer === null && !this._pending) return;
    if (this._pendingTimer !== null) {
      clearTimeout(this._pendingTimer);
      this._pendingTimer = null;
    }
    await this._runCommit();
  }

  private async _runCommit(): Promise<void> {
    this._pendingTimer = null;
    if (!this._pending) {
      this._setCommitPending(false);
      return;
    }
    this._pending = false;
    // Loro buffers ops until commit(); flush them before exporting the snapshot.
    this.doc.commit();
    await persistDataHubDoc(this._owner, this._id, this.doc);
    if (this._pendingTimer === null) this._setCommitPending(false);
    const waiters = this._flushWaiters;
    this._flushWaiters = [];
    for (const resolve of waiters) resolve();
  }

  subscribe(cb: () => void): () => void {
    if (this._docUnsub === null) {
      this._docUnsub = this.doc.subscribe(() => {
        for (const s of this._subs) s();
      });
    }
    this._subs.push(cb);
    return () => {
      this._subs = this._subs.filter((c) => c !== cb);
      if (this._subs.length === 0 && this._docUnsub) {
        this._docUnsub();
        this._docUnsub = null;
      }
    };
  }

  _registerUnsub(unsub: () => void): void {
    this._externalUnsubs.push(unsub);
  }

  async close(): Promise<void> {
    await this.flush();
    for (const u of this._externalUnsubs) {
      try {
        u();
      } catch {
        // best-effort teardown
      }
    }
    this._externalUnsubs = [];
    if (this._docUnsub) {
      this._docUnsub();
      this._docUnsub = null;
    }
    _handleCache.delete(cacheKey(this._owner, this._id));
  }
}

// Module cache so re-renders of the same open document reuse one handle.
const _handleCache = new Map<string, DataHubDocHandle>();
function cacheKey(owner: string, id: string): string {
  return `${owner}:${id}`;
}

/**
 * Open (or reuse) a Loro handle for a Data Hub document.
 *
 * Mirrors openPurchaseDoc: load / rebuild from disk, adopt the DO canonical for
 * a collab doc (the fork fix, entity-agnostic) when DATAHUB_LORO_COLLAB_ENABLED,
 * set this device's peer id, return a handle. When adopted, the local sidecar is
 * re-aligned to the canonical.
 */
export async function openDataHubDoc(
  owner: string,
  id: string,
): Promise<DataHubDocHandle> {
  const key = cacheKey(owner, id);
  const cached = _handleCache.get(key);
  if (cached) return cached;

  const localDoc = await loadOrRebuildDataHubDoc(owner, id);

  const collabDocId = DATAHUB_LORO_COLLAB_ENABLED
    ? getCollabDocId(localDoc)
    : undefined;
  let doc = localDoc;
  let adopted = false;
  if (collabDocId) {
    const result = await buildCollabBaseDoc(localDoc, collabDocId);
    doc = result.doc;
    adopted = result.adopted;
  }

  doc.setPeerId(getDevicePeerId());

  const handle = new DataHubDocHandleImpl(doc, owner, id);
  _handleCache.set(key, handle);

  if (collabDocId && adopted) {
    // Align the local sidecar with the adopted canonical so the next open loads
    // it and never forks again. Best-effort.
    void persistDataHubDoc(owner, id, doc);
  }

  return handle;
}

/** Test / teardown helper: drop a handle from the cache. */
export function _evictDataHubDoc(owner: string, id: string): void {
  _handleCache.delete(cacheKey(owner, id));
}
