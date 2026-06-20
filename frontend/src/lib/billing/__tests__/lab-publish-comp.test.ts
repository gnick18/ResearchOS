// Tests for isLabPublishEntitled extended with the comped-tier OR-gate.
//
// Strategy: mock @neondatabase/serverless so ensureBillingSchema + getSubscription
// can run (db.ts's module-level singleton needs DATABASE_URL + a working neon()).
// Control getSubscription output via nextRows (same pattern as grants.test.ts).
// Control getActiveCompedTier output by mocking ../grants.
//
// The mock is a call-sequence queue: each SQL tagged-template call pops one
// entry. ensureBillingSchema fires multiple ALTER TABLE calls before the SELECT;
// we pad the queue with enough entries.
//
// The existing lab-entitlement.test.ts pins the pure isActiveLabPlan predicate.
// This file pins only the new comped-tier branch.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Neon queue mock ────────────────────────────────────────────────────────────
// Each call to the tagged-template function pops the next entry. This lets us
// control what getSubscription sees without touching the schema calls.

let callQueue: unknown[][] = [];
let callIdx = 0;

vi.mock("@neondatabase/serverless", () => ({
  neon: () =>
    Object.assign(
      () => {
        const row = callQueue[callIdx] ?? [];
        callIdx++;
        return Promise.resolve(row);
      },
      { unsafe: (s: string) => s },
    ),
}));

process.env.DATABASE_URL = "postgres://test";

// ── Mock getActiveCompedTier from grants ───────────────────────────────────────

vi.mock("../grants", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../grants")>();
  return { ...mod, getActiveCompedTier: vi.fn() };
});

const { getActiveCompedTier: _compedMock } = await import("../grants");
const getCompedTierMock = vi.mocked(_compedMock);

const { isLabPublishEntitled } = await import("../db");
import { LAB_PLANS, type Plan } from "../plans";

const paidLabPlan = LAB_PLANS.find((p: Plan) => p.priceCents > 0)!;

// ensureBillingSchema fires 6 SQL calls (CREATE TABLE + 5 ALTER TABLE statements
// + CREATE TABLE billing_events). After that, getSubscription fires 1 SELECT.
// We pre-fill the schema calls with empty arrays so they succeed silently.
const SCHEMA_CALLS = 6;

function setupForSubscription(subRows: unknown[]): void {
  callIdx = 0;
  callQueue = [
    ...Array.from({ length: SCHEMA_CALLS }, () => [] as unknown[]),
    subRows,
  ];
}

describe("isLabPublishEntitled with comped tier", () => {
  beforeEach(() => {
    getCompedTierMock.mockReset();
    callIdx = 0;
    callQueue = [];
  });

  it("is false for an empty owner key (fast-path, no DB calls)", async () => {
    expect(await isLabPublishEntitled("")).toBe(false);
  });

  it("is false when there is no subscription row and no comp", async () => {
    setupForSubscription([]);
    getCompedTierMock.mockResolvedValue(null);
    expect(await isLabPublishEntitled("owner")).toBe(false);
  });

  it("is true when the real subscription is a paid lab plan", async () => {
    setupForSubscription([
      {
        owner_key: "owner",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_item_id: null,
        cap_bytes: 0,
        status: "active",
        lab_billing: false,
        plan_id: paidLabPlan.id,
      },
    ]);
    // Comp should not matter when the real plan qualifies.
    getCompedTierMock.mockResolvedValue(null);
    expect(await isLabPublishEntitled("owner")).toBe(true);
  });

  it("is true for an active lab comp with no real subscription", async () => {
    setupForSubscription([]);
    getCompedTierMock.mockResolvedValue("lab");
    expect(await isLabPublishEntitled("owner")).toBe(true);
  });

  it("is true for an active dept comp with no real subscription", async () => {
    setupForSubscription([]);
    getCompedTierMock.mockResolvedValue("dept");
    expect(await isLabPublishEntitled("owner")).toBe(true);
  });

  it("is false for a solo comp (solo is individual-only, not lab-publish)", async () => {
    setupForSubscription([]);
    getCompedTierMock.mockResolvedValue("solo");
    expect(await isLabPublishEntitled("owner")).toBe(false);
  });

  it("is false when the comp is expired (getActiveCompedTier returns null)", async () => {
    // SQL WHERE expires_at > now() means expired grants return no rows, so
    // getActiveCompedTier returns null. The gate must stay closed.
    setupForSubscription([]);
    getCompedTierMock.mockResolvedValue(null);
    expect(await isLabPublishEntitled("owner")).toBe(false);
  });

  it("is false when getActiveCompedTier throws (fail-safe catch)", async () => {
    setupForSubscription([]);
    getCompedTierMock.mockRejectedValue(new Error("db down"));
    expect(await isLabPublishEntitled("owner")).toBe(false);
  });
});
