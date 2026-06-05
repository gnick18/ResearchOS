/**
 * ResearchOS notes collaboration relay.
 *
 * A blind byte-fan-out Cloudflare Durable Object. One DO instance per collab
 * session (addressed by sessionId), so each room is fully isolated. The DO
 * uses the WebSocket Hibernation API so it can be evicted between messages
 * while the sockets remain open (Cloudflare rehydrates it on the next event).
 *
 * The relay is deliberately dumb: every binary message that arrives on one
 * socket is forwarded verbatim to every OTHER socket in the same room. The
 * relay NEVER parses, decodes, or stores the payload. Clients encrypt + sign
 * every update before sending (XChaCha20-Poly1305 ciphertext + Ed25519
 * signature). Peer-side signature verification and envelope authentication are
 * a later hardening step; the MVP relies on the sessionId acting as a
 * capability token plus the clients' own E2E encryption and signature checks.
 *
 * Adapted from spikes/collab-yjs/src/worker.ts (the single-room throwaway
 * spike). The only production addition is the per-session room routing via
 * idFromName(sessionId).
 */

export interface Env {
  COLLAB_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    // Reject plain HTTP upgrades before touching the DO.
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(
        "This endpoint requires a WebSocket upgrade",
        { status: 426, headers: { Upgrade: "websocket" } }
      );
    }

    const sessionId = url.searchParams.get("session");
    if (!sessionId || sessionId.trim() === "") {
      return new Response(
        "Missing required query parameter: session",
        { status: 400 }
      );
    }

    // Each sessionId maps to its own DO instance (isolated room). idFromName
    // is deterministic, so any client that knows the sessionId can join the
    // same room. The sessionId is the capability token at the relay level.
    const id = env.COLLAB_ROOM.idFromName(sessionId);
    const stub = env.COLLAB_ROOM.get(id);
    return stub.fetch(request);
  },
};

export class CollabRoom {
  readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    // The outer fetch handler already validates the Upgrade header, but guard
    // here too in case the DO is addressed directly (e.g. via the test harness
    // hitting the stub fetch).
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Hibernation API: the runtime serialises the socket handle and rehydrates
    // the DO on the next incoming message. The DO does not need to stay in
    // memory between messages.
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Blind fan-out. Forward data verbatim to every peer EXCEPT the sender.
  // The payload is opaque ciphertext; we never read it.
  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    for (const peer of this.state.getWebSockets()) {
      if (peer === ws) continue;
      try {
        peer.send(data);
      } catch {
        // Peer disconnected between enumeration and send; skip it.
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      // Already closed or closing; nothing to do.
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      // Ignore close errors on an errored socket.
    }
  }
}
