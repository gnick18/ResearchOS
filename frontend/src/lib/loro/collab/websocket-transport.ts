// Loro Phase 3, chunk 4: real-WebSocket adapter for CollabTransport.
//
// PURPOSE. The relay provider in relay-provider.ts talks to an injected
// CollabTransport interface so it stays network-free in tests. This module
// wraps a real browser WebSocket into that interface. The only tricky part is
// the pre-open send buffer: callers (and the relay provider itself, on connect)
// may call send() before the socket is actually open. We queue those frames and
// flush them all once "open" fires so no early edit is lost.
//
// Binary protocol. ws.binaryType is set to "arraybuffer" so every inbound
// message.data is already an ArrayBuffer; we wrap it in Uint8Array before
// delivering to the callback. Outbound frames are Uint8Array; WebSocket.send()
// accepts Uint8Array directly.
//
// Browser-only. This module imports nothing and references the global WebSocket
// constructor, so it only works in a browser (or jsdom). Do not import from
// Node test helpers that lack a WebSocket global; see websocket-transport.test.ts
// for the stub approach.

import type { CollabTransport } from "./relay-provider";

export type { CollabTransport };

/**
 * Wraps a real browser WebSocket in the CollabTransport interface expected by
 * createCollabProvider. Send calls before the socket opens are buffered and
 * flushed once the open event fires.
 *
 * @param url - The full ws:// or wss:// URL to connect to.
 */
export function createWebSocketTransport(url: string): CollabTransport {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  // Pre-open send buffer. Any frame sent before the socket transitions to OPEN
  // lands here and is drained once onOpen fires.
  const preopenBuffer: Uint8Array[] = [];
  let opened = false;

  // Registered callbacks. The relay provider calls onMessage and onOpen exactly
  // once to register its handlers; we store them here and invoke on events.
  let messageCallback: ((frame: Uint8Array) => void) | null = null;
  let openCallback: (() => void) | null = null;

  ws.addEventListener("open", () => {
    opened = true;

    // Drain pre-open buffer in arrival order.
    for (const frame of preopenBuffer) {
      ws.send(frame);
    }
    preopenBuffer.length = 0;

    // Notify the relay provider that the connection is established. The
    // provider uses this to broadcast a full doc snapshot to the just-joined
    // peer.
    if (openCallback) openCallback();
  });

  ws.addEventListener("message", (e: MessageEvent) => {
    if (!messageCallback) return;
    messageCallback(new Uint8Array(e.data as ArrayBuffer));
  });

  return {
    send(frame: Uint8Array): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
      } else {
        // Buffer until open. This covers the window between createTransport and
        // the "open" event, which includes the relay provider's own onOpen
        // re-broadcast of the full doc snapshot that it fires synchronously in
        // the onOpen callback.
        preopenBuffer.push(frame);
      }
    },

    onMessage(cb: (frame: Uint8Array) => void): void {
      messageCallback = cb;
    },

    onOpen(cb: () => void): void {
      openCallback = cb;
      // If the socket happened to open before onOpen() was called (race in
      // tests or very fast local relay), invoke the callback immediately.
      if (opened) {
        cb();
      }
    },

    close(): void {
      ws.close();
    },
  };
}
