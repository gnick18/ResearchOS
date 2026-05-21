// frontend/src/lib/streak/__tests__/streak-activity-tracker.test.ts
//
// Phase S1 tests: the activity tracker + tick + debounce + day-boundary
// + multi-user concurrency + milestone-emission semantics. Pinning
// these here means S2/S3/S6 can build on top with confidence the
// engine actually advances counters correctly.
//
// Mocks: fileService is replaced with an in-memory Map (same shape as
// the S0 test) so node-env tests run without an OPFS shim.
// user-metadata is a no-op (not used in S1).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      // Microtask-only async so writes still resolve when fake-timers
      // are in use (a setTimeout(0) here would deadlock under
      // vi.useFakeTimers since no real timer is ticking).
      await Promise.resolve();
      memFs.set(path, data);
    }),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
}));

import {
  INITIAL_STREAK,
  __resetStreakWriteQueueForTests,
  readStreak,
  type StreakSidecar,
} from "../streak-sidecar";
import {
  __resetStreakActivityTrackerForTests,
  flushStreakActivity,
  notifyStreakActivity,
  onStreakMilestoneCrossed,
} from "../streak-activity-tracker";

/** Build a path for a user's sidecar file. */
const sidecarPath = (u: string) => `users/${u}/_streak.json`;

/** Seed the in-memory fs with a sidecar shape for a user. */
function seedSidecar(username: string, patch: Partial<StreakSidecar>): void {
  memFs.set(sidecarPath(username), { ...INITIAL_STREAK, ...patch });
}

/** Convert a Date to YYYY-MM-DD in local time (the date the tracker
 *  computes via `new Date().getFullYear()` etc). */
function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

beforeEach(() => {
  memFs.clear();
  __resetStreakWriteQueueForTests();
  __resetStreakActivityTrackerForTests();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ----- first-ever activity -----------------------------------------

describe("first-ever activity (last_activity_date null)", () => {
  it("sets current_count = 1, started_on = today, last_activity_date = today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 10, 0, 0)); // Thu 2026-05-21
    const today = isoOf(new Date());

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    // flush any in-flight tick fully
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    expect(sc.current_count).toBe(1);
    expect(sc.longest_count).toBe(1);
    expect(sc.last_activity_date).toBe(today);
    expect(sc.started_on).toBe(today);
  });
});

// ----- idempotent same-day -----------------------------------------

describe("second activity same day", () => {
  it("is a no-op (no write, no count change)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 10, 0, 0));
    const today = isoOf(new Date());
    seedSidecar("alex", {
      current_count: 3,
      longest_count: 5,
      last_activity_date: today,
      started_on: today,
    });

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    expect(sc.current_count).toBe(3);
    expect(sc.last_activity_date).toBe(today);
  });
});

// ----- consecutive workday -----------------------------------------

describe("consecutive workday", () => {
  it("increments current_count by 1", async () => {
    vi.useFakeTimers();
    // Tue 2026-05-19 yesterday, today is Wed 2026-05-20 (both workdays).
    vi.setSystemTime(new Date(2026, 4, 20, 10, 0, 0));
    seedSidecar("alex", {
      current_count: 7,
      longest_count: 7,
      last_activity_date: "2026-05-19",
      started_on: "2026-05-13",
    });

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    expect(sc.current_count).toBe(8);
    expect(sc.longest_count).toBe(8);
    expect(sc.last_activity_date).toBe("2026-05-20");
    expect(sc.started_on).toBe("2026-05-13"); // unchanged
  });
});

// ----- weekend skip -------------------------------------------------

describe("skip weekend (Mon -> Tue with Sat/Sun in between)", () => {
  it("continues, increments by 1", async () => {
    // Wait, the brief says "Mon -> Tue with Sat/Sun in between" but
    // that's actually Fri -> Mon with Sat/Sun in between. The brief
    // wording reads like "last activity Friday, next activity Monday".
    // Use that interpretation: 2026-05-15 = Friday, 2026-05-18 = Monday.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 10, 0, 0)); // Mon 2026-05-18
    seedSidecar("alex", {
      current_count: 4,
      longest_count: 4,
      last_activity_date: "2026-05-15", // Friday
      started_on: "2026-05-12",
    });

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    expect(sc.current_count).toBe(5);
    expect(sc.longest_count).toBe(5);
    expect(sc.last_activity_date).toBe("2026-05-18");
  });
});

// ----- PTO skip -----------------------------------------------------

describe("skip PTO weekday (Mon -> Wed with Tue in pto_dates)", () => {
  it("continues, increments by 1", async () => {
    vi.useFakeTimers();
    // 2026-05-18 Mon, 2026-05-19 Tue (PTO), 2026-05-20 Wed.
    vi.setSystemTime(new Date(2026, 4, 20, 10, 0, 0)); // Wed
    seedSidecar("alex", {
      current_count: 2,
      longest_count: 2,
      last_activity_date: "2026-05-18", // Mon
      started_on: "2026-05-15",
      pto_dates: ["2026-05-19"],
    });

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    expect(sc.current_count).toBe(3);
    expect(sc.last_activity_date).toBe("2026-05-20");
  });
});

// ----- missed non-PTO weekday --------------------------------------

describe("miss a non-PTO weekday", () => {
  it("resets current_count to 1, started_on = today", async () => {
    vi.useFakeTimers();
    // 2026-05-18 Mon (last activity), 2026-05-19 Tue (missed, no PTO),
    // 2026-05-20 Wed (today). The Tue gap breaks the streak.
    vi.setSystemTime(new Date(2026, 4, 20, 10, 0, 0));
    seedSidecar("alex", {
      current_count: 12,
      longest_count: 28,
      last_activity_date: "2026-05-18",
      started_on: "2026-05-07",
      pto_dates: [],
    });

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    expect(sc.current_count).toBe(1);
    // longest_count should be preserved as max of old (28) and new (1).
    expect(sc.longest_count).toBe(28);
    expect(sc.started_on).toBe("2026-05-20");
    expect(sc.last_activity_date).toBe("2026-05-20");
  });
});

// ----- disabled -----------------------------------------------------

describe("disabled user", () => {
  it("does not write, does not emit any event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 10, 0, 0));
    seedSidecar("alex", {
      enabled: false,
      current_count: 6,
      last_activity_date: "2026-05-19",
      started_on: "2026-05-13",
    });

    const events: unknown[] = [];
    const unsub = onStreakMilestoneCrossed((e) => events.push(e));

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    // last_activity_date is UNCHANGED: we should have returned at step 3.
    expect(sc.last_activity_date).toBe("2026-05-19");
    expect(sc.current_count).toBe(6);
    expect(events).toEqual([]);

    unsub();
  });
});

// ----- debounce -----------------------------------------------------

describe("debounce (5s window)", () => {
  it("4 consecutive notifies within 5s -> only one tick fires after the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 10, 0, 0));

    // Spread 4 notifies across 4 seconds. Each restarts the timer.
    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(1_000);
    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(1_000);
    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(1_000);
    notifyStreakActivity("alex");
    // At this point we are 3s after the first notify; debounce has been
    // restarted 3 times, so the timer was last set 0s ago. After 4s
    // more we should be 1s short of the 5s window.
    await vi.advanceTimersByTimeAsync(4_000);
    const beforeFlush = await readStreak("alex");
    expect(beforeFlush.current_count).toBe(0); // nothing fired yet

    // Advance the last 1s -> the timer fires.
    await vi.advanceTimersByTimeAsync(1_000);
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    expect(sc.current_count).toBe(1);
  });
});

// ----- flush immediately -------------------------------------------

describe("flushStreakActivity(username)", () => {
  it("cancels the pending timer and fires immediately", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 10, 0, 0));

    notifyStreakActivity("alex");
    // Don't advance time: flush before the 5s window.
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    expect(sc.current_count).toBe(1);
    expect(sc.last_activity_date).toBe("2026-05-21");
  });
});

// ----- cross-midnight ----------------------------------------------

describe("cross-midnight tick uses flush-time date, not notify-time", () => {
  it("notify at 23:59:55 + 5s debounce + advance through midnight -> tick stamped with NEW day", async () => {
    vi.useFakeTimers();
    // Notify at 23:59:55 on Wed 2026-05-20.
    vi.setSystemTime(new Date(2026, 4, 20, 23, 59, 55));
    seedSidecar("alex", {
      current_count: 4,
      longest_count: 4,
      last_activity_date: "2026-05-19",
      started_on: "2026-05-15",
    });

    notifyStreakActivity("alex");
    // Advance 5 seconds: clock is now 00:00:00 on Thu 2026-05-21.
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    // Tick stamped at the new day. From 2026-05-19 to 2026-05-21,
    // the intermediate day 2026-05-20 (Wed) is a workday with no PTO,
    // so the streak BROKE during the gap: count resets to 1 and
    // started_on becomes today (2026-05-21).
    expect(sc.last_activity_date).toBe("2026-05-21");
    expect(sc.current_count).toBe(1);
    expect(sc.started_on).toBe("2026-05-21");
  });

  it("flush-time date is the new day even when notify happened on previous day", async () => {
    // Same idea but the gap is fully covered by skip days so the
    // streak DOES continue across midnight: prove the date used is
    // flush-time (the new day), not notify-time (the old day).
    vi.useFakeTimers();
    // Saturday 2026-05-23, 23:59:55, about to roll into Sunday.
    vi.setSystemTime(new Date(2026, 4, 23, 23, 59, 55));
    seedSidecar("alex", {
      current_count: 3,
      longest_count: 3,
      // Last activity Friday 2026-05-22. From Fri to Sun:
      //   intermediate day is Sat 2026-05-23 -> weekend -> skip-day.
      // So the streak continues.
      last_activity_date: "2026-05-22",
      started_on: "2026-05-20",
    });

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    const sc = await readStreak("alex");
    // Tick stamp must be 2026-05-24 (Sun, the new day), not 2026-05-23.
    expect(sc.last_activity_date).toBe("2026-05-24");
    expect(sc.current_count).toBe(4);
  });
});

// ----- milestone emission ------------------------------------------

describe("milestone emission", () => {
  it("newly-crossed 3d milestone emits one event with tag=3d, count=3, username", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 10, 0, 0)); // Wed
    seedSidecar("alex", {
      current_count: 2,
      longest_count: 2,
      // Tue 2026-05-19 -> Wed 2026-05-20: consecutive workdays.
      last_activity_date: "2026-05-19",
      started_on: "2026-05-18",
    });

    const events: { username: string; tag: string; count: number }[] = [];
    const unsub = onStreakMilestoneCrossed((e) => events.push(e));

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ username: "alex", tag: "3d", count: 3 });
    unsub();
  });

  it("already-seen milestone does NOT emit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 10, 0, 0));
    seedSidecar("alex", {
      current_count: 2,
      longest_count: 7,
      last_activity_date: "2026-05-19",
      started_on: "2026-05-18",
      celebrations_seen: {
        account_anniversaries: [],
        streak_milestones: ["3d"], // already seen
      },
    });

    const events: unknown[] = [];
    const unsub = onStreakMilestoneCrossed((e) => events.push(e));

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    expect(events).toEqual([]);
    unsub();
  });

  it("crossing 3d AND 7d in the same tick emits both events", async () => {
    // Edge case: a user manually edits their sidecar to current_count=6
    // and then ticks to 7 (or seed data plants them at the boundary).
    // Both 3d (already crossed numerically but not in seen set) and 7d
    // should emit if neither is seen.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 10, 0, 0));
    seedSidecar("alex", {
      current_count: 6,
      longest_count: 6,
      last_activity_date: "2026-05-19",
      started_on: "2026-05-13",
      celebrations_seen: {
        account_anniversaries: [],
        streak_milestones: [], // neither seen
      },
    });

    const events: { tag: string; count: number }[] = [];
    const unsub = onStreakMilestoneCrossed((e) =>
      events.push({ tag: e.tag, count: e.count }),
    );

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    expect(events).toEqual([
      { tag: "3d", count: 3 },
      { tag: "7d", count: 7 },
    ]);
    unsub();
  });
});

// ----- multi-user concurrency ---------------------------------------

describe("multi-user concurrency", () => {
  it("alice + bob in parallel: both debounces fire independently, both events with correct usernames", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 10, 0, 0));
    seedSidecar("alice", {
      current_count: 2,
      longest_count: 2,
      last_activity_date: "2026-05-19",
      started_on: "2026-05-18",
    });
    seedSidecar("bob", {
      current_count: 2,
      longest_count: 2,
      last_activity_date: "2026-05-19",
      started_on: "2026-05-18",
    });

    const events: { username: string; tag: string }[] = [];
    const unsub = onStreakMilestoneCrossed((e) =>
      events.push({ username: e.username, tag: e.tag }),
    );

    // Notify alice at t=0, bob at t=1s. Bob's window resets later.
    notifyStreakActivity("alice");
    await vi.advanceTimersByTimeAsync(1_000);
    notifyStreakActivity("bob");
    // After 4 more seconds: alice is at 5s (fires), bob is at 4s (pending).
    await vi.advanceTimersByTimeAsync(4_000);
    await flushStreakActivity("alice");
    // Advance to fire bob's timer too.
    await vi.advanceTimersByTimeAsync(1_000);
    await flushStreakActivity("bob");

    const alice = await readStreak("alice");
    const bob = await readStreak("bob");
    expect(alice.current_count).toBe(3);
    expect(bob.current_count).toBe(3);

    // Both 3d events, each scoped to the right username.
    expect(events.length).toBe(2);
    const usernames = events.map((e) => e.username).sort();
    expect(usernames).toEqual(["alice", "bob"]);
    expect(events.every((e) => e.tag === "3d")).toBe(true);
    unsub();
  });

  it("flushStreakActivity(no-arg) drains all pending users", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 10, 0, 0));

    notifyStreakActivity("alice");
    notifyStreakActivity("bob");
    notifyStreakActivity("carol");

    // Don't advance time: flush all.
    await flushStreakActivity();

    const alice = await readStreak("alice");
    const bob = await readStreak("bob");
    const carol = await readStreak("carol");
    expect(alice.current_count).toBe(1);
    expect(bob.current_count).toBe(1);
    expect(carol.current_count).toBe(1);
  });
});

// ----- listener lifecycle ------------------------------------------

describe("listener lifecycle", () => {
  it("multiple subscribers each fire once per event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 10, 0, 0));
    seedSidecar("alex", {
      current_count: 2,
      longest_count: 2,
      last_activity_date: "2026-05-19",
      started_on: "2026-05-18",
    });

    let countA = 0;
    let countB = 0;
    const unsubA = onStreakMilestoneCrossed(() => {
      countA += 1;
    });
    const unsubB = onStreakMilestoneCrossed(() => {
      countB += 1;
    });

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    expect(countA).toBe(1);
    expect(countB).toBe(1);
    unsubA();
    unsubB();
  });

  it("unsubscribed listener does not fire", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 10, 0, 0));
    seedSidecar("alex", {
      current_count: 2,
      longest_count: 2,
      last_activity_date: "2026-05-19",
      started_on: "2026-05-18",
    });

    let count = 0;
    const unsub = onStreakMilestoneCrossed(() => {
      count += 1;
    });
    unsub();

    notifyStreakActivity("alex");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity("alex");

    expect(count).toBe(0);
  });
});

// ----- defensive: bad inputs ---------------------------------------

describe("defensive guards", () => {
  it("notifyStreakActivity with empty string is a no-op", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 10, 0, 0));

    notifyStreakActivity("");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity();

    // Nothing written.
    expect(memFs.size).toBe(0);
  });

  it("notifyStreakActivity with _no_user_ sentinel is a no-op", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 10, 0, 0));

    notifyStreakActivity("_no_user_");
    await vi.advanceTimersByTimeAsync(5_000);
    await flushStreakActivity();

    expect(memFs.size).toBe(0);
  });
});
