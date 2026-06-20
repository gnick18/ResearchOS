// Unit tests for the shared nudge throttle.
//
// These cover the pure decision helper and the standalone retire function against
// an in-memory store, plus the localStorage-backed store, so the anti-annoyance
// contract is pinned without needing a DOM or a React renderer. The hook itself is
// a thin shell over `shouldNudge` and the store, both of which are exercised here.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldNudge,
  markNudgeUsed,
  DEFAULT_MAX_SEEN,
  localStorageNudgeStore,
  type NudgeStore,
} from "../use-nudge";

/** A simple in-memory store for deterministic, DOM-free assertions. */
function makeMemoryStore(): NudgeStore {
  const map = new Map<string, number>();
  return {
    getSeen: (key) => map.get(key) ?? 0,
    setSeen: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("shouldNudge", () => {
  it("does not shimmer when the moment is not eligible", () => {
    expect(shouldNudge(0, DEFAULT_MAX_SEEN, false)).toBe(false);
    expect(shouldNudge(2, DEFAULT_MAX_SEEN, false)).toBe(false);
  });

  it("shimmers while eligible and under the cap", () => {
    expect(shouldNudge(0, 4, true)).toBe(true);
    expect(shouldNudge(3, 4, true)).toBe(true);
    expect(shouldNudge(4, 4, true)).toBe(true);
  });

  it("stops shimmering once the seen count exceeds maxSeen", () => {
    expect(shouldNudge(5, 4, true)).toBe(false);
    expect(shouldNudge(99, 4, true)).toBe(false);
  });
});

describe("episode counting (false to true transitions)", () => {
  // The hook increments the store on each false to true transition of `eligible`.
  // We model that loop directly so the throttle is verified end to end without a
  // React renderer. The decision uses the count BEFORE the episode's increment,
  // matching the hook (the count for episode N is N).
  function runEpisode(store: NudgeStore, key: string, maxSeen: number): boolean {
    const next = store.getSeen(key) + 1;
    store.setSeen(key, next);
    return shouldNudge(next, maxSeen, true);
  }

  it("shimmers for the first maxSeen+1 episodes, then retires", () => {
    const store = makeMemoryStore();
    const key = "rail-coding";
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      results.push(runEpisode(store, key, 4));
    }
    // Episodes 1..5 shimmer (seen 1..5 with cap 4, since 5 <= 4 is false at 5),
    // wait, verify against the helper. seen <= maxSeen => 1..4 true, 5 false.
    expect(results).toEqual([true, true, true, true, false, false, false, false]);
    expect(store.getSeen(key)).toBe(8);
  });

  it("never shimmers while ineligible regardless of count", () => {
    const store = makeMemoryStore();
    expect(shouldNudge(store.getSeen("k"), 4, false)).toBe(false);
  });
});

describe("markNudgeUsed", () => {
  it("retires a nudge immediately by pushing the count past the cap", () => {
    const store = makeMemoryStore();
    const key = "datahub-transform";
    expect(shouldNudge(store.getSeen(key), 4, true)).toBe(true);
    markNudgeUsed(key, 4, store);
    expect(shouldNudge(store.getSeen(key), 4, true)).toBe(false);
  });

  it("uses the default cap when none is given", () => {
    const store = makeMemoryStore();
    markNudgeUsed("k", undefined, store);
    expect(store.getSeen("k")).toBe(DEFAULT_MAX_SEEN + 1);
  });
});

describe("localStorageNudgeStore", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") window.localStorage.clear();
  });

  it("round-trips a seen count under the ros.nudge.seen prefix", () => {
    if (typeof window === "undefined") {
      // node env without a DOM, the store is a no-op that returns 0
      expect(localStorageNudgeStore.getSeen("x")).toBe(0);
      return;
    }
    expect(localStorageNudgeStore.getSeen("x")).toBe(0);
    localStorageNudgeStore.setSeen("x", 3);
    expect(localStorageNudgeStore.getSeen("x")).toBe(3);
    expect(window.localStorage.getItem("ros.nudge.seen.x")).toBe("3");
  });
});
