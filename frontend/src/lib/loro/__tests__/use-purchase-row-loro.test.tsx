// Tests for usePurchaseRowLoro (purchase-loro chunk 2 = open-row READ + CONNECT
// lifecycle). The store, doc-id mint, and collab session are mocked so the test
// pins the HOOK contract: open on edit-start, mint + connect, close on edit-end,
// and a flat no-op when PURCHASE_LORO_ENABLED is false.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { LoroDoc } from "loro-crdt";

// The flag is read by the hook at call time. We flip it per-suite via this mock.
const flagState = { enabled: true };
vi.mock("../config", () => ({
  get PURCHASE_LORO_ENABLED() {
    return flagState.enabled;
  },
}));

// One fake handle per open. Records close() so the lifecycle can be asserted.
function makeFakeHandle() {
  const doc = new LoroDoc();
  doc.getMap("fields").set("vendor", "NEB");
  doc.commit();
  let subCb: (() => void) | null = null;
  return {
    doc,
    flush: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    subscribe: vi.fn((cb: () => void) => {
      subCb = cb;
      return () => {
        subCb = null;
      };
    }),
    commit: vi.fn(async () => {}),
    commitPending: false,
    subscribeCommitPending: vi.fn(() => () => {}),
    _registerUnsub: vi.fn(),
    _fire: () => subCb?.(),
  };
}

let lastHandle: ReturnType<typeof makeFakeHandle>;
const openPurchaseDoc = vi.fn(async () => {
  lastHandle = makeFakeHandle();
  return lastHandle;
});
vi.mock("../purchase-store", () => ({
  openPurchaseDoc: (...args: unknown[]) =>
    (openPurchaseDoc as (...a: unknown[]) => unknown)(...args),
}));

const getOrMintCollabDocId = vi.fn(() => "doc-room-123");
// getCollabDocId is read by the dedicated connect effect (which fires after the
// handle lands in state) to derive the room id, so the mock must expose it too.
const getCollabDocId = vi.fn(() => "doc-room-123");
vi.mock("@/lib/collab/client/doc-id", () => ({
  getOrMintCollabDocId: () => getOrMintCollabDocId(),
  getCollabDocId: () => getCollabDocId(),
}));

const connectFromDocId = vi.fn();
const stop = vi.fn();
vi.mock("../collab/use-collab-session", () => ({
  useCollabSession: () => ({
    state: { status: "idle", link: null, sessionId: null, errorMessage: null },
    connectFromDocId,
    stop,
    start: vi.fn(),
    join: vi.fn(),
    retireSession: vi.fn(),
    ephemeral: {},
  }),
}));

import { usePurchaseRowLoro } from "../use-purchase-row-loro";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
}

const BASE = { owner: "manny", taskId: 7, queryUsername: "manny", currentUser: "manny" };

describe("usePurchaseRowLoro", () => {
  beforeEach(() => {
    flagState.enabled = true;
    openPurchaseDoc.mockClear();
    getOrMintCollabDocId.mockClear();
    getCollabDocId.mockClear();
    connectFromDocId.mockClear();
    stop.mockClear();
  });

  it("opens the handle, mints the doc id, and auto-connects on edit start", async () => {
    const { result } = renderHook(
      () => usePurchaseRowLoro({ itemId: 3, ...BASE }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.handle).not.toBeNull());

    expect(openPurchaseDoc).toHaveBeenCalledWith("manny", 3, "manny");
    expect(getOrMintCollabDocId).toHaveBeenCalledTimes(1);
    expect(lastHandle.flush).toHaveBeenCalledTimes(1); // persisted after mint
    expect(connectFromDocId).toHaveBeenCalledWith("doc-room-123");
    expect(result.current.opening).toBe(false);
  });

  it("closes the handle and ends the session on edit end", async () => {
    const { result, rerender } = renderHook(
      ({ itemId }: { itemId: number | null }) =>
        usePurchaseRowLoro({ itemId, ...BASE }),
      { wrapper, initialProps: { itemId: 3 as number | null } },
    );

    await waitFor(() => expect(result.current.handle).not.toBeNull());
    const opened = lastHandle;

    rerender({ itemId: null });

    await waitFor(() => expect(opened.close).toHaveBeenCalled());
    expect(stop).toHaveBeenCalled();
    expect(result.current.handle).toBeNull();
  });

  it("invalidates the row's purchases query on a remote doc change", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(
      () => usePurchaseRowLoro({ itemId: 3, ...BASE }),
      { wrapper: localWrapper },
    );
    await waitFor(() => expect(result.current.handle).not.toBeNull());

    lastHandle._fire();

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["purchases", 7, "manny"],
    });
  });

  it("is a flat no-op when PURCHASE_LORO_ENABLED is false", async () => {
    flagState.enabled = false;
    const { result } = renderHook(
      () => usePurchaseRowLoro({ itemId: 3, ...BASE }),
      { wrapper },
    );

    // Give any stray async open a tick to (not) resolve.
    await new Promise((r) => setTimeout(r, 0));

    expect(openPurchaseDoc).not.toHaveBeenCalled();
    expect(connectFromDocId).not.toHaveBeenCalled();
    expect(result.current.handle).toBeNull();
    expect(result.current.opening).toBe(false);
  });
});
