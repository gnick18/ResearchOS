// Lab tier Phase 8a: tests for the OAuth-email to membership binding.
//
// The security value of this layer is in its FAILURE cases (no bypass), so most
// of these assert rejection: wrong email, no binding, wrong lab key, tampered
// ciphertext, empty inputs. The happy path and case/whitespace normalization are
// covered too.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { generateLabKey } from "./lab-key";
import {
  computeLabEmailHash,
  sealMemberEmailHash,
  verifyMemberEmailBinding,
  LAB_EMAIL_BINDING_SALT,
} from "./lab-binding";
import type { LabMember } from "./lab-membership";

function memberWith(emailHashEnc?: string): LabMember {
  return {
    username: "alice",
    x25519PublicKey: "00".repeat(32),
    ed25519PublicKey: "11".repeat(32),
    role: "member",
    emailHashEnc,
  };
}

describe("computeLabEmailHash", () => {
  it("is deterministic and 64 hex chars (sha256)", () => {
    const a = computeLabEmailHash("alice@wisc.edu");
    const b = computeLabEmailHash("alice@wisc.edu");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("canonicalizes case and surrounding whitespace", () => {
    expect(computeLabEmailHash("  Alice@WISC.edu ")).toBe(
      computeLabEmailHash("alice@wisc.edu"),
    );
  });

  it("differs for different emails", () => {
    expect(computeLabEmailHash("alice@wisc.edu")).not.toBe(
      computeLabEmailHash("bob@wisc.edu"),
    );
  });

  it("is domain-separated from a raw hashEmail under a different salt", () => {
    // A different salt yields a different hash, so a lab binding can never be
    // cross-matched against a directory or inbox hash.
    expect(LAB_EMAIL_BINDING_SALT).toBe("researchos-lab-member-binding-v1");
  });
});

describe("sealMemberEmailHash + verifyMemberEmailBinding (happy path)", () => {
  it("accepts the exact email it was sealed under", () => {
    const labKey = generateLabKey();
    const member = memberWith(sealMemberEmailHash("alice@wisc.edu", labKey));
    const r = verifyMemberEmailBinding({
      member,
      oauthEmail: "alice@wisc.edu",
      labKey,
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("");
  });

  it("accepts a differently-cased / padded login of the same email", () => {
    const labKey = generateLabKey();
    const member = memberWith(sealMemberEmailHash("alice@wisc.edu", labKey));
    const r = verifyMemberEmailBinding({
      member,
      oauthEmail: " ALICE@Wisc.Edu ",
      labKey,
    });
    expect(r.ok).toBe(true);
  });

  it("binds the email the member chose, not the head's invite address", () => {
    // The send-address and the bound email can differ; only the bound (accepted)
    // email must match at login.
    const labKey = generateLabKey();
    const member = memberWith(
      sealMemberEmailHash("alice.dev@gmail.com", labKey),
    );
    expect(
      verifyMemberEmailBinding({
        member,
        oauthEmail: "alice.dev@gmail.com",
        labKey,
      }).ok,
    ).toBe(true);
    // The school address the head might have invited with does NOT pass.
    expect(
      verifyMemberEmailBinding({
        member,
        oauthEmail: "alice@wisc.edu",
        labKey,
      }).ok,
    ).toBe(false);
  });

  it("produces unrelated ciphertexts for the same email (random nonce)", () => {
    const labKey = generateLabKey();
    const a = sealMemberEmailHash("alice@wisc.edu", labKey);
    const b = sealMemberEmailHash("alice@wisc.edu", labKey);
    expect(a).not.toBe(b);
    // Both still verify.
    expect(
      verifyMemberEmailBinding({
        member: memberWith(a),
        oauthEmail: "alice@wisc.edu",
        labKey,
      }).ok,
    ).toBe(true);
    expect(
      verifyMemberEmailBinding({
        member: memberWith(b),
        oauthEmail: "alice@wisc.edu",
        labKey,
      }).ok,
    ).toBe(true);
  });
});

describe("verifyMemberEmailBinding (rejections, the security-critical cases)", () => {
  it("rejects a different OAuth email", () => {
    const labKey = generateLabKey();
    const member = memberWith(sealMemberEmailHash("alice@wisc.edu", labKey));
    const r = verifyMemberEmailBinding({
      member,
      oauthEmail: "attacker@evil.com",
      labKey,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("does not match");
  });

  it("rejects a member with NO binding (fail-safe, no silent takeover)", () => {
    const labKey = generateLabKey();
    const r = verifyMemberEmailBinding({
      member: memberWith(undefined),
      oauthEmail: "alice@wisc.edu",
      labKey,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no email binding");
  });

  it("rejects an empty or whitespace OAuth email", () => {
    const labKey = generateLabKey();
    const member = memberWith(sealMemberEmailHash("alice@wisc.edu", labKey));
    expect(
      verifyMemberEmailBinding({ member, oauthEmail: "", labKey }).ok,
    ).toBe(false);
    expect(
      verifyMemberEmailBinding({ member, oauthEmail: "   ", labKey }).ok,
    ).toBe(false);
  });

  it("rejects the right email under the WRONG lab key (decrypt fails)", () => {
    const labKey = generateLabKey();
    const wrongKey = generateLabKey();
    const member = memberWith(sealMemberEmailHash("alice@wisc.edu", labKey));
    const r = verifyMemberEmailBinding({
      member,
      oauthEmail: "alice@wisc.edu",
      labKey: wrongKey,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("decrypt");
  });

  it("rejects a tampered / swapped ciphertext (Poly1305 tag fails)", () => {
    const labKey = generateLabKey();
    const sealed = sealMemberEmailHash("alice@wisc.edu", labKey);
    // Flip the last hex nibble of the ciphertext.
    const last = sealed.slice(-1);
    const flipped =
      sealed.slice(0, -1) + (last === "0" ? "1" : "0");
    const r = verifyMemberEmailBinding({
      member: memberWith(flipped),
      oauthEmail: "alice@wisc.edu",
      labKey,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("decrypt");
  });

  it("rejects a malformed (non-hex / truncated) binding", () => {
    const labKey = generateLabKey();
    expect(
      verifyMemberEmailBinding({
        member: memberWith("not-hex-zzzz"),
        oauthEmail: "alice@wisc.edu",
        labKey,
      }).ok,
    ).toBe(false);
    expect(
      verifyMemberEmailBinding({
        member: memberWith("00"),
        oauthEmail: "alice@wisc.edu",
        labKey,
      }).ok,
    ).toBe(false);
  });

  it("rejects another member's binding swapped into this member (DoS, not bypass)", () => {
    // A relay that swaps member A's emailHashEnc for member B's just denies
    // service: A decrypts B's hash and fails the match. It never grants access.
    const labKey = generateLabKey();
    const aliceSeal = sealMemberEmailHash("alice@wisc.edu", labKey);
    const bobSeal = sealMemberEmailHash("bob@wisc.edu", labKey);
    expect(
      verifyMemberEmailBinding({
        member: memberWith(bobSeal),
        oauthEmail: "alice@wisc.edu",
        labKey,
      }).ok,
    ).toBe(false);
    // Sanity: alice's own seal does pass.
    expect(
      verifyMemberEmailBinding({
        member: memberWith(aliceSeal),
        oauthEmail: "alice@wisc.edu",
        labKey,
      }).ok,
    ).toBe(true);
  });
});
