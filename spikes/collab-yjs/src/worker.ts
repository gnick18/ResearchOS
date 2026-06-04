/**
 * THROWAWAY spike worker. A minimal Cloudflare Durable Object that acts as a
 * blind WebSocket fan-out hub for one collaborative document.
 *
 * SPIKE SIMPLIFICATION: this is a PURE BYTE RELAY. Every binary message that
 * arrives on one socket is forwarded verbatim to every OTHER connected socket.
 * The DO never parses the payload, never holds a Y.Doc, never decodes the Yjs
 * protocol. This is deliberate: it both keeps the spike tiny and exactly
 * mirrors the recommended 4a design (CROSS_BOUNDARY_SHARING_COLLABORATE.md),
 * where each message is already XChaCha20-Poly1305 ciphertext + Ed25519 signed
 * by the client and the hub is BLIND. The fan-out mechanic proven here is
 * identical under that wrapper, the only addition in production is that the DO
 * verifies the signed envelope before fanning, which does not change routing.
 *
 * Because the relay is blind, late-join catch-up is client-driven: a freshly
 * connected client asks its peers to re-sync (the Yjs client provider does
 * this automatically by broadcasting its state vector on open, and peers reply
 * with the missing update). For the two-person MVP this is exactly the "still
 * connected peer re-broadcasts current state" fallback the proposal names.
 *
 * Single hard-coded room. No auth, no invites, no persistence. Uses the
 * WebSocket Hibernation API so the DO can evict while sockets stay open.
 *
 * Wiring shape follows napolab/y-durableobjects (MIT), trimmed to a relay.
 */

interface Env {
  COLLAB_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      // One hard-coded room for the spike.
      const id = env.COLLAB_ROOM.idFromName("spike-room");
      const stub = env.COLLAB_ROOM.get(id);
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class CollabRoom {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation API: the DO keeps these sockets across memory eviction.
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Fired for every incoming message on any accepted socket.
  // Blind fan-out: forward verbatim to all other connected sockets.
  async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string) {
    for (const peer of this.state.getWebSockets()) {
      if (peer !== ws) {
        try {
          peer.send(data);
        } catch {
          // peer gone between enumeration and send; ignore
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      // already closing
    }
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
}
