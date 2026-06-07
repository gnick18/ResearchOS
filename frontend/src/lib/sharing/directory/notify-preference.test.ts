// External-collab email notification: the notifyOnCollabInvite profile field.
//
// Two properties under test:
//   1. The signed profile payload ROUND-TRIPS with the new field, the bytes the
//      client signs match the bytes the server rebuilds, for both true and false.
//   2. BACKWARD-SAFE default: a payload built without the field encodes the same
//      bytes as one built with notifyOnCollabInvite: true, so an older client's
//      signature still verifies against the server's reconstruction.

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { generateIdentityKeys } from "@/lib/sharing/identity/keys";
import { buildProfilePayload } from "./signature";

const dec = new TextDecoder();

describe("notifyOnCollabInvite profile signature", () => {
  const base = {
    action: "profile" as const,
    displayName: "Dr. Lab Head",
    affiliation: "UW-Madison",
    orcid: null,
    pinnedWorks: [],
    hiddenWorks: [],
    issuedAt: "2026-06-07T00:00:00.000Z",
  };

  it("round-trips a signature with notifyOnCollabInvite: true", () => {
    const keys = generateIdentityKeys().signing;
    const payload = buildProfilePayload({ ...base, notifyOnCollabInvite: true });
    const sig = ed25519.sign(payload, keys.privateKey);

    // The server independently rebuilds the same bytes and verifies.
    const rebuilt = buildProfilePayload({ ...base, notifyOnCollabInvite: true });
    expect(ed25519.verify(sig, rebuilt, keys.publicKey)).toBe(true);
    expect(dec.decode(payload)).toContain("notifyOnCollabInvite=true");
  });

  it("round-trips a signature with notifyOnCollabInvite: false", () => {
    const keys = generateIdentityKeys().signing;
    const payload = buildProfilePayload({ ...base, notifyOnCollabInvite: false });
    const sig = ed25519.sign(payload, keys.privateKey);
    const rebuilt = buildProfilePayload({ ...base, notifyOnCollabInvite: false });
    expect(ed25519.verify(sig, rebuilt, keys.publicKey)).toBe(true);
    expect(dec.decode(payload)).toContain("notifyOnCollabInvite=false");
  });

  it("defaults to true when the field is omitted (backward-safe)", () => {
    // An older client signs without the field. The server, which also defaults to
    // true, rebuilds identical bytes, so the old signature still verifies.
    const keys = generateIdentityKeys().signing;
    const omitted = buildProfilePayload(base);
    const sig = ed25519.sign(omitted, keys.privateKey);
    const serverRebuild = buildProfilePayload({
      ...base,
      notifyOnCollabInvite: true,
    });
    expect(dec.decode(omitted)).toEqual(dec.decode(serverRebuild));
    expect(ed25519.verify(sig, serverRebuild, keys.publicKey)).toBe(true);
  });

  it("leaves the delete-profile signed bytes unchanged by the new field", () => {
    // A delete payload must not carry the preference line, so old delete
    // signatures keep validating.
    const del = buildProfilePayload({
      action: "delete-profile",
      issuedAt: base.issuedAt,
    });
    expect(dec.decode(del)).not.toContain("notifyOnCollabInvite");
  });

  it("can be decoded back from a raw hex public key without throwing", () => {
    // Smoke check that the encode/verify pair handles a hex round-trip the way
    // the server route does.
    const keys = generateIdentityKeys().signing;
    const payload = buildProfilePayload({ ...base, notifyOnCollabInvite: true });
    const sig = ed25519.sign(payload, keys.privateKey);
    const pubHex = Buffer.from(keys.publicKey).toString("hex");
    expect(ed25519.verify(sig, payload, hexToBytes(pubHex))).toBe(true);
  });
});
