// External-collab notify-invite route. Proves the three core behaviors:
//   (a) skips sending when the recipient's preference is false (200 sent:false),
//   (b) attempts a send when the preference is true (mailer mock called),
//   (c) rejects a bad owner signature (no send).
//
// Every dependency is mocked so no Neon, no Redis, no Resend, and no real
// freshness clock runs. The route's branching is exercised in isolation.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateIdentityKeys } from "@/lib/sharing/identity/keys";
import { buildNotifyInvitePayload } from "@/lib/sharing/directory/signature";

// --- Mocks (declared before the route import so the route binds them). --------

vi.mock("@/lib/loro/config", () => ({
  EXTERNAL_COLLAB_ENABLED: true,
}));

const guardState = { enabled: true };
vi.mock("@/lib/sharing/directory/guard", () => ({
  isSharingEnabled: () => guardState.enabled,
  extractClientIp: () => "1.2.3.4",
  getPepper: () => "pepper",
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
}));

vi.mock("@/lib/sharing/directory/email", () => ({
  canonicalizeEmail: (e: string) => e.trim().toLowerCase(),
  hashEmail: (e: string) => `hash:${e}`,
}));

const limiterState = { sender: true, recipient: true, ip: true };
vi.mock("@/lib/sharing/directory/ratelimit", () => ({
  getRelayIpBackstopLimiter: () => ({
    limit: async () => ({ success: limiterState.ip }),
  }),
  getCollabNotifySenderLimiter: () => ({
    limit: async () => ({ success: limiterState.sender }),
  }),
  getCollabNotifyRecipientLimiter: () => ({
    limit: async () => ({ success: limiterState.recipient }),
  }),
}));

// Always fresh in tests (the freshness rule is covered by relay/auth tests).
vi.mock("@/lib/sharing/relay/auth", () => ({
  isFresh: () => true,
}));

interface FakeBinding {
  ed25519PublicKey: string;
  fingerprint: string;
}
const dbState = {
  bindings: new Map<string, FakeBinding>(),
  profiles: new Map<string, { notifyOnCollabInvite: boolean; displayName: string }>(),
};
vi.mock("@/lib/sharing/directory/db", () => ({
  ensureSchema: async () => {},
  ensureProfileSchema: async () => {},
  getBindingByHash: async (h: string) => dbState.bindings.get(h) ?? null,
  getProfileByFingerprint: async (fp: string) =>
    dbState.profiles.get(fp) ?? null,
}));

const sendSpy = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/sharing/relay/mailer", () => ({
  sendCollabInviteEmail: (p: unknown) => sendSpy(p),
}));

import { POST } from "../route";

// --- Helpers -----------------------------------------------------------------

const owner = generateIdentityKeys().signing;
const ownerPubkey = bytesToHex(owner.publicKey);
const ownerEmail = "owner@lab.edu";
const recipientEmail = "rcpt@lab.edu";
const issuedAt = "2026-06-07T00:00:00.000Z";
const noteTitle = "PCR optimization";

function sign(privateKey: Uint8Array, recipient = recipientEmail): string {
  const payload = buildNotifyInvitePayload({
    recipientEmail: recipient,
    noteTitle,
    issuedAt,
  });
  return bytesToHex(ed25519.sign(payload, privateKey));
}

function makeRequest(signature: string): Request {
  return new Request("https://app/api/collab/notify-invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: { email: ownerEmail, pubkey: ownerPubkey },
      recipientEmail,
      noteTitle,
      issuedAt,
      signature,
    }),
  });
}

function seedRegistered(recipientNotify: boolean) {
  dbState.bindings.set(`hash:${ownerEmail}`, {
    ed25519PublicKey: ownerPubkey,
    fingerprint: "fp-owner",
  });
  dbState.bindings.set(`hash:${recipientEmail}`, {
    ed25519PublicKey: "recipient-key",
    fingerprint: "fp-rcpt",
  });
  dbState.profiles.set("fp-rcpt", {
    notifyOnCollabInvite: recipientNotify,
    displayName: "Recipient",
  });
  dbState.profiles.set("fp-owner", {
    notifyOnCollabInvite: true,
    displayName: "Owner Name",
  });
}

describe("POST /api/collab/notify-invite", () => {
  beforeEach(() => {
    guardState.enabled = true;
    limiterState.sender = true;
    limiterState.recipient = true;
    limiterState.ip = true;
    dbState.bindings.clear();
    dbState.profiles.clear();
    sendSpy.mockClear();
  });

  it("skips the send when the recipient opted out (sent:false)", async () => {
    seedRegistered(false);
    const res = await POST(makeRequest(sign(owner.privateKey)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("attempts the send when the recipient opted in (sent:true)", async () => {
    seedRegistered(true);
    const res = await POST(makeRequest(sign(owner.privateKey)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const arg = sendSpy.mock.calls[0]?.[0] as unknown as {
      toEmail: string;
      senderLabel: string;
      noteTitle: string;
    };
    expect(arg.toEmail).toBe(recipientEmail);
    expect(arg.noteTitle).toBe(noteTitle);
    // Sender display name is preferred over the raw email.
    expect(arg.senderLabel).toBe("Owner Name");
  });

  it("defaults to sending when the recipient has no published profile", async () => {
    dbState.bindings.set(`hash:${ownerEmail}`, {
      ed25519PublicKey: ownerPubkey,
      fingerprint: "fp-owner",
    });
    dbState.bindings.set(`hash:${recipientEmail}`, {
      ed25519PublicKey: "recipient-key",
      fingerprint: "fp-rcpt",
    });
    // No profile rows -> default true.
    const res = await POST(makeRequest(sign(owner.privateKey)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad owner signature without sending", async () => {
    seedRegistered(true);
    const wrong = generateIdentityKeys().signing;
    const res = await POST(makeRequest(sign(wrong.privateKey)));
    expect(res.status).toBe(400);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("rejects when from.pubkey does not match the directory binding", async () => {
    seedRegistered(true);
    // Re-bind the owner email to a different key; the signature is valid for the
    // presented pubkey but the directory has a different key on file.
    dbState.bindings.set(`hash:${ownerEmail}`, {
      ed25519PublicKey: "some-other-key",
      fingerprint: "fp-owner",
    });
    const res = await POST(makeRequest(sign(owner.privateKey)));
    expect(res.status).toBe(400);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("never emails a non-registered recipient", async () => {
    // Only the sender is registered; recipient has no binding.
    dbState.bindings.set(`hash:${ownerEmail}`, {
      ed25519PublicKey: ownerPubkey,
      fingerprint: "fp-owner",
    });
    const res = await POST(makeRequest(sign(owner.privateKey)));
    expect(res.status).toBe(400);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("404s when the feature flag path is on but sharing is disabled", async () => {
    guardState.enabled = false;
    seedRegistered(true);
    const res = await POST(makeRequest(sign(owner.privateKey)));
    expect(res.status).toBe(404);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("429s when the per-recipient limit is exhausted", async () => {
    seedRegistered(true);
    limiterState.recipient = false;
    const res = await POST(makeRequest(sign(owner.privateKey)));
    expect(res.status).toBe(429);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
