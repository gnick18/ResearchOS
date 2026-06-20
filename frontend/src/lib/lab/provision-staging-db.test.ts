// Unit tests for the staged-PI-provisioning store.
//
// Pins the JS mapping + the SQL shape the routes depend on:
//   - schema-ensure is idempotent (callable repeatedly, no throw).
//   - upsert -> get roundtrip maps the row to the typed shape (numbers coerced,
//     nulls preserved, status defaulted).
//   - markConsumed runs without throwing and the get mapping reads 'consumed'.
//
// No live Neon: the @neondatabase/serverless driver is mocked so the tagged
// template returns a queued row set, the same pattern as billing/grants.test.ts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The mock query function returns whatever `nextRows` is set to. A tagged-template
// call (sql`...`) invokes this, so every query in a test resolves to nextRows.
let nextRows: unknown[] = [];
const queryFn = vi.fn(async () => nextRows);

vi.mock("@neondatabase/serverless", () => ({
  neon: () => queryFn,
}));

process.env.DATABASE_URL = "postgres://test";

const {
  ensureProvisionStagingSchema,
  upsertProvisionStaging,
  getProvisionStaging,
  markProvisionConsumed,
} = await import("./provision-staging-db");

beforeEach(() => {
  nextRows = [];
  queryFn.mockClear();
});

describe("provision-staging-db", () => {
  it("ensureProvisionStagingSchema is idempotent (no throw on repeat calls)", async () => {
    await expect(ensureProvisionStagingSchema()).resolves.toBeUndefined();
    await expect(ensureProvisionStagingSchema()).resolves.toBeUndefined();
  });

  it("upsert -> get roundtrips the typed row (coerces numbers, preserves nulls)", async () => {
    // The driver row uses snake_case + string numerics, like Neon returns. After
    // the upsert INSERT (which returns nothing meaningful here), getProvisionStaging
    // re-selects, so we seed the SELECT result.
    nextRows = [
      {
        pi_email_hash: "hash-abc",
        lab_name: "Nickles Lab",
        institution: null,
        slug: "nickles-lab",
        comp_tier: "lab",
        comp_months: "12",
        pi_title: "Dr.",
        pi_display: "Grant Nickles",
        status: "pending",
        created_at: "2026-06-19T00:00:00Z",
        consumed_at: null,
      },
    ];

    const row = await upsertProvisionStaging({
      piEmailHash: "hash-abc",
      labName: "Nickles Lab",
      institution: null,
      slug: "nickles-lab",
      compTier: "lab",
      compMonths: 12,
      piTitle: "Dr.",
      piDisplay: "Grant Nickles",
    });

    expect(row).toEqual({
      piEmailHash: "hash-abc",
      labName: "Nickles Lab",
      institution: null,
      slug: "nickles-lab",
      compTier: "lab",
      compMonths: 12, // string "12" coerced to a number
      piTitle: "Dr.",
      piDisplay: "Grant Nickles",
      status: "pending",
      createdAt: "2026-06-19T00:00:00Z",
      consumedAt: null,
    });
  });

  it("getProvisionStaging returns null when no row matches", async () => {
    nextRows = [];
    expect(await getProvisionStaging("missing")).toBeNull();
  });

  it("getProvisionStaging returns null for an empty hash without a query", async () => {
    queryFn.mockClear();
    expect(await getProvisionStaging("")).toBeNull();
    // An empty hash short-circuits before any SQL runs.
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("markProvisionConsumed runs without throwing, and a consumed row maps", async () => {
    await expect(markProvisionConsumed("hash-abc")).resolves.toBeUndefined();

    nextRows = [
      {
        pi_email_hash: "hash-abc",
        lab_name: "Nickles Lab",
        institution: "UW-Madison",
        slug: "nickles-lab",
        comp_tier: "lab",
        comp_months: 12,
        pi_title: null,
        pi_display: null,
        status: "consumed",
        created_at: "2026-06-19T00:00:00Z",
        consumed_at: "2026-06-20T00:00:00Z",
      },
    ];
    const row = await getProvisionStaging("hash-abc");
    expect(row?.status).toBe("consumed");
    expect(row?.consumedAt).toBe("2026-06-20T00:00:00Z");
    expect(row?.institution).toBe("UW-Madison");
  });

  it("markProvisionConsumed is a no-op on an empty hash (no query)", async () => {
    queryFn.mockClear();
    await markProvisionConsumed("");
    expect(queryFn).not.toHaveBeenCalled();
  });
});
