// resolveBillingChain / resolveBillingPayer contract: the payer is the HIGHEST
// org tier sponsoring an account (member -> lab -> department -> institution), and
// any DB error fails SAFE to self. The hops are sequential Neon lookups, so the
// stub answers from a QUEUE (one entry per query, in call order: lab, dept, then
// institution). The SQL itself verifies at the billing launch-time integration
// test against a real DB, matching the rest of the billing DB layer. See
// docs/proposals/2026-06-13-org-tier-billing-cascade.md.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Queue-driven neon stub: each tagged-template query shifts the next result off
// `queue` (default [] when drained), or rejects globally when `shouldThrow`.
let queue: unknown[][] = [];
let shouldThrow = false;

vi.mock("@neondatabase/serverless", () => ({
  neon: () => () =>
    shouldThrow
      ? Promise.reject(new Error("db down"))
      : Promise.resolve(queue.length ? queue.shift() : []),
}));

process.env.DATABASE_URL = "postgres://test";

const { resolveBillingChain, resolveBillingPayer } = await import("../payer");

describe("resolveBillingChain", () => {
  beforeEach(() => {
    queue = [];
    shouldThrow = false;
  });

  it("solo user with no sponsor pays as self", async () => {
    queue = [[], []]; // no lab, no dept
    const c = await resolveBillingChain("solo");
    expect(c.payer).toEqual({ tier: "self", id: "solo" });
    expect(c.poolOwnerKey).toBe("solo");
    expect(c.labOwnerKey).toBeNull();
  });

  it("member in a lab with no dept pays through the lab (PI key)", async () => {
    queue = [[{ lab_owner_key: "PI" }], []];
    const c = await resolveBillingChain("member");
    expect(c.payer).toEqual({ tier: "lab", id: "PI" });
    expect(c.poolOwnerKey).toBe("PI");
    expect(c.labOwnerKey).toBe("PI");
    expect(c.deptId).toBeNull();
  });

  it("member whose lab is dept-sponsored pays through the department", async () => {
    queue = [[{ lab_owner_key: "PI" }], [{ dept_id: "D1" }], []];
    const c = await resolveBillingChain("member");
    expect(c.payer).toEqual({ tier: "department", id: "D1" });
    expect(c.deptId).toBe("D1");
    expect(c.institutionId).toBeNull();
  });

  it("member whose dept is institution-sponsored pays through the institution", async () => {
    queue = [[{ lab_owner_key: "PI" }], [{ dept_id: "D1" }], [{ institution_id: "I1" }]];
    const c = await resolveBillingChain("member");
    expect(c.payer).toEqual({ tier: "institution", id: "I1" });
    expect(c.deptId).toBe("D1");
    expect(c.institutionId).toBe("I1");
  });

  it("a PI whose own lab is dept-sponsored pays through the department", async () => {
    queue = [[], [{ dept_id: "D1" }], []]; // PI resolves to self at the lab hop
    const c = await resolveBillingChain("PI");
    expect(c.payer).toEqual({ tier: "department", id: "D1" });
    expect(c.labOwnerKey).toBe("PI"); // the PI is the lab head in the chain
  });

  it("fails safe to self on a DB error", async () => {
    shouldThrow = true;
    const c = await resolveBillingChain("anyone");
    expect(c.payer).toEqual({ tier: "self", id: "anyone" });
    expect(c.deptId).toBeNull();
    expect(c.institutionId).toBeNull();
  });

  it("resolveBillingPayer returns just the payer", async () => {
    queue = [[{ lab_owner_key: "PI" }], [{ dept_id: "D1" }], [{ institution_id: "I1" }]];
    expect(await resolveBillingPayer("member")).toEqual({ tier: "institution", id: "I1" });
  });
});
