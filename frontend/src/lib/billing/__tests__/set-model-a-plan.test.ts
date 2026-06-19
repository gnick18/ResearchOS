// setModelAPlan contract: the Model-A card-setup webhook activates a paid plan by
// writing the Model-A id (solo / lab / dept) DIRECTLY with an active status, which
// is what modelAPlanForSubscription reads back. This pins the regression where the
// webhook routed the Model-A id through setPlan (the flat catalog), which resolved
// to null and stored plan_id="free" status="inactive", making a genuine paid lab
// read as free (it would under-charge and mis-gate the lab).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { modelAPlanForSubscription } from "../model-a/resolve";
import type { SubscriptionRecord } from "../db";

// Capturing neon stub: record the values of each query so we can assert what row
// setModelAPlan wrote, and resolve to the configured rows for read-back.
let lastValues: unknown[] = [];
let nextRows: unknown[] = [];

vi.mock("@neondatabase/serverless", () => ({
  neon: () => (_strings: TemplateStringsArray, ...values: unknown[]) => {
    lastValues = values;
    return Promise.resolve(nextRows);
  },
}));

process.env.DATABASE_URL = "postgres://test";

const { setModelAPlan } = await import("../db");

function rowFor(values: unknown[]): SubscriptionRecord {
  // setModelAPlan binds (ownerKey, plan_id, status, ...) on the INSERT VALUES.
  const [ownerKey, planId, status] = values as [string, string, string];
  return {
    ownerKey,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeItemId: null,
    capBytes: 0,
    status,
    labBilling: false,
    planId,
  };
}

describe("setModelAPlan", () => {
  beforeEach(() => {
    lastValues = [];
    nextRows = [];
  });

  it("writes a paid lab as plan_id=lab status=active, which resolves to lab", async () => {
    await setModelAPlan("PI_KEY", "lab");
    expect(lastValues.slice(0, 3)).toEqual(["PI_KEY", "lab", "active"]);
    // The row this produces must read back as a paid lab, not free.
    expect(modelAPlanForSubscription(rowFor(lastValues))).toBe("lab");
  });

  it("writes a paid solo as plan_id=solo status=active, which resolves to solo", async () => {
    await setModelAPlan("SOLO_KEY", "solo");
    expect(lastValues.slice(0, 3)).toEqual(["SOLO_KEY", "solo", "active"]);
    expect(modelAPlanForSubscription(rowFor(lastValues))).toBe("solo");
  });

  it("writes the free tier as free / inactive", async () => {
    await setModelAPlan("FREE_KEY", "free");
    expect(lastValues.slice(0, 3)).toEqual(["FREE_KEY", "free", "inactive"]);
    expect(modelAPlanForSubscription(rowFor(lastValues))).toBe("free");
  });

  it("never grants paid room on an unknown id (falls to free / inactive)", async () => {
    await setModelAPlan("BAD_KEY", "lab_plus"); // a flat id, not a Model-A id
    expect(lastValues.slice(0, 3)).toEqual(["BAD_KEY", "free", "inactive"]);
    expect(modelAPlanForSubscription(rowFor(lastValues))).toBe("free");
  });
});
