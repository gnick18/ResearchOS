import { describe, expect, it } from "vitest";

import { modelAPlanForSubscription } from "../resolve";
import type { SubscriptionRecord } from "../../db";

function sub(over: Partial<SubscriptionRecord>): SubscriptionRecord {
  return {
    ownerKey: "o",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeItemId: null,
    capBytes: 0,
    status: "active",
    labBilling: false,
    planId: "free",
    ...over,
  };
}

describe("modelAPlanForSubscription", () => {
  it("is free with no subscription", () => {
    expect(modelAPlanForSubscription(null)).toBe("free");
  });

  it("is free when the subscription is not active", () => {
    expect(modelAPlanForSubscription(sub({ status: "inactive", planId: "plus" }))).toBe("free");
    expect(modelAPlanForSubscription(sub({ status: "past_due", planId: "lab_plus" }))).toBe("free");
  });

  it("is free on a free/legacy free plan", () => {
    expect(modelAPlanForSubscription(sub({ planId: "free" }))).toBe("free");
    expect(modelAPlanForSubscription(sub({ planId: "lab_free" }))).toBe("free");
  });

  it("bridges legacy paid individual plans to solo", () => {
    expect(modelAPlanForSubscription(sub({ planId: "plus" }))).toBe("solo");
    expect(modelAPlanForSubscription(sub({ planId: "pro" }))).toBe("solo");
  });

  it("bridges legacy paid lab plans to lab", () => {
    expect(modelAPlanForSubscription(sub({ planId: "lab_plus" }))).toBe("lab");
    expect(modelAPlanForSubscription(sub({ planId: "lab_pro" }))).toBe("lab");
  });

  it("accepts direct Model-A ids set by the new checkout", () => {
    expect(modelAPlanForSubscription(sub({ planId: "solo" }))).toBe("solo");
    expect(modelAPlanForSubscription(sub({ planId: "lab" }))).toBe("lab");
    expect(modelAPlanForSubscription(sub({ planId: "dept" }))).toBe("dept");
  });

  it("is free on an unknown plan id", () => {
    expect(modelAPlanForSubscription(sub({ planId: "mystery" }))).toBe("free");
  });
});
