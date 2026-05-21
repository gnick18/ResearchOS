// frontend/src/lib/streak/__tests__/streak-sidecar.test.ts
//
// Unit tests for the Phase S0 _streak.json sidecar module. Pinning
// the data-layer contract here means S1+ (activity tracking,
// milestone scheduler) can build on top with confidence that the
// write-queue race, the lazy-init contract, and the past-anniversary
// backfill all hold.
//
// Mocks: the fileService is replaced with an in-memory Map so the
// tests run in node-env without an OPFS / FSA shim. user-metadata's
// getUserMetadata is mocked separately so initializeStreakForUser
// can be driven with controlled created_at values.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();
const writeOrder: string[] = [];

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      // Sleep a tick so concurrent writes that are serialized through
      // the queue have to actually queue, not just resolve in
      // microtask order. Without this the race test below would
      // pass even if the queue were a no-op.
      await new Promise((r) => setTimeout(r, 2));
      memFs.set(path, data);
      writeOrder.push(path);
    }),
    isConnected: vi.fn(() => true),
  },
}));

const userMetaMap = new Map<string, { created_at: string; color: string }>();
vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async (username: string) => {
    return userMetaMap.get(username) ?? null;
  }),
}));

import {
  ACCOUNT_ANNIVERSARY_THRESHOLDS,
  INITIAL_STREAK,
  STREAK_MILESTONE_THRESHOLDS,
  computeReachedAnniversaries,
  initializeStreakForUser,
  isPtoDay,
  isSkipDay,
  isWeekend,
  patchStreak,
  readStreak,
  type StreakSidecar,
  __resetStreakWriteQueueForTests,
} from "../streak-sidecar";

const USER = "alex";
const PATH = `users/${USER}/_streak.json`;

beforeEach(() => {
  memFs.clear();
  userMetaMap.clear();
  writeOrder.length = 0;
  __resetStreakWriteQueueForTests();
});

describe("readStreak", () => {
  it("returns INITIAL_STREAK when the file is missing", async () => {
    const sc = await readStreak(USER);
    expect(sc).toEqual(INITIAL_STREAK);
    // And does NOT write — pure read.
    expect(memFs.has(PATH)).toBe(false);
  });

  it("returns the parsed sidecar when the file exists", async () => {
    const stored: StreakSidecar = {
      schema_version: 1,
      enabled: true,
      current_count: 12,
      longest_count: 28,
      last_activity_date: "2026-05-20",
      started_on: "2026-05-09",
      shown_privacy_notice: true,
      pto_dates: ["2026-06-01", "2026-06-02"],
      celebrations_seen: {
        account_anniversaries: ["1w", "1mo"],
        streak_milestones: ["3d", "7d"],
      },
    };
    memFs.set(PATH, stored);
    const sc = await readStreak(USER);
    expect(sc).toEqual(stored);
  });

  it("self-heals pto_dates ordering and duplicates on read", async () => {
    memFs.set(PATH, {
      ...INITIAL_STREAK,
      pto_dates: ["2026-06-02", "2026-06-01", "2026-06-02"],
    });
    const sc = await readStreak(USER);
    expect(sc.pto_dates).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("defaults enabled to true on a malformed missing-enabled record", async () => {
    memFs.set(PATH, { schema_version: 1 });
    const sc = await readStreak(USER);
    expect(sc.enabled).toBe(true);
    expect(sc.current_count).toBe(0);
  });
});

describe("patchStreak write-queue serialization", () => {
  it("serializes 5 concurrent patches without lost updates", async () => {
    // Fire 5 increments in parallel. Each reads current_count, adds 1,
    // and writes back. Without serialization the writes would
    // interleave and final count would be < 5 (lost updates). With
    // the per-user queue, every read sees the prior write's result.
    const promises = [
      patchStreak(USER, (cur) => ({ ...cur, current_count: cur.current_count + 1 })),
      patchStreak(USER, (cur) => ({ ...cur, current_count: cur.current_count + 1 })),
      patchStreak(USER, (cur) => ({ ...cur, current_count: cur.current_count + 1 })),
      patchStreak(USER, (cur) => ({ ...cur, current_count: cur.current_count + 1 })),
      patchStreak(USER, (cur) => ({ ...cur, current_count: cur.current_count + 1 })),
    ];
    await Promise.all(promises);
    const final = await readStreak(USER);
    expect(final.current_count).toBe(5);
    // The write order should be 5 writes, all to the same path, in
    // queue order (not interleaved with anything else).
    expect(writeOrder.filter((p) => p === PATH).length).toBe(5);
  });

  it("does NOT block concurrent patches on different users", async () => {
    // Two users patching at the same time should both complete and
    // each see only their own increments.
    const promises = [
      patchStreak("alice", (cur) => ({ ...cur, current_count: cur.current_count + 1 })),
      patchStreak("bob", (cur) => ({ ...cur, current_count: cur.current_count + 10 })),
      patchStreak("alice", (cur) => ({ ...cur, current_count: cur.current_count + 1 })),
      patchStreak("bob", (cur) => ({ ...cur, current_count: cur.current_count + 10 })),
    ];
    await Promise.all(promises);
    const alice = await readStreak("alice");
    const bob = await readStreak("bob");
    expect(alice.current_count).toBe(2);
    expect(bob.current_count).toBe(20);
  });

  it("keeps pto_dates sorted and deduped after an out-of-order patch", async () => {
    await patchStreak(USER, (cur) => ({
      ...cur,
      pto_dates: ["2026-06-15", "2026-05-03", "2026-06-15", "2026-04-20"],
    }));
    const sc = await readStreak(USER);
    expect(sc.pto_dates).toEqual(["2026-04-20", "2026-05-03", "2026-06-15"]);
  });

  it("doesn't poison the queue when a write fails", async () => {
    // First patch: succeed. Second patch: throw inside the mutator.
    // Third patch: should still run cleanly after the failure.
    await patchStreak(USER, (cur) => ({ ...cur, current_count: 1 }));
    await expect(
      patchStreak(USER, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await patchStreak(USER, (cur) => ({
      ...cur,
      current_count: cur.current_count + 10,
    }));
    const sc = await readStreak(USER);
    expect(sc.current_count).toBe(11);
  });
});

describe("initializeStreakForUser", () => {
  it("persists INITIAL_STREAK when the user has no metadata yet", async () => {
    const sc = await initializeStreakForUser(USER);
    expect(sc).toEqual(INITIAL_STREAK);
    expect(memFs.get(PATH)).toEqual(INITIAL_STREAK);
  });

  it("backfills past anniversaries as already-seen for an existing user", async () => {
    // 200 days ago: should mark 1w, 1mo, 3mo, 6mo (but not 1y, 2y, 5y).
    const now = new Date();
    const twoHundredDaysAgo = new Date(now.getTime() - 200 * 86_400_000);
    userMetaMap.set(USER, {
      color: "#3b82f6",
      created_at: twoHundredDaysAgo.toISOString(),
    });
    const sc = await initializeStreakForUser(USER);
    expect(sc.celebrations_seen.account_anniversaries).toEqual([
      "1w",
      "1mo",
      "3mo",
      "6mo",
    ]);
    expect(sc.celebrations_seen.streak_milestones).toEqual([]);
    // Streak counters fresh.
    expect(sc.current_count).toBe(0);
    expect(sc.longest_count).toBe(0);
    expect(sc.last_activity_date).toBeNull();
    expect(sc.enabled).toBe(true);
  });

  it("backfills all 7 anniversaries for a user older than 5 years", async () => {
    const sixYearsAgo = new Date();
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
    userMetaMap.set(USER, {
      color: "#3b82f6",
      created_at: sixYearsAgo.toISOString(),
    });
    const sc = await initializeStreakForUser(USER);
    expect(sc.celebrations_seen.account_anniversaries).toEqual([
      "1w",
      "1mo",
      "3mo",
      "6mo",
      "1y",
      "2y",
      "5y",
    ]);
  });

  it("backfills nothing for a brand-new account (created today)", async () => {
    userMetaMap.set(USER, {
      color: "#3b82f6",
      created_at: new Date().toISOString(),
    });
    const sc = await initializeStreakForUser(USER);
    expect(sc.celebrations_seen.account_anniversaries).toEqual([]);
  });
});

describe("isWeekend / isPtoDay / isSkipDay", () => {
  // 2026-05-21 is a Thursday. 2026-05-23 is Saturday. 2026-05-24 is Sunday.
  // Verify the day-of-week math against known-good dates.

  it("isWeekend returns true for Saturday and Sunday", () => {
    expect(isWeekend("2026-05-23")).toBe(true); // Sat
    expect(isWeekend("2026-05-24")).toBe(true); // Sun
  });

  it("isWeekend returns false for weekdays", () => {
    expect(isWeekend("2026-05-19")).toBe(false); // Tue
    expect(isWeekend("2026-05-21")).toBe(false); // Thu
    expect(isWeekend("2026-05-22")).toBe(false); // Fri
  });

  it("isWeekend returns false for malformed input", () => {
    expect(isWeekend("not-a-date")).toBe(false);
    expect(isWeekend("")).toBe(false);
  });

  it("isPtoDay returns true for any date in pto_dates", () => {
    const pto = ["2026-05-19", "2026-06-01"];
    expect(isPtoDay("2026-05-19", pto)).toBe(true);
    expect(isPtoDay("2026-06-01", pto)).toBe(true);
  });

  it("isPtoDay returns false for dates not in pto_dates", () => {
    const pto = ["2026-05-19"];
    expect(isPtoDay("2026-05-20", pto)).toBe(false);
    expect(isPtoDay("2026-05-19", [])).toBe(false);
  });

  it("isSkipDay returns true for Sat/Sun", () => {
    expect(isSkipDay("2026-05-23", [])).toBe(true);
    expect(isSkipDay("2026-05-24", [])).toBe(true);
  });

  it("isSkipDay returns true for any date in pto_dates", () => {
    expect(isSkipDay("2026-05-19", ["2026-05-19"])).toBe(true); // weekday PTO
    expect(isSkipDay("2026-05-23", ["2026-05-23"])).toBe(true); // weekend ALSO PTO
  });

  it("isSkipDay returns false for a weekday not in pto_dates", () => {
    expect(isSkipDay("2026-05-19", [])).toBe(false); // Tue, no PTO
    expect(isSkipDay("2026-05-21", ["2026-05-19"])).toBe(false); // Thu, PTO is a different day
  });
});

describe("computeReachedAnniversaries", () => {
  it("returns 1w / 1mo / 3mo / 6mo for a created_at 200 days before today", () => {
    // Anchor today to a fixed date so the test isn't time-sensitive.
    const today = "2026-05-21";
    const createdAt = "2025-11-02T08:00:00.000Z"; // 200 days before 2026-05-21
    const reached = computeReachedAnniversaries(createdAt, today);
    expect(reached).toEqual(["1w", "1mo", "3mo", "6mo"]);
  });

  it("returns [] for a created_at in the future", () => {
    const today = "2026-05-21";
    const createdAt = "2026-06-01T08:00:00.000Z";
    expect(computeReachedAnniversaries(createdAt, today)).toEqual([]);
  });

  it("returns [] for malformed created_at", () => {
    expect(computeReachedAnniversaries("garbage")).toEqual([]);
    expect(computeReachedAnniversaries("")).toEqual([]);
  });

  it("returns all 7 tags for a created_at older than 5 years", () => {
    const today = "2026-05-21";
    const createdAt = "2020-01-01T08:00:00.000Z";
    expect(computeReachedAnniversaries(createdAt, today)).toEqual([
      "1w",
      "1mo",
      "3mo",
      "6mo",
      "1y",
      "2y",
      "5y",
    ]);
  });

  it("matches the threshold boundary exactly (created_at exactly 7 days ago = 1w reached)", () => {
    const today = "2026-05-21";
    const createdAt = "2026-05-14T00:00:00.000Z"; // exactly 7 days before
    expect(computeReachedAnniversaries(createdAt, today)).toEqual(["1w"]);
  });
});

describe("threshold tables match the spec (L10 / L11)", () => {
  it("account anniversaries are 1w, 1mo, 3mo, 6mo, 1y, 2y, 5y", () => {
    expect(ACCOUNT_ANNIVERSARY_THRESHOLDS.map((t) => t.tag)).toEqual([
      "1w",
      "1mo",
      "3mo",
      "6mo",
      "1y",
      "2y",
      "5y",
    ]);
    expect(ACCOUNT_ANNIVERSARY_THRESHOLDS.map((t) => t.days)).toEqual([
      7, 30, 90, 180, 365, 730, 1825,
    ]);
  });

  it("streak milestones are 3, 7, 14, 30, 100, 365 days", () => {
    expect(STREAK_MILESTONE_THRESHOLDS.map((t) => t.tag)).toEqual([
      "3d",
      "7d",
      "14d",
      "30d",
      "100d",
      "365d",
    ]);
    expect(STREAK_MILESTONE_THRESHOLDS.map((t) => t.count)).toEqual([
      3, 7, 14, 30, 100, 365,
    ]);
  });
});
