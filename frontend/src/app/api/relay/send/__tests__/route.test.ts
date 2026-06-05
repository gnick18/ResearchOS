// Cross-boundary sharing, relay send route, byte-budget + count-cap enforcement.
//
// Pins the two independent ceilings the send route enforces (the per-recipient
// pending COUNT cap PENDING_SHARE_CAP and the total stored-BYTES budget
// FREE_STORAGE_BYTES, read symbolically so the 5 GB -> 1 GB change is covered), and
// proves a normal send still reserves a bundle. Every dependency is mocked so no
// Neon, no R2, no rate limiter, no crypto verification runs, the test exercises
// the route's branching only.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FREE_STORAGE_BYTES,
  PENDING_SHARE_CAP,
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
}));

vi.mock("@/lib/sharing/directory/email", () => ({
  canonicalizeEmail: (e: string) => e.trim().toLowerCase(),
  hashEmail: (e: string) => `hash:${e}`,
}));

const dirState = { binding: { ed25519PublicKey: "abc" } as unknown | null };
vi.mock("@/lib/sharing/directory/db", () => ({
  getBindingByHash: async () => dirState.binding,
}));

const verifyState = {
  result: {
    emailHash: "sender-hash",
    binding: {},
    parsed: {
      action: "send",
      email: "sender@example.com",
      issuedAt: "2026-06-03T00:00:00.000Z",
      signature: "00",
      recipientEmail: "rcpt@example.com",
      sizeBytes: 100,
    },
  } as unknown | null,
};
vi.mock("@/lib/sharing/relay/auth", () => ({
  verifyRelayRequest: async () => verifyState.result,
}));

const relayState = { count: 0, bytes: 0 };
const insertSpy = vi.fn(async (_entry: unknown) => {});
vi.mock("@/lib/sharing/relay/db", () => ({
  ensureRelaySchema: async () => {},
  countInboxByRecipient: async () => relayState.count,
  sumPendingBytesByRecipient: async () => relayState.bytes,
  insertInboxEntry: (entry: unknown) => insertSpy(entry),
}));

vi.mock("@/lib/sharing/relay/storage", () => ({
  presignUpload: async () => "https://r2.example/upload",
}));

import { POST } from "../route";

function makeRequest(): Request {
  return new Request("https://app.example/api/relay/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "send" }),
  });
}

function freshParsed(sizeBytes: number) {
  return {
    emailHash: "sender-hash",
    binding: {},
    parsed: {
      action: "send",
      email: "sender@example.com",
      issuedAt: "2026-06-03T00:00:00.000Z",
      signature: "00",
      recipientEmail: "rcpt@example.com",
      sizeBytes,
    },
  };
}

beforeEach(() => {
  guardState.enabled = true;
  dirState.binding = { ed25519PublicKey: "abc" };
  relayState.count = 0;
  relayState.bytes = 0;
  verifyState.result = freshParsed(100);
  insertSpy.mockClear();
});

describe("relay send route, count cap", () => {
  it("rejects with 429 when the recipient is at the pending-share cap", async () => {
    relayState.count = PENDING_SHARE_CAP;
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("allows a send one below the cap", async () => {
    relayState.count = PENDING_SHARE_CAP - 1;
    relayState.bytes = 0;
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

describe("relay send route, byte budget", () => {
  it("rejects when existing bytes plus the incoming bundle exceed the budget", async () => {
    // One byte of headroom, an incoming bundle of 2 bytes pushes it over.
    relayState.bytes = FREE_STORAGE_BYTES - 1;
    verifyState.result = freshParsed(2);
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("allows a send that lands exactly on the budget", async () => {
    relayState.bytes = FREE_STORAGE_BYTES - 2;
    verifyState.result = freshParsed(2);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a single oversized bundle on an empty mailbox", async () => {
    relayState.bytes = 0;
    verifyState.result = freshParsed(FREE_STORAGE_BYTES + 1);
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("relay send route, happy path", () => {
  it("reserves a bundle and returns an upload URL", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bundleId: string; uploadUrl: string };
    expect(body.uploadUrl).toBe("https://r2.example/upload");
    expect(typeof body.bundleId).toBe("string");
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
