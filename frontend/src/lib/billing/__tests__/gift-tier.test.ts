// Tests for getActiveCompedTier and issueGrant validation (grants.ts).
//
// getActiveCompedTier: JS mapping of DB rows to the highest tier. The SQL
// expiry filter (expires_at > now()) lives in Neon; we simulate its output by
// injecting rows. Returns null when empty.
//
// issueGrant tier-requires-expiry: pure JS guard before any SQL runs.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Install the Neon mock before any module imports so the singleton captures it.
let nextRows: unknown[] = [];

vi.mock("@neondatabase/serverless", () => ({
  neon: () =>
    Object.assign(() => Promise.resolve(nextRows), {
      unsafe: (s: string) => s,
    }),
}));

process.env.DATABASE_URL = "postgres://test";

const { getActiveCompedTier, issueGrant } = await import("../grants");

// ── getActiveCompedTier ────────────────────────────────────────────────────────

describe("getActiveCompedTier", () => {
  beforeEach(() => {
    nextRows = [];
  });

  it("returns null when there are no active comped-tier grants", async () => {
    nextRows = [];
    expect(await getActiveCompedTier("owner")).toBeNull();
  });

  it("returns the single active tier", async () => {
    nextRows = [{ gift_tier: "lab" }];
    expect(await getActiveCompedTier("owner")).toBe("lab");
  });

  it("returns the highest tier when multiple are active (dept > lab > solo)", async () => {
    nextRows = [{ gift_tier: "solo" }, { gift_tier: "lab" }, { gift_tier: "dept" }];
    expect(await getActiveCompedTier("owner")).toBe("dept");
  });

  it("returns lab over solo", async () => {
    nextRows = [{ gift_tier: "solo" }, { gift_tier: "lab" }];
    expect(await getActiveCompedTier("owner")).toBe("lab");
  });

  it("returns dept over lab", async () => {
    nextRows = [{ gift_tier: "lab" }, { gift_tier: "dept" }];
    expect(await getActiveCompedTier("owner")).toBe("dept");
  });

  it("returns null when the SQL returns empty (all grants expired per DB filter)", async () => {
    // The SQL WHERE expires_at > now() already filtered out expired rows.
    // An empty result set means no active comped tier.
    nextRows = [];
    expect(await getActiveCompedTier("anotherOwner")).toBeNull();
  });
});

// ── issueGrant tier-requires-expiry validation ──────────────────────────────────

describe("issueGrant tier-requires-expiry", () => {
  beforeEach(() => {
    nextRows = [{ id: 1 }];
  });

  it("throws when giftTier is set but expiresAt is absent", async () => {
    await expect(
      issueGrant({ ownerKey: "owner", bonusBytes: 0, bonusWrites: 0, giftTier: "lab" }),
    ).rejects.toThrow(/expiresAt/);
  });

  it("throws for solo tier without expiresAt", async () => {
    await expect(
      issueGrant({ ownerKey: "owner", bonusBytes: 0, bonusWrites: 0, giftTier: "solo" }),
    ).rejects.toThrow(/expiresAt/);
  });

  it("throws for dept tier without expiresAt", async () => {
    await expect(
      issueGrant({ ownerKey: "owner", bonusBytes: 0, bonusWrites: 0, giftTier: "dept" }),
    ).rejects.toThrow(/expiresAt/);
  });

  it("throws when giftTier is set and expiresAt is explicitly null", async () => {
    await expect(
      issueGrant({
        ownerKey: "owner",
        bonusBytes: 0,
        bonusWrites: 0,
        giftTier: "lab",
        expiresAt: null,
      }),
    ).rejects.toThrow(/expiresAt/);
  });

  it("succeeds when giftTier is provided with a future expiresAt", async () => {
    await expect(
      issueGrant({
        ownerKey: "owner",
        bonusBytes: 0,
        bonusWrites: 0,
        giftTier: "lab",
        expiresAt: new Date(Date.now() + 86_400_000 * 30).toISOString(),
      }),
    ).resolves.toBe(1);
  });

  it("succeeds with no giftTier and no expiresAt (permanent allowance-only gift)", async () => {
    await expect(
      issueGrant({ ownerKey: "owner", bonusBytes: 1_000_000, bonusWrites: 0 }),
    ).resolves.toBe(1);
  });
});
