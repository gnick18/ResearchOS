// Cross-boundary sharing, relay inbox route, per-identity rate-limit wiring.
//
// Proves the authenticated inbox route applies the PRIMARY rate limit per
// VERIFIED IDENTITY (the email hash from verifyRelayRequest), not per IP, and in
// the right order, verify FIRST, then limit. Every dependency is mocked so no
// Neon, no Redis, no crypto runs, the test exercises the route's gating only.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks. Defined before the route import so the route binds the mocks. -----

const guardState = { enabled: true };
vi.mock("@/lib/sharing/directory/guard", () => ({
  isSharingEnabled: () => guardState.enabled,
  extractClientIp: () => "10.0.0.1",
  getPepper: () => "pepper",
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
}));

// The identity limiter records the key it was called with so the test can assert
// the route keys on the email hash, not the IP. Its verdict is switchable.
const identityState = { success: true, lastKey: "" };
const backstopState = { success: true, lastKey: "" };
vi.mock("@/lib/sharing/directory/ratelimit", () => ({
  getRelayIpBackstopLimiter: () => ({
    limit: async (key: string) => {
      backstopState.lastKey = key;
      return { success: backstopState.success };
    },
  }),
  getRelayIdentityLimiter: () => ({
    limit: async (key: string) => {
      identityState.lastKey = key;
      return { success: identityState.success };
    },
  }),
}));

const verifyState = {
  result: {
    emailHash: "recipient-hash",
    binding: {},
    parsed: {
      action: "inbox",
      email: "rcpt@example.com",
      issuedAt: "2026-06-03T00:00:00.000Z",
      signature: "00",
    },
  } as unknown | null,
};
const verifySpy = vi.fn(async () => verifyState.result);
vi.mock("@/lib/sharing/relay/auth", () => ({
  verifyRelayRequest: () => verifySpy(),
}));

const listSpy = vi.fn(async () => [] as unknown[]);
vi.mock("@/lib/sharing/relay/db", () => ({
  ensureRelaySchema: async () => {},
  sweepStalePending: async () => {},
  listInboxByRecipient: () => listSpy(),
}));

import { POST } from "../route";

function makeRequest(): Request {
  return new Request("https://app.example/api/relay/inbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "inbox" }),
  });
}

beforeEach(() => {
  guardState.enabled = true;
  identityState.success = true;
  identityState.lastKey = "";
  backstopState.success = true;
  backstopState.lastKey = "";
  verifyState.result = {
    emailHash: "recipient-hash",
    binding: {},
    parsed: {
      action: "inbox",
      email: "rcpt@example.com",
      issuedAt: "2026-06-03T00:00:00.000Z",
      signature: "00",
    },
  };
  verifySpy.mockClear();
  listSpy.mockClear();
});

describe("relay inbox route, per-identity rate limiting", () => {
  it("keys the primary limiter on the verified email hash, not the IP", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // The binding limit is keyed by identity, the backstop by IP.
    expect(identityState.lastKey).toBe("recipient-hash");
    expect(backstopState.lastKey).toBe("10.0.0.1");
  });

  it("verifies the signature BEFORE applying the identity limit", async () => {
    // If verification ran after the limit, an unverified caller (null result)
    // would still consume identity budget. Here a null verify must short-circuit
    // to 400 and never key the identity limiter.
    verifyState.result = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(identityState.lastKey).toBe("");
  });

  it("returns 429 when the per-identity limit is exceeded", async () => {
    identityState.success = false;
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    // The listing must never run once the identity limit trips.
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("returns 429 from the IP backstop before verification runs", async () => {
    backstopState.success = false;
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    // The backstop precedes verification, so a tripped backstop never verifies.
    expect(verifySpy).not.toHaveBeenCalled();
  });
});
