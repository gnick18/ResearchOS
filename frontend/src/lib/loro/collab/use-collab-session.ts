"use client";

// Loro Phase 3, chunk 4: React hook owning the collab session lifecycle.
// Updated in chunk 5a: EphemeralStore is now a real shared instance, not a
// throwaway, so live-cursor data produced by LoroEphemeralPlugin flows through
// the relay to the remote peer.
//
// PURPOSE. Keeps NoteDetailPopup thin. This hook manages:
//   - start(): generate a sessionId + key, open the WebSocket transport to the
//     relay, wire the relay provider, expose a copy-able join link.
//   - join(link): decode a pasted link and connect to that session.
//   - stop(): destroy the provider and close the transport.
//
// CRYPTO. We load the local Ed25519 identity from IndexedDB (loadIdentity).
// For the two-tab MVP both tabs are the same user, so BOTH sides sign with the
// same key and expectedPeerEd25519PublicKey is left undefined (accept any valid
// signed frame from our own key). A later chunk adds X25519 key-wrapping and
// pins the peer's key from the directory invite.
//
// EPHEMERAL. One EphemeralStore<EphemeralState> is created per hook instance
// (not per connect call) and exposed on the return value. Both the relay
// provider AND the editor's LoroEphemeralPlugin receive the SAME instance, so
// cursor data produced locally by CM6 is relayed to the remote peer.
//
// STATUS TRANSITIONS.
//   idle -> connecting (start/join called)
//   connecting -> live (WebSocket opened)
//   live -> stopped (stop called)
//   Any error during connect stays at stopped (with an error note in the
//   console; we could surface a fine-grained error string but the MVP doesn't
//   need it).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";
import { LoroDoc, EphemeralStore } from "loro-crdt";
import type { EphemeralState } from "loro-codemirror";
import { generateSessionKey } from "./envelope";
import { createCollabProvider, type CollabProvider } from "./relay-provider";
import { createWebSocketTransport } from "./websocket-transport";
import { encodeSessionLink, decodeSessionLink } from "./session-link";
import { loadIdentity } from "@/lib/sharing/identity/storage";
import { COLLAB_RELAY_URL } from "@/lib/loro/config";

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export type CollabStatus = "idle" | "connecting" | "live" | "stopped";

export interface CollabState {
  status: CollabStatus;
  /** Copy-able join link (set once the session is live). */
  link: string | null;
  sessionId: string | null;
  /** Non-null when connection failed, to surface in the UI. */
  errorMessage: string | null;
}

export interface CollabSessionApi {
  state: CollabState;
  /**
   * The shared EphemeralStore for this session.
   *
   * Both the relay provider and the editor's LoroEphemeralPlugin receive this
   * SAME instance so cursor/presence data flows through the relay. The store
   * is created once per hook instance and never re-created on reconnect, so
   * the editor plugin never needs to be remounted when start/join is called.
   */
  ephemeral: EphemeralStore<EphemeralState>;
  /** Generate a new sessionId + key, connect, and surface a copy-able link. */
  start(): void;
  /** Decode a pasted join link and connect to that session. */
  join(link: string): void;
  /** Destroy the provider and close the transport. */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Idle/stopped state sentinel.
// ---------------------------------------------------------------------------

const IDLE_STATE: CollabState = {
  status: "idle",
  link: null,
  sessionId: null,
  errorMessage: null,
};

// ---------------------------------------------------------------------------
// useCollabSession
// ---------------------------------------------------------------------------

/**
 * Manages a live collab session for one LoroDoc.
 *
 * @param args.doc - The live LoroDoc from the NoteHandle. Pass null while the
 *   handle is still opening; start/join will no-op until doc is present.
 * @param args.enabled - Must be true (LORO_PILOT_ENABLED) or this hook is
 *   permanently idle with zero side-effects.
 */
export function useCollabSession(args: {
  doc: LoroDoc | null;
  enabled: boolean;
}): CollabSessionApi {
  const { doc, enabled } = args;

  const [state, setState] = useState<CollabState>(IDLE_STATE);

  // One EphemeralStore per hook instance. Created once here (not inside
  // connectSession) so it survives stop-and-restart cycles. Both the relay
  // provider and the editor's LoroEphemeralPlugin receive this same instance:
  // cursor data written by CM6 flows directly through the relay without any
  // extra plumbing. The 30-second TTL matches the upstream default.
  const ephemeralRef = useRef<EphemeralStore<EphemeralState>>(
    new EphemeralStore<EphemeralState>(30_000),
  );

  // Stable ref so cleanup functions always reach the latest provider instance
  // without re-creating callbacks.
  const providerRef = useRef<CollabProvider | null>(null);

  // Cleanup helper: destroy the provider if one is live and reset state.
  const destroyProvider = useCallback(() => {
    if (providerRef.current) {
      providerRef.current.destroy();
      providerRef.current = null;
    }
  }, []);

  // Shared connect implementation used by both start() and join().
  const connectSession = useCallback(
    async (sessionId: string, sessionKey: Uint8Array) => {
      if (!enabled || !doc) return;

      setState({
        status: "connecting",
        link: null,
        sessionId,
        errorMessage: null,
      });

      // Load the local signing keypair. If the identity does not exist yet
      // (first run before the sharing setup flow) generate a runtime-only
      // ephemeral key so the session still works for the same-user two-tab test
      // (no signature pinning in the MVP).
      let secretKey: Uint8Array;
      let publicKey: Uint8Array;
      try {
        const identity = await loadIdentity();
        if (identity) {
          secretKey = identity.keys.signing.privateKey;
          publicKey = identity.keys.signing.publicKey;
        } else {
          // Fallback: generate a transient keypair for this session. The two
          // tabs can still sync because expectedPeerEd25519PublicKey is left
          // undefined, so frames from any valid signature are accepted.
          const { ed25519 } = await import("@noble/curves/ed25519.js");
          const kp = ed25519.keygen();
          secretKey = kp.secretKey;
          publicKey = kp.publicKey;
        }
      } catch (err) {
        console.error("[useCollabSession] Failed to load identity:", err);
        setState({
          status: "stopped",
          link: null,
          sessionId,
          errorMessage: "Could not load signing identity",
        });
        return;
      }

      // Build the relay URL: relay's /ws endpoint, session capability in query.
      const relayUrl = `${COLLAB_RELAY_URL}/ws?session=${encodeURIComponent(sessionId)}`;
      const transport = createWebSocketTransport(relayUrl);

      // Reuse the stable EphemeralStore created once for this hook instance.
      // The same store is exposed on the return value so the editor's
      // LoroEphemeralPlugin can use it directly. Local cursor writes by CM6
      // trigger ephemeral.subscribeLocalUpdates inside the relay provider and
      // are relayed as encrypted ephemeral frames to the remote peer.
      const ephemeral = ephemeralRef.current;

      // Wire the provider. It subscribes to local doc updates and installs the
      // inbound message handler on the transport.
      const provider = createCollabProvider({
        doc,
        ephemeral,
        sessionKey,
        sessionId,
        senderEd25519SecretKey: secretKey,
        senderEd25519PublicKey: publicKey,
        // Leave expectedPeerEd25519PublicKey undefined for the MVP same-identity
        // two-tab test: accept frames signed by any key. A later chunk pins the
        // peer's key from the directory invite.
        expectedPeerEd25519PublicKey: undefined,
        transport,
      });

      providerRef.current = provider;

      // Build the join link now (before onOpen fires) so the UI can show it
      // immediately in the "connecting" state. The link encodes the raw key for
      // the same-identity MVP; no X25519 wrapping yet.
      const link = encodeSessionLink({ sessionId, sessionKey });

      // Transition to "live" once the WebSocket opens. The relay provider also
      // registers its own onOpen (to broadcast the full doc snapshot for peer
      // catch-up); the transport fans to both, so neither clobbers the other.
      transport.onOpen(() => {
        setState((prev) =>
          prev.sessionId === sessionId
            ? { status: "live", link, sessionId, errorMessage: null }
            : prev,
        );
      });

      // Surface a failed connection instead of spinning on "connecting" forever.
      // A blocked socket (CSP, relay down) fires "error" before it ever opens.
      transport.onError(() => {
        setState((prev) =>
          prev.sessionId === sessionId && prev.status === "connecting"
            ? {
                status: "stopped",
                link: null,
                sessionId,
                errorMessage:
                  "Could not reach the relay. Is the collab server running?",
              }
            : prev,
        );
      });

      // A close while live means the peer/relay dropped. Code 1000/1005 is a
      // clean local close from stop(), which should leave the state alone.
      transport.onClose((code) => {
        if (code === 1000 || code === 1005) return;
        setState((prev) =>
          prev.sessionId === sessionId && prev.status === "live"
            ? {
                status: "stopped",
                link: null,
                sessionId,
                errorMessage: "Collab connection closed.",
              }
            : prev,
        );
      });
    },
    [enabled, doc, destroyProvider],
  );

  // ---------------------------------------------------------------------------
  // Public API.
  // ---------------------------------------------------------------------------

  const start = useCallback(() => {
    if (!enabled || !doc) return;
    destroyProvider();

    const sessionId = crypto.randomUUID();
    const sessionKey = generateSessionKey();

    void connectSession(sessionId, sessionKey);
  }, [enabled, doc, destroyProvider, connectSession]);

  const join = useCallback(
    (link: string) => {
      if (!enabled || !doc) return;
      destroyProvider();

      const decoded = decodeSessionLink(link);
      if (!decoded) {
        setState({
          status: "stopped",
          link: null,
          sessionId: null,
          errorMessage: "Invalid session link",
        });
        return;
      }

      void connectSession(decoded.sessionId, decoded.sessionKey);
    },
    [enabled, doc, destroyProvider, connectSession],
  );

  const stop = useCallback(() => {
    destroyProvider();
    setState((prev) => ({
      status: "stopped",
      link: null,
      sessionId: prev.sessionId,
      errorMessage: null,
    }));
  }, [destroyProvider]);

  // Cleanup on unmount: destroy any live provider so the transport closes and
  // the relay room loses this peer.
  useEffect(() => {
    return () => {
      destroyProvider();
    };
  }, [destroyProvider]);

  return { state, ephemeral: ephemeralRef.current, start, join, stop };
}
