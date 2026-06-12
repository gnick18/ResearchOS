// BeakerBot AI billing, the top-up checkout route (Phase 3). No live Stripe, no
// Neon. The Stripe client, the session, and the owner-key hash are all mocked so
// these tests are pure. They pin:
//   - a valid pack creates a one-time Checkout (mode "payment") with the right
//     price id, owner+pack metadata, and returns the session url;
//   - an unknown pack is a 400 and never touches Stripe;
//   - an unconfigured price is a 500 "pack_unconfigured" and never touches Stripe;
//   - no session email is a 401.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock fns so the module factories can close over them.
const { authMock, createMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock("@/lib/sharing/auth", () => ({ auth: authMock }));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: createMock } } }),
}));
// Keep the owner key deterministic without needing the directory pepper.
vi.mock("@/lib/billing/owner", () => ({
  ownerKeyForEmail: (email: string) => `owner:${email}`,
}));

const ORIGINAL_ENV = { ...process.env };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/billing/ai-topup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("../route");
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.BILLING_ENABLED = "true";
  process.env.STRIPE_AI_PRICE_10 = "price_ai_10";
  process.env.STRIPE_AI_PRICE_25 = "price_ai_25";
  process.env.STRIPE_AI_PRICE_50 = "price_ai_50";
  process.env.BILLING_RETURN_ORIGIN = "https://app.test";
  authMock.mockReset();
  createMock.mockReset();
  authMock.mockResolvedValue({ user: { email: "lab@uw.test" } });
  createMock.mockResolvedValue({ url: "https://checkout.stripe.test/c/pay/cs_1" });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/billing/ai-topup", () => {
  it("creates a one-time payment Checkout with the right price + metadata and returns the url", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ pack: "25" }));

    expect(res.status).toBe(200);
    const data = (await res.json()) as { url?: string; pack?: string };
    expect(data.url).toBe("https://checkout.stripe.test/c/pay/cs_1");
    expect(data.pack).toBe("25");

    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0][0] as {
      mode: string;
      line_items: Array<{ price: string; quantity: number }>;
      metadata: Record<string, string>;
      success_url: string;
      cancel_url: string;
    };
    expect(args.mode).toBe("payment");
    expect(args.line_items).toEqual([{ price: "price_ai_25", quantity: 1 }]);
    expect(args.metadata.aiPack).toBe("25");
    expect(args.metadata.ownerKey).toBe("owner:lab@uw.test");
    expect(args.success_url).toContain("/settings?section=ai");
    expect(args.success_url).toContain("topup=success");
    expect(args.cancel_url).toContain("topup=cancel");
  });

  it("uses the price id matching the chosen pack", async () => {
    const { POST } = await loadRoute();
    await POST(makeRequest({ pack: "50" }));
    const args = createMock.mock.calls[0][0] as {
      line_items: Array<{ price: string }>;
    };
    expect(args.line_items[0].price).toBe("price_ai_50");
  });

  it("rejects an unknown pack with 400 and never calls Stripe", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ pack: "100" }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 500 pack_unconfigured when the price env is unset", async () => {
    delete process.env.STRIPE_AI_PRICE_25;
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ pack: "25" }));
    expect(res.status).toBe(500);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toBe("pack_unconfigured");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no signed-in email", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ pack: "10" }));
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 404 when billing is disabled", async () => {
    delete process.env.BILLING_ENABLED;
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ pack: "10" }));
    expect(res.status).toBe(404);
    expect(createMock).not.toHaveBeenCalled();
  });
});
