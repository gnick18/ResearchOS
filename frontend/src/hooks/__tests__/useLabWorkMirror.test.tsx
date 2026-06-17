// Tests for useLabWorkMirror.
//
// Coverage:
//   (a) Runs once when the session transitions to live.
//   (b) Does NOT run while the session is locked.
//   (c) Min-interval guard skips a too-soon second trigger.
//   (d) In-flight guard prevents overlapping runs.
//
// All external I/O is replaced by injected fakes. A tiny fake controller
// (getState + subscribe) is driven between "locked" and "live" states to
// simulate transitions. Fake timers keep the tests deterministic.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Inline fake controller factory.
// ---------------------------------------------------------------------------

type SimpleState = { kind: "locked" } | {
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

  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    // Test helper: transition the state and notify subscribers.
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

// ---------------------------------------------------------------------------
// Import under test AFTER setting up mocks.
// ---------------------------------------------------------------------------

import { useLabWorkMirror } from "../useLabWorkMirror";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children?: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

// ---------------------------------------------------------------------------
// Shared test deps.
// ---------------------------------------------------------------------------

const FAST_DEPS = {
  periodMs: 500,
  debounceMs: 100,
  minIntervalMs: 50,
};

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("useLabWorkMirror", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  // (a) Runs once when the session transitions to live.
  it("runs runSync once when the session becomes live", async () => {
    const controller = makeFakeController({ kind: "locked" });
    const runSync = vi.fn().mockResolvedValue({ ran: true, owner: "alice" });

    renderHook(
      () =>
        useLabWorkMirror(controller as never, {
          ...FAST_DEPS,
          runSync,
          makeSource: () => ({} as never),
          makeManifestStore: () => ({} as never),
          now: () => 0,
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    // Starts locked: no run yet.
    expect(runSync).not.toHaveBeenCalled();

    // Transition to live, then flush the microtask queue so the async
    // runIfLive() call completes.
    act(() => {
      controller._setState(LIVE_STATE);
    });
    // Drain the microtask queue (the void async chain resolves here).
    await act(async () => {
      await Promise.resolve();
    });

    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith(
      LIVE_STATE,
      expect.objectContaining({ source: expect.anything(), manifestStore: expect.anything() }),
    );
  });

  // (b) Does NOT run while the session is locked.
  it("does not call runSync when the session is locked", async () => {
    const controller = makeFakeController({ kind: "locked" });
    const runSync = vi.fn().mockResolvedValue({ ran: false, reason: "session not live" });

    renderHook(
      () =>
        useLabWorkMirror(controller as never, {
          ...FAST_DEPS,
          runSync,
          makeSource: () => ({} as never),
          makeManifestStore: () => ({} as never),
          now: () => 0,
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    // Advance past both the initial call and the periodic interval.
    await act(async () => {
      vi.advanceTimersByTime(FAST_DEPS.periodMs + FAST_DEPS.periodMs);
    });

    // runSync is never called because the state is locked throughout.
    expect(runSync).not.toHaveBeenCalled();
  });

  // (c) Min-interval guard skips a too-soon second run.
  it("skips a second run that fires before minIntervalMs has elapsed", async () => {
    let nowValue = 0;
    const controller = makeFakeController(LIVE_STATE);
    const runSync = vi.fn().mockImplementation(async () => {
      // Simulate a sync that takes 1 ms.
      return { ran: true };
    });

    renderHook(
      () =>
        useLabWorkMirror(controller as never, {
          ...FAST_DEPS,
          runSync,
          makeSource: () => ({} as never),
          makeManifestStore: () => ({} as never),
          now: () => nowValue,
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    // The initial effect fires immediately (session already live).
    // Flush microtasks so the async runIfLive() completes and lastRunAt is set.
    await act(async () => {
      await Promise.resolve();
    });
    expect(runSync).toHaveBeenCalledTimes(1);

    // Advance clock by less than minIntervalMs, then fire a second subscribe
    // notification. The second run must be skipped.
    nowValue = FAST_DEPS.minIntervalMs - 1; // 49 ms: too soon
    act(() => {
      controller._setState({ ...LIVE_STATE }); // triggers subscriber
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Still only one call.
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  // (d) In-flight guard prevents overlap.
  it("does not start a second sync while one is already in flight", async () => {
    let resolveFirst: (() => void) | null = null;
    const firstRunPromise = new Promise<void>((res) => {
      resolveFirst = res;
    });

    const controller = makeFakeController({ kind: "locked" });
    // The first run hangs until we manually resolve it.
    const runSync = vi
      .fn()
      .mockReturnValueOnce(firstRunPromise)
      .mockResolvedValue({ ran: true });

    renderHook(
      () =>
        useLabWorkMirror(controller as never, {
          ...FAST_DEPS,
          runSync,
          makeSource: () => ({} as never),
          makeManifestStore: () => ({} as never),
          now: () => 0,
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    // Go live: triggers the first (hanging) run.
    act(() => {
      controller._setState(LIVE_STATE);
    });
    // Flush microtasks so runIfLive starts (and hangs on firstRunPromise).
    await act(async () => {
      await Promise.resolve();
    });
    expect(runSync).toHaveBeenCalledTimes(1);

    // Trigger again while the first run is still in flight.
    act(() => {
      controller._setState({ ...LIVE_STATE });
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Still only one call; the in-flight guard blocked the second attempt.
    expect(runSync).toHaveBeenCalledTimes(1);

    // Resolve the first run; subsequent triggers can fire again.
    await act(async () => {
      resolveFirst!();
      await Promise.resolve();
    });
  });

  // (e) No-op when controller is null.
  it("is a no-op when controller is null", async () => {
    const runSync = vi.fn();

    renderHook(
      () =>
        useLabWorkMirror(null, {
          ...FAST_DEPS,
          runSync,
          makeSource: () => ({} as never),
          makeManifestStore: () => ({} as never),
          now: () => 0,
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      vi.advanceTimersByTime(FAST_DEPS.periodMs * 2);
    });

    expect(runSync).not.toHaveBeenCalled();
  });
});
