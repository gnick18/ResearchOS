// Phase 1b-i, the email-to-keys binding signature.
// Also covers the profile payload (section 17) including the badges phase 2 fields.

import { describe, expect, it } from "vitest";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";

import {
  buildBindingPayload,
  buildProfilePayload,
  signBinding,
  verifyBindingSignature,
  type BindingInput,
  type ProfilePayloadInput,
} from "../signature";

function sampleInput(overrides: Partial<BindingInput> = {}): BindingInput {
  const enc = x25519.keygen();
  const sig = ed25519.keygen();
  return {
    email: "user@example.com",
    x25519PublicKey: Buffer.from(enc.publicKey).toString("hex"),
    ed25519PublicKey: Buffer.from(sig.publicKey).toString("hex"),
    issuedAt: "2026-06-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildBindingPayload", () => {
  it("is deterministic for the same input", () => {
    const input = sampleInput();
    expect(buildBindingPayload(input)).toEqual(buildBindingPayload(input));
  });

  it("changes when any field changes", () => {
    const a = buildBindingPayload(sampleInput({ issuedAt: "2026-06-03T00:00:00.000Z" }));
    const b = buildBindingPayload(sampleInput({ issuedAt: "2026-06-03T00:00:01.000Z" }));
    // Note both use fresh random keys, so this is a weak check; the strong
    // determinism check is the test above. This just confirms bytes are not
    // empty/constant.
    expect(a).not.toEqual(b);
  });
});

describe("signBinding / verifyBindingSignature", () => {
  it("verifies a valid signature", () => {
    const signer = ed25519.keygen();
    const payload = buildBindingPayload(sampleInput());
    const signature = signBinding(payload, signer.secretKey);
    expect(verifyBindingSignature(payload, signature, signer.publicKey)).toBe(true);
  });

  it("fails on a tampered payload", () => {
    const signer = ed25519.keygen();
    const payload = buildBindingPayload(sampleInput());
    const signature = signBinding(payload, signer.secretKey);
    const tampered = new Uint8Array(payload);
    tampered[0] ^= 0xff;
    expect(verifyBindingSignature(tampered, signature, signer.publicKey)).toBe(false);
  });

  it("fails on a wrong public key", () => {
    const signer = ed25519.keygen();
    const attacker = ed25519.keygen();
    const payload = buildBindingPayload(sampleInput());
    const signature = signBinding(payload, signer.secretKey);
    expect(verifyBindingSignature(payload, signature, attacker.publicKey)).toBe(false);
  });

  it("returns false (no throw) on a malformed public key", () => {
    const signer = ed25519.keygen();
    const payload = buildBindingPayload(sampleInput());
    const signature = signBinding(payload, signer.secretKey);
    expect(verifyBindingSignature(payload, signature, new Uint8Array(3))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Profile payload (section 17) + badges phase 2 round-trip.
// ---------------------------------------------------------------------------

function sampleProfileInput(
  overrides: Partial<ProfilePayloadInput> = {},
): ProfilePayloadInput {
  return {
    action: "profile",
    displayName: "Alice Researcher",
    affiliation: "UW-Madison",
    orcid: "0000-0002-1825-0097",
    pinnedWorks: ["123", "456"],
    hiddenWorks: ["789"],
    notifyOnCollabInvite: true,
    issuedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildProfilePayload", () => {
  it("is deterministic for the same input", () => {
    const input = sampleProfileInput();
    expect(buildProfilePayload(input)).toEqual(buildProfilePayload(input));
  });

  it("includes badge lines in the signed bytes when action is profile", () => {
    const withBadges = buildProfilePayload(
      sampleProfileInput({
        earnedBadgeIds: ["founding-lab"],
        pinnedBadgeIds: ["founding-lab"],
      }),
    );
    const withoutBadges = buildProfilePayload(sampleProfileInput());
    // The payloads must differ because the badge lines add content.
    expect(withBadges).not.toEqual(withoutBadges);
    // The badge payload must contain the expected line text.
    const decoded = new TextDecoder().decode(withBadges);
    expect(decoded).toContain("earnedBadges=founding-lab");
    expect(decoded).toContain("pinnedBadges=founding-lab");
  });

  it("encodes absent badge ids as empty strings (back-compat default)", () => {
    const payload = buildProfilePayload(sampleProfileInput());
    const decoded = new TextDecoder().decode(payload);
    expect(decoded).toContain("earnedBadges=");
    expect(decoded).toContain("pinnedBadges=");
  });

  it("does NOT include badge lines for delete-profile (stable delete bytes)", () => {
    const payload = buildProfilePayload({
      action: "delete-profile",
      issuedAt: "2026-06-20T00:00:00.000Z",
      earnedBadgeIds: ["founding-lab"],
    });
    const decoded = new TextDecoder().decode(payload);
    expect(decoded).not.toContain("earnedBadges");
    expect(decoded).not.toContain("notifyOnCollabInvite");
  });

  it("sign + verify round-trips with badge fields", () => {
    const signer = ed25519.keygen();
    const payload = buildProfilePayload(
      sampleProfileInput({
        earnedBadgeIds: ["founding-lab"],
        pinnedBadgeIds: ["founding-lab"],
      }),
    );
    const sig = signBinding(payload, signer.secretKey);
    expect(verifyBindingSignature(payload, sig, signer.publicKey)).toBe(true);
  });

  it("signature fails when badge field differs between client and server", () => {
    const signer = ed25519.keygen();
    // Simulate the client signing with badges...
    const clientPayload = buildProfilePayload(
      sampleProfileInput({ earnedBadgeIds: ["founding-lab"] }),
    );
    const sig = signBinding(clientPayload, signer.secretKey);
    // ...and the server reconstructing WITHOUT badges (old server code).
    const serverPayload = buildProfilePayload(sampleProfileInput());
    expect(verifyBindingSignature(serverPayload, sig, signer.publicKey)).toBe(false);
  });
});
