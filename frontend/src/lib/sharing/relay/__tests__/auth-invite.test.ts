// Cross-boundary sharing, the INVITE signed-action payloads.
//
// Pins that the two new relay actions ("invite", "invite-confirm") bind their
// fields into the signed bytes and verify end to end like the existing actions,
// and that the action label cannot be cross-replayed (an "invite" signature
// cannot satisfy "invite-confirm" or "send"). The directory lookup is mocked so
// the verify path runs without a live Neon connection.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBindingByHash = vi.fn();
vi.mock("@/lib/sharing/directory/db", () => ({
  getBindingByHash: (...args: unknown[]) => getBindingByHash(...args),
}));

import {
  buildRelayPayload,
  parseRelayBody,
  verifyRelayRequest,
} from "../auth";

const PEPPER = "test-pepper-value";
const PRIV = new Uint8Array(32).fill(7);
const PUB = ed25519.getPublicKey(PRIV);
const PUB_HEX = bytesToHex(PUB);
const SENDER_EMAIL = "sender@example.com";
const ISSUED = "2026-06-04T12:00:00.000Z";
const NOW = new Date(ISSUED).getTime() + 1000;

beforeEach(() => {
  getBindingByHash.mockReset();
  getBindingByHash.mockResolvedValue({
    ed25519PublicKey: PUB_HEX,
    x25519PublicKey: "00".repeat(32),
    fingerprint: "fp",
  });
});

describe("buildRelayPayload, invite actions bind their fields", () => {
  it("emits recipientEmail + sizeBytes for invite (like send)", () => {
    const bytes = buildRelayPayload({
      action: "invite",
      email: SENDER_EMAIL,
      issuedAt: ISSUED,
      recipientEmail: "newperson@uni.edu",
      sizeBytes: 4242,
    });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("action=invite");
    expect(text).toContain("recipientEmail=newperson@uni.edu");
    expect(text).toContain("sizeBytes=4242");
  });

  it("emits inviteId for invite-confirm", () => {
    const bytes = buildRelayPayload({
      action: "invite-confirm",
      email: SENDER_EMAIL,
      issuedAt: ISSUED,
      inviteId: "inv-123",
    });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("action=invite-confirm");
    expect(text).toContain("inviteId=inv-123");
  });

  it("an invite payload and an invite-confirm payload differ in bytes", () => {
    const a = buildRelayPayload({
      action: "invite",
      email: SENDER_EMAIL,
      issuedAt: ISSUED,
      recipientEmail: "x@uni.edu",
      sizeBytes: 1,
    });
    const b = buildRelayPayload({
      action: "invite-confirm",
      email: SENDER_EMAIL,
      issuedAt: ISSUED,
      inviteId: "inv-1",
    });
    expect(new TextDecoder().decode(a)).not.toBe(new TextDecoder().decode(b));
  });
});

describe("parseRelayBody, invite actions", () => {
  it("accepts a well-formed invite body", () => {
    const parsed = parseRelayBody(
      {
        action: "invite",
        email: SENDER_EMAIL,
        issuedAt: ISSUED,
        signature: "ab",
        recipientEmail: "new@uni.edu",
        sizeBytes: 10,
      },
      "invite",
    );
    expect(parsed?.recipientEmail).toBe("new@uni.edu");
    expect(parsed?.sizeBytes).toBe(10);
  });

  it("rejects an invite body missing recipientEmail", () => {
    const parsed = parseRelayBody(
      {
        action: "invite",
        email: SENDER_EMAIL,
        issuedAt: ISSUED,
        signature: "ab",
        sizeBytes: 10,
      },
      "invite",
    );
    expect(parsed).toBeNull();
  });

  it("accepts a well-formed invite-confirm body", () => {
    const parsed = parseRelayBody(
      {
        action: "invite-confirm",
        email: SENDER_EMAIL,
        issuedAt: ISSUED,
        signature: "ab",
        inviteId: "inv-9",
      },
      "invite-confirm",
    );
    expect(parsed?.inviteId).toBe("inv-9");
  });

  it("rejects an invite-confirm body missing inviteId", () => {
    const parsed = parseRelayBody(
      {
        action: "invite-confirm",
        email: SENDER_EMAIL,
        issuedAt: ISSUED,
        signature: "ab",
      },
      "invite-confirm",
    );
    expect(parsed).toBeNull();
  });
});

/** Builds a signed body for an action over the canonical payload. */
function signed(
  action: "invite" | "invite-confirm",
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const payload = buildRelayPayload({
    action,
    email: SENDER_EMAIL,
    issuedAt: ISSUED,
    recipientEmail: extra.recipientEmail as string | undefined,
    sizeBytes: extra.sizeBytes as number | undefined,
    inviteId: extra.inviteId as string | undefined,
  });
  const signature = bytesToHex(ed25519.sign(payload, PRIV));
  return { action, email: SENDER_EMAIL, issuedAt: ISSUED, signature, ...extra };
}

describe("verifyRelayRequest, invite actions end to end", () => {
  it("verifies a good invite signature", async () => {
    const body = signed("invite", {
      recipientEmail: "new@uni.edu",
      sizeBytes: 100,
    });
    const result = await verifyRelayRequest(body, "invite", PEPPER, NOW);
    expect(result).not.toBeNull();
    expect(result?.parsed.recipientEmail).toBe("new@uni.edu");
  });

  it("verifies a good invite-confirm signature", async () => {
    const body = signed("invite-confirm", { inviteId: "inv-42" });
    const result = await verifyRelayRequest(body, "invite-confirm", PEPPER, NOW);
    expect(result).not.toBeNull();
    expect(result?.parsed.inviteId).toBe("inv-42");
  });

  it("an invite signature cannot be replayed as invite-confirm", async () => {
    // Sign an invite, then submit those exact signed bytes claiming the
    // invite-confirm action. The action is part of the signed bytes, so the
    // verifier rebuilds a different payload and the signature fails.
    const inviteBody = signed("invite", {
      recipientEmail: "new@uni.edu",
      sizeBytes: 100,
    });
    const replay = {
      ...inviteBody,
      action: "invite-confirm",
      inviteId: "inv-1",
    };
    const result = await verifyRelayRequest(
      replay,
      "invite-confirm",
      PEPPER,
      NOW,
    );
    expect(result).toBeNull();
  });
});
