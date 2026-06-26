// Tests for POST /api/admin/ai-credit (operator gift of BeakerBot AI tokens).
//
// Pins:
//   - a non-operator is blocked by requireOperator (the gate Response is returned).
//   - a valid { ownerKey, tokens } calls giftTokens and returns the new balance.
//   - missing ownerKey is a 400.
//   - a non-positive or non-integer token count is a 400.
//   - an over-max token count is a 400.
//
// No live Neon, giftTokens is mocked so we test the route's gate + validation.
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
  gateResponse = null;
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
    const res = await POST(makePost({ ownerKey: "ok:abc", tokens: 1000 }));
    expect(res.status).toBe(404);
    expect(giftMock).not.toHaveBeenCalled();
  });

  it("gifts tokens by ownerKey and returns the new balance", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ ownerKey: "ok:abc", tokens: 1_000_000 }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; balance: number };
    expect(json.ok).toBe(true);
    expect(json.balance).toBe(5_000 + 1_000_000);
    expect(giftMock).toHaveBeenCalledOnce();
    expect(giftMock.mock.calls[0]).toEqual(["ok:abc", 1_000_000]);
  });

  it("rejects a missing ownerKey", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ tokens: 1000 }));
    expect(res.status).toBe(400);
    expect(giftMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive token count", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ ownerKey: "ok:abc", tokens: 0 }));
    expect(res.status).toBe(400);
    expect(giftMock).not.toHaveBeenCalled();
  });

  it("rejects a non-integer token count", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ ownerKey: "ok:abc", tokens: 12.5 }));
    expect(res.status).toBe(400);
    expect(giftMock).not.toHaveBeenCalled();
  });

  it("rejects an over-max token count", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makePost({ ownerKey: "ok:abc", tokens: 100_000_001 }),
    );
    expect(res.status).toBe(400);
    expect(giftMock).not.toHaveBeenCalled();
  });
});
