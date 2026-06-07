// Round-trip test for the collab DO access-control signing helpers. Each helper
// produces an artifact the relay Durable Object verifies with
// ed25519.verify(sig, msg, pubkey) over an exact canonical string. This test
// reconstructs that DO-side verification so a regression in either the message
// shape or the encoding fails here before it reaches the relay.

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { generateIdentityKeys, encodePublicKey } from "@/lib/sharing/identity/keys";
import { signGrant, signRevoke, signConnectToken } from "./do-access";

function verify(sigHex: string, message: string, pubkeyHex: string): boolean {
  return ed25519.verify(
    hexToBytes(sigHex),
    new TextEncoder().encode(message),
    hexToBytes(pubkeyHex),
  );
}

describe("do-access signing helpers", () => {
  const sessionId = "doc-abc-123";
  const ownerEmail = "owner@lab.edu";

  it("signGrant produces a body the DO would accept", () => {
    const owner = generateIdentityKeys().signing;
    const memberKeys = generateIdentityKeys().signing;
    const members = [
      {
        email: "member@lab.edu",
        pubkey: encodePublicKey(memberKeys.publicKey),
        role: "editor",
      },
    ];
    const issuedAt = Date.now();
    const body = signGrant({
      sessionId,
      ownerEmail,
      ownerSigningKey: owner,
      members,
      issuedAt,
    });

    expect(body.owner.email).toBe(ownerEmail);
    expect(body.owner.pubkey).toBe(encodePublicKey(owner.publicKey));
    expect(body.members).toEqual(members);
    expect(body.issuedAt).toBe(issuedAt);

    const message = `grant\n${sessionId}\n${ownerEmail}\n${issuedAt}\n${JSON.stringify(members)}`;
    expect(verify(body.signature, message, body.owner.pubkey)).toBe(true);
  });

  it("signGrant signature fails verification if the members change", () => {
    const owner = generateIdentityKeys().signing;
    const body = signGrant({
      sessionId,
      ownerEmail,
      ownerSigningKey: owner,
      members: [{ email: "a@lab.edu", pubkey: "00", role: "editor" }],
      issuedAt: Date.now(),
    });
    const tamperedMessage = `grant\n${sessionId}\n${ownerEmail}\n${body.issuedAt}\n${JSON.stringify(
      [{ email: "attacker@evil.com", pubkey: "ff", role: "owner" }],
    )}`;
    expect(verify(body.signature, tamperedMessage, body.owner.pubkey)).toBe(false);
  });

  it("signRevoke produces a body the DO would accept", () => {
    const owner = generateIdentityKeys().signing;
    const issuedAt = Date.now();
    const body = signRevoke({
      sessionId,
      ownerEmail,
      ownerSigningKey: owner,
      email: "gone@lab.edu",
      issuedAt,
    });

    expect(body.email).toBe("gone@lab.edu");
    const message = `revoke\n${sessionId}\n${ownerEmail}\n${issuedAt}\n${"gone@lab.edu"}`;
    expect(verify(body.signature, message, body.owner.pubkey)).toBe(true);
  });

  it("signConnectToken produces params the DO would accept", () => {
    const member = generateIdentityKeys().signing;
    const email = "member@lab.edu";
    const ts = Date.now();
    const token = signConnectToken({
      sessionId,
      email,
      signingKey: member,
      ts,
    });

    expect(token.authEmail).toBe(email);
    expect(token.authTs).toBe(String(ts));
    const message = `connect\n${sessionId}\n${email}\n${token.authTs}`;
    expect(verify(token.authSig, message, encodePublicKey(member.publicKey))).toBe(true);
  });
});
