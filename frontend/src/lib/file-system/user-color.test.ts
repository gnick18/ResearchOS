// frontend/src/lib/file-system/user-color.test.ts
//
// Tests for the single-source deterministic per-user color helper. The point of
// this module is that the stored color, the metadata auto-assign fallback, the
// pre-folder picker fallback, and the roster materialize all resolve the SAME
// color for a member with no stored entry. These tests pin determinism and the
// cross-surface agreement so a future palette / hash edit can't silently make
// two surfaces disagree.

import { describe, it, expect } from "vitest";
import {
  deterministicUserColor,
  pickUserColor,
  USER_COLOR_PALETTE,
} from "./user-color";
import { fallbackColorForUsername } from "../colors";
import { fallbackUserColor } from "./user-metadata";

describe("deterministicUserColor", () => {
  it("is deterministic — same key always returns the same color", () => {
    const first = deterministicUserColor("alice");
    for (let i = 0; i < 50; i += 1) {
      expect(deterministicUserColor("alice")).toBe(first);
    }
  });

  it("always returns a swatch from the hex palette", () => {
    for (const key of ["a", "alice", "bob", "morgan", "mira", "zzzzzzzz", ""]) {
      expect(USER_COLOR_PALETTE).toContain(deterministicUserColor(key));
    }
  });

  it("never returns a rainbow sentinel (hex-only palette)", () => {
    for (const key of ["rainbow", "vivid", "alice", "x".repeat(100)]) {
      const c = deterministicUserColor(key);
      expect(c).not.toBe("rainbow");
      expect(c).not.toBe("rainbow-vivid");
      expect(c.startsWith("#")).toBe(true);
    }
  });

  it("spreads distinct keys across more than one swatch", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i += 1) seen.add(deterministicUserColor(`user-${i}`));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("pickUserColor", () => {
  it("prefers the first unused swatch", () => {
    const taken = new Set<string>();
    const a = pickUserColor(taken, "alice");
    expect(a).toBe(USER_COLOR_PALETTE[0]);
    taken.add(a);
    const b = pickUserColor(taken, "bob");
    expect(b).toBe(USER_COLOR_PALETTE[1]);
  });

  it("falls back to the deterministic hash once every swatch is taken", () => {
    const taken = new Set<string>(USER_COLOR_PALETTE);
    expect(pickUserColor(taken, "alice")).toBe(deterministicUserColor("alice"));
  });
});

describe("cross-surface agreement (the whole point of the dedupe)", () => {
  it("colors.ts fallbackColorForUsername == deterministicUserColor", () => {
    for (const key of ["alice", "bob", "morgan", "mira", "x", ""]) {
      expect(fallbackColorForUsername(key)).toBe(deterministicUserColor(key));
    }
  });

  it("user-metadata.ts fallbackUserColor == deterministicUserColor", () => {
    for (const key of ["alice", "bob", "morgan", "mira", "x", ""]) {
      expect(fallbackUserColor(key)).toBe(deterministicUserColor(key));
    }
  });

  it("matches what the roster materialize would ASSIGN a fresh co-member (empty taken set)", () => {
    // materialize uses pickUserColor(takenColors, username). With no colors yet
    // taken, the first member gets the first palette swatch — identical to what
    // a consumer computing the fallback for that same member would resolve once
    // it is the first unused swatch. Determinism here is the contract.
    const taken = new Set<string>();
    const assigned = pickUserColor(taken, "newmember");
    expect(USER_COLOR_PALETTE).toContain(assigned);
    // Re-running with the same taken-state is idempotent.
    expect(pickUserColor(new Set<string>(), "newmember")).toBe(assigned);
  });
});
