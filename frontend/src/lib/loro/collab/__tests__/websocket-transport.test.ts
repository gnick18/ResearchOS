// Tests for websocket-transport.ts.
//
// We cannot use a real WebSocket in jsdom (no network), so we install a
// minimal hand-rolled stub as `global.WebSocket`. The stub is honest: it
// records sends, simulates the open event, and lets us fire message events,
// so we can exercise the actual buffering + dispatch logic in the transport
// without any real network dependency.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWebSocketTransport } from "../websocket-transport";

// ---------------------------------------------------------------------------
// FakeWebSocket stub.
// ---------------------------------------------------------------------------

interface FakeWsInstance {
  url: string;
  binaryType: string;
  readyState: number;
  sent: Uint8Array[];
  listeners: Record<string, Array<(e: unknown) => void>>;
  addEventListener(type: string, cb: (e: unknown) => void): void;
  send(data: Uint8Array): void;
  close(): void;
  // Test helpers:
  simulateOpen(): void;
  simulateMessage(data: Uint8Array): void;
}

let fakeInstances: FakeWsInstance[] = [];

// Fake WebSocket constructor. Matches the subset the transport uses.
class FakeWebSocket {
  url: string;
  binaryType = "blob";
  readyState = 0; // CONNECTING
  sent: Uint8Array[] = [];
  listeners: Record<string, Array<(e: unknown) => void>> = {};

  // Expose OPEN constant so transport's readyState === WebSocket.OPEN works.
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;

  constructor(url: string) {
    this.url = url;
    fakeInstances.push(this as unknown as FakeWsInstance);
  }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] = this.listeners[type] ?? []).push(cb);
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
  }

  // Test helper: fire the "open" event and transition to OPEN state.
  simulateOpen(): void {
    this.readyState = 1;
    for (const cb of this.listeners["open"] ?? []) cb({});
  }

  // Test helper: fire the "message" event with a binary payload.
  simulateMessage(data: Uint8Array): void {
    for (const cb of this.listeners["message"] ?? []) {
      cb({ data: data.buffer });
    }
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown: install and restore the global WebSocket stub.
// ---------------------------------------------------------------------------

// We need to store the original to restore it. In jsdom there may be no
// WebSocket at all, so we fall back gracefully.
let originalWebSocket: typeof WebSocket | undefined;

beforeEach(() => {
  fakeInstances = [];
  const g = globalThis as Record<string, unknown>;
  originalWebSocket = g.WebSocket as typeof WebSocket | undefined;
  g.WebSocket = FakeWebSocket;
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  if (originalWebSocket !== undefined) {
    g.WebSocket = originalWebSocket;
  } else {
    Reflect.deleteProperty(g, "WebSocket");
  }
});

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("createWebSocketTransport", () => {
  it("sets binaryType to arraybuffer", () => {
    createWebSocketTransport("ws://localhost:8787/ws?session=test");
    const ws = fakeInstances[0];
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("creates a WebSocket with the given URL", () => {
    createWebSocketTransport("ws://localhost:8787/ws?session=abc");
    expect(fakeInstances[0].url).toBe("ws://localhost:8787/ws?session=abc");
  });

  it("buffers frames sent before the socket opens, then flushes on open", () => {
    const transport = createWebSocketTransport("ws://localhost:8787/ws?session=buf");
    const ws = fakeInstances[0];

    const frame1 = new Uint8Array([1, 2, 3]);
    const frame2 = new Uint8Array([4, 5, 6]);

    // Socket is still CONNECTING (readyState 0); these should be buffered.
    transport.send(frame1);
    transport.send(frame2);

    expect(ws.sent).toHaveLength(0);

    // Open the socket; buffer should flush in order.
    ws.simulateOpen();

    expect(ws.sent).toHaveLength(2);
    expect(ws.sent[0]).toEqual(frame1);
    expect(ws.sent[1]).toEqual(frame2);
  });

  it("sends immediately when the socket is already open", () => {
    const transport = createWebSocketTransport("ws://localhost:8787/ws?session=open");
    const ws = fakeInstances[0];

    ws.simulateOpen();

    const frame = new Uint8Array([10, 20, 30]);
    transport.send(frame);

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toEqual(frame);
  });

  it("delivers inbound messages as Uint8Array to the onMessage callback", () => {
    const transport = createWebSocketTransport("ws://localhost:8787/ws?session=msg");
    const ws = fakeInstances[0];

    const received: Uint8Array[] = [];
    transport.onMessage((f) => received.push(f));

    ws.simulateOpen();
    ws.simulateMessage(new Uint8Array([7, 8, 9]));

    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(Uint8Array);
    expect(received[0]).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("calls the onOpen callback once the socket opens", () => {
    const transport = createWebSocketTransport("ws://localhost:8787/ws?session=oo");
    const ws = fakeInstances[0];

    const calls: number[] = [];
    transport.onOpen(() => calls.push(Date.now()));

    expect(calls).toHaveLength(0);
    ws.simulateOpen();
    expect(calls).toHaveLength(1);
  });

  it("calls onOpen immediately if registered after the socket already opened", () => {
    const transport = createWebSocketTransport("ws://localhost:8787/ws?session=late");
    const ws = fakeInstances[0];

    // Open before registering callback.
    ws.simulateOpen();

    const calls: number[] = [];
    transport.onOpen(() => calls.push(1));

    // Should be invoked synchronously during onOpen() registration.
    expect(calls).toHaveLength(1);
  });

  it("does not send buffered frames more than once after open", () => {
    const transport = createWebSocketTransport("ws://localhost:8787/ws?session=once");
    const ws = fakeInstances[0];

    transport.send(new Uint8Array([1]));
    ws.simulateOpen();
    // Simulate a second open (should not happen in practice, but guard the invariant).
    ws.simulateOpen();

    // Buffer drained on first open; second open has nothing to flush.
    expect(ws.sent).toHaveLength(1);
  });

  it("calls close() on the underlying WebSocket", () => {
    const transport = createWebSocketTransport("ws://localhost:8787/ws?session=close");
    const ws = fakeInstances[0];

    transport.close();

    expect(ws.readyState).toBe(3); // CLOSED
  });

  it("does not deliver messages if no onMessage callback is registered", () => {
    const transport = createWebSocketTransport("ws://localhost:8787/ws?session=nom");
    const ws = fakeInstances[0];
    ws.simulateOpen();

    // Should not throw even with no callback.
    expect(() => ws.simulateMessage(new Uint8Array([1, 2]))).not.toThrow();
    // Satisfy the "transport variable is used" lint.
    transport.close();
  });

  it("delivers multiple messages in order", () => {
    const transport = createWebSocketTransport("ws://localhost:8787/ws?session=ord");
    const ws = fakeInstances[0];

    const received: number[] = [];
    transport.onMessage((f) => received.push(f[0]));

    ws.simulateOpen();
    ws.simulateMessage(new Uint8Array([1]));
    ws.simulateMessage(new Uint8Array([2]));
    ws.simulateMessage(new Uint8Array([3]));

    expect(received).toEqual([1, 2, 3]);
  });
});
