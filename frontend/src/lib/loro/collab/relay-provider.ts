// Loro Phase 3 collab provider (storage-migration phase 1, chunk 2).
//
// PURPOSE. loro-codemirror handles doc<->editor binding but does NOT include any
// network layer. This module IS that network layer. It wires a local LoroDoc +
// EphemeralStore to an injected CollabTransport by:
//   - Subscribing to doc.subscribeLocalUpdates and ephemeral.subscribeLocalUpdates
//     to send every outgoing update as a typed plaintext frame.
//   - Installing transport.onMessage to route inbound frames: doc updates via
//     doc.import, cursor/presence via ephemeral.apply.
//   - Pushing the local doc state on transport.onOpen so the Durable Object
//     persists and fans it out (and so a brand-new room gets seeded).
//
// PLAINTEXT (Option B). Collab updates travel as plaintext over TLS, not sealed
// frames. The relay Durable Object is the canonical, server-readable store (see
// docs/proposals/COLLAB_STORAGE_D1_DO_MIGRATION.md), so it needs to read the
// Loro bytes to persist and compact them. The E2E envelope (envelope.ts) is no
// longer used by collab. Private, unshared notes never reach the relay at all.
//
// WIRE PROTOCOL (must match relay/src/worker.ts): binary frames whose first byte
// is the type tag: 0x01 doc update (persisted + fanned out), 0x02 ephemeral
// (fanned out only, never persisted). The DO sends its catch-up snapshot as a
// 0x01 frame on connect.
//
// ECHO LOOP GUARD. doc.subscribeLocalUpdates fires on local edits only, not on
// doc.import of remote updates (the canonical Loro two-way-sync pattern). Same
// for EphemeralStore.subscribeLocalUpdates vs .apply. We rely on this and do NOT
// add an "applying remote" suppression flag.
//
// React-free. No storage. No DOM.

import { LoroDoc, EphemeralStore } from "loro-crdt";

// ---------------------------------------------------------------------------
// Wire protocol type tags. MUST match relay/src/worker.ts.
// ---------------------------------------------------------------------------

const MSG_DOC_UPDATE = 0x01;
const MSG_EPHEMERAL = 0x02;
// DO -> client: durable persistence is paused (cost breaker tripped, the per-doc
// write throttle was hit, or the doc is at its size cap). Live fan-out continues
// and every edit stays safe in the local Loro doc, so this is a soft, transient
// state. Payload is a short ASCII reason ("paused" | "throttled" | "full").
const MSG_SYNC_BLOCKED = 0x03;

/** Prepend the one-byte type tag to a payload. */
function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.byteLength + 1);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

// ---------------------------------------------------------------------------
// [freeze-diag] OBSERVE-ONLY relay-rate instrumentation (2026-06-18).
//
// Diagnostic for a reported ~90s main-thread freeze in the Loro Lab Notes
// editor on prod. The relay path is a prime suspect: notebook notes auto-mint a
// collab_doc_id, so a relay provider runs on prod that demo/OPFS never does.
// This adds pure per-provider counters + a throttled console.warn around the
// inbound MSG_DOC_UPDATE handler and doc.getAllChanges(). It introduces NO
// throttling/debouncing/early-return and does not change a single sync path; it
// only logs when the per-second rate exceeds ~20 (never reached in normal use).
//
// changeCount is the TOTAL number of changes across all peers (summing the
// already-materialized change arrays is O(peers), not O(total changes), so the
// counter itself does not add the cost we are hunting). It tells us whether the
// freeze scales with the total change count, i.e. an O(total changes) traversal.
// ---------------------------------------------------------------------------
/** Sum change counts across peers in a getAllChanges() result. O(peers). */
function freezeDiagTotalChanges(
  allChanges: Map<unknown, { length: number }[]>,
): number {
  let n = 0;
  for (const changes of allChanges.values()) n += changes.length;
  return n;
}

// ---------------------------------------------------------------------------
// CollabTransport interface.
// ---------------------------------------------------------------------------

/**
 * A thin transport abstraction the provider uses. websocket-transport.ts wraps
 * a real WebSocket into this shape. The provider never references WebSocket
 * directly, which keeps the unit tests free of any network dependency.
 *
 * Lifecycle contract:
 *   - send() is called only while the transport is open; the implementation
 *     may queue or discard silently if called before open.
 *   - onMessage / onOpen are called once each by the provider at construction
 *     to register its callbacks; the transport invokes those callbacks as
 *     events arrive.
 *   - close() tears down the underlying connection.
 */
export interface CollabTransport {
  send(frame: Uint8Array): void;
  onMessage(cb: (frame: Uint8Array) => void): void;
  onOpen(cb: () => void): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// CollabProviderOptions.
// ---------------------------------------------------------------------------

export interface CollabProviderOptions {
  /** The local Loro document to sync. */
  doc: LoroDoc;
  /** The EphemeralStore carrying cursor/presence data (loro-codemirror drives it). */
  ephemeral: EphemeralStore;
  /** The transport that carries plaintext frames to/from the relay. */
  transport: CollabTransport;
  /**
   * [freeze-diag] OPTIONAL, observe-only: the collab session/doc id, used solely
   * to label the diagnostic console.warn lines so a reproduced freeze names the
   * exact note. Has no effect on sync behavior; omitted in unit tests.
   */
  docId?: string;
  /**
   * Called the FIRST TIME a remote peer's doc commit arrives via doc.import.
   *
   * Receives the Loro PeerID string so the caller can record the peer ->
   * identity mapping in the actors map (version-history attribution). Fires at
   * most once per remote peer per provider instance. Best-effort: errors from
   * this callback are caught and logged.
   *
   * NOTE: plaintext frames carry no per-frame sender identity (unlike the old
   * sealed envelope), so the caller resolves the human name from its own
   * context (the invited collaborator's username) or falls back to the peer id.
   */
  onFirstRemotePeer?: (peerId: string) => void;
  /**
   * Called when the relay reports durable persistence is paused (cost breaker,
   * the per-doc write throttle, or the doc size cap). The reason is a short
   * ASCII code ("paused" | "throttled" | "full"). Live fan-out continues and the
   * edit stays in the local doc, so this is informational; the caller surfaces a
   * quiet indicator. React-land wires this to the sync-status store.
   */
  onSyncBlocked?: (reason: string) => void;
}

// ---------------------------------------------------------------------------
// createCollabProvider.
// ---------------------------------------------------------------------------

export interface CollabProvider {
  /** Unsubscribe from doc/ephemeral and close the transport. */
  destroy(): void;
}

/**
 * Wire a local LoroDoc + EphemeralStore to a CollabTransport using the plaintext
 * typed protocol the relay Durable Object speaks.
 *
 * Subscribes to local updates, installs the inbound message handler, and pushes
 * the local doc state when the transport connects so the DO persists + fans it
 * (and a fresh room gets seeded).
 *
 * Returns a handle whose destroy() cleans up all subscriptions and closes the
 * transport. Call destroy() when the collab session ends.
 */
export function createCollabProvider(opts: CollabProviderOptions): CollabProvider {
  const { doc, ephemeral, transport, onFirstRemotePeer, onSyncBlocked } = opts;

  // [freeze-diag] OBSERVE-ONLY per-provider relay-rate counters. Sliding 1000ms
  // windows of inbound MSG_DOC_UPDATE frames and getAllChanges() calls, with a
  // throttled warn. No effect on sync; see the freeze-diag note above frame().
  const freezeDiagId = opts.docId ?? doc.peerIdStr;
  const freezeDiagInbound: number[] = [];
  const freezeDiagGac: number[] = [];
  let freezeDiagLastWarn = 0;
  let freezeDiagLastChangeCount = 0;
  const freezeDiagMaybeWarn = (): void => {
    if (typeof performance === "undefined") return;
    const now = performance.now();
    while (freezeDiagInbound.length > 0 && now - freezeDiagInbound[0] > 1000) {
      freezeDiagInbound.shift();
    }
    while (freezeDiagGac.length > 0 && now - freezeDiagGac[0] > 1000) {
      freezeDiagGac.shift();
    }
    if (
      (freezeDiagInbound.length > 20 || freezeDiagGac.length > 20) &&
      now - freezeDiagLastWarn > 500
    ) {
      freezeDiagLastWarn = now;
      console.warn(
        `[freeze-diag] relay inbound ${freezeDiagInbound.length}/s, ` +
          `getAllChanges ${freezeDiagGac.length}/s, ` +
          `changeCount=${freezeDiagLastChangeCount}; docId=${freezeDiagId}`,
      );
    }
  };

  // Track which remote peer IDs we have already reported so the callback fires
  // at most once per peer per provider instance.
  const reportedRemotePeers = new Set<string>();

  // The local peer's own PeerID string. Remote peers have different IDs.
  const localPeerIdStr: string = doc.peerIdStr;

  // Subscribe to local doc commits. Every local edit produces incremental update
  // bytes; we frame and send them as plaintext doc updates.
  const unsubDoc = doc.subscribeLocalUpdates((bytes: Uint8Array) => {
    transport.send(frame(MSG_DOC_UPDATE, bytes));
  });

  // Subscribe to local ephemeral changes (cursor, presence). Sent as ephemeral
  // frames; the relay fans them out but never persists them.
  const unsubEphemeral = ephemeral.subscribeLocalUpdates((bytes: Uint8Array) => {
    transport.send(frame(MSG_EPHEMERAL, bytes));
  });

  // Handle inbound frames from the relay (peer updates and the DO's catch-up).
  transport.onMessage((rawFrame: Uint8Array) => {
    if (rawFrame.byteLength === 0) return;
    const type = rawFrame[0];
    const payload = rawFrame.subarray(1);

    if (type === MSG_DOC_UPDATE) {
      // [freeze-diag] OBSERVE-ONLY: count this inbound doc-update frame.
      if (typeof performance !== "undefined") {
        freezeDiagInbound.push(performance.now());
      }

      // Snapshot the known peer ids BEFORE the import so we can detect a
      // genuinely new remote peer (for version-history attribution).
      // [freeze-diag] reuse the single getAllChanges() result for both the
      // peer-id set (existing behavior) and the observe-only change-count
      // counter; this is the same one call, not an added traversal.
      let knownPeersBefore: Set<string> | null = null;
      if (onFirstRemotePeer) {
        const allChanges = doc.getAllChanges();
        knownPeersBefore = new Set<string>(allChanges.keys());
        if (typeof performance !== "undefined") {
          freezeDiagGac.push(performance.now());
          freezeDiagLastChangeCount = freezeDiagTotalChanges(
            allChanges as unknown as Map<unknown, { length: number }[]>,
          );
        }
      }
      freezeDiagMaybeWarn();

      // CRDT-merge the remote update. Idempotent; does NOT fire our own
      // subscribeLocalUpdates. A malformed/corrupt frame makes doc.import throw,
      // so guard it and drop the bad frame rather than crash the session (the
      // relay is server-readable, not E2E, so this is integrity hygiene, not an
      // attacker channel).
      let status;
      try {
        status = doc.import(payload);
      } catch {
        return;
      }

      if (onFirstRemotePeer && knownPeersBefore !== null) {
        for (const [peerId] of status.success) {
          if (peerId === localPeerIdStr) continue;
          if (knownPeersBefore.has(peerId)) continue;
          if (reportedRemotePeers.has(peerId)) continue;
          reportedRemotePeers.add(peerId);
          try {
            onFirstRemotePeer(peerId);
          } catch (err) {
            console.warn("[relay-provider] onFirstRemotePeer callback threw:", err);
          }
        }
      }
    } else if (type === MSG_EPHEMERAL) {
      // Deliver cursor/presence bytes to the local ephemeral store. Guard
      // against a malformed frame the same way as doc updates.
      try {
        ephemeral.apply(payload);
      } catch {
        // Drop the bad ephemeral frame.
      }
    } else if (type === MSG_SYNC_BLOCKED) {
      // Durable persistence is paused server-side (breaker / throttle / doc cap).
      // The edit is safe in the local Loro doc and live fan-out still works, so
      // this is informational only. TODO(account-setup-revamp): surface a quiet
      // "sync paused" indicator. For now, log it so the state is observable.
      let reason = "blocked";
      try {
        reason = new TextDecoder().decode(payload) || reason;
      } catch {
        // keep the default
      }
      try {
        onSyncBlocked?.(reason);
      } catch {
        // a misbehaving callback must never break the message loop
      }
    }
    // Unknown type tags are ignored (forward-compatibility).
  });

  // On connect, push our local doc state so the DO persists it and fans it to
  // peers. The DO independently sends its own canonical snapshot back as a
  // catch-up frame, so both directions converge. Loro merges are idempotent, so
  // re-sending already-known ops is safe and cheap.
  transport.onOpen(() => {
    // [freeze-diag] OBSERVE-ONLY: one line per relay session open so a
    // reproduced freeze confirms whether the frozen note even had a relay
    // session. Not throttled (fires at most once per connect). No behavior change.
    console.warn(`[freeze-diag] relay session opened for docId=${freezeDiagId}`);
    transport.send(frame(MSG_DOC_UPDATE, doc.export({ mode: "update" })));
  });

  return {
    destroy() {
      unsubDoc();
      unsubEphemeral();
      transport.close();
    },
  };
}
