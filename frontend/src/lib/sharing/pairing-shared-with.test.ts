// Shared Notebooks Phase 1 (notebooks-data bot, 2026-06-02). Pure-function
// coverage for `pairingSharedWith` and its interplay with the unified
// canRead / canWrite gates. No file system: this asserts the SHAPE the helper
// produces and that the two members (and only them) get read + write.

import { describe, expect, it } from "vitest";
import {
  pairingSharedWith,
  canRead,
  canWrite,
  NEVER_UNLOCKED,
  type Viewer,
} from "./unified";

const member = (username: string): Viewer => ({
  username,
  account_type: "lab",
});

describe("pairingSharedWith", () => {
  it("returns both usernames at level edit", () => {
    expect(pairingSharedWith("pi", "student")).toEqual([
      { username: "pi", level: "edit" },
      { username: "student", level: "edit" },
    ]);
  });

  it("deduplicates a degenerate self-pairing to a single entry", () => {
    expect(pairingSharedWith("solo", "solo")).toEqual([
      { username: "solo", level: "edit" },
    ]);
  });

  it("skips empty / non-string usernames defensively", () => {
    expect(pairingSharedWith("pi", "")).toEqual([
      { username: "pi", level: "edit" },
    ]);
    expect(
      pairingSharedWith(undefined as unknown as string, "student"),
    ).toEqual([{ username: "student", level: "edit" }]);
  });

  it("returns a new array (no shared reference between calls)", () => {
    const a = pairingSharedWith("x", "y");
    const b = pairingSharedWith("x", "y");
    expect(a).not.toBe(b);
  });
});

describe("pairingSharedWith feeds the unified read/write gates", () => {
  // A record owned by "pi" and pair-shared with the student. owner is the
  // creator; the student is reachable only via the explicit edit entry.
  const record = {
    owner: "pi",
    shared_with: pairingSharedWith("pi", "student"),
  };

  it("both members can READ", () => {
    expect(canRead(record, member("pi"))).toBe(true);
    expect(canRead(record, member("student"))).toBe(true);
  });

  it("both members can WRITE without any lab_head bypass", () => {
    // NEVER_UNLOCKED proves write comes from the explicit edit entry, not the
    // PI edit-session override.
    expect(canWrite(record, member("pi"), NEVER_UNLOCKED)).toBe(true);
    expect(canWrite(record, member("student"), NEVER_UNLOCKED)).toBe(true);
  });

  it("a non-member plain user can neither read nor write", () => {
    expect(canRead(record, member("other"))).toBe(false);
    expect(canWrite(record, member("other"), NEVER_UNLOCKED)).toBe(false);
  });

  it("a lab_head non-member reads via implicit view-all (expected), but has no implicit write", () => {
    const piNonMember: Viewer = { username: "boss", account_type: "lab_head" };
    expect(canRead(record, piNonMember)).toBe(true);
    // canWrite for a lab_head is gated on the edit session; NEVER_UNLOCKED
    // denies it, so no silent write without the explicit pairing entry.
    expect(canWrite(record, piNonMember, NEVER_UNLOCKED)).toBe(false);
  });
});
