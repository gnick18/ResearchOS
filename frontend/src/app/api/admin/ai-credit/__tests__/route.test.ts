// Tests for POST /api/admin/ai-credit (operator gift of BeakerBot AI tokens).
//
// Pins:
//   - a non-operator is blocked by requireOperator (the gate Response is returned).
//   - a valid { email, tokens } resolves ownerKeyForEmail(email) server-side and
//     gifts to THAT key (the same key ai-status / ai-chat charge against), then
//     returns the email it credited and the new balance.
//   - a missing or malformed email is a 400.
//   - a non-positive or non-integer token count is a 400.
//   - an over-max token count is a 400.
//   - a missing pepper (ownerKeyForEmailSafe -> null) is a clean 503, not a 500,
//     and never gifts.
//
// No live Neon, giftTokens and the owner-key derivation are mocked so we test the
// route's gate, validation, and email-to-key wiring.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Operator gate. Default to "pass" (null), but a test can flip it to a blocking
// Response to prove the route refuses a non-operator.
let gateResponse: Response | null = null;
vi.mock("@/lib/sharing/operator-access", () => ({
  requireOperator: async () => gateResponse,
}));

// json() helper used by the route.
vi.mock("@/lib/sharing/directory/guard", () => ({
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
}));

// ownerKeyForEmailSafe: deterministic stand-in for the peppered hash. It models
// the real contract, a hash on success and null when the pepper is missing. The
// route MUST derive the ledger key through this, never trust a raw key.
let pepperMissing = false;
const ownerKeyMock = vi.fn((email: string) =>
  pepperMissing ? null : `hash:${email.trim().toLowerCase()}`,
);
vi.mock("@/lib/billing/owner", () => ({
  ownerKeyForEmailSafe: (email: string) => ownerKeyMock(email),
}));

// giftTokens: capture the args and return a deterministic balance. MAX_GIFT_TOKENS
// is re-exported through the same module mock so the route's bound check is real.
const giftMock = vi.fn(async (_ownerKey: string, tokens: number) => 5_000 + tokens);
vi.mock("@/lib/billing/ai-ledger", () => ({
  giftTokens: (ownerKey: string, tokens: number) => giftMock(ownerKey, tokens),
  MAX_GIFT_TOKENS: 100_000_000,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePost(body: unknown): Request {
  return new Request("http://localhost/api/admin/ai-credit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("../route");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  giftMock.mockClear();
  ownerKeyMock.mockClear();
  gateResponse = null;
  pepperMissing = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/ai-credit", () => {
  it("blocks a non-operator with the gate Response and never gifts", async () => {
    gateResponse = new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
    });
    const { POST } = await loadRoute();
    const res = await POST(makePost({ email: "a@b.com", tokens: 1000 }));
    expect(res.status).toBe(404);
    expect(giftMock).not.toHaveBeenCalled();
    expect(ownerKeyMock).not.toHaveBeenCalled();
  });

  it("resolves ownerKeyForEmail(email) and gifts to THAT key, returning the email and balance", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ email: "Gnick317@Gmail.com", tokens: 1_000_000 }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      email: string;
      balance: number;
    };
    expect(json.ok).toBe(true);
    expect(json.email).toBe("Gnick317@Gmail.com");
    expect(json.balance).toBe(5_000 + 1_000_000);
    // The derivation ran against the supplied email.
    expect(ownerKeyMock).toHaveBeenCalledWith("Gnick317@Gmail.com");
    // The gift landed on the DERIVED key (the canonical-email hash), not the raw
    // email, so it matches the key ai-status / ai-chat charge against.
    expect(giftMock).toHaveBeenCalledOnce();
    expect(giftMock.mock.calls[0]).toEqual([
      "hash:gnick317@gmail.com",
      1_000_000,
    ]);
  });

  it("rejects a missing email", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ tokens: 1000 }));
    expect(res.status).toBe(400);
    expect(giftMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ email: "not-an-email", tokens: 1000 }));
    expect(res.status).toBe(400);
    expect(giftMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive token count", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ email: "a@b.com", tokens: 0 }));
    expect(res.status).toBe(400);
    expect(giftMock).not.toHaveBeenCalled();
  });

  it("rejects a non-integer token count", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ email: "a@b.com", tokens: 12.5 }));
    expect(res.status).toBe(400);
    expect(giftMock).not.toHaveBeenCalled();
  });

  it("rejects an over-max token count", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ email: "a@b.com", tokens: 100_000_001 }));
    expect(res.status).toBe(400);
    expect(giftMock).not.toHaveBeenCalled();
  });

  it("answers 503 (not 500) and never gifts when the pepper is missing", async () => {
    pepperMissing = true;
    const { POST } = await loadRoute();
    const res = await POST(makePost({ email: "a@b.com", tokens: 1000 }));
    expect(res.status).toBe(503);
    expect(giftMock).not.toHaveBeenCalled();
  });
});
