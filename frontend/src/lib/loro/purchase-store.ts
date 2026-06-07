/**
 * purchase-store.ts
 *
 * Open path + handle for a purchase item's Loro doc (docs/proposals/PURCHASE_LORO.md
 * chunk 1). The structured-record analogue of task-store.ts openTaskDoc /
 * TaskDocHandle, deliberately simpler: a purchase item is a FIELD MAP, not text,
 * so there is no CM6 editor binding. The handle just exposes the doc plus the
 * debounced commit / subscribe surface the later read/write wiring chunks need.
 *
 * The collab path is entity-agnostic and reused as-is: getCollabDocId reads the
 * "collab_doc_id" from the doc's meta map (the same key notes and tasks use),
 * and buildCollabBaseDoc adopts the DO canonical. So a shared purchase item's
 * doc auto-connects to the DO exactly like a note or experiment surface, gated
 * by PURCHASE_LORO_ENABLED.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

"use client";

import { LoroDoc } from "loro-crdt";
import {
  loadOrRebuildPurchaseDoc,
  persistPurchaseDoc,
} from "./purchase-sidecar-store";
import { getDevicePeerId } from "./device-peer";
import { PURCHASE_LORO_ENABLED } from "./config";
import { getCollabDocId } from "@/lib/collab/client/doc-id";
import { buildCollabBaseDoc } from "@/lib/collab/client/sync-hooks";

export interface PurchaseDocHandle {
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

class PurchaseDocHandleImpl implements PurchaseDocHandle {
  readonly doc: LoroDoc;
  private readonly _owner: string;
  private readonly _id: number;
  // Carried for shape-parity with TaskDocHandle; persist ignores it.
  private readonly _currentUser?: string;
  private _pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private _pending = false;
  private _flushWaiters: Array<() => void> = [];
  private _externalUnsubs: Array<() => void> = [];
  private _subs: Array<() => void> = [];
  private _docUnsub: (() => void) | null = null;
  private _commitPending = false;
  private _commitPendingSubs: Array<(p: boolean) => void> = [];

  constructor(doc: LoroDoc, owner: string, id: number, currentUser?: string) {
    this.doc = doc;
    this._owner = owner;
    this._id = id;
    this._currentUser = currentUser;
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
    await persistPurchaseDoc(this._owner, this._id, this.doc, this._currentUser);
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

// Module cache so re-renders of the same open purchase item reuse one handle.
const _handleCache = new Map<string, PurchaseDocHandle>();
function cacheKey(owner: string, id: number): string {
  return `${owner}:${id}`;
}

/**
 * Open (or reuse) a Loro handle for a purchase item.
 *
 * Mirrors openTaskDoc: load/rebuild from disk, adopt the DO canonical for a
 * collab doc (the fork fix, entity-agnostic) when PURCHASE_LORO_ENABLED, set
 * this device's peer id, return a handle. When adopted, the local sidecar is
 * re-aligned to the canonical.
 */
export async function openPurchaseDoc(
  owner: string,
  id: number,
  currentUser?: string,
): Promise<PurchaseDocHandle> {
  const key = cacheKey(owner, id);
  const cached = _handleCache.get(key);
  if (cached) return cached;

  const localDoc = await loadOrRebuildPurchaseDoc(owner, id, currentUser);

  const collabDocId = PURCHASE_LORO_ENABLED ? getCollabDocId(localDoc) : undefined;
  let doc = localDoc;
  let adopted = false;
  if (collabDocId) {
    const result = await buildCollabBaseDoc(localDoc, collabDocId);
    doc = result.doc;
    adopted = result.adopted;
  }

  doc.setPeerId(getDevicePeerId());

  const handle = new PurchaseDocHandleImpl(doc, owner, id, currentUser);
  _handleCache.set(key, handle);

  if (collabDocId && adopted) {
    // Align the local sidecar with the adopted canonical so the next open loads
    // it and never forks again. Best-effort.
    void persistPurchaseDoc(owner, id, doc, currentUser);
  }

  return handle;
}

/** Test/teardown helper: drop a handle from the cache. */
export function _evictPurchaseDoc(owner: string, id: number): void {
  _handleCache.delete(cacheKey(owner, id));
}
