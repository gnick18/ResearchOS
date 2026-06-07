"use client";

/**
 * use-purchase-row-loro.ts
 *
 * Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 2 = READ +
 * CONNECT wiring for the SINGLE actively-edited purchase row. This is the
 * lightweight live model Grant locked. Lists stay on React Query off the .json
 * mirror (SharedFolderAutoRefresh invalidates them on any data-folder change),
 * so the only new relay plumbing is one live subscription scoped to the row the
 * user has open in the row-draft editor.
 *
 * Lifecycle, mirroring the NoteDetailPopup open-handle + auto-connect pattern:
 *   - When a row enters edit mode (itemId becomes non-null) AND
 *     PURCHASE_LORO_ENABLED, open that item's Loro handle via openPurchaseDoc,
 *     mint + adopt its collab_doc_id (so the row joins the in-lab open-access
 *     relay room), and persist so the sidecar carries the id (NOT the .json).
 *   - useCollabSession auto-connects on the handle's doc once it is open.
 *   - Subscribe to the handle so a REMOTE change to this item refreshes the
 *     cached underlying item (the ["purchases", taskId, owner] query) WITHOUT
 *     clobbering the user's in-progress draft (the merge-at-save is chunk 3).
 *   - On edit end (itemId back to null) close the handle and end the session.
 *
 * Flag-off-safe. With PURCHASE_LORO_ENABLED false this hook opens no handle,
 * starts no session, and registers no subscription. It is a pure no-op, so
 * PurchaseEditor behaves byte-for-byte as today.
 *
 * Chunk 2 is READ + CONNECT only. Field edits and pi-actions approval writes
 * still go through purchasesApi.update / pi-actions as today; routing those
 * through the doc is chunk 3.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { EphemeralStore } from "loro-crdt";
import type { EphemeralState } from "loro-codemirror";
import { PURCHASE_LORO_ENABLED } from "./config";
import { openPurchaseDoc, type PurchaseDocHandle } from "./purchase-store";
import { getOrMintCollabDocId, getCollabDocId } from "@/lib/collab/client/doc-id";
import { useCollabSession } from "./collab/use-collab-session";

export interface PurchaseRowLoroState {
  /** The open handle for the editing row, or null when none is open / flag off. */
  handle: PurchaseDocHandle | null;
  /**
   * True while the flag is on and the handle for the current editing row is
   * still being opened (the loading gate, mirroring NoteDetailPopup loroOpening).
   * The editor should read its initial field values from the Loro projection
   * only once this is false and a handle is present, falling back to the .json
   * item otherwise.
   */
  opening: boolean;
  /**
   * The live session's shared EphemeralStore, exposed so the presence hook
   * (use-purchase-presence.ts) can broadcast + read this row's live presence
   * over the relay. Null when the flag is off (the collab session stays idle).
   * Chunk 4 presence indicator.
   */
  ephemeral: EphemeralStore<EphemeralState> | null;
}

/**
 * Own the open-row Loro handle + live session for the purchase row editor.
 *
 * @param args.itemId   The id of the row currently in edit mode, or null.
 * @param args.owner    The purchase item's FOLDER owner (the path the sidecar
 *                       lives under). In lab mode this is `username`; in
 *                       self mode it is the current user. Used by openPurchaseDoc.
 * @param args.taskId   The parent task id, used to target the row's cached query.
 * @param args.queryUsername The EXACT `username` value the editor's
 *                       ["purchases", taskId, username] query key uses (undefined
 *                       in self mode). Kept distinct from `owner` so the cache
 *                       invalidation matches the live query key byte-for-byte.
 * @param args.currentUser The signed-in user (for adopt / attribution parity).
 */
export function usePurchaseRowLoro(args: {
  itemId: number | null;
  owner: string;
  taskId: number;
  queryUsername?: string;
  currentUser?: string;
}): PurchaseRowLoroState {
  const { itemId, owner, taskId, queryUsername, currentUser } = args;
  const queryClient = useQueryClient();

  const [handle, setHandle] = useState<PurchaseDocHandle | null>(null);
  const [opening, setOpening] = useState(false);

  // useCollabSession is unconditionally called (Rules of Hooks) but stays
  // permanently idle when PURCHASE_LORO_ENABLED is false or the handle is null.
  const collab = useCollabSession({
    doc: handle?.doc ?? null,
    enabled: PURCHASE_LORO_ENABLED,
    owner: owner || currentUser || undefined,
    collaboratorUsername: currentUser ?? undefined,
  });

  // Keep the latest collab api in a ref so the open/close effect does not need
  // collab in its dep list (the api object is recreated each render; depending
  // on it would tear the handle down on every render). connectFromDocId and
  // stop are stable useCallbacks internally.
  const collabRef = useRef(collab);
  collabRef.current = collab;

  // Open the handle when a row enters edit mode; close it when the row leaves
  // edit mode (or the component unmounts / the item identity changes). Flag-off,
  // every branch returns early, so this effect is a no-op.
  useEffect(() => {
    if (!PURCHASE_LORO_ENABLED) return;
    if (itemId === null) return;

    let active = true;
    setOpening(true);

    void (async () => {
      try {
        const h = await openPurchaseDoc(owner, itemId, currentUser);
        if (!active) {
          // The row was closed (or changed) before the open resolved. Tear the
          // freshly-opened handle down so it does not linger in the cache.
          void h.close();
          return;
        }

        // Mint + adopt the collab doc id so this row joins a relay room. In-lab
        // the relay is open-access, so no server grant is needed. The id lives
        // in the .loro meta map (getOrMintCollabDocId writes it there), NOT in
        // the .json record. Persist after minting so the sidecar carries it.
        // Mint the collab doc id into the .loro meta (side effect) so the
        // connect effect below reads a real id. The actual connectFromDocId is
        // deliberately NOT called here: at this synchronous point
        // useCollabSession has not yet re-rendered with the new handle.doc, so
        // its connectFromDocId closure still sees doc === null and would
        // early-return without ever opening the relay socket. The dedicated
        // connect effect (keyed on the handle landing in state) fires after the
        // doc prop propagates, exactly like NoteDetailPopup.
        getOrMintCollabDocId(h.doc);
        await h.flush();

        if (!active) {
          void h.close();
          return;
        }

        setHandle(h);
        setOpening(false);
      } catch (err) {
        console.error("[usePurchaseRowLoro] openPurchaseDoc failed:", err);
        if (active) setOpening(false);
      }
    })();

    return () => {
      active = false;
      // End the live session and close the handle on edit end.
      collabRef.current.stop();
      setHandle((prev) => {
        if (prev) void prev.close();
        return null;
      });
      setOpening(false);
    };
    // Keyed on the editing item identity + owner only (one handle per open row).
    // collab is intentionally excluded (read via collabRef) so the handle is not
    // torn down on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, owner, currentUser]);

  // Auto-connect the live relay session once the handle has LANDED IN STATE.
  // This must run from its own effect, not synchronously inside the open path,
  // because connectFromDocId early-returns while useCollabSession's doc prop is
  // still null (it only becomes handle.doc on the render after setHandle). By
  // the time this effect runs the doc has propagated, so connectFromDocId opens
  // the socket. Gated on status "idle" so it connects once per open row and does
  // not reconnect on every status transition. Mirrors NoteDetailPopup exactly.
  // Flag-off / no-handle, it returns early and connects nothing.
  useEffect(() => {
    if (!PURCHASE_LORO_ENABLED) return;
    if (!handle) return;
    if (collab.state.status !== "idle") return;
    const docId = getCollabDocId(handle.doc);
    if (!docId) return;
    collab.connectFromDocId(docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, collab.state.status]);

  // Live read. When a REMOTE change arrives on the open row's doc, refresh the
  // cached underlying item so the row reflects the remote value. We invalidate
  // (not patch) the ["purchases", taskId, owner] query, the same key the
  // editor's list read uses. This keeps the CACHED item fresh; it does NOT
  // touch the user's in-progress editingRow draft (the merge-at-save is chunk
  // 3). Flag-off / no-handle, the effect returns early and registers nothing.
  useEffect(() => {
    if (!PURCHASE_LORO_ENABLED) return;
    if (!handle) return;

    const unsub = handle.subscribe(() => {
      // Refetch only the row's task-scoped query. The editor keeps the local
      // draft authoritative for the open row, so this never clobbers what the
      // user is typing; it just keeps the underlying source-of-truth current.
      void queryClient.invalidateQueries({
        queryKey: ["purchases", taskId, queryUsername],
      });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, taskId, queryUsername, queryClient]);

  // Expose the session's shared EphemeralStore for the presence hook ONLY when
  // the flag is on (flag-off the session stays permanently idle, so there is no
  // live store to broadcast over and presence must be a pure no-op).
  const ephemeral = PURCHASE_LORO_ENABLED ? collab.ephemeral : null;

  return { handle, opening, ephemeral };
}
