// resolveBillingOwner contract: a lab member resolves to their sponsoring lab
// (the PI's key, so usage + cap pool there), a solo user resolves to themselves,
// and any DB error fails SAFE to the owner's own key (billed solo + capped,
// never escaping enforcement). The SQL aggregation itself (getLabPoolUsage
// subquery, enrollMemberActive upsert) verifies at the BILLING_ENABLED
// launch-time integration test against a real DB, matching how the rest of the
// billing DB layer is checked. See docs/proposals/LAB_SHARED_BILLING_POOL.md.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Controllable neon stub: each query resolves to `nextRows`, or rejects when
// `shouldThrow` is set, so we can drive getSponsoringLab's result.
let nextRows: unknown[] = [];
let shouldThrow = false;

vi.mock("@neondatabase/serverless", () => ({
  neon: () => () =>
    shouldThrow ? Promise.reject(new Error("db down")) : Promise.resolve(nextRows),
}));

process.env.DATABASE_URL = "postgres://test";

const { resolveBillingOwner } = await import("../lab");

describe("resolveBillingOwner", () => {
  beforeEach(() => {
    nextRows = [];
    shouldThrow = false;
  });

  it("resolves a lab member to their sponsoring lab (the PI key)", async () => {
    nextRows = [{ lab_owner_key: "PI_LAB_KEY" }];
    expect(await resolveBillingOwner("member_key")).toBe("PI_LAB_KEY");
  });

  it("resolves a solo user (no active sponsor) to themselves", async () => {
    nextRows = [];
    expect(await resolveBillingOwner("solo_key")).toBe("solo_key");
  });

  it("fails safe to the owner's own key on a DB error", async () => {
    shouldThrow = true;
    expect(await resolveBillingOwner("anyone")).toBe("anyone");
  });
});
