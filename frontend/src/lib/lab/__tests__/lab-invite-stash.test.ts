// @vitest-environment jsdom

// Invite-arrival detection (the onboarding join-vs-create branch). The chooser
// and the wizard read readPendingLabInvite / hasPendingLabInvite to keep an
// invited visitor on the JOIN path and never push them to create their own lab.
// These tests pin both invite shapes (signed fragment + bare server token), the
// expiry gate, and the malformed-stash cases.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { afterEach, describe, expect, it } from "vitest";
import { encodeInviteLink, type LabInvitePayload } from "@/lib/lab/lab-invite";
import {
  LAB_TOKEN_STASH_KEY,
  hasPendingLabInvite,
  readPendingLabInvite,
  stashInviteFragment,
  clearStashedInvite,
} from "@/lib/lab/lab-invite-stash";

function fragmentFor(p: LabInvitePayload): string {
  // The encoder puts the payload in the hash; the stash holds the bare fragment.
  return encodeInviteLink("https://research-os.app", p).split("#")[1];
}

function makePayload(over: Partial<LabInvitePayload> = {}): LabInvitePayload {
  return {
    labId: "lab_abc",
    headUsername: "emile",
    labName: "Fungal Interactions Lab",
    piTitle: "Dr.",
    nonce: "n0nce",
    sig: "deadbeef",
    headEd25519Pub: "ed",
    headX25519Pub: "x25519",
    expiresAt: Date.now() + 60_000,
    ...over,
  } as LabInvitePayload;
}

afterEach(() => {
  clearStashedInvite();
  try {
    sessionStorage.removeItem(LAB_TOKEN_STASH_KEY);
  } catch {
    /* ignore */
  }
});

describe("readPendingLabInvite", () => {
  it("returns null with no stash", () => {
    expect(readPendingLabInvite()).toBeNull();
    expect(hasPendingLabInvite()).toBe(false);
  });

  it("reads a valid signed fragment with its display fields", () => {
    stashInviteFragment(fragmentFor(makePayload()));
    const got = readPendingLabInvite();
    expect(got).toEqual({
      headUsername: "emile",
      labName: "Fungal Interactions Lab",
      labId: "lab_abc",
    });
    expect(hasPendingLabInvite()).toBe(true);
  });

  it("ignores an expired signed fragment", () => {
    stashInviteFragment(fragmentFor(makePayload({ expiresAt: Date.now() - 1 })));
    expect(readPendingLabInvite()).toBeNull();
    expect(hasPendingLabInvite()).toBe(false);
  });

  it("ignores a malformed fragment", () => {
    stashInviteFragment("not-a-real-fragment");
    expect(readPendingLabInvite()).toBeNull();
  });

  it("detects a bare server token in sessionStorage", () => {
    const token = "a".repeat(64);
    sessionStorage.setItem(LAB_TOKEN_STASH_KEY, token);
    expect(readPendingLabInvite()).toEqual({
      headUsername: "",
      labName: null,
      labId: null,
    });
    expect(hasPendingLabInvite()).toBe(true);
  });

  it("ignores a non-hex bare token", () => {
    sessionStorage.setItem(LAB_TOKEN_STASH_KEY, "zz-not-a-token");
    expect(readPendingLabInvite()).toBeNull();
  });

  it("prefers a valid signed fragment over a token", () => {
    stashInviteFragment(fragmentFor(makePayload({ headUsername: "grant" })));
    sessionStorage.setItem(LAB_TOKEN_STASH_KEY, "b".repeat(64));
    expect(readPendingLabInvite()?.headUsername).toBe("grant");
  });
});
