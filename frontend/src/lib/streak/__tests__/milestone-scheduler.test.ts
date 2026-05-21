// frontend/src/lib/streak/__tests__/milestone-scheduler.test.ts
//
// Phase S6 evaluator + persistence helper tests.
// Mirrors the streak-sidecar.test.ts setup pattern: in-memory
// fileService + user-metadata stubs, per-test reset.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
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
  __resetStreakWriteQueueForTests,
  type StreakSidecar,
} from "../streak-sidecar";
import {
  evaluatePendingCelebrations,
  markCelebrationSeen,
  type PendingCelebration,
} from "../milestone-scheduler";

const USER = "alex";
const PATH = `users/${USER}/_streak.json`;

function freshSidecar(overrides: Partial<StreakSidecar> = {}): StreakSidecar {
  return {
    schema_version: 1,
    enabled: true,
    current_count: 0,
    longest_count: 0,
    last_activity_date: null,
    started_on: null,
    shown_privacy_notice: false,
    pto_dates: [],
    celebrations_seen: {
      account_anniversaries: [],
      streak_milestones: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  memFs.clear();
  userMetaMap.clear();
  __resetStreakWriteQueueForTests();
});

describe("evaluatePendingCelebrations", () => {
  it("returns [] for an empty username", async () => {
    const pending = await evaluatePendingCelebrations("");
    expect(pending).toEqual([]);
  });

  it("returns [] when no thresholds are crossed", async () => {
    // No streak activity (count 0), and no user_metadata so no
    // anniversaries either.
    memFs.set(PATH, freshSidecar());
    const pending = await evaluatePendingCelebrations(USER);
    expect(pending).toEqual([]);
  });

  it("returns account anniversary tags for thresholds the user has crossed", async () => {
    // User created 200 days ago. Should have reached 1w, 1mo, 3mo, 6mo
    // (not 1y / 2y / 5y yet).
    const createdAt = new Date(Date.now() - 200 * 86_400_000).toISOString();
    userMetaMap.set(USER, { created_at: createdAt, color: "#000000" });
    memFs.set(PATH, freshSidecar());

    const pending = await evaluatePendingCelebrations(USER);
    const anniversaries = pending
      .filter((c) => c.kind === "account_anniversary")
      .map((c) => c.tag);
    expect(anniversaries).toEqual(["1w", "1mo", "3mo", "6mo"]);
  });

  it("excludes anniversary tags that are already in the seen list", async () => {
    const createdAt = new Date(Date.now() - 200 * 86_400_000).toISOString();
    userMetaMap.set(USER, { created_at: createdAt, color: "#000000" });
    memFs.set(
      PATH,
      freshSidecar({
        celebrations_seen: {
          account_anniversaries: ["1w", "1mo"],
          streak_milestones: [],
        },
      }),
    );

    const pending = await evaluatePendingCelebrations(USER);
    const anniversaries = pending
      .filter((c) => c.kind === "account_anniversary")
      .map((c) => c.tag);
    expect(anniversaries).toEqual(["3mo", "6mo"]);
  });

  it("returns streak milestone tags for thresholds the user has crossed", async () => {
    // Current count of 15 → crosses 3d, 7d, 14d (not 30, 100, 365).
    memFs.set(PATH, freshSidecar({ current_count: 15 }));

    const pending = await evaluatePendingCelebrations(USER);
    const streaks = pending.filter((c) => c.kind === "streak_milestone");
    expect(streaks.map((c) => c.tag)).toEqual(["3d", "7d", "14d"]);
    // count is populated for streak milestones.
    expect(streaks.map((c) => c.count)).toEqual([3, 7, 14]);
  });

  it("excludes streak milestone tags that are already in the seen list", async () => {
    memFs.set(
      PATH,
      freshSidecar({
        current_count: 15,
        celebrations_seen: {
          account_anniversaries: [],
          streak_milestones: ["3d", "7d"],
        },
      }),
    );

    const pending = await evaluatePendingCelebrations(USER);
    const streaks = pending
      .filter((c) => c.kind === "streak_milestone")
      .map((c) => c.tag);
    expect(streaks).toEqual(["14d"]);
  });

  it("returns [] when every reached tag is already in seen lists", async () => {
    const createdAt = new Date(Date.now() - 200 * 86_400_000).toISOString();
    userMetaMap.set(USER, { created_at: createdAt, color: "#000000" });
    memFs.set(
      PATH,
      freshSidecar({
        current_count: 15,
        celebrations_seen: {
          account_anniversaries: ["1w", "1mo", "3mo", "6mo"],
          streak_milestones: ["3d", "7d", "14d"],
        },
      }),
    );

    const pending = await evaluatePendingCelebrations(USER);
    expect(pending).toEqual([]);
  });

  it("returns priority order: anniversaries first, then streak milestones", async () => {
    // 200 days since signup, current streak of 15. Both kinds have
    // multiple pending tags; the anniversaries should come first in
    // their natural ascending order, then the streak milestones in
    // their natural ascending order.
    const createdAt = new Date(Date.now() - 200 * 86_400_000).toISOString();
    userMetaMap.set(USER, { created_at: createdAt, color: "#000000" });
    memFs.set(PATH, freshSidecar({ current_count: 15 }));

    const pending = await evaluatePendingCelebrations(USER);
    expect(pending.map((c) => `${c.kind}:${c.tag}`)).toEqual([
      "account_anniversary:1w",
      "account_anniversary:1mo",
      "account_anniversary:3mo",
      "account_anniversary:6mo",
      "streak_milestone:3d",
      "streak_milestone:7d",
      "streak_milestone:14d",
    ]);
  });

  it("returns just streak milestones when user_metadata is missing created_at", async () => {
    // No userMetaMap entry → null metadata → no anniversaries
    memFs.set(PATH, freshSidecar({ current_count: 7 }));
    const pending = await evaluatePendingCelebrations(USER);
    expect(pending.map((c) => `${c.kind}:${c.tag}`)).toEqual([
      "streak_milestone:3d",
      "streak_milestone:7d",
    ]);
  });
});

describe("markCelebrationSeen", () => {
  it("appends an account_anniversary tag to the correct seen list", async () => {
    memFs.set(PATH, freshSidecar());
    const celebration: PendingCelebration = {
      kind: "account_anniversary",
      tag: "1w",
    };
    await markCelebrationSeen(USER, celebration);
    const stored = memFs.get(PATH) as StreakSidecar;
    expect(stored.celebrations_seen.account_anniversaries).toContain("1w");
    expect(stored.celebrations_seen.streak_milestones).not.toContain("1w");
  });

  it("appends a streak_milestone tag to the correct seen list", async () => {
    memFs.set(PATH, freshSidecar());
    const celebration: PendingCelebration = {
      kind: "streak_milestone",
      tag: "7d",
      count: 7,
    };
    await markCelebrationSeen(USER, celebration);
    const stored = memFs.get(PATH) as StreakSidecar;
    expect(stored.celebrations_seen.streak_milestones).toContain("7d");
    expect(stored.celebrations_seen.account_anniversaries).not.toContain("7d");
  });

  it("preserves existing seen entries and dedupes on repeat", async () => {
    memFs.set(
      PATH,
      freshSidecar({
        celebrations_seen: {
          account_anniversaries: ["1w"],
          streak_milestones: ["3d"],
        },
      }),
    );
    // Add a NEW anniversary.
    await markCelebrationSeen(USER, {
      kind: "account_anniversary",
      tag: "1mo",
    });
    let stored = memFs.get(PATH) as StreakSidecar;
    expect(stored.celebrations_seen.account_anniversaries.sort()).toEqual([
      "1mo",
      "1w",
    ]);
    expect(stored.celebrations_seen.streak_milestones).toEqual(["3d"]);

    // Re-mark "1w" should be a no-op (no duplicate).
    await markCelebrationSeen(USER, {
      kind: "account_anniversary",
      tag: "1w",
    });
    stored = memFs.get(PATH) as StreakSidecar;
    expect(
      stored.celebrations_seen.account_anniversaries.filter((t) => t === "1w"),
    ).toHaveLength(1);
  });

  it("is a no-op on empty username or empty tag", async () => {
    memFs.set(PATH, freshSidecar());
    await markCelebrationSeen("", { kind: "account_anniversary", tag: "1w" });
    await markCelebrationSeen(USER, {
      kind: "account_anniversary",
      tag: "",
    });
    const stored = memFs.get(PATH) as StreakSidecar;
    expect(stored.celebrations_seen.account_anniversaries).toEqual([]);
    expect(stored.celebrations_seen.streak_milestones).toEqual([]);
  });
});
