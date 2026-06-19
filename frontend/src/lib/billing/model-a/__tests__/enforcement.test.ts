// Model A monthly $-cap enforcement tests (bill-shock guard).

import { beforeEach, describe, expect, it } from "vitest";

import { __resetCloudSchemaCacheForTests, type Sql } from "../ledger-db";
import { isOverCap, modelACapState } from "../enforcement";
import { type OwnerUsageReader } from "../accrual";
import { MODEL_A_PLANS, periodCharge } from "../pricing";

describe("isOverCap", () => {
  it("a null cap never trips", () => {
    expect(isOverCap(999999, null)).toBe(false);
  });
  it("trips only strictly above the cap", () => {
    expect(isOverCap(500, 500)).toBe(false);
    expect(isOverCap(501, 500)).toBe(true);
    expect(isOverCap(0, 500)).toBe(false);
  });
});

function fakeReader(writes: number, storageBytes: number, hostedBytes: number): OwnerUsageReader {
  return {
    poolWrites: () => Promise.resolve(writes),
    poolStorageBytes: () => Promise.resolve(storageBytes),
    hostedBytes: () => Promise.resolve(hostedBytes),
  };
}

// A mock sql that only needs to answer getMonthlyCap (when capCents is not passed).
function makeCapSql(cap: number | null) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    if (/CREATE TABLE|ALTER TABLE|CREATE UNIQUE INDEX/i.test(text)) return Promise.resolve([]);
    if (/SELECT monthly_cap_cents FROM cloud_balance/i.test(text)) {
      return Promise.resolve(cap == null ? [{ monthly_cap_cents: null }] : [{ monthly_cap_cents: cap }]);
    }
    throw new Error(`unmocked query: ${text}`);
  }) as unknown as Sql;
}

const heavy = { writes: 5_000_000, storageBytes: 100e9, hostedBytes: 0 };

describe("modelACapState", () => {
  beforeEach(() => __resetCloudSchemaCacheForTests());

  it("free owners are never over the cap", async () => {
    const state = await modelACapState("free-a", "2026-06", {
      planId: "free",
      capCents: 100,
      reader: fakeReader(5_000_000, 100e9, 0),
    });
    expect(state.over).toBe(false);
    expect(state.reason).toBeNull();
  });

  it("no cap set means never over (relies on the global breaker)", async () => {
    const state = await modelACapState("solo-a", "2026-06", {
      planId: "solo",
      capCents: null,
      reader: fakeReader(5_000_000, 100e9, 0),
    });
    expect(state.over).toBe(false);
  });

  it("pauses sync when the projected charge exceeds the cap", async () => {
    const projected = periodCharge(MODEL_A_PLANS.lab, { ...heavy, labCount: 1 }).totalCents;
    const cap = projected - 1; // one cent under the projection
    const state = await modelACapState("lab-a", "2026-06", {
      planId: "lab",
      capCents: cap,
      reader: fakeReader(heavy.writes, heavy.storageBytes, heavy.hostedBytes),
    });
    expect(state.projectedCents).toBe(projected);
    expect(state.over).toBe(true);
    expect(state.reason).toBe("cap");
  });

  it("stays under when the cap is comfortably above the projection", async () => {
    const state = await modelACapState("solo-a", "2026-06", {
      planId: "solo",
      capCents: 1_000_000,
      reader: fakeReader(200_000, 4e9, 0),
    });
    expect(state.over).toBe(false);
  });

  it("reads the cap from the ledger when not passed", async () => {
    const sql = makeCapSql(400);
    const projected = periodCharge(MODEL_A_PLANS.solo, { writes: 200_000, storageBytes: 4e9, hostedBytes: 0 }).totalCents;
    const state = await modelACapState("solo-a", "2026-06", {
      planId: "solo",
      reader: fakeReader(200_000, 4e9, 0),
      sql,
    });
    expect(state.capCents).toBe(400);
    expect(state.over).toBe(projected > 400);
  });
});
