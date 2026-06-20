// Tests for comped-tier entitlement in the Model-A resolve layer.
//
// Covers: getEffectiveModelAPlanId, resolveModelAPlanId, and isProduceEntitled
// all honoring an active comped gift tier when no real paid plan is present.
// Also verifies that a real paid plan is never downgraded by a lower comp, that
// an expired comp (null return) confers nothing, and that a grants-layer error
// fails safe to free.
//
// Strategy: mock @neondatabase/serverless and ../grants so we control what the
// functions see without hitting real DB. Lab resolution (resolveBillingOwner) is
// also mocked to bypass its schema calls for isProduceEntitled tests.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Neon call-queue mock ───────────────────────────────────────────────────────
// Each tagged-template call pops from the queue. Index resets in beforeEach.
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

// ── Mock grants.getActiveCompedTier ───────────────────────────────────────────
vi.mock("../../grants", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../grants")>();
  return { ...mod, getActiveCompedTier: vi.fn() };
});

// ── Mock lab.resolveBillingOwner to return the owner key unchanged ─────────────
// isProduceEntitled calls ensureLabSchema + resolveBillingOwner. We stub both
// so the test can focus on the entitlement logic without lab DB calls.
vi.mock("../../lab", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../lab")>();
  return {
    ...mod,
    ensureLabSchema: vi.fn().mockResolvedValue(undefined),
    resolveBillingOwner: vi.fn().mockImplementation((k: string) => Promise.resolve(k)),
  };
});

const { getActiveCompedTier: _compMock } = await import("../../grants");
const compMock = vi.mocked(_compMock);

const { getEffectiveModelAPlanId, resolveModelAPlanId, isProduceEntitled } =
  await import("../resolve");

// ── Helpers ────────────────────────────────────────────────────────────────────

/** getSubscription fires ONE SQL SELECT. Prefix it with an empty array so
 *  ensureBillingSchema (which fires 6 calls inside quotaBytesForOwner but NOT
 *  inside getSubscription directly) is not needed here; getSubscription reads
 *  from the singleton sql function that runs whatever the queue says. */
function queueSub(subRow: Record<string, unknown> | null): void {
  callIdx = 0;
  callQueue = [subRow ? [subRow] : []];
}

const FREE_SUB = {
  owner_key: "owner",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  stripe_item_id: null,
  cap_bytes: 0,
  status: "inactive",
  lab_billing: false,
  plan_id: "free",
};

const PAID_SOLO_SUB = { ...FREE_SUB, status: "active", plan_id: "solo" };
const PAID_LAB_SUB = { ...FREE_SUB, status: "active", plan_id: "lab" };

// ── getEffectiveModelAPlanId ───────────────────────────────────────────────────

describe("getEffectiveModelAPlanId", () => {
  beforeEach(() => {
    compMock.mockReset();
    callIdx = 0;
    callQueue = [];
  });

  it("returns free when there is no subscription and no comp", async () => {
    queueSub(null);
    compMock.mockResolvedValue(null);
    expect(await getEffectiveModelAPlanId("owner")).toBe("free");
  });

  it("returns lab when there is a lab comp and no real plan", async () => {
    queueSub(null);
    compMock.mockResolvedValue("lab");
    expect(await getEffectiveModelAPlanId("owner")).toBe("lab");
  });

  it("returns solo when there is a solo comp and no real plan", async () => {
    queueSub(null);
    compMock.mockResolvedValue("solo");
    expect(await getEffectiveModelAPlanId("owner")).toBe("solo");
  });

  it("returns dept when there is a dept comp and no real plan", async () => {
    queueSub(null);
    compMock.mockResolvedValue("dept");
    expect(await getEffectiveModelAPlanId("owner")).toBe("dept");
  });

  it("returns the real plan and ignores a lower comp (no downgrade)", async () => {
    // Real plan is lab; comp is solo. Lab must win.
    queueSub(PAID_LAB_SUB);
    compMock.mockResolvedValue("solo");
    expect(await getEffectiveModelAPlanId("owner")).toBe("lab");
  });

  it("returns the real plan and ignores an equal comp (no change, no DB comp call needed)", async () => {
    queueSub(PAID_LAB_SUB);
    compMock.mockResolvedValue("lab");
    // The real plan is lab, so comp is irrelevant. Still lab.
    expect(await getEffectiveModelAPlanId("owner")).toBe("lab");
  });

  it("returns the real plan solo and ignores a lab comp that would upgrade", async () => {
    // The real plan is solo; comp is lab. Real plan is not free, so comp is skipped.
    queueSub(PAID_SOLO_SUB);
    compMock.mockResolvedValue("lab");
    expect(await getEffectiveModelAPlanId("owner")).toBe("solo");
  });

  it("returns free when the comp is expired (getActiveCompedTier returns null)", async () => {
    queueSub(null);
    compMock.mockResolvedValue(null);
    expect(await getEffectiveModelAPlanId("owner")).toBe("free");
  });

  it("fails safe to free when getActiveCompedTier throws", async () => {
    queueSub(null);
    compMock.mockRejectedValue(new Error("db down"));
    expect(await getEffectiveModelAPlanId("owner")).toBe("free");
  });
});

// ── resolveModelAPlanId ────────────────────────────────────────────────────────

describe("resolveModelAPlanId", () => {
  beforeEach(() => {
    compMock.mockReset();
    callIdx = 0;
    callQueue = [];
  });

  it("returns lab-level entitlement for a lab comp", async () => {
    queueSub(null);
    compMock.mockResolvedValue("lab");
    expect(await resolveModelAPlanId("owner")).toBe("lab");
  });

  it("returns solo for a solo comp", async () => {
    queueSub(null);
    compMock.mockResolvedValue("solo");
    expect(await resolveModelAPlanId("owner")).toBe("solo");
  });

  it("returns the real plan, not the comp, when the real plan is paid", async () => {
    queueSub(PAID_LAB_SUB);
    // Even a lab comp should not change a real lab plan.
    compMock.mockResolvedValue("lab");
    expect(await resolveModelAPlanId("owner")).toBe("lab");
  });
});

// ── isProduceEntitled ──────────────────────────────────────────────────────────

describe("isProduceEntitled with comped tier", () => {
  beforeEach(() => {
    compMock.mockReset();
    callIdx = 0;
    callQueue = [];
  });

  it("is true for a lab comped owner with no real subscription", async () => {
    // resolveBillingOwner returns owner unchanged (mocked above).
    // getSubscription fires one call, returning no row.
    queueSub(null);
    compMock.mockResolvedValue("lab");
    expect(await isProduceEntitled("owner")).toBe(true);
  });

  it("is true for a solo comped owner", async () => {
    queueSub(null);
    compMock.mockResolvedValue("solo");
    expect(await isProduceEntitled("owner")).toBe(true);
  });

  it("is false when the comp is expired", async () => {
    queueSub(null);
    compMock.mockResolvedValue(null);
    expect(await isProduceEntitled("owner")).toBe(false);
  });

  it("is true for a real paid solo plan (unchanged from before)", async () => {
    queueSub(PAID_SOLO_SUB);
    // Comp should not matter here; real plan already grants produce.
    compMock.mockResolvedValue(null);
    expect(await isProduceEntitled("owner")).toBe(true);
  });

  it("does not downgrade a real paid lab to free when comp throws", async () => {
    // Real plan is lab (paid, active). Even if comp throws, real plan still wins.
    queueSub(PAID_LAB_SUB);
    compMock.mockRejectedValue(new Error("grants down"));
    expect(await isProduceEntitled("owner")).toBe(true);
  });
});
