// Lab tier Phase 8c: tests for the member accept + head verification.
//
// Most cases are rejections, the security-critical surface: wrong lab, forged
// invite (attacker pubkey), expired, tampered member pubkeys or sealed email.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { mintLabInvite, DEFAULT_INVITE_TTL_MS } from "./lab-invite";
import {
  buildAcceptPayload,
  verifyAccept,
  decryptAcceptEmail,
} from "./lab-accept";

const NOW = 1_000_000;

function edKeys() {
  const priv = ed25519.utils.randomSecretKey();
  return { priv, pub: bytesToHex(ed25519.getPublicKey(priv)) };
}
function xKeys() {
  const k = x25519.keygen();
  return { priv: k.secretKey, pub: bytesToHex(k.publicKey) };
}

function setup(opts: { expiresAt?: number } = {}) {
  const headEd = edKeys();
  const headX = xKeys();
  const memberEd = edKeys();
  const memberX = xKeys();
  const invite = mintLabInvite({
    labId: "lab-1",
    headUsername: "Manny",
    headEd25519Pub: headEd.pub,
    headX25519Pub: headX.pub,
    headEd25519Priv: headEd.priv,
    expiresAt: opts.expiresAt ?? NOW + DEFAULT_INVITE_TTL_MS,
    nonce: "ab".repeat(32),
  });
  const accept = buildAcceptPayload({
    invite,
    memberUsername: "Rosa",
    memberEmail: "  Rosa.Dev@Gmail.com ",
    memberX25519Pub: memberX.pub,
    memberEd25519Pub: memberEd.pub,
    memberEd25519Priv: memberEd.priv,
  });
  return { headEd, headX, memberEd, memberX, invite, accept };
}

describe("buildAcceptPayload + verifyAccept (happy path)", () => {
  it("a well-formed accept verifies", () => {
    const { accept, headEd } = setup();
    const r = verifyAccept({
      accept, expectedLabId: "lab-1", headEd25519Pub: headEd.pub, now: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it("the head decrypts the member email (canonicalized)", () => {
    const { accept, headX } = setup();
    expect(decryptAcceptEmail(accept, headX.priv)).toBe("rosa.dev@gmail.com");
  });

  it("seals the email so the relay cannot read it (ciphertext, not the email)", () => {
    const { accept } = setup();
    expect(accept.sealedEmail).toMatch(/^[0-9a-f]+$/);
    expect(accept.sealedEmail.toLowerCase()).not.toContain("726f7361"); // "rosa" hex
  });
});

describe("verifyAccept (rejections)", () => {
  it("rejects an accept for a different lab", () => {
    const { accept, headEd } = setup();
    const r = verifyAccept({ accept, expectedLabId: "lab-OTHER", headEd25519Pub: headEd.pub, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("different lab");
  });

  it("rejects a forged invite self-signed with an attacker pubkey", () => {
    // Attacker mints their OWN invite for lab-1 (their key), builds a valid
    // accept for it. The invite signature verifies under the attacker pubkey,
    // but the head-pubkey cross-check rejects it.
    const attackerEd = edKeys();
    const attackerX = xKeys();
    const realHeadEd = edKeys();
    const forgedInvite = mintLabInvite({
      labId: "lab-1", headUsername: "Manny",
      headEd25519Pub: attackerEd.pub, headX25519Pub: attackerX.pub,
      headEd25519Priv: attackerEd.priv,
      expiresAt: NOW + 1000, nonce: "ff".repeat(32),
    });
    const memberEd = edKeys();
    const memberX = xKeys();
    const accept = buildAcceptPayload({
      invite: forgedInvite, memberUsername: "Mallory", memberEmail: "m@x.com",
      memberX25519Pub: memberX.pub, memberEd25519Pub: memberEd.pub, memberEd25519Priv: memberEd.priv,
    });
    const r = verifyAccept({ accept, expectedLabId: "lab-1", headEd25519Pub: realHeadEd.pub, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("head pubkey");
  });

  it("rejects an expired invite", () => {
    const { accept, headEd } = setup({ expiresAt: NOW - 1 });
    const r = verifyAccept({ accept, expectedLabId: "lab-1", headEd25519Pub: headEd.pub, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("expired");
  });

  it("rejects a swapped member X25519 pubkey (member sig fails)", () => {
    const { accept, headEd } = setup();
    const attackerX = xKeys();
    const tampered = { ...accept, memberX25519Pub: attackerX.pub };
    const r = verifyAccept({ accept: tampered, expectedLabId: "lab-1", headEd25519Pub: headEd.pub, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("member signature");
  });

  it("rejects a tampered sealedEmail (member sig fails)", () => {
    const { accept, headEd } = setup();
    const tampered = { ...accept, sealedEmail: accept.sealedEmail.slice(0, -2) + "00" };
    const r = verifyAccept({ accept: tampered, expectedLabId: "lab-1", headEd25519Pub: headEd.pub, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("member signature");
  });

  it("rejects a nonce that does not match the echoed invite", () => {
    const { accept, headEd } = setup();
    const tampered = { ...accept, nonce: "cc".repeat(32) };
    const r = verifyAccept({ accept: tampered, expectedLabId: "lab-1", headEd25519Pub: headEd.pub, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("nonce mismatch");
  });

  it("rejects when the decrypt key is wrong (tamper or wrong head device)", () => {
    const { accept } = setup();
    const wrongX = xKeys();
    expect(() => decryptAcceptEmail(accept, wrongX.priv)).toThrow();
  });
});
