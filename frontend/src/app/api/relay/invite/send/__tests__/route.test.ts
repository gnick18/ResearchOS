// Cross-boundary sharing, relay INVITE send route, byte-budget + count-cap gates.
//
// Mirrors the send route's route.test.ts for the invite-a-non-user path. Pins the
// per-recipient BYTE budget (INVITE_FREE_STORAGE_BYTES, read symbolically) added
// as the invite-path analog of FREE_STORAGE_BYTES, alongside the existing
// per-sender PENDING_INVITE_CAP count cap, and proves a normal invite still
// reserves a bundle. Every dependency is mocked so no Neon, no R2, no rate
// limiter, no crypto verification runs, the test exercises the route's branching
// only.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INVITE_FREE_STORAGE_BYTES,
  PENDING_INVITE_CAP,
} from "@/lib/sharing/relay/limits";

// --- Mocks. Defined before the route import so the route binds the mocks. -----

const guardState = { enabled: true };
vi.mock("@/lib/sharing/directory/guard", () => ({
  isSharingEnabled: () => guardState.enabled,
  extractClientIp: () => "1.2.3.4",
  getPepper: () => "pepper",
  // Mirror the real json() so assertions can read status + body.
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
}));

vi.mock("@/lib/sharing/directory/ratelimit", () => ({
  getRelayIpBackstopLimiter: () => ({ limit: async () => ({ success: true }) }),
  getRelayIdentityLimiter: () => ({ limit: async () => ({ success: true }) }),
  getInviteLimiter: () => ({ limit: async () => ({ success: true }) }),
}));

vi.mock("@/lib/sharing/directory/email", () => ({
  canonicalizeEmail: (e: string) => e.trim().toLowerCase(),
  hashEmail: (e: string) => `hash:${e}`,
}));

const verifyState = {
  result: makeParsed(100) as unknown | null,
};
vi.mock("@/lib/sharing/relay/auth", () => ({
  verifyRelayRequest: async () => verifyState.result,
}));

const relayState = { count: 0, bytes: 0 };
const insertSpy = vi.fn(async (_entry: unknown) => {});
vi.mock("@/lib/sharing/relay/db", () => ({
  ensureInviteSchema: async () => {},
  countInvitesBySender: async () => relayState.count,
  sumPendingInviteBytesByRecipient: async () => relayState.bytes,
  insertInviteEntry: (entry: unknown) => insertSpy(entry),
}));

const presignSpy = vi.fn(
  async (_key: string, _contentLength?: number) => "https://r2.example/upload",
);
vi.mock("@/lib/sharing/relay/storage", () => ({
  presignUpload: (key: string, contentLength?: number) =>
    presignSpy(key, contentLength),
}));

// Model A produce gate. Off by default (the beta), so the gate is inert and the
// existing tests behave exactly as before; the gate suite flips these to prove
// the paid-send paywall on the invite path.
const billingState = { enabled: false, entitled: true };
vi.mock("@/lib/billing/config", () => ({
  isBillingEnabled: () => billingState.enabled,
}));
vi.mock("@/lib/billing/model-a/resolve", () => ({
  isProduceEntitled: async () => billingState.entitled,
}));

import { POST } from "../route";

function makeRequest(): Request {
  return new Request("https://app.example/api/relay/invite/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "invite" }),
  });
}

function makeParsed(sizeBytes: number) {
  return {
    emailHash: "sender-hash",
    binding: {},
    parsed: {
      action: "invite",
      email: "sender@example.com",
      issuedAt: "2026-06-08T00:00:00.000Z",
      signature: "00",
      recipientEmail: "newperson@example.com",
      sizeBytes,
    },
  };
}

beforeEach(() => {
  guardState.enabled = true;
  relayState.count = 0;
  relayState.bytes = 0;
  verifyState.result = makeParsed(100);
  billingState.enabled = false;
  billingState.entitled = true;
  insertSpy.mockClear();
  presignSpy.mockClear();
});

describe("relay invite send route, count cap", () => {
  it("rejects with 429 when the sender is at the pending-invite cap", async () => {
    relayState.count = PENDING_INVITE_CAP;
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("allows an invite one below the cap", async () => {
    relayState.count = PENDING_INVITE_CAP - 1;
    relayState.bytes = 0;
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

describe("relay invite send route, byte budget", () => {
  it("rejects when existing bytes plus the incoming bundle exceed the budget", async () => {
    // One byte of headroom, an incoming bundle of 2 bytes pushes it over.
    relayState.bytes = INVITE_FREE_STORAGE_BYTES - 1;
    verifyState.result = makeParsed(2);
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("allows an invite that lands exactly on the budget", async () => {
    relayState.bytes = INVITE_FREE_STORAGE_BYTES - 2;
    verifyState.result = makeParsed(2);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a single oversized bundle on an empty recipient", async () => {
    relayState.bytes = 0;
    verifyState.result = makeParsed(INVITE_FREE_STORAGE_BYTES + 1);
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("rejects a declared size of zero (the budget-dodge claim) with 400", async () => {
    // A zero size would otherwise pass the byte budget unconditionally and leave
    // the presign unbound. It must be refused before any reservation.
    relayState.bytes = 0;
    verifyState.result = makeParsed(0);
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(presignSpy).not.toHaveBeenCalled();
  });
});

describe("relay invite send route, size-bound presign", () => {
  it("binds the presigned PUT to exactly the declared size", async () => {
    verifyState.result = makeParsed(4096);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(presignSpy).toHaveBeenCalledTimes(1);
    // presignUpload(inviteId, contentLength) — the 2nd arg is the binding.
    expect(presignSpy.mock.calls[0][1]).toBe(4096);
  });
});

describe("relay invite send route, paid-send produce gate", () => {
  it("blocks a FREE sender with 402 once billing is live", async () => {
    billingState.enabled = true;
    billingState.entitled = false;
    const res = await POST(makeRequest());
    expect(res.status).toBe(402);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBe("send-is-paid");
    // The gate fires before any reservation, so nothing is parked on the relay.
    expect(insertSpy).not.toHaveBeenCalled();
    expect(presignSpy).not.toHaveBeenCalled();
  });

  it("allows a PAID sender (or a free member of a paid lab) to invite", async () => {
    billingState.enabled = true;
    billingState.entitled = true;
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("is inert while billing is off, a free sender can still invite in the beta", async () => {
    billingState.enabled = false;
    billingState.entitled = false; // would block if the gate read it, but it must not
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

describe("relay invite send route, happy path", () => {
  it("reserves an invite and returns an upload URL", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inviteId: string; uploadUrl: string };
    expect(body.uploadUrl).toBe("https://r2.example/upload");
    expect(typeof body.inviteId).toBe("string");
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
