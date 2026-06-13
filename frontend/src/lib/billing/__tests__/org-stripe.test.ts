// Phase 3 org billing, the procurement subscription orchestration. No live Stripe,
// no Neon: the Stripe client and the org-billing persistence are mocked, so these
// pin the control flow.
//   - a zero-derived rate persists the plan + marks inactive, and never calls
//     Stripe (no empty subscription is created);
//   - a positive rate with no existing subscription creates a send_invoice
//     subscription with net terms and records the ids active;
//   - a positive rate with an existing subscription UPDATES the item price in
//     place rather than creating a second subscription.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  customersCreateMock,
  pricesCreateMock,
  subsCreateMock,
  subsUpdateMock,
  subsCancelMock,
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
  }),
}));

vi.mock("@/lib/billing/org-billing", () => ({
  getOrgBilling: getOrgBillingMock,
  setOrgPlan: setOrgPlanMock,
  setOrgCustomer: setOrgCustomerMock,
  setOrgSubscription: setOrgSubscriptionMock,
}));

import {
  provisionOrgSubscription,
  cancelOrgSubscription,
} from "../org-stripe";

const INFO = { name: "Chemistry Dept", email: "admin@uni.edu" };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ORG_BILLING_TAX_ENABLED;
  getOrgBillingMock.mockResolvedValue(null);
  customersCreateMock.mockResolvedValue({ id: "cus_1" });
  pricesCreateMock.mockResolvedValue({ id: "price_1" });
  subsCreateMock.mockResolvedValue({ id: "sub_1", items: { data: [{ id: "si_1" }] } });
  subsUpdateMock.mockResolvedValue({ id: "sub_1", items: { data: [{ id: "si_1" }] } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("provisionOrgSubscription", () => {
  it("a zero rate persists the plan inactive and never touches Stripe", async () => {
    const sub = await provisionOrgSubscription({
      tier: "department",
      entityId: "dept_x",
      info: INFO,
      planInputs: { labs: 0, storageTb: 0 },
      monthlyCents: 0,
    });
    expect(sub).toBeNull();
    expect(setOrgPlanMock).toHaveBeenCalledWith("department", "dept_x", { labs: 0, storageTb: 0 }, 0);
    expect(setOrgSubscriptionMock).toHaveBeenCalledWith("department", "dept_x", null, null, "inactive");
    expect(customersCreateMock).not.toHaveBeenCalled();
    expect(subsCreateMock).not.toHaveBeenCalled();
  });

  it("a positive rate with no existing sub creates a send_invoice subscription", async () => {
    await provisionOrgSubscription({
      tier: "department",
      entityId: "dept_x",
      info: INFO,
      planInputs: { labs: 3, storageTb: 2 },
      monthlyCents: 12345,
    });
    expect(pricesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "usd", unit_amount: 12345 }),
    );
    expect(subsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        collection_method: "send_invoice",
        days_until_due: 30,
        metadata: expect.objectContaining({ orgTier: "department", orgId: "dept_x" }),
      }),
    );
    expect(setOrgSubscriptionMock).toHaveBeenCalledWith("department", "dept_x", "sub_1", "si_1", "active");
  });

  it("updates the existing subscription item in place instead of creating a second", async () => {
    getOrgBillingMock.mockResolvedValue({
      tier: "department",
      entityId: "dept_x",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      stripeItemId: "si_1",
      monthlyCents: 1000,
      planInputs: {},
      status: "active",
    });
    await provisionOrgSubscription({
      tier: "department",
      entityId: "dept_x",
      info: INFO,
      planInputs: { labs: 5, storageTb: 4 },
      monthlyCents: 22222,
    });
    expect(subsUpdateMock).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({ items: [{ id: "si_1", price: "price_1" }] }),
    );
    expect(subsCreateMock).not.toHaveBeenCalled();
  });

  it("omits automatic_tax unless ORG_BILLING_TAX_ENABLED is set", async () => {
    await provisionOrgSubscription({
      tier: "institution",
      entityId: "inst_y",
      info: INFO,
      planInputs: { depts: 2, storageTb: 5 },
      monthlyCents: 50000,
    });
    const args = subsCreateMock.mock.calls[0][0];
    expect(args.automatic_tax).toBeUndefined();
  });

  it("includes automatic_tax when the tax flag is on", async () => {
    process.env.ORG_BILLING_TAX_ENABLED = "true";
    await provisionOrgSubscription({
      tier: "institution",
      entityId: "inst_y",
      info: INFO,
      planInputs: { depts: 2, storageTb: 5 },
      monthlyCents: 50000,
    });
    const args = subsCreateMock.mock.calls[0][0];
    expect(args.automatic_tax).toEqual({ enabled: true });
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
