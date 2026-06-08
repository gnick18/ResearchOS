// Lab-tier Phase 7a: migration planner unit tests.
//
// Covers:
//   - single-user folder -> alreadySolo true, usersToMove empty.
//   - empty folder (0 users) -> alreadySolo true.
//   - multiuser (3 users, primary = one of them) -> usersToMove has the other
//     2 with correct recordCounts + totals, sorted by username, primary excluded.
//   - primaryUser not in allUsers -> throws a descriptive error.
//   - countRecords is called once per non-primary user and NOT for the primary
//     (asserted with a spy).
//   - totals are the sum of the per-type counts.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import {
  planMigrationToSolo,
  type MigrationPlan,
  type PerUserSummary,
} from "../migrate-to-solo";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Build a countRecords fake that returns a fixed map per username. */
function fixedCountRecords(
  map: Record<string, Record<string, number>>,
): (username: string) => Promise<Record<string, number>> {
  return async (username: string) => map[username] ?? {};
}

// ---------------------------------------------------------------------------
// alreadySolo cases.
// ---------------------------------------------------------------------------

describe("planMigrationToSolo: alreadySolo cases", () => {
  it("returns alreadySolo:true for a single-user folder", async () => {
    const countRecords = vi.fn(async () => ({}));
    const plan = await planMigrationToSolo({
      allUsers: ["alice"],
      primaryUser: "alice",
      countRecords,
    });

    expect(plan.alreadySolo).toBe(true);
    expect(plan.usersToMove).toHaveLength(0);
    expect(plan.primaryUser).toBe("alice");
    // countRecords must NOT be called (primary user is never counted).
    expect(countRecords).not.toHaveBeenCalled();
  });

  it("returns alreadySolo:true for an empty folder (0 users)", async () => {
    const countRecords = vi.fn(async () => ({}));
    const plan = await planMigrationToSolo({
      allUsers: [],
      primaryUser: "alice",
      countRecords,
    });

    expect(plan.alreadySolo).toBe(true);
    expect(plan.usersToMove).toHaveLength(0);
    expect(countRecords).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// multiuser case.
// ---------------------------------------------------------------------------

describe("planMigrationToSolo: multiuser folder", () => {
  it("usersToMove has the two non-primary users with correct recordCounts, totals, sorted by username", async () => {
    // 3 users: alice (primary), bob, carol.
    const countRecords = vi.fn(
      fixedCountRecords({
        bob: { task: 3, note: 2, method: 1 },
        carol: { task: 0, note: 5 },
      }),
    );

    const plan = await planMigrationToSolo({
      allUsers: ["carol", "alice", "bob"], // intentionally unsorted input
      primaryUser: "alice",
      countRecords,
    });

    expect(plan.alreadySolo).toBe(false);
    expect(plan.primaryUser).toBe("alice");
    expect(plan.usersToMove).toHaveLength(2);

    // Sorted ascending by username: bob before carol.
    expect(plan.usersToMove[0].username).toBe("bob");
    expect(plan.usersToMove[1].username).toBe("carol");

    // bob's counts.
    const bob = plan.usersToMove[0] as PerUserSummary;
    expect(bob.recordCounts).toEqual({ task: 3, note: 2, method: 1 });
    expect(bob.total).toBe(6); // 3 + 2 + 1

    // carol's counts.
    const carol = plan.usersToMove[1] as PerUserSummary;
    expect(carol.recordCounts).toEqual({ task: 0, note: 5 });
    expect(carol.total).toBe(5); // 0 + 5
  });

  it("primary user is excluded from usersToMove", async () => {
    const plan = await planMigrationToSolo({
      allUsers: ["alice", "bob"],
      primaryUser: "alice",
      countRecords: async () => ({}),
    });

    const usernames = plan.usersToMove.map((u) => u.username);
    expect(usernames).not.toContain("alice");
    expect(usernames).toContain("bob");
  });

  it("totals are the sum of all per-type count values", async () => {
    const plan = await planMigrationToSolo({
      allUsers: ["primary", "other"],
      primaryUser: "primary",
      countRecords: async () => ({
        task: 4,
        experiment: 2,
        note: 7,
        method: 0,
        purchase: 1,
      }),
    });

    expect(plan.usersToMove[0].total).toBe(14); // 4 + 2 + 7 + 0 + 1
  });
});

// ---------------------------------------------------------------------------
// countRecords spy assertions.
// ---------------------------------------------------------------------------

describe("planMigrationToSolo: countRecords spy", () => {
  it("calls countRecords once per non-primary user and NOT for the primary", async () => {
    const countRecords = vi.fn(async (_username: string) => ({ task: 1 }));

    await planMigrationToSolo({
      allUsers: ["alice", "bob", "carol"],
      primaryUser: "alice",
      countRecords,
    });

    // Called exactly twice (bob + carol), never for alice.
    expect(countRecords).toHaveBeenCalledTimes(2);
    const calledWith = countRecords.mock.calls.map((args) => args[0]);
    expect(calledWith).toContain("bob");
    expect(calledWith).toContain("carol");
    expect(calledWith).not.toContain("alice");
  });

  it("countRecords is never called in an alreadySolo folder", async () => {
    const countRecords = vi.fn(async () => ({}));

    await planMigrationToSolo({
      allUsers: ["alice"],
      primaryUser: "alice",
      countRecords,
    });

    expect(countRecords).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// error case: primaryUser not in allUsers.
// ---------------------------------------------------------------------------

describe("planMigrationToSolo: primaryUser not in allUsers", () => {
  it("throws a descriptive error when primaryUser is absent from a non-empty allUsers", async () => {
    await expect(
      planMigrationToSolo({
        allUsers: ["bob", "carol"],
        primaryUser: "alice",
        countRecords: async () => ({}),
      }),
    ).rejects.toThrow(/primaryUser "alice" is not present in allUsers/);
  });

  it("does NOT throw when allUsers is empty (empty folder edge case)", async () => {
    // An empty folder does not contain anyone; the primary is not absent, it
    // just has nothing. alreadySolo should be returned cleanly.
    const plan = await planMigrationToSolo({
      allUsers: [],
      primaryUser: "alice",
      countRecords: async () => ({}),
    });
    expect(plan.alreadySolo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stable sort: output is deterministic regardless of input order.
// ---------------------------------------------------------------------------

describe("planMigrationToSolo: stable sort", () => {
  it("usersToMove is always sorted ascending by username regardless of allUsers input order", async () => {
    const users = ["zelda", "alice", "bob", "carol", "primary"];

    const plan1 = await planMigrationToSolo({
      allUsers: users,
      primaryUser: "primary",
      countRecords: async (u) => ({ task: u.length }), // deterministic counts
    });

    const plan2 = await planMigrationToSolo({
      allUsers: [...users].reverse(),
      primaryUser: "primary",
      countRecords: async (u) => ({ task: u.length }),
    });

    const names1 = plan1.usersToMove.map((u) => u.username);
    const names2 = plan2.usersToMove.map((u) => u.username);

    // Both runs produce the same sorted sequence.
    expect(names1).toEqual(names2);
    // And that sequence is ascending.
    expect(names1).toEqual([...names1].sort());
  });
});
