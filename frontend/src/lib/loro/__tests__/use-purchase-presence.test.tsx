// Tests for usePurchasePresence (purchase-loro chunk 4 = live-presence over the
// shared EphemeralStore). Uses a real EphemeralStore so the broadcast + read
// round-trips through the actual loro-crdt store, plus a flag-off no-op test.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { EphemeralStore } from "loro-crdt";

// The flag is read by the hook at call time. Flip it per-test via this mock.
const flagState = { enabled: true };
vi.mock("../config", () => ({
  get PURCHASE_LORO_ENABLED() {
    return flagState.enabled;
  },
}));

// Stable device peer for THIS hook instance (the local broadcaster).
vi.mock("../device-peer", () => ({ getDevicePeerId: () => BigInt(111) }));

import { usePurchasePresence } from "../use-purchase-presence";

const PRESENCE_PREFIX = "purchase-presence-";

beforeEach(() => {
  flagState.enabled = true;
  vi.clearAllMocks();
});

describe("usePurchasePresence: broadcast + read round-trip", () => {
  it("broadcasts this device's presence into the shared store", () => {
    const store = new EphemeralStore(30_000);
    renderHook(() =>
      usePurchasePresence({ store: store as never, itemId: 5, username: "mira" }),
    );

    const states = (store as unknown as { getAllStates(): Record<string, unknown> }).getAllStates();
    const myEntry = states[`${PRESENCE_PREFIX}111`] as
      | { username: string; itemId: number }
      | undefined;
    expect(myEntry).toBeDefined();
    expect(myEntry!.username).toBe("mira");
    expect(myEntry!.itemId).toBe(5);
  });

  it("surfaces a REMOTE peer present on the same item", async () => {
    const store = new EphemeralStore(30_000);
    // Simulate a remote peer already present on item 5.
    (store as unknown as { set(k: string, v: unknown): void }).set(
      `${PRESENCE_PREFIX}999`,
      { username: "alex", itemId: 5, ts: Date.now() },
    );

    const { result } = renderHook(() =>
      usePurchasePresence({ store: store as never, itemId: 5, username: "mira" }),
    );

    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0].peerId).toBe("999");
    expect(result.current[0].presence.username).toBe("alex");
  });

  it("ignores a remote peer on a DIFFERENT item", async () => {
    const store = new EphemeralStore(30_000);
    (store as unknown as { set(k: string, v: unknown): void }).set(
      `${PRESENCE_PREFIX}999`,
      { username: "alex", itemId: 8, ts: Date.now() },
    );

    const { result } = renderHook(() =>
      usePurchasePresence({ store: store as never, itemId: 5, username: "mira" }),
    );

    // Give the read effect a tick; it should stay empty (different item).
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.length).toBe(0);
  });

  it("removes its own entry on unmount", () => {
    const store = new EphemeralStore(30_000);
    const { unmount } = renderHook(() =>
      usePurchasePresence({ store: store as never, itemId: 5, username: "mira" }),
    );

    const getAll = () =>
      (store as unknown as { getAllStates(): Record<string, unknown> }).getAllStates();
    expect(getAll()[`${PRESENCE_PREFIX}111`]).toBeDefined();

    act(() => unmount());
    expect(getAll()[`${PRESENCE_PREFIX}111`]).toBeUndefined();
  });
});

describe("usePurchasePresence: flag-off no-op", () => {
  it("broadcasts nothing and returns an empty list when the flag is off", () => {
    flagState.enabled = false;
    const store = new EphemeralStore(30_000);

    const { result } = renderHook(() =>
      usePurchasePresence({ store: store as never, itemId: 5, username: "mira" }),
    );

    const states = (store as unknown as { getAllStates(): Record<string, unknown> }).getAllStates();
    expect(Object.keys(states).length).toBe(0);
    expect(result.current.length).toBe(0);
  });

  it("returns an empty list when no store / no item", () => {
    const { result } = renderHook(() =>
      usePurchasePresence({ store: null, itemId: null, username: "mira" }),
    );
    expect(result.current.length).toBe(0);
  });
});
