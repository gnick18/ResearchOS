// Phase 3 org billing, the procurement subscription orchestration. No live Stripe,
// no Neon: the Stripe client and the org-billing persistence are mocked, so these
// pin the control flow for the collection (invoice vs automatic) and the pay class
// (card = list price vs bank = discounted), including that the discounted price is
// enforced to bank-debit methods only.
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
import { priceForMethod } from "../processing-fee";

const INFO = { name: "Chemistry Dept", email: "admin@uni.edu" };
const BASE = {
  tier: "department" as const,
  entityId: "dept_x",
  info: INFO,
  returnOrigin: "https://app.test",
};

beforeEach(() => {
  vi.clearAllMocks();
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
  it("a zero rate persists inactive and never touches Stripe", async () => {
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 0, storageGb: 0, international: 0 },
      monthlyCents: 0,
      method: "invoice",
      payClass: "bank",
    });
    expect(r.status).toBe("inactive");
    expect(subsCreateMock).not.toHaveBeenCalled();
    expect(checkoutCreateMock).not.toHaveBeenCalled();
  });

  it("invoice + bank: send_invoice, restricted to bank methods, discounted price", async () => {
    const list = 20000;
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 3, storageGb: 200, international: 0 },
      monthlyCents: list,
      method: "invoice",
      payClass: "bank",
    });
    expect(r).toEqual({ status: "active" });
    // The bank price is the discounted amount, below the card list price.
    const expected = priceForMethod(list, "bank", false);
    expect(pricesCreateMock.mock.calls[0][0].unit_amount).toBe(expected);
    expect(expected).toBeLessThan(list);
    const subArgs = subsCreateMock.mock.calls[0][0];
    expect(subArgs.collection_method).toBe("send_invoice");
    expect(subArgs.payment_settings.payment_method_types).toContain("us_bank_account");
    expect(subArgs.payment_settings.payment_method_types).not.toContain("card");
  });

  it("automatic + card: Checkout restricted to card, price is the list", async () => {
    const list = 20000;
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 3, storageGb: 200, international: 0 },
      monthlyCents: list,
      method: "automatic",
      payClass: "card",
    });
    expect(r.status).toBe("pending_checkout");
    expect(r.url).toBe("https://stripe.test/cs_1");
    expect(pricesCreateMock.mock.calls[0][0].unit_amount).toBe(list); // card pays list
    expect(checkoutCreateMock.mock.calls[0][0].payment_method_types).toEqual(["card"]);
  });

  it("automatic + bank: Checkout restricted to bank debits, discounted price", async () => {
    const list = 20000;
    await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 3, storageGb: 200, international: 0 },
      monthlyCents: list,
      method: "automatic",
      payClass: "bank",
    });
    expect(pricesCreateMock.mock.calls[0][0].unit_amount).toBe(priceForMethod(list, "bank", false));
    const methods = checkoutCreateMock.mock.calls[0][0].payment_method_types;
    expect(methods).toContain("us_bank_account");
    expect(methods).not.toContain("card");
  });

  it("invoice + bank with an existing invoice sub updates the price in place", async () => {
    getOrgBillingMock.mockResolvedValue({
      tier: "department", entityId: "dept_x",
      stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", stripeItemId: "si_1",
      monthlyCents: 1000, planInputs: {}, method: "invoice", payClass: "bank", status: "active",
    });
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 5, storageGb: 400, international: 0 },
      monthlyCents: 30000,
      method: "invoice",
      payClass: "bank",
    });
    expect(r).toEqual({ status: "active" });
    expect(subsUpdateMock).toHaveBeenCalled();
    expect(checkoutCreateMock).not.toHaveBeenCalled();
  });

  it("changing the pay class on an automatic sub forces a fresh Checkout", async () => {
    // STATEFUL mock: setOrgPlan writes method/payClass and getOrgBilling reflects
    // it, catching the read-after-write ordering bug. The switch must be detected
    // from the PRIOR row (read BEFORE setOrgPlan). If the code reads existing after
    // the write, row.payClass is already "bank", no switch is seen, an in-place
    // update runs, and this test fails.
    let row: Record<string, unknown> = {
      tier: "department", entityId: "dept_x",
      stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", stripeItemId: "si_1",
      monthlyCents: 1000, planInputs: {}, method: "automatic", payClass: "card", status: "active",
    };
    getOrgBillingMock.mockImplementation(async () => row);
    setOrgPlanMock.mockImplementation((async (
      _t: unknown,
      _e: unknown,
      _pi: unknown,
      _c: unknown,
      m: unknown,
      pc: unknown,
    ) => {
      row = { ...row, method: m as string, payClass: pc as string };
    }) as unknown as () => Promise<void>);
    subsCancelMock.mockResolvedValue({});
    const r = await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 5, storageGb: 400, international: 0 },
      monthlyCents: 30000,
      method: "automatic",
      payClass: "bank", // was card -> needs a new bank instrument
    });
    expect(r.status).toBe("pending_checkout");
    expect(checkoutCreateMock).toHaveBeenCalled();
    expect(subsUpdateMock).not.toHaveBeenCalled();
  });

  it("an international card list yields a bigger bank discount than domestic", async () => {
    const list = 20000;
    await setupOrgBilling({
      ...BASE,
      planInputs: { labs: 3, storageGb: 200, international: 1 },
      monthlyCents: list,
      method: "invoice",
      payClass: "bank",
    });
    expect(pricesCreateMock.mock.calls[0][0].unit_amount).toBe(priceForMethod(list, "bank", true));
    expect(priceForMethod(list, "bank", true)).toBeLessThan(priceForMethod(list, "bank", false));
  });
});

describe("cancelOrgSubscription", () => {
  it("cancels the Stripe subscription and marks the row canceled", async () => {
    getOrgBillingMock.mockResolvedValue({
      tier: "department", entityId: "dept_x",
      stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", stripeItemId: "si_1",
      monthlyCents: 1000, planInputs: {}, method: "invoice", payClass: "bank", status: "active",
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
