// getActiveGrant maps the summed-bonus row to numbers and zeros out when there
// is no active grant. The expiry filter itself (expires_at > now()) is SQL and
// verifies at the launch-time integration test; this pins the JS mapping +
// fail-to-zero shape the allowance functions depend on.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

let nextRows: unknown[] = [];

vi.mock("@neondatabase/serverless", () => ({
  neon: () => () => Promise.resolve(nextRows),
}));

process.env.DATABASE_URL = "postgres://test";

const { getActiveGrant } = await import("../grants");

const GB = 1024 ** 3;

describe("getActiveGrant", () => {
  beforeEach(() => {
    nextRows = [];
  });

  it("returns the summed bonus bytes + writes", async () => {
    nextRows = [{ bytes: 50 * GB, writes: 3_000_000 }];
    expect(await getActiveGrant("owner")).toEqual({
      bonusBytes: 50 * GB,
      bonusWrites: 3_000_000,
    });
  });

  it("coerces string-typed numerics from the driver", async () => {
    nextRows = [{ bytes: "1073741824", writes: "1000000" }];
    expect(await getActiveGrant("owner")).toEqual({
      bonusBytes: GB,
      bonusWrites: 1_000_000,
    });
  });

  it("returns zeros when there is no active grant", async () => {
    nextRows = [{ bytes: 0, writes: 0 }];
    expect(await getActiveGrant("owner")).toEqual({
      bonusBytes: 0,
      bonusWrites: 0,
    });
  });
});
