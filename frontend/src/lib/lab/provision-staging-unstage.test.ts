// Unit tests for the unstage-side store helpers (staged-PI-provisioning lane).
//
// Pins:
//   - deleteProvisionStaging issues a delete and does not throw.
//   - listPendingStagings maps the snake_case rows to the typed shape (numbers
//     coerced) and returns them.
//
// No live Neon: the @neondatabase/serverless driver is mocked, same pattern as
// provision-staging-db.test.ts.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

let nextRows: unknown[] = [];
const queryFn = vi.fn(async () => nextRows);

vi.mock("@neondatabase/serverless", () => ({
  neon: () => queryFn,
}));

process.env.DATABASE_URL = "postgres://test";

const { deleteProvisionStaging, listPendingStagings } = await import(
  "./provision-staging-db"
);

beforeEach(() => {
  nextRows = [];
  queryFn.mockClear();
});

describe("provision-staging unstage helpers", () => {
  it("deleteProvisionStaging runs a delete without throwing", async () => {
    await expect(deleteProvisionStaging("hash-abc")).resolves.toBeUndefined();
    expect(queryFn).toHaveBeenCalled();
  });

  it("deleteProvisionStaging is a no-op for an empty hash", async () => {
    await expect(deleteProvisionStaging("")).resolves.toBeUndefined();
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("listPendingStagings maps rows to the typed shape (coerces numbers)", async () => {
    nextRows = [
      {
        pi_email_hash: "hash-1",
        lab_name: "Fungal Interactions Lab",
        slug: "fungal-interactions",
        comp_tier: "lab",
        comp_months: "12",
        created_at: "2026-06-20T00:00:00Z",
      },
      {
        pi_email_hash: "hash-2",
        lab_name: "Provisioning Dry Run",
        slug: "ros-provision-dryrun",
        comp_tier: "lab",
        comp_months: 1,
        created_at: "2026-06-20T01:00:00Z",
      },
    ];

    const rows = await listPendingStagings();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      piEmailHash: "hash-1",
      labName: "Fungal Interactions Lab",
      slug: "fungal-interactions",
      compTier: "lab",
      compMonths: 12,
      createdAt: "2026-06-20T00:00:00Z",
    });
    // The string "12" and the number 1 both coerce to a number.
    expect(rows[0].compMonths).toBe(12);
    expect(rows[1].compMonths).toBe(1);
  });

  it("listPendingStagings returns an empty array when nothing is pending", async () => {
    nextRows = [];
    await expect(listPendingStagings()).resolves.toEqual([]);
  });
});
