"use client";

/**
 * use-purchase-presence.ts
 *
 * Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 4 = a SMALL
 * custom live-presence indicator for the actively-edited purchase row. Purchase
 * items are a structured field map with NO CM6 text editor, so we do NOT reuse
 * the loro-codemirror cursor plugin (which keys per-peer cursor entries off CM6
 * selections). Instead we broadcast a tiny presence object over the SAME shared
 * EphemeralStore the collab session already exposes (use-collab-session.ts
 * `ephemeral`), which flows through the relay to the remote peer.
 *
 * Presence payload (one entry per peer, keyed by a dedicated presence key so it
 * never collides with the loro-codemirror `<peerId>-cm-*` keys):
 *   key   = `purchase-presence-<peerIdStr>`
 *   value = { username, itemId, ts }
 *
 * This device WRITES its own entry while a row is open in edit mode, and READS
 * the store to find OTHER peers present on the SAME itemId. The indicator shows
 * only when at least one REMOTE peer is on this item.
 *
 * Lifecycle: broadcast on open, refresh on a heartbeat so the 30s EphemeralStore
 * TTL never lapses, and delete the entry on edit-end / unmount.
 *
 * Flag-off-safe. With PURCHASE_LORO_ENABLED false (or no store / no itemId) this
 * hook broadcasts nothing, reads nothing, and returns an empty peer list. It is a
 * pure no-op, so PurchaseEditor behaves byte-for-byte as today.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { useEffect, useState } from "react";
import type { EphemeralStore } from "loro-crdt";
import type { EphemeralState } from "loro-codemirror";
import { PURCHASE_LORO_ENABLED } from "./config";
import { getDevicePeerId } from "./device-peer";

/** The presence value stored per peer in the EphemeralStore. */
export interface PurchasePresence {
  /** Display name of the editing user. */
  username: string;
  /** The purchase_item id this peer currently has open in edit mode. */
  itemId: number;
  /** Millisecond timestamp of the last broadcast (for freshness / debugging). */
  ts: number;
}

/** A remote peer present on the same item, as surfaced to the indicator. */
export interface RemotePurchasePeer {
  /** Raw Loro peer id string of the remote editor. */
  peerId: string;
  /** Their broadcast presence payload. */
  presence: PurchasePresence;
}

/** The dedicated presence-key prefix (never collides with loro-codemirror keys). */
const PRESENCE_KEY_PREFIX = "purchase-presence-";

/** Heartbeat interval (ms). Comfortably under the 30s EphemeralStore TTL. */
const HEARTBEAT_MS = 10_000;

/**
 * A permissive view of the EphemeralStore. The typed EphemeralStore generic
 * (EphemeralStore<EphemeralState>) models the loro-codemirror cursor keys, not
 * our dynamic presence keys, so we access via this minimal shape (the same
 * pattern use-collab-session.ts uses for its heartbeat).
 */
interface EphemeralView {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  getAllStates(): Record<string, unknown>;
  subscribe(cb: () => void): () => void;
}

/** Narrow an unknown store entry into a PurchasePresence (or null). */
function asPresence(value: unknown): PurchasePresence | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.username !== "string") return null;
  if (typeof v.itemId !== "number") return null;
  if (typeof v.ts !== "number") return null;
  return { username: v.username, itemId: v.itemId, ts: v.ts };
}

/**
 * Own the presence broadcast + read for the open purchase row.
 *
 * @param args.store    The collab session's shared EphemeralStore (or null when
 *                       no session is live / the flag is off).
 * @param args.itemId   The id of the row currently in edit mode, or null.
 * @param args.username This device's display name, broadcast in the payload.
 * @returns             The list of REMOTE peers present on the SAME itemId.
 *                       Empty when flag-off, no store, no item, or solo.
 */
export function usePurchasePresence(args: {
  store: EphemeralStore<EphemeralState> | null;
  itemId: number | null;
  username: string;
}): RemotePurchasePeer[] {
  const { store, itemId, username } = args;

  const [remotePeers, setRemotePeers] = useState<RemotePurchasePeer[]>([]);

  // Broadcast this device's presence while a row is open, refresh on a
  // heartbeat, and delete the entry on edit-end / unmount. Flag-off / no store /
  // no item: every branch returns early, so this effect is a no-op.
  useEffect(() => {
    if (!PURCHASE_LORO_ENABLED) return;
    if (!store || itemId === null) return;

    const view = store as unknown as EphemeralView;
    const myKey = `${PRESENCE_KEY_PREFIX}${getDevicePeerId().toString()}`;

    const broadcast = () => {
      const payload: PurchasePresence = { username, itemId, ts: Date.now() };
      view.set(myKey, payload);
    };

    broadcast();
    const heartbeat = setInterval(broadcast, HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeat);
      // Best-effort removal so the indicator clears on the remote side promptly
      // rather than waiting out the TTL.
      try {
        view.delete(myKey);
      } catch {
        // EphemeralStore may already be destroyed on teardown; ignore.
      }
    };
  }, [store, itemId, username]);

  // Read the store to find OTHER peers present on the SAME itemId. Subscribe so
  // a remote arrival / departure re-renders the indicator. Flag-off / no store /
  // no item: register nothing and clear the list.
  useEffect(() => {
    if (!PURCHASE_LORO_ENABLED) {
      setRemotePeers([]);
      return;
    }
    if (!store || itemId === null) {
      setRemotePeers([]);
      return;
    }

    const view = store as unknown as EphemeralView;
    const myKey = `${PRESENCE_KEY_PREFIX}${getDevicePeerId().toString()}`;

    const recompute = () => {
      const states = view.getAllStates();
      const peers: RemotePurchasePeer[] = [];
      for (const [key, value] of Object.entries(states)) {
        if (!key.startsWith(PRESENCE_KEY_PREFIX)) continue;
        if (key === myKey) continue; // skip this device
        const presence = asPresence(value);
        if (!presence) continue;
        if (presence.itemId !== itemId) continue; // only same-item peers
        peers.push({ peerId: key.slice(PRESENCE_KEY_PREFIX.length), presence });
      }
      setRemotePeers(peers);
    };

    recompute();
    const unsub = view.subscribe(recompute);
    return unsub;
  }, [store, itemId]);

  return remotePeers;
}
