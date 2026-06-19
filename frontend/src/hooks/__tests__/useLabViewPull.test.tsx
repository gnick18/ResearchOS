// Multi-lab P2: tests for useLabViewPull.
//
// Coverage:
//   (a) FLAG OFF (enabled: false) is byte-identical to no-op: never subscribes,
//       never runs the pull, even when the session is live. This is the
//       byte-identical-flag-off guarantee.
//   (b) FLAG ON runs the pull once when the session becomes live.
//   (c) controller === null is a complete no-op even with the flag on.
//
// All external I/O is replaced by injected fakes. A tiny fake controller drives
// the state between "locked" and "live". The flag is forced via the test-only
// `enabled` dep so the suite never depends on the ambient env flag.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type SimpleState =
  | { kind: "locked" }
  | {
      kind: "live";
      labId: string;
      labKey: Uint8Array;
      signingKeyPair: { ed25519Priv: Uint8Array; ed25519Pub: Uint8Array };
      member: { username: string; labId: string };
      graceUntil: number | null;
    };

function makeFakeController(initial: SimpleState = { kind: "locked" }) {
  let state: SimpleState = initial;
  const listeners = new Set<() => void>();
  let subscribeCalls = 0;
  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      subscribeCalls += 1;
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    _subscribeCalls: () => subscribeCalls,
    _setState(next: SimpleState) {
      state = next;
      for (const fn of listeners) fn();
    },
  };
}

const LIVE_STATE: SimpleState = {
  kind: "live",
  labId: "lab-1",
  labKey: new Uint8Array(32),
  signingKeyPair: {
    ed25519Priv: new Uint8Array(32),
    ed25519Pub: new Uint8Array(32),
  },
  member: { username: "alice", labId: "lab-1" },
  graceUntil: null,
};

import { useLabViewPull } from "../useLabViewPull";

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children?: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const FAST_DEPS = {
  periodMs: 500,
  debounceMs: 100,
  minIntervalMs: 50,
};

describe("useLabViewPull", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  // (a) FLAG OFF: byte-identical no-op.
  it("does NOTHING when the flag is off, even on a live session", async () => {
    const controller = makeFakeController(LIVE_STATE);
    const runPull = vi.fn().mockResolvedValue({ ran: true });

    renderHook(
      () =>
        useLabViewPull(controller as never, {
          ...FAST_DEPS,
          runPull,
          now: () => 0,
          enabled: false,
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await Promise.resolve();
    });

    // No subscription, no pull: the hook registered no effects at all.
    expect(controller._subscribeCalls()).toBe(0);
    expect(runPull).not.toHaveBeenCalled();
  });

  // (b) FLAG ON: runs once when the session becomes live.
  it("runs runPull once when the session becomes live (flag on)", async () => {
    const controller = makeFakeController({ kind: "locked" });
    const runPull = vi.fn().mockResolvedValue({ ran: true });

    renderHook(
      () =>
        useLabViewPull(controller as never, {
          ...FAST_DEPS,
          runPull,
          now: () => 0,
          enabled: true,
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    expect(runPull).not.toHaveBeenCalled();

    await act(async () => {
      controller._setState(LIVE_STATE);
      await Promise.resolve();
    });

    expect(runPull).toHaveBeenCalledTimes(1);
    expect(runPull.mock.calls[0][0]).toMatchObject({ kind: "live" });
  });

  // (c) controller null is a complete no-op even with the flag on.
  it("does nothing when controller is null (flag on)", async () => {
    const runPull = vi.fn().mockResolvedValue({ ran: true });
    renderHook(
      () =>
        useLabViewPull(null, {
          ...FAST_DEPS,
          runPull,
          now: () => 0,
          enabled: true,
        }),
      { wrapper: makeWrapper(queryClient) },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(runPull).not.toHaveBeenCalled();
  });
});
