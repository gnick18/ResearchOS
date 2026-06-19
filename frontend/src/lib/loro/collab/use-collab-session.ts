"use client";

// Loro Phase 3, chunk 4: React hook owning the collab session lifecycle.
// Updated in chunk 5a: EphemeralStore is now a real shared instance, not a
// throwaway, so live-cursor data produced by LoroEphemeralPlugin flows through
// the relay to the remote peer.
// Updated in chunk 5b: retireSession() ends the session cleanly, recording the
// remote collaborator in the actors map and writing a "collab-session-ended"
// forward commit so the note's version history carries co-author provenance.
// Updated in Phase 3c chunk 3a: connectFromDocId() derives the sessionId and
// sessionKey deterministically from the note's collab_doc_id so every member
// auto-connects to the same relay room with the same key, with no manual link.
//
// PURPOSE. Keeps NoteDetailPopup thin. This hook manages:
//   - start(): generate a sessionId + key, open the WebSocket transport to the
//     relay, wire the relay provider, expose a copy-able join link.
//   - join(link): decode a pasted link and connect to that session.
//   - stop(): destroy the provider and close the transport.
//   - retireSession(handle, owner, base): flush actors, write the history
//     marker commit, persist, then stop. Either collaborator can call this.
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
// REMOTE PEER ATTRIBUTION. The relay provider fires onFirstRemotePeer the
// first time a new peer's commit arrives via doc.import. This hook wires that
// callback to recordActor (the Phase 2 actors map), so the remote collaborator
// is attributable in the note's version history. The collaboratorUsername
// option lets the caller pass the invited user's display name; it falls back
// to a hex fingerprint of their Ed25519 public key when absent.
//
// STATUS TRANSITIONS.
//   idle -> connecting (start/join called)
//   connecting -> live (WebSocket opened)
//   live -> stopped (stop called or retireSession called)
//   Any error during connect stays at stopped (with an error note in the
//   console; we could surface a fine-grained error string but the MVP doesn't
//   need it).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";
import { LoroDoc, EphemeralStore } from "loro-crdt";
import { notifySyncBlocked } from "@/lib/collab/sync-status";
import type { EphemeralState } from "loro-codemirror";
import { randomBytes } from "@noble/hashes/utils.js";
import { collabSessionFromDocId } from "./doc-id-session";
import { createCollabProvider, type CollabProvider } from "./relay-provider";
import { createWebSocketTransport } from "./websocket-transport";
import { encodeSessionLink, decodeSessionLink } from "./session-link";
import { COLLAB_RELAY_URL } from "@/lib/loro/config";
import { buildConnectTokenSuffix } from "@/lib/collab/client/connect-token";
import { recordActor } from "@/lib/loro/actors";
import { persistNote } from "@/lib/loro/sidecar-store";
import type { NoteHandle } from "@/lib/loro/store";
import type { Note } from "@/lib/types";

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
  /**
   * Auto-connect to the shared note's live session using the collab_doc_id.
   *
   * Derives the sessionId and sessionKey deterministically from the doc id
   * (Phase 3c chunk 3a), so every member who opens the same shared note
   * connects to the same relay room with the same key. No link to paste, no
   * server bootstrap for the session credentials.
   *
   * This is the entry point for shared notes. Unshared notes never call this;
   * they use start() / join() for the manual two-tab dev path.
   */
  connectFromDocId(docId: string): void;
  /** Destroy the provider and close the transport (no provenance commit). */
  stop(): void;
  /**
   * End the session cleanly with provenance.
   *
   * Writes a "collab-session-ended" forward commit into the note's Loro doc
   * (using the same forward-commit pattern as restore.ts), persists the
   * sidecar + mirror, then disconnects. Either collaborator can call this.
   *
   * Pass the live NoteHandle, the note owner's username, and the current Note
   * so the commit and persist have the right context. The caller is responsible
   * for ensuring the handle is still open when retireSession is called.
   *
   * Best-effort: if the commit or persist fails, the session is still stopped.
   * Flag-gated at the call site; not called when LORO_PILOT_ENABLED is false.
   */
  retireSession(handle: NoteHandle, owner: string, base: Note): Promise<void>;
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
 * @param args.owner - The note owner's username (for recordActor calls).
 * @param args.collaboratorUsername - Optional display name for the remote
 *   collaborator. When provided it is stored in the actors map when the first
 *   remote peer commit arrives so the version history shows a real name. When
 *   absent the recording falls back to a hex fingerprint of their Ed25519 key.
 *   For the same-user two-tab MVP, pass the local user's username here too.
 */
export function useCollabSession(args: {
  doc: LoroDoc | null;
  enabled: boolean;
  owner?: string;
  collaboratorUsername?: string;
}): CollabSessionApi {
  const { doc, enabled, owner, collaboratorUsername } = args;

  const [state, setState] = useState<CollabState>(IDLE_STATE);

  // One EphemeralStore per hook instance. Created once here (not inside
  // connectSession) so it survives stop-and-restart cycles. Both the relay
  // provider and the editor's LoroEphemeralPlugin receive this same instance:
  // cursor data written by CM6 flows directly through the relay without any
  // extra plumbing. The 30-second TTL matches the upstream default.
  const ephemeralRef = useRef<EphemeralStore<EphemeralState>>(
    new EphemeralStore<EphemeralState>(30_000),
  );

  // Stable refs for owner + collaboratorUsername so the onFirstRemotePeer
  // callback can access the latest values without re-creating connectSession.
  const ownerRef = useRef<string | undefined>(owner);
  const collaboratorUsernameRef = useRef<string | undefined>(collaboratorUsername);
  useEffect(() => {
    ownerRef.current = owner;
    collaboratorUsernameRef.current = collaboratorUsername;
  });

  // Stable ref so cleanup functions always reach the latest provider instance
  // without re-creating callbacks.
  const providerRef = useRef<CollabProvider | null>(null);

  // Heartbeat that re-broadcasts this peer's ephemeral cursor + user state while
  // connected, so an idle peer's name does not lapse. The EphemeralStore TTL is
  // 30s; without a refresh, loro-codemirror renders an expired peer's remote
  // cursor label as "unknown". Cleared when the provider tears down.
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup helper: destroy the provider if one is live and reset state.
  const destroyProvider = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (providerRef.current) {
      providerRef.current.destroy();
      providerRef.current = null;
    }
  }, []);

  // Shared connect implementation used by both start() and join().
  const connectSession = useCallback(
    (sessionId: string, sessionKey: Uint8Array) => {
      if (!enabled || !doc) return;

      setState({
        status: "connecting",
        link: null,
        sessionId,
        errorMessage: null,
      });

      // Build the relay URL: relay's /ws endpoint, session capability in query.
      // Always attach a member connect token when this device has a sharing
      // identity. An OPEN doc ignores it; an ENFORCED doc requires it. Never
      // gated by a flag and never blocks the connect (empty suffix on no
      // identity / signing error), so the existing in-lab path is unchanged.
      const authSuffix = buildConnectTokenSuffix(sessionId);
      const relayUrl = `${COLLAB_RELAY_URL}/ws?session=${encodeURIComponent(sessionId)}${authSuffix}`;
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
        transport,
        // [freeze-diag] OBSERVE-ONLY: label the diagnostic logs with the session
        // id so a reproduced freeze names the exact note. No effect on sync.
        docId: sessionId,
        // Record the remote collaborator in the actors map the first time their
        // commit arrives, so version-history rows can attribute remote edits to
        // a real person. Plaintext frames carry no per-frame sender identity, so
        // resolve the display name from the invited collaborator's username,
        // falling back to a short peer-id fingerprint when it is absent.
        onFirstRemotePeer: (peerId: string) => {
          const recordOwner = ownerRef.current;
          if (!recordOwner) return;
          const username =
            collaboratorUsernameRef.current ?? `peer-${peerId.slice(0, 6)}`;
          void recordActor(recordOwner, BigInt(peerId), username);
        },
        // Surface a quiet "sync paused" indicator when the relay reports durable
        // persistence is paused (cost breaker / write throttle / doc cap). Live
        // editing keeps working; this is informational. It auto-clears.
        onSyncBlocked: (reason: string) => notifySyncBlocked(reason),
      });

      providerRef.current = provider;

      // Keep this peer's ephemeral cursor + user state alive while connected so
      // an idle peer's name never expires (TTL 30s; refresh every 10s). Both
      // loro-codemirror keys (`<peerId>-cm-user` / `<peerId>-cm-cursor`) are
      // re-set with their current value, which resets the TTL and re-broadcasts.
      // Re-setting an identical value is visually a no-op; it only refreshes the
      // expiry. Only runs once a value exists (i.e. after the first cursor set).
      {
        const userKey = `${doc.peerIdStr}-cm-user`;
        const cursorKey = `${doc.peerIdStr}-cm-cursor`;
        heartbeatRef.current = setInterval(() => {
          // loro-codemirror stores per-peer entries under dynamic string keys
          // (`<peerId>-cm-user` / `<peerId>-cm-cursor`), which the typed
          // EphemeralStore generic does not model, so access via a permissive
          // view (the same shape loro-codemirror uses internally).
          const store = ephemeralRef.current as unknown as {
            get(key: string): unknown;
            set(key: string, value: unknown): void;
          };
          const userVal = store.get(userKey);
          if (userVal !== undefined) store.set(userKey, userVal);
          const cursorVal = store.get(cursorKey);
          if (cursorVal !== undefined) store.set(cursorKey, cursorVal);
        }, 10_000);
      }

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
    const sessionKey = randomBytes(32);

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

  /**
   * Phase 3c chunk 3a: auto-connect entry point for shared notes.
   *
   * Derives sessionId + sessionKey from the collab_doc_id, then calls the
   * shared connectSession with those values. The existing engine (provider,
   * cursors, undo guard) is reused without modification.
   *
   * Does NOT surface a copy-able join link (the shared note is the implicit
   * "link"; no link needs to be passed). The collab.state.link will be null
   * while connected via this path, which the UI interprets as "auto-session,
   * no link to copy" and hides the copy-link button.
   *
   * Idempotent: if the session is already live with the same sessionId, calling
   * this again is a no-op from the UX perspective (the provider guard fires first
   * on the connecting path). In practice NoteDetailPopup gates this on status
   * "idle" so it only fires once on open.
   */
  const connectFromDocId = useCallback(
    (docId: string) => {
      if (!enabled || !doc) return;
      destroyProvider();

      const { sessionId, sessionKey } = collabSessionFromDocId(docId);
      void connectSession(sessionId, sessionKey);
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

  /**
   * End the session cleanly with provenance (Phase 3 chunk 5b).
   *
   * Writes a "collab-session-ended" forward commit into the Loro doc (the same
   * forward-commit pattern as restore.ts `restore-vN`), then persists the
   * sidecar + mirror so the history is on disk, then disconnects.
   *
   * This is the durable artifact: the version history row with message
   * "collab-session-ended" signals that this note was collaboratively edited
   * with at least one other person whose edits are attributed via the actors
   * map (recorded in onFirstRemotePeer above).
   *
   * Either collaborator can call this. If the doc commit or persist fails,
   * the session is still stopped (best-effort, consistent with the rest of the
   * Loro error-handling posture).
   */
  const retireSession = useCallback(
    async (handle: NoteHandle, retireOwner: string, base: Note) => {
      if (!enabled) {
        stop();
        return;
      }

      try {
        // Write a retire marker into the doc's meta map so the commit is
        // non-empty (doc.commit is a no-op when nothing is dirty). The
        // "meta" map is the Loro doc's root metadata map (see note-doc.ts);
        // the key "collab_retired_at" is a new Loro-internal key that lives
        // only in the CRDT sidecar, not in the Note JSON mirror (projectToNote
        // reads only the known meta keys: title/description/is_running_log/
        // created_at). It carries the ISO timestamp of the retire event.
        //
        // FLAG: new Loro meta map key "collab_retired_at" (ISO timestamp string).
        // Stored in the Loro sidecar only; not in Note JSON. See report section 3.
        handle.doc.getMap("meta").set("collab_retired_at", new Date().toISOString());
        // Forward commit stamping the retire event. Matches the pattern in
        // restore.ts: `handle.doc.commit({ message: "restore-vN" })`.
        handle.doc.commit({ message: "collab-session-ended" });
        // Persist sidecar + mirror so the commit lands on disk before we close
        // the WebSocket. Matches the persistNote call in restore.ts.
        await persistNote(retireOwner, handle.doc, base);
      } catch (err) {
        // Best-effort: log but do not block the disconnect. A failed persist is
        // consistent with the rest of the Loro error posture (the sidecar
        // re-persists on the next debounced commit if the handle is still open).
        console.warn("[useCollabSession] retireSession persist failed:", err);
      }

      // Disconnect regardless of whether the commit/persist succeeded.
      stop();
    },
    [enabled, stop],
  );

  // Cleanup on unmount: destroy any live provider so the transport closes and
  // the relay room loses this peer.
  useEffect(() => {
    return () => {
      destroyProvider();
    };
  }, [destroyProvider]);

  return { state, ephemeral: ephemeralRef.current, start, join, connectFromDocId, stop, retireSession };
}
