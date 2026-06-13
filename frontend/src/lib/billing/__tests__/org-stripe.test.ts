// Phase 3 org billing, the procurement subscription orchestration. No live Stripe,
// no Neon: the Stripe client and the org-billing persistence are mocked, so these
// pin the control flow for both payment methods.
//   - a zero-derived rate persists the plan + marks inactive, never touches Stripe;
//   - invoice, no existing sub: creates a send_invoice subscription (net terms),
//     no payment method collected, marks active;
//   - invoice, existing sub: updates the item price in place, no second sub;
//   - automatic, no existing sub: returns a Checkout URL + pending_checkout (the
//     admin adds a card or bank), no subscription created server-side;
//   - automatic, existing automatic sub: updates the price in place;
//   - the tax seam is off unless ORG_BILLING_TAX_ENABLED.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  customersCreateMock,
  pricesCreateMock,
  subsCreateMock,
  subsUpdateMock,
  subsCancelMock,
  checkoutCreateMock,
  getOrgBillingMock,
  setOrgPlanMock,
  setOrgCustomerMock,
  setOrgSubscriptionMock,
} = vi.hoisted(() => ({
  customersCreateMock: vi.fn(),
  pricesCreateMock: vi.fn(),
  subsCreateMock: vi.fn(),
  subsUpdateMock: vi.fn(),
  subsCancelMock: vi.fn(),
  checkoutCreateMock: vi.fn(),
  getOrgBillingMock: vi.fn(),
  setOrgPlanMock: vi.fn(async () => {}),
  setOrgCustomerMock: vi.fn(async () => {}),
  setOrgSubscriptionMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({
    customers: { create: customersCreateMock },
    prices: { create: pricesCreateMock },
    subscriptions: {
      create: subsCreateMock,
      update: subsUpdateMock,
      cancel: subsCancelMock,
    },
    checkout: { sessions: { create: checkoutCreateMock } },
  }),
}));

vi.mock("@/lib/billing/org-billing", () => ({
  getOrgBilling: getOrgBillingMock,
  setOrgPlan: setOrgPlanMock,
  setOrgCustomer: setOrgCustomerMock,
  setOrgSubscription: setOrgSubscriptionMock,
}));

import { setupOrgBilling, cancelOrgSubscription } from "../org-stripe";

const INFO = { name: "Chemistry Dept", email: "admin@uni.edu" };
const BASE = {
  tier: "department" as const,
  entityId: "dept_x",
  info: INFO,
  returnOrigin: "https://app.test",
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ORG_BILLING_TAX_ENABLED;
  getOrgBillingMock.mockResolvedValue(null);
  customersCreateMock.mockResolvedValue({ id: "cus_1" });
  pricesCreateMock.mockResolvedValue({ id: "price_1" });
  subsCreateMock.mockResolvedValue({ id: "sub_1", items: { data: [{ id: "si_1" }] } });
  subsUpdateMock.mockResolvedValue({ id: "sub_1", items: { data: [{ id: "si_1" }] } });
  checkoutCreateMock.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setupOrgBilling", () => {
  it("a zero rate persists the plan inactive and never touches Stripe", async () => {
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 0, storageGb: 0 },
      monthlyCents: 0,
      method: "invoice",
    });
    expect(r.status).toBe("inactive");
    expect(setOrgPlanMock).toHaveBeenCalledWith("department", "dept_x", { labs: 0, storageGb: 0 }, 0, "invoice");
    expect(subsCreateMock).not.toHaveBeenCalled();
    expect(checkoutCreateMock).not.toHaveBeenCalled();
  });

  it("invoice, no existing sub: creates a send_invoice subscription", async () => {
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 3, storageGb: 200 },
      monthlyCents: 12345,
      method: "invoice",
    });
    expect(r).toEqual({ status: "active" });
    expect(subsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        collection_method: "send_invoice",
        days_until_due: 30,
        metadata: expect.objectContaining({ orgTier: "department", orgId: "dept_x" }),
      }),
    );
    expect(checkoutCreateMock).not.toHaveBeenCalled();
    expect(setOrgSubscriptionMock).toHaveBeenCalledWith("department", "dept_x", "sub_1", "si_1", "active");
  });

  it("invoice, existing sub: updates the item price in place", async () => {
    getOrgBillingMock.mockResolvedValue({
      tier: "department",
      entityId: "dept_x",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      stripeItemId: "si_1",
      monthlyCents: 1000,
      planInputs: {},
      method: "invoice",
      status: "active",
    });
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 5, storageGb: 400 },
      monthlyCents: 22222,
      method: "invoice",
    });
    expect(r).toEqual({ status: "active" });
    expect(subsUpdateMock).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({
        items: [{ id: "si_1", price: "price_1" }],
        collection_method: "send_invoice",
      }),
    );
    expect(subsCreateMock).not.toHaveBeenCalled();
  });

  it("automatic, no existing sub: returns a Checkout URL + pending_checkout", async () => {
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 4, storageGb: 300 },
      monthlyCents: 33333,
      method: "automatic",
    });
    expect(r.status).toBe("pending_checkout");
    expect(r.url).toBe("https://stripe.test/cs_1");
    // payment_method_types is intentionally omitted so Stripe presents every
    // eligible method for the buyer (card + local bank debits per the Dashboard).
    const checkoutArgs = checkoutCreateMock.mock.calls[0][0];
    expect(checkoutArgs.mode).toBe("subscription");
    expect(checkoutArgs.payment_method_types).toBeUndefined();
    expect(checkoutArgs.metadata).toMatchObject({ orgTier: "department", orgId: "dept_x" });
    expect(subsCreateMock).not.toHaveBeenCalled();
    expect(setOrgSubscriptionMock).toHaveBeenCalledWith("department", "dept_x", null, null, "pending_checkout");
  });

  it("automatic, existing automatic sub: updates the price in place (charge_automatically)", async () => {
    getOrgBillingMock.mockResolvedValue({
      tier: "department",
      entityId: "dept_x",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      stripeItemId: "si_1",
      monthlyCents: 1000,
      planInputs: {},
      method: "automatic",
      status: "active",
    });
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 6, storageGb: 500 },
      monthlyCents: 44444,
      method: "automatic",
    });
    expect(r).toEqual({ status: "active" });
    expect(subsUpdateMock).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({ collection_method: "charge_automatically" }),
    );
    expect(checkoutCreateMock).not.toHaveBeenCalled();
  });

  it("omits automatic_tax unless ORG_BILLING_TAX_ENABLED is set", async () => {
    await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 2, storageGb: 100 },
      monthlyCents: 5000,
      method: "invoice",
    });
    expect(subsCreateMock.mock.calls[0][0].automatic_tax).toBeUndefined();
  });

  it("includes automatic_tax when the tax flag is on", async () => {
    process.env.ORG_BILLING_TAX_ENABLED = "true";
    await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 2, storageGb: 100 },
      monthlyCents: 5000,
      method: "invoice",
    });
    expect(subsCreateMock.mock.calls[0][0].automatic_tax).toEqual({ enabled: true });
  });
});

describe("cancelOrgSubscription", () => {
  it("cancels the Stripe subscription and marks the row canceled", async () => {
    getOrgBillingMock.mockResolvedValue({
      tier: "department",
      entityId: "dept_x",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      stripeItemId: "si_1",
      monthlyCents: 1000,
      planInputs: {},
      method: "invoice",
      status: "active",
    });
    subsCancelMock.mockResolvedValue({});
    await cancelOrgSubscription("department", "dept_x");
    expect(subsCancelMock).toHaveBeenCalledWith("sub_1");
    expect(setOrgSubscriptionMock).toHaveBeenCalledWith("department", "dept_x", "sub_1", "si_1", "canceled");
  });

  it("is safe when there is no subscription", async () => {
    getOrgBillingMock.mockResolvedValue(null);
    await cancelOrgSubscription("department", "dept_x");
    expect(subsCancelMock).not.toHaveBeenCalled();
    expect(setOrgSubscriptionMock).toHaveBeenCalledWith("department", "dept_x", null, null, "canceled");
  });
});
