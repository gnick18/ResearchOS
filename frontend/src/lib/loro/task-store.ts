/**
 * task-store.ts
 *
 * Open path + handle for a task's markdown-surface Loro docs (experiment
 * collab chunk 1). The task analogue of store.ts openNote / NoteHandleImpl,
 * deliberately simpler: a task surface is a SINGLE markdown text, so there are
 * no entries, no JSON-mirror projection, no metadata sync. The editor binds to
 * the doc's "content" text; persist writes the .loro sidecar + the .md mirror.
 *
 * The collab path is entity-agnostic and reused as-is: getCollabDocId reads the
 * "collab_doc_id" from the doc's meta map (same key notes use), and
 * buildCollabBaseDoc adopts the DO canonical. So a shared experiment's Lab
 * Notes doc auto-connects to the DO exactly like a note.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

"use client";

import { LoroDoc, type EphemeralStore } from "loro-crdt";
import {
  LoroSyncPlugin,
  type UserState,
  type EphemeralState,
} from "loro-codemirror";
import type { Extension } from "@codemirror/state";
import {
  loadOrRebuildTaskDoc,
  persistTaskDoc,
  type TaskMarkdownSurface,
  type TaskRef,
} from "./task-sidecar-store";
import { getTaskContent } from "./task-doc";
import { getDevicePeerId } from "./device-peer";
import { safeLoroEphemeralPlugin } from "./collab/safe-ephemeral-plugin";
import { LORO_PILOT_ENABLED } from "./config";
import { getCollabDocId } from "@/lib/collab/client/doc-id";
import { buildCollabBaseDoc } from "@/lib/collab/client/sync-hooks";

export interface TaskDocHandle {
  readonly doc: LoroDoc;
  /**
   * CM6 extension that binds Loro to the editor. `activeIndex` is accepted for
   * shape-compatibility with the note editor wiring but ignored (a task surface
   * is a single text). LoroEphemeralPlugin (cursors) is added only with a live
   * collab session.
   */
  bindEditorExtension(
    activeIndex: number,
    collabEphemeral?: EphemeralStore<EphemeralState>,
    collabUser?: UserState,
  ): Extension;
  /** Debounced persist (~600 ms trailing edge). */
  commit(): Promise<void>;
  flush(): Promise<void>;
  subscribe(cb: () => void): () => void;
  _registerUnsub(unsub: () => void): void;
  close(): Promise<void>;
  readonly commitPending: boolean;
  subscribeCommitPending(cb: (pending: boolean) => void): () => void;
  /**
   * Read the seed markdown for the editor. The index is accepted for
   * shape-compatibility with the note editor (which seeds per entry) but
   * ignored here, since a task surface is a single text. Lets the shared
   * EditorLoroHandle seed a task surface from its "content" text.
   */
  editorSeedText(activeIndex: number): string;
}

class TaskDocHandleImpl implements TaskDocHandle {
  readonly doc: LoroDoc;
  private readonly _task: TaskRef;
  private readonly _which: TaskMarkdownSurface;
  // Carried so persist resolves the SAME on-disk base the open used (legacy
  // global vs per-user), keeping the `.loro` sidecar + `.md` mirror co-located.
  private readonly _currentUser?: string;
  private _pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private _pending = false;
  private _flushWaiters: Array<() => void> = [];
  private _externalUnsubs: Array<() => void> = [];
  private _subs: Array<() => void> = [];
  private _docUnsub: (() => void) | null = null;
  private _commitPending = false;
  private _commitPendingSubs: Array<(p: boolean) => void> = [];

  constructor(
    doc: LoroDoc,
    task: TaskRef,
    which: TaskMarkdownSurface,
    currentUser?: string,
  ) {
    this.doc = doc;
    this._task = task;
    this._which = which;
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

  bindEditorExtension(
    _activeIndex: number,
    collabEphemeral?: EphemeralStore<EphemeralState>,
    collabUser?: UserState,
  ): Extension {
    const textAccessor = (d: LoroDoc) => getTaskContent(d);
    const syncExtension = LoroSyncPlugin(this.doc, textAccessor);
    if (collabEphemeral && collabUser) {
      return [
        syncExtension,
        ...safeLoroEphemeralPlugin(this.doc, collabEphemeral, collabUser, textAccessor),
      ];
    }
    return syncExtension;
  }

  editorSeedText(_activeIndex: number): string {
    return getTaskContent(this.doc).toString();
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
    await persistTaskDoc(this._task, this._which, this.doc, this._currentUser);
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
    _handleCache.delete(cacheKey(this._task, this._which));
  }
}

// Module cache so re-renders of the same open task surface reuse one handle.
const _handleCache = new Map<string, TaskDocHandle>();
function cacheKey(task: TaskRef, which: TaskMarkdownSurface): string {
  return `${task.owner}:${task.id}:${which}`;
}

/**
 * Open (or reuse) a Loro handle for a task's markdown surface.
 *
 * Mirrors openNote: load/rebuild from disk, adopt the DO canonical for a collab
 * doc (the fork fix, entity-agnostic), set this device's peer id, return a
 * handle. When adopted, the local sidecar is re-aligned to the canonical.
 */
export async function openTaskDoc(
  task: TaskRef,
  which: TaskMarkdownSurface,
  currentUser?: string,
): Promise<TaskDocHandle> {
  const key = cacheKey(task, which);
  const cached = _handleCache.get(key);
  if (cached) return cached;

  const localDoc = await loadOrRebuildTaskDoc(task, which, currentUser);

  const collabDocId = LORO_PILOT_ENABLED ? getCollabDocId(localDoc) : undefined;
  let doc = localDoc;
  let adopted = false;
  if (collabDocId) {
    const result = await buildCollabBaseDoc(localDoc, collabDocId);
    doc = result.doc;
    adopted = result.adopted;
  }

  doc.setPeerId(getDevicePeerId());

  const handle = new TaskDocHandleImpl(doc, task, which, currentUser);
  _handleCache.set(key, handle);

  if (collabDocId && adopted) {
    // Align the local sidecar with the adopted canonical so the next open loads
    // it and never forks again. Best-effort.
    void persistTaskDoc(task, which, doc, currentUser);
  }

  return handle;
}

/** Test/teardown helper: drop a handle from the cache. */
export function _evictTaskDoc(task: TaskRef, which: TaskMarkdownSurface): void {
  _handleCache.delete(cacheKey(task, which));
}
