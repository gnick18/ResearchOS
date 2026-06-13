// Tests for institution-invite.ts (Institution tier Phase 4, the signed link).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  mintInstitutionInvite,
  verifyInstitutionInviteSignature,
  isInstitutionInviteExpired,
  encodeInstitutionInviteLink,
  decodeInstitutionInviteFragment,
  canonicalInstitutionInviteMessage,
} from "../institution-invite";

function keypair() {
  const priv = ed25519.utils.randomSecretKey();
  return { priv, pub: bytesToHex(ed25519.getPublicKey(priv)) };
}
function mint(over: Partial<Parameters<typeof mintInstitutionInvite>[0]> = {}) {
  const kp = keypair();
  return mintInstitutionInvite({
    institutionId: "inst-uw",
    institutionName: "UW-Madison",
    adminUsername: "vega",
    adminEd25519Pub: kp.pub,
    adminEd25519Priv: kp.priv,
    expiresAt: 9_999_999_999_999,
    nonce: "fixednonce",
    ...over,
  });
}

describe("institution-invite", () => {
  it("mints an invite that verifies under the carried pubkey", () => {
    const inv = mint();
    expect(verifyInstitutionInviteSignature(inv)).toBe(true);
    expect(inv.institutionId).toBe("inst-uw");
  });

  it("rejects tampering with id, expiry, or signer", () => {
    const inv = mint();
    expect(verifyInstitutionInviteSignature({ ...inv, institutionId: "x" })).toBe(false);
    expect(verifyInstitutionInviteSignature({ ...inv, expiresAt: 1 })).toBe(false);
    expect(
      verifyInstitutionInviteSignature({ ...inv, adminEd25519Pub: keypair().pub }),
    ).toBe(false);
  });

  it("domain-separates from dept + lab invites", () => {
    expect(
      canonicalInstitutionInviteMessage({ institutionId: "i", nonce: "n", expiresAt: 5 }),
    ).toBe("institution-invite\ni\nn\n5");
  });

  it("flags expiry relative to now", () => {
    const inv = mint({ expiresAt: 1000 });
    expect(isInstitutionInviteExpired(inv, 999)).toBe(false);
    expect(isInstitutionInviteExpired(inv, 1000)).toBe(true);
  });

  it("round-trips through the link fragment", () => {
    const inv = mint();
    const link = encodeInstitutionInviteLink("https://research-os.app", inv);
    expect(link.startsWith("https://research-os.app/institution/join#")).toBe(true);
    const decoded = decodeInstitutionInviteFragment(link.split("#")[1]);
    expect(decoded).toEqual(inv);
    expect(verifyInstitutionInviteSignature(decoded!)).toBe(true);
  });

  it("returns null on malformed input, never throws", () => {
    expect(decodeInstitutionInviteFragment("not-b64!!")).toBeNull();
    expect(decodeInstitutionInviteFragment("")).toBeNull();
  });
});
