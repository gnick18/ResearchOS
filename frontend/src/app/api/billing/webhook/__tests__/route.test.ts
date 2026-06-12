// BeakerBot AI billing, the webhook AI branch (Phase 3). No live Stripe, no Neon.
// The Stripe client (signature verification), the billing/business db, and the AI
// ledger are mocked, so these are pure. They pin the ADDITIVE top-up branch:
//   - a checkout.session.completed carrying metadata.aiPack credits the ledger
//     once, with the pack's token amount and the event id (idempotency key);
//   - the same event does NOT run the subscription path;
//   - a non-AI checkout.session.completed (a subscription) does NOT credit, so
//     the existing subscription handling is untouched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PACK_TOKENS } from "@/lib/billing/ai-config";

const { constructEventAsyncMock, retrieveMock, creditTokensMock, claimEventMock } =
  vi.hoisted(() => ({
    constructEventAsyncMock: vi.fn(),
    retrieveMock: vi.fn(),
    creditTokensMock: vi.fn(),
    claimEventMock: vi.fn(),
  }));

vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEventAsync: constructEventAsyncMock },
    subscriptions: { retrieve: retrieveMock },
  }),
  getWebhookSecret: () => "whsec_test",
}));

vi.mock("@/lib/billing/ai-ledger", () => ({
  creditTokens: creditTokensMock,
}));

// Billing db, only claimEvent gates the flow here. The rest are inert stubs so
// the subscription path (if it ran) would not blow up.
vi.mock("@/lib/billing/db", () => ({
  ensureBillingSchema: vi.fn(async () => {}),
  claimEvent: claimEventMock,
  getSubscriptionByStripeId: vi.fn(async () => null),
  setPlan: vi.fn(async () => {}),
  upsertSubscription: vi.fn(async () => {}),
}));

// Business db, inert stubs (only exercised by the invoice path).
vi.mock("@/lib/business/db", () => ({
  ensureBusinessSchema: vi.fn(async () => {}),
  addLedgerEntry: vi.fn(async () => ({})),
  recordBusinessEmail: vi.fn(async () => {}),
}));

const ORIGINAL_ENV = { ...process.env };

function makeRequest(): Request {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig_test", "content-type": "application/json" },
    body: "{}",
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("../route");
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.BILLING_ENABLED = "true";
  constructEventAsyncMock.mockReset();
  retrieveMock.mockReset();
  creditTokensMock.mockReset();
  claimEventMock.mockReset();
  claimEventMock.mockResolvedValue(true);
  creditTokensMock.mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/billing/webhook, AI top-up branch", () => {
  it("credits the ledger once for a top-up checkout, with the pack tokens and event id", async () => {
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_topup_1",
      type: "checkout.session.completed",
      data: {
        object: {
          // a one-time pack purchase, no subscription, carries aiPack metadata
          subscription: null,
          metadata: { ownerKey: "owner_abc", aiPack: "25" },
        },
      },
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(creditTokensMock).toHaveBeenCalledTimes(1);
    expect(creditTokensMock).toHaveBeenCalledWith(
      "owner_abc",
      PACK_TOKENS[25],
      "evt_topup_1",
    );
    // The top-up branch returns early, the subscription retrieve must not run.
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("does NOT credit when a top-up event is missing the owner key", async () => {
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_topup_2",
      type: "checkout.session.completed",
      data: { object: { subscription: null, metadata: { aiPack: "10" } } },
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(creditTokensMock).not.toHaveBeenCalled();
  });

  it("does NOT credit on a subscription checkout (the existing path is untouched)", async () => {
    retrieveMock.mockResolvedValue({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      items: { data: [{ id: "si_1" }] },
      metadata: { ownerKey: "owner_sub", planId: "free" },
    });
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_sub_1",
      type: "checkout.session.completed",
      data: {
        object: {
          subscription: "sub_1",
          metadata: { ownerKey: "owner_sub", planId: "lab" },
        },
      },
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(creditTokensMock).not.toHaveBeenCalled();
    // The subscription path ran instead.
    expect(retrieveMock).toHaveBeenCalledWith("sub_1");
  });

  it("acknowledges a redelivered event without reprocessing (idempotency)", async () => {
    claimEventMock.mockResolvedValue(false);
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_topup_1",
      type: "checkout.session.completed",
      data: {
        object: { subscription: null, metadata: { ownerKey: "owner_abc", aiPack: "25" } },
      },
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(creditTokensMock).not.toHaveBeenCalled();
  });
});
