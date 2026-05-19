// Unit tests for the module-private password cache. Verifies the
// set/get/clear contract that the 5 wipe triggers (constraint 2) and the
// encrypted-backup decrypt paths rely on.

import { afterEach, describe, expect, it } from "vitest";

import {
  clearCachedPassword,
  getCachedPassword,
  hasCachedPassword,
  setCachedPassword,
} from "./cached-password";

afterEach(() => {
  // Module state survives across tests in the same suite; always reset
  // back to the empty contract so a leaked password from one test cannot
  // accidentally satisfy assertions in another.
  clearCachedPassword();
});

describe("cached-password", () => {
  it("starts empty (getCachedPassword returns null before any set)", () => {
    expect(getCachedPassword()).toBeNull();
    expect(hasCachedPassword()).toBe(false);
  });

  it("set + get round-trip", () => {
    setCachedPassword("correct horse battery staple");
    expect(getCachedPassword()).toBe("correct horse battery staple");
    expect(hasCachedPassword()).toBe(true);
  });

  it("clear returns to null state", () => {
    setCachedPassword("hunter2");
    clearCachedPassword();
    expect(getCachedPassword()).toBeNull();
    expect(hasCachedPassword()).toBe(false);
  });

  it("clear is idempotent (calling on already-empty cache is fine)", () => {
    expect(getCachedPassword()).toBeNull();
    clearCachedPassword();
    clearCachedPassword();
    expect(getCachedPassword()).toBeNull();
  });

  it("multiple set calls overwrite cleanly", () => {
    setCachedPassword("first");
    expect(getCachedPassword()).toBe("first");
    setCachedPassword("second");
    expect(getCachedPassword()).toBe("second");
    setCachedPassword("third");
    expect(getCachedPassword()).toBe("third");
  });

  it("empty-string passwords are allowed (caller verifies semantics)", () => {
    // The cache is a dumb container — verifyPassword decides what counts
    // as a valid password. An empty string is distinct from `null`
    // (cleared) so consumers can tell the two states apart.
    setCachedPassword("");
    expect(getCachedPassword()).toBe("");
    expect(hasCachedPassword()).toBe(true);
  });
});
