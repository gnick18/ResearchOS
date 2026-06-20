// Model A dispute + refund webhook branches (Grant 2026-06-19). No live Stripe, no
// Neon. The Stripe client (signature + charges.retrieve), the billing/business db,
// and the model-a ledger are mocked, so these are pure. They pin the ADDITIVE
// dispute/refund branches:
//   - charge.refunded credits the ledger by amount_refunded, keyed on the charge id;
//   - charge.dispute.created flags the mapped owner disputed (pause);
//   - charge.dispute.closed won clears the flag; lost does not.
// The existing handlers are untouched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  constructEventAsyncMock,
  chargesRetrieveMock,
  claimEventMock,
  creditBalanceMock,
  getOwnerByCustomerIdMock,
  setDisputedMock,
  recordChargeMock,
} = vi.hoisted(() => ({
  constructEventAsyncMock: vi.fn(),
  chargesRetrieveMock: vi.fn(),
  claimEventMock: vi.fn(),
  creditBalanceMock: vi.fn(),
  getOwnerByCustomerIdMock: vi.fn(),
  setDisputedMock: vi.fn(),
  recordChargeMock: vi.fn(),
}));

vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEventAsync: constructEventAsyncMock },
    subscriptions: { retrieve: vi.fn() },
    setupIntents: { retrieve: vi.fn() },
    charges: { retrieve: chargesRetrieveMock },
  }),
  getWebhookSecret: () => "whsec_test",
}));

vi.mock("@/lib/billing/db", () => ({
  ensureBillingSchema: vi.fn(async () => {}),
  claimEvent: claimEventMock,
  getSubscriptionByStripeId: vi.fn(async () => null),
  setPlan: vi.fn(async () => {}),
  setModelAPlan: vi.fn(async () => {}),
  upsertSubscription: vi.fn(async () => {}),
}));

vi.mock("@/lib/billing/model-a/ledger", () => ({
  creditBalance: creditBalanceMock,
  getOwnerByCustomerId: getOwnerByCustomerIdMock,
  setDisputed: setDisputedMock,
  recordCharge: recordChargeMock,
  setCloudPaymentMethod: vi.fn(async () => {}),
}));

vi.mock("@/lib/billing/ai-ledger", () => ({ creditTokens: vi.fn(async () => 0) }));
vi.mock("@/lib/billing/org-billing", () => ({
  ensureOrgBillingSchema: vi.fn(async () => {}),
  getOrgBillingBySubId: vi.fn(async () => null),
  setOrgSubscription: vi.fn(async () => {}),
}));
vi.mock("@/lib/business/db", () => ({
  ensureBusinessSchema: vi.fn(async () => {}),
  addLedgerEntryBySource: vi.fn(async () => ({ inserted: true })),
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
  chargesRetrieveMock.mockReset();
  claimEventMock.mockReset();
  claimEventMock.mockResolvedValue(true);
  creditBalanceMock.mockReset();
  creditBalanceMock.mockResolvedValue(0);
  getOwnerByCustomerIdMock.mockReset();
  getOwnerByCustomerIdMock.mockResolvedValue("owner_abc");
  setDisputedMock.mockReset();
  setDisputedMock.mockResolvedValue(undefined);
  recordChargeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("charge.refunded", () => {
  it("credits the owner by the refunded amount, keyed on the charge id", async () => {
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_refund_1",
      type: "charge.refunded",
      data: { object: { id: "ch_1", customer: "cus_1", amount_refunded: 137 } },
    });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(getOwnerByCustomerIdMock).toHaveBeenCalledWith("cus_1");
    expect(creditBalanceMock).toHaveBeenCalledTimes(1);
    expect(creditBalanceMock).toHaveBeenCalledWith("owner_abc", 137, "refund ch_1", "refund:ch_1");
  });

  it("does NOT credit when no refund amount", async () => {
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_refund_2",
      type: "charge.refunded",
      data: { object: { id: "ch_2", customer: "cus_1", amount_refunded: 0 } },
    });
    const { POST } = await loadRoute();
    await POST(makeRequest());
    expect(creditBalanceMock).not.toHaveBeenCalled();
  });

  it("does NOT credit when the customer maps to no owner", async () => {
    getOwnerByCustomerIdMock.mockResolvedValue(null);
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_refund_3",
      type: "charge.refunded",
      data: { object: { id: "ch_3", customer: "cus_unknown", amount_refunded: 500 } },
    });
    const { POST } = await loadRoute();
    await POST(makeRequest());
    expect(creditBalanceMock).not.toHaveBeenCalled();
  });
});

describe("charge.dispute.created / closed", () => {
  it("flags the mapped owner disputed on created", async () => {
    chargesRetrieveMock.mockResolvedValue({ id: "ch_1", customer: "cus_1" });
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_disp_1",
      type: "charge.dispute.created",
      data: { object: { id: "dp_1", charge: "ch_1", status: "needs_response" } },
    });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(chargesRetrieveMock).toHaveBeenCalledWith("ch_1");
    expect(setDisputedMock).toHaveBeenCalledWith("owner_abc", true);
  });

  it("clears the flag on a WON dispute close", async () => {
    chargesRetrieveMock.mockResolvedValue({ id: "ch_1", customer: "cus_1" });
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_disp_won",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_1", charge: "ch_1", status: "won" } },
    });
    const { POST } = await loadRoute();
    await POST(makeRequest());
    expect(setDisputedMock).toHaveBeenCalledWith("owner_abc", false);
  });

  it("does NOT clear the flag on a LOST dispute close", async () => {
    chargesRetrieveMock.mockResolvedValue({ id: "ch_1", customer: "cus_1" });
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_disp_lost",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_1", charge: "ch_1", status: "lost" } },
    });
    const { POST } = await loadRoute();
    await POST(makeRequest());
    expect(setDisputedMock).not.toHaveBeenCalled();
  });

  it("acknowledges a redelivered dispute event without reprocessing", async () => {
    claimEventMock.mockResolvedValue(false);
    constructEventAsyncMock.mockResolvedValue({
      id: "evt_disp_1",
      type: "charge.dispute.created",
      data: { object: { id: "dp_1", charge: "ch_1", status: "needs_response" } },
    });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(setDisputedMock).not.toHaveBeenCalled();
  });
});
