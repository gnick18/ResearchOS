// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  getDevicePeerId,
  _resetDevicePeerCacheForTests,
} from "../device-peer";

describe("getDevicePeerId (per-device stable peer)", () => {
  beforeEach(() => {
    _resetDevicePeerCacheForTests();
    localStorage.clear();
  });

  it("is stable across calls in a session, non-zero, and within u64 range", () => {
    const a = getDevicePeerId();
    expect(getDevicePeerId()).toBe(a);
    expect(a).not.toBe(BigInt(0));
    expect(a).toBeGreaterThan(BigInt(0));
    expect(a).toBeLessThan((BigInt(2) ** BigInt(64)));
  });

  it("persists across a simulated reload (module cache cleared, storage kept)", () => {
    const first = getDevicePeerId();
    // Simulate a page reload: the module is re-evaluated (cache lost) but
    // localStorage survives.
    _resetDevicePeerCacheForTests();
    const second = getDevicePeerId();
    expect(second).toBe(first);
  });

  it("generates a fresh value when both cache and storage are cleared", () => {
    getDevicePeerId();
    _resetDevicePeerCacheForTests();
    localStorage.clear();
    const fresh = getDevicePeerId();
    expect(fresh).toBeGreaterThan(BigInt(0));
    expect(fresh).toBeLessThan((BigInt(2) ** BigInt(64)));
  });
});
