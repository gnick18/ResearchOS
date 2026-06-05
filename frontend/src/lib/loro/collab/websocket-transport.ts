// Loro Phase 3, chunk 4: real-WebSocket adapter for CollabTransport.
//
// PURPOSE. The relay provider in relay-provider.ts talks to an injected
// CollabTransport interface so it stays network-free in tests. This module
// wraps a real browser WebSocket into that interface. The only tricky part is
// the pre-open send buffer: callers (and the relay provider itself, on connect)
// may call send() before the socket is actually open. We queue those frames and
// flush them all once "open" fires so no early edit is lost.
//
// MULTIPLE LISTENERS. onOpen and onMessage register into arrays, not single
// slots. Both the relay provider AND the session hook register an onOpen
// handler (the provider broadcasts its catch-up snapshot, the hook flips the UI
// to "live"). A single-slot store would let the second registration clobber the
// first, dropping the snapshot broadcast so a late-joiner never receives the
// existing note text. Arrays keep both.
//
// FAILURE SURFACING. The interface adds onError / onClose so a blocked or
// dropped connection is observable. Without them a failed connect (for example
// a CSP block, or the relay being down) would never fire "open" and the UI
// would spin on "connecting" forever with no signal.
//
// Binary protocol. ws.binaryType is set to "arraybuffer" so every inbound
// message.data is already an ArrayBuffer; we wrap it in Uint8Array before
// delivering to the callback. Outbound frames are Uint8Array; WebSocket.send()
// accepts Uint8Array directly.
//
// Browser-only. This module references the global WebSocket constructor, so it
// only works in a browser (or jsdom with a stub). See the test for the stub.

import type { CollabTransport } from "./relay-provider";

/**
 * The WebSocket transport adds failure callbacks on top of the base
 * CollabTransport. The relay provider only needs the base interface; the
 * session hook uses onError / onClose to surface a failed connection.
 */
export interface WebSocketCollabTransport extends CollabTransport {
  /** Fired when the socket emits an error event (connection refused, blocked, etc.). */
  onError(cb: () => void): void;
  /** Fired when the socket closes. Carries the close code so the caller can tell clean from abnormal. */
  onClose(cb: (code: number) => void): void;
}

/**
 * Wraps a real browser WebSocket in the CollabTransport interface expected by
 * createCollabProvider. Send calls before the socket opens are buffered and
 * flushed once the open event fires.
 *
 * @param url - The full ws:// or wss:// URL to connect to.
 */
export function createWebSocketTransport(url: string): WebSocketCollabTransport {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  // Pre-open send buffer. Any frame sent before the socket transitions to OPEN
  // lands here and is drained once onOpen fires.
  const preopenBuffer: Uint8Array[] = [];
  let opened = false;

  // Listener arrays. onOpen and onMessage may each be registered by more than
  // one caller (see the MULTIPLE LISTENERS note above), so we fan to all.
  const openCallbacks: Array<() => void> = [];
  const messageCallbacks: Array<(frame: Uint8Array) => void> = [];
  let errorCallback: (() => void) | null = null;
  let closeCallback: ((code: number) => void) | null = null;

  ws.addEventListener("open", () => {
    opened = true;

    // Drain pre-open buffer in arrival order.
    for (const frame of preopenBuffer) {
      ws.send(frame);
    }
    preopenBuffer.length = 0;

    // Notify every registered open handler. The provider uses this to broadcast
    // a full doc snapshot; the hook uses it to flip the UI to live.
    for (const cb of openCallbacks) cb();
  });

  ws.addEventListener("message", (e: MessageEvent) => {
    const frame = new Uint8Array(e.data as ArrayBuffer);
    for (const cb of messageCallbacks) cb(frame);
  });

  ws.addEventListener("error", () => {
    if (errorCallback) errorCallback();
  });

  ws.addEventListener("close", (e: CloseEvent) => {
    if (closeCallback) closeCallback(e.code);
  });

  return {
    send(frame: Uint8Array): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
      } else {
        // Buffer until open. This covers the window between createTransport and
        // the "open" event, which includes the relay provider's own onOpen
        // re-broadcast of the full doc snapshot.
        preopenBuffer.push(frame);
      }
    },

    onMessage(cb: (frame: Uint8Array) => void): void {
      messageCallbacks.push(cb);
    },

    onOpen(cb: () => void): void {
      openCallbacks.push(cb);
      // If the socket happened to open before onOpen() was called (race in
      // tests or a very fast local relay), invoke the callback immediately.
      if (opened) cb();
    },

    onError(cb: () => void): void {
      errorCallback = cb;
    },

    onClose(cb: (code: number) => void): void {
      closeCallback = cb;
    },

    close(): void {
      ws.close();
    },
  };
}
