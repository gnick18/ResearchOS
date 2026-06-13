// Tests for dept-invite.ts (Department tier Phase 1, the signed invite link).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  mintDeptInvite,
  verifyDeptInviteSignature,
  isDeptInviteExpired,
  encodeDeptInviteLink,
  decodeDeptInviteFragment,
  canonicalDeptInviteMessage,
} from "../dept-invite";

function keypair() {
  const priv = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(priv);
  return { priv, pub: bytesToHex(pub) };
}

function mint(over: Partial<Parameters<typeof mintDeptInvite>[0]> = {}) {
  const kp = keypair();
  const invite = mintDeptInvite({
    deptId: "dept-micro",
    deptName: "Department of Microbiology",
    adminUsername: "vega",
    adminEd25519Pub: kp.pub,
    adminEd25519Priv: kp.priv,
    expiresAt: 9_999_999_999_999,
    nonce: "fixednonce",
    ...over,
  });
  return { invite, kp };
}

describe("dept-invite", () => {
  it("mints an invite whose signature verifies under the carried pubkey", () => {
    const { invite } = mint();
    expect(verifyDeptInviteSignature(invite)).toBe(true);
    expect(invite.deptId).toBe("dept-micro");
    expect(invite.nonce).toBe("fixednonce");
  });

  it("rejects a tampered deptId", () => {
    const { invite } = mint();
    expect(verifyDeptInviteSignature({ ...invite, deptId: "dept-other" })).toBe(false);
  });

  it("rejects a tampered expiresAt (a stale link cannot be extended)", () => {
    const { invite } = mint();
    expect(verifyDeptInviteSignature({ ...invite, expiresAt: 1 })).toBe(false);
  });

  it("rejects a swapped pubkey (self-signed-with-own-key attack)", () => {
    const { invite } = mint();
    const attacker = keypair();
    expect(
      verifyDeptInviteSignature({ ...invite, adminEd25519Pub: attacker.pub }),
    ).toBe(false);
  });

  it("domain-separates from lab invites via the verb prefix", () => {
    expect(
      canonicalDeptInviteMessage({ deptId: "d", nonce: "n", expiresAt: 5 }),
    ).toBe("dept-invite\nd\nn\n5");
  });

  it("flags expiry relative to now", () => {
    const { invite } = mint({ expiresAt: 1000 });
    expect(isDeptInviteExpired(invite, 999)).toBe(false);
    expect(isDeptInviteExpired(invite, 1000)).toBe(true);
    expect(isDeptInviteExpired(invite, 2000)).toBe(true);
  });

  it("round-trips through the link fragment", () => {
    const { invite } = mint();
    const link = encodeDeptInviteLink("https://research-os.app", invite);
    expect(link.startsWith("https://research-os.app/dept/join#")).toBe(true);
    const frag = link.split("#")[1];
    const decoded = decodeDeptInviteFragment(frag);
    expect(decoded).toEqual(invite);
    // still verifies after the round trip
    expect(verifyDeptInviteSignature(decoded!)).toBe(true);
  });

  it("returns null on a malformed fragment, never throws", () => {
    expect(decodeDeptInviteFragment("not-base64!!")).toBeNull();
    expect(decodeDeptInviteFragment("")).toBeNull();
    expect(decodeDeptInviteFragment(btoa(JSON.stringify({ deptId: "x" })))).toBeNull();
  });
});
