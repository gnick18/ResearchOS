// External-collab chunk 5 unit tests: the owner-signed REVOKE and MEMBERS-list
// bodies, plus the recipient-side revoke detection registry.
//
// The two signing helpers must produce a signature that verifies under the EXACT
// canonical message the relay DO rebuilds (relay/src/worker.ts), or an enforced
// doc would reject a real revoke / members read. We rebuild the same message
// here and verify with @noble/curves, the same primitive the DO uses.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, beforeEach } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";

import { signRevoke, signMembersList } from "../client/do-access";
import { generateIdentityKeys } from "@/lib/sharing/identity/keys";
import {
  isRevokedStatus,
  isMaterializedExternalNote,
  isRevoked,
  markRevoked,
  onRevoked,
  _resetRevocationRegistry,
} from "../client/revocation";

const SESSION_ID = "sess-deadbeef";
const OWNER_EMAIL = "owner@example.edu";
const TARGET_EMAIL = "outsider@other.org";

function verify(sigHex: string, message: string, pub: Uint8Array): boolean {
  return ed25519.verify(
    hexToBytes(sigHex),
    new TextEncoder().encode(message),
    pub,
  );
}

describe("signRevoke", () => {
  it("signs the exact canonical message the DO rebuilds for /revoke", () => {
    const keys = generateIdentityKeys();
    const body = signRevoke({
      sessionId: SESSION_ID,
      ownerEmail: OWNER_EMAIL,
      ownerSigningKey: keys.signing,
      email: TARGET_EMAIL,
      issuedAt: 1_700_000_000_000,
    });

    expect(body.owner.email).toBe(OWNER_EMAIL);
    expect(body.email).toBe(TARGET_EMAIL);
    // DO message: revoke\n${sessionId}\n${ownerEmail}\n${issuedAt}\n${email}
    const message = `revoke\n${SESSION_ID}\n${OWNER_EMAIL}\n${body.issuedAt}\n${TARGET_EMAIL}`;
    expect(verify(body.signature, message, keys.signing.publicKey)).toBe(true);
  });

  it("a tampered target email no longer verifies (anti-forgery)", () => {
    const keys = generateIdentityKeys();
    const body = signRevoke({
      sessionId: SESSION_ID,
      ownerEmail: OWNER_EMAIL,
      ownerSigningKey: keys.signing,
      email: TARGET_EMAIL,
    });
    const tampered = `revoke\n${SESSION_ID}\n${OWNER_EMAIL}\n${body.issuedAt}\nattacker@evil.com`;
    expect(verify(body.signature, tampered, keys.signing.publicKey)).toBe(false);
  });
});

describe("signMembersList", () => {
  it("signs the exact canonical message the DO rebuilds for /members", () => {
    const keys = generateIdentityKeys();
    const body = signMembersList({
      sessionId: SESSION_ID,
      ownerEmail: OWNER_EMAIL,
      ownerSigningKey: keys.signing,
      issuedAt: 1_700_000_000_000,
    });

    // DO message: members\n${sessionId}\n${ownerEmail}\n${issuedAt}
    const message = `members\n${SESSION_ID}\n${OWNER_EMAIL}\n${body.issuedAt}`;
    expect(verify(body.signature, message, keys.signing.publicKey)).toBe(true);
  });

  it("the members verb is distinct so the signature cannot be replayed as a revoke", () => {
    const keys = generateIdentityKeys();
    const body = signMembersList({
      sessionId: SESSION_ID,
      ownerEmail: OWNER_EMAIL,
      ownerSigningKey: keys.signing,
    });
    // A /revoke message with the same fields must NOT verify against a /members
    // signature (different leading verb), so the read cannot be turned into a
    // mutation.
    const revokeMsg = `revoke\n${SESSION_ID}\n${OWNER_EMAIL}\n${body.issuedAt}\n${TARGET_EMAIL}`;
    expect(verify(body.signature, revokeMsg, keys.signing.publicKey)).toBe(false);
  });
});

describe("revocation detection", () => {
  beforeEach(() => {
    _resetRevocationRegistry();
  });

  const externalNote = {
    collab_doc_id: "doc-1",
    received_from: "owner@example.edu",
  };

  it("only a materialized external note (collab id + received_from) qualifies", () => {
    expect(isMaterializedExternalNote(externalNote)).toBe(true);
    expect(
      isMaterializedExternalNote({ collab_doc_id: "doc-1" }),
    ).toBe(false);
    expect(
      isMaterializedExternalNote({ received_from: "x@y.z" }),
    ).toBe(false);
  });

  it("treats 401 as revoke for an external note, and nothing else", () => {
    expect(isRevokedStatus(401, externalNote)).toBe(true);
    // A 403 / 404 / 5xx is NOT a revoke (those are open / empty / outage).
    expect(isRevokedStatus(403, externalNote)).toBe(false);
    expect(isRevokedStatus(404, externalNote)).toBe(false);
    expect(isRevokedStatus(500, externalNote)).toBe(false);
    // A 401 on an owner's own (non-received) note is not a revoke either.
    expect(
      isRevokedStatus(401, { collab_doc_id: "doc-1" }),
    ).toBe(false);
  });

  it("markRevoked records the id and notifies listeners once", () => {
    let fired = 0;
    let seen: string | null = null;
    const off = onRevoked((id) => {
      fired += 1;
      seen = id;
    });
    expect(isRevoked("doc-1")).toBe(false);
    markRevoked("doc-1");
    markRevoked("doc-1"); // idempotent: no second notify
    expect(isRevoked("doc-1")).toBe(true);
    expect(fired).toBe(1);
    expect(seen).toBe("doc-1");
    off();
  });
});
