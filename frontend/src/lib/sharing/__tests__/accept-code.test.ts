// Cross-boundary sharing, accept-page key parsing (P1-A).
//
// readFragmentKey recovers the one-time key from a sender-delivered private
// link's URL fragment; parseUnlockCode recovers it from what the recipient pastes
// when they arrived via the keyless email link. Both are pure and never touch the
// network, which is the property that keeps the key off our servers.

import { describe, expect, it } from "vitest";

import {
  KEY_HEX_RE,
  readFragmentKey,
  parseUnlockCode,
} from "../accept-code";

const KEY = "a".repeat(64); // 64 lowercase hex chars
const UPPER = "A".repeat(64);

describe("readFragmentKey", () => {
  it("reads a valid #k=<hex> fragment", () => {
    expect(readFragmentKey(`#k=${KEY}`)).toBe(KEY);
  });

  it("lowercases an upper-case fragment so a hand-copied link still opens", () => {
    expect(readFragmentKey(`#k=${UPPER}`)).toBe(KEY);
  });

  it("reads k= when it is not the first fragment param", () => {
    expect(readFragmentKey(`#foo=1&k=${KEY}`)).toBe(KEY);
  });

  it("returns null for a missing fragment", () => {
    expect(readFragmentKey("")).toBeNull();
    expect(readFragmentKey("#")).toBeNull();
    expect(readFragmentKey("#other=1")).toBeNull();
  });

  it("returns null for a malformed (wrong-length) key", () => {
    expect(readFragmentKey("#k=deadbeef")).toBeNull();
    expect(readFragmentKey(`#k=${KEY}ff`)).toBeNull(); // 66 chars
  });
});

describe("parseUnlockCode", () => {
  it("accepts a bare 64-hex code", () => {
    expect(parseUnlockCode(KEY)).toBe(KEY);
  });

  it("lowercases and trims a pasted bare code", () => {
    expect(parseUnlockCode(`   ${UPPER}  `)).toBe(KEY);
  });

  it("recovers the key from a pasted full private link", () => {
    expect(
      parseUnlockCode(`https://research-os.app/accept/abc-123#k=${KEY}`),
    ).toBe(KEY);
  });

  it("recovers the key from a pasted #k= fragment alone", () => {
    expect(parseUnlockCode(`#k=${KEY}`)).toBe(KEY);
  });

  it("recovers the key from a pasted k=<hex> with no hash", () => {
    expect(parseUnlockCode(`k=${KEY}`)).toBe(KEY);
  });

  it("returns null for empty or junk input", () => {
    expect(parseUnlockCode("")).toBeNull();
    expect(parseUnlockCode("   ")).toBeNull();
    expect(parseUnlockCode("not a code")).toBeNull();
    expect(parseUnlockCode("deadbeef")).toBeNull(); // too short
  });
});

describe("KEY_HEX_RE", () => {
  it("matches exactly 64 lowercase hex chars", () => {
    expect(KEY_HEX_RE.test(KEY)).toBe(true);
    expect(KEY_HEX_RE.test(UPPER)).toBe(false); // upper rejected by the canonical re
    expect(KEY_HEX_RE.test("a".repeat(63))).toBe(false);
    expect(KEY_HEX_RE.test("g".repeat(64))).toBe(false);
  });
});
