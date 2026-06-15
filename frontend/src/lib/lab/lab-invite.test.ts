// Lab tier Phase 8b: tests for the head-minted invite link.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  mintLabInvite,
  verifyInviteSignature,
  isInviteExpired,
  encodeInviteLink,
  decodeInviteFragment,
  canonicalInviteMessage,
  DEFAULT_INVITE_TTL_MS,
} from "./lab-invite";

function headKeys() {
  const edPriv = ed25519.utils.randomSecretKey();
  const edPub = bytesToHex(ed25519.getPublicKey(edPriv));
  const xk = x25519.keygen();
  return { edPriv, edPub, xPub: bytesToHex(xk.publicKey) };
}

function mint(overrides: Partial<Parameters<typeof mintLabInvite>[0]> = {}) {
  const h = headKeys();
  return mintLabInvite({
    labId: "lab-1",
    headUsername: "Manny",
    headEd25519Pub: h.edPub,
    headX25519Pub: h.xPub,
    headEd25519Priv: h.edPriv,
    expiresAt: 1_000_000 + DEFAULT_INVITE_TTL_MS,
    nonce: "ab".repeat(32),
    ...overrides,
  });
}

describe("mintLabInvite + verifyInviteSignature", () => {
  it("a freshly minted invite verifies", () => {
    expect(verifyInviteSignature(mint())).toBe(true);
  });

  it("generates a random 64-hex nonce when none supplied", () => {
    const h = headKeys();
    const inv = mintLabInvite({
      labId: "lab-1", headUsername: "Manny",
      headEd25519Pub: h.edPub, headX25519Pub: h.xPub, headEd25519Priv: h.edPriv,
      expiresAt: 2_000_000,
    });
    expect(inv.nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a tampered labId", () => {
    const inv = { ...mint(), labId: "lab-EVIL" };
    expect(verifyInviteSignature(inv)).toBe(false);
  });

  it("rejects a tampered nonce", () => {
    const inv = { ...mint(), nonce: "cd".repeat(32) };
    expect(verifyInviteSignature(inv)).toBe(false);
  });

  it("rejects a tampered expiresAt (no silent extension)", () => {
    const inv = { ...mint(), expiresAt: 9_999_999_999_999 };
    expect(verifyInviteSignature(inv)).toBe(false);
  });

  it("rejects a swapped head pubkey (self-signed by an attacker key)", () => {
    // Attacker re-signs the same payload with their own key + pubkey. The
    // signature is internally consistent, so verifyInviteSignature passes here,
    // but verifyAccept's head-pubkey cross-check (lab-accept.test.ts) rejects it.
    // This test pins that a DIFFERENT pubkey with the ORIGINAL sig fails.
    const real = mint();
    const attacker = headKeys();
    const forged = { ...real, headEd25519Pub: attacker.edPub };
    expect(verifyInviteSignature(forged)).toBe(false);
  });

  it("rejects malformed signature/pubkey hex without throwing", () => {
    expect(verifyInviteSignature({ ...mint(), sig: "zz" })).toBe(false);
    expect(verifyInviteSignature({ ...mint(), headEd25519Pub: "nothex" })).toBe(false);
  });

  it("canonical message is stable and verb-prefixed", () => {
    expect(canonicalInviteMessage({ labId: "L", nonce: "N", expiresAt: 5 })).toBe(
      "lab-invite\nL\nN\n5",
    );
  });
});

describe("isInviteExpired", () => {
  it("is false before and true at/after expiry", () => {
    const inv = mint({ expiresAt: 1000 });
    expect(isInviteExpired(inv, 999)).toBe(false);
    expect(isInviteExpired(inv, 1000)).toBe(true);
    expect(isInviteExpired(inv, 1001)).toBe(true);
  });
});

describe("encodeInviteLink + decodeInviteFragment", () => {
  it("round-trips a payload through the link fragment", () => {
    const inv = mint();
    const link = encodeInviteLink("https://app.test", inv);
    expect(link.startsWith("https://app.test/lab/join#")).toBe(true);
    const frag = link.split("#")[1];
    const decoded = decodeInviteFragment(frag);
    expect(decoded).toEqual(inv);
    // and the decoded invite still verifies
    expect(verifyInviteSignature(decoded!)).toBe(true);
  });

  it("tolerates a leading # on the fragment", () => {
    const inv = mint();
    const frag = encodeInviteLink("https://x", inv).split("#")[1];
    expect(decodeInviteFragment("#" + frag)).toEqual(inv);
  });

  it("returns null for garbage or a payload missing fields", () => {
    expect(decodeInviteFragment("not-base64-$$$")).toBeNull();
    const partial = btoa(JSON.stringify({ labId: "x" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeInviteFragment(partial)).toBeNull();
  });
});

describe("lab identity branding (display-only fields)", () => {
  it("omits labName/piTitle when not supplied (backward-compatible shape)", () => {
    const inv = mint();
    expect("labName" in inv).toBe(false);
    expect("piTitle" in inv).toBe(false);
  });

  it("carries labName + piTitle and round-trips them through the link", () => {
    const inv = mint({ labName: "Fungal Interactions Lab", piTitle: "Dr." });
    expect(inv.labName).toBe("Fungal Interactions Lab");
    expect(inv.piTitle).toBe("Dr.");
    const frag = encodeInviteLink("https://x", inv).split("#")[1];
    const decoded = decodeInviteFragment(frag);
    expect(decoded?.labName).toBe("Fungal Interactions Lab");
    expect(decoded?.piTitle).toBe("Dr.");
  });

  it("does NOT sign the display fields (they are cosmetic, not in the canonical message)", () => {
    // The canonical message is labId + nonce + expiresAt only. Tampering labName
    // must therefore leave the signature valid (it is display only).
    const inv = mint({ labName: "Fungal Interactions Lab" });
    expect(verifyInviteSignature(inv)).toBe(true);
    const tampered = { ...inv, labName: "Some Other Lab" };
    expect(verifyInviteSignature(tampered)).toBe(true);
    // Proof the canonical message ignores labName.
    const msg = canonicalInviteMessage({
      labId: inv.labId,
      nonce: inv.nonce,
      expiresAt: inv.expiresAt,
    });
    expect(msg.includes("Fungal")).toBe(false);
  });
});
