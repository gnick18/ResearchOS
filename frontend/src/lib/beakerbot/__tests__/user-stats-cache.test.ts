// @vitest-environment jsdom
//
// frontend/src/lib/beakerbot/__tests__/user-stats-cache.test.ts
//
// Unit tests for readUserStats and writeUserStats. Uses jsdom so
// window.localStorage is available. SSR (no-window) behaviour is
// simulated by temporarily deleting globalThis.window.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readUserStats, writeUserStats } from "../user-stats-cache";
import type { UserStatsSummary } from "../user-stats-cache";

const SAMPLE: UserStatsSummary = {
  updatedAt: 1_718_000_000_000,
  experiments: 3,
  notes: 47,
  streakDays: 5,
};

describe("user-stats-cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  // ─── SSR safety ────────────────────────────────────────────────────────────

  it("readUserStats returns null on SSR (no window)", () => {
    // Temporarily shadow `window` to simulate SSR.
    const saved = globalThis.window;
    // @ts-expect-error -- intentional undefined to test SSR guard
    globalThis.window = undefined;
    try {
      const result = readUserStats("alice");
      expect(result).toBeNull();
    } finally {
      globalThis.window = saved;
    }
  });

  it("writeUserStats does not throw on SSR (no window)", () => {
    const saved = globalThis.window;
    // @ts-expect-error -- intentional undefined to test SSR guard
    globalThis.window = undefined;
    try {
      expect(() => writeUserStats("alice", SAMPLE)).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
  });

  // ─── Missing key ───────────────────────────────────────────────────────────

  it("returns null when the key has never been written", () => {
    expect(readUserStats("nobody")).toBeNull();
  });

  // ─── Round-trip ────────────────────────────────────────────────────────────

  it("reads back exactly what was written", () => {
    writeUserStats("alice", SAMPLE);
    const result = readUserStats("alice");
    expect(result).toEqual(SAMPLE);
  });

  it("overwrites a previous snapshot with the new one", () => {
    writeUserStats("alice", SAMPLE);
    const updated: UserStatsSummary = { ...SAMPLE, notes: 99, updatedAt: SAMPLE.updatedAt + 1000 };
    writeUserStats("alice", updated);
    expect(readUserStats("alice")).toEqual(updated);
  });

  // ─── Malformed JSON ────────────────────────────────────────────────────────

  it("returns null when the stored value is invalid JSON", () => {
    window.localStorage.setItem("ros:beakerbot-stats:alice", "not-json{{{");
    expect(readUserStats("alice")).toBeNull();
  });

  it("returns null when the stored value is an empty string", () => {
    window.localStorage.setItem("ros:beakerbot-stats:alice", "");
    // JSON.parse("") throws SyntaxError
    expect(readUserStats("alice")).toBeNull();
  });

  // ─── Per-user keying ───────────────────────────────────────────────────────

  it("stores user A and user B independently (no collision)", () => {
    const statsA: UserStatsSummary = { updatedAt: 1, experiments: 2 };
    const statsB: UserStatsSummary = { updatedAt: 2, notes: 500 };

    writeUserStats("alice", statsA);
    writeUserStats("bob", statsB);

    expect(readUserStats("alice")).toEqual(statsA);
    expect(readUserStats("bob")).toEqual(statsB);
  });

  it("writing for user B does not affect user A's cached stats", () => {
    writeUserStats("alice", SAMPLE);
    writeUserStats("bob", { updatedAt: 9999 });
    expect(readUserStats("alice")).toEqual(SAMPLE);
  });

  it("reading a different user when one user is set still returns null", () => {
    writeUserStats("alice", SAMPLE);
    expect(readUserStats("carol")).toBeNull();
  });

  // ─── Storage key format ────────────────────────────────────────────────────

  it("uses the expected localStorage key format", () => {
    writeUserStats("alice", SAMPLE);
    // Confirm the key is precisely `ros:beakerbot-stats:{user}`.
    const raw = window.localStorage.getItem("ros:beakerbot-stats:alice");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(SAMPLE);
  });
});
