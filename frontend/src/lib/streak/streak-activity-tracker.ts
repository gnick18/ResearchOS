// frontend/src/lib/streak/streak-activity-tracker.ts
//
// Phase S1 of the Streak-and-Milestones arc (see
// STREAK_AND_MILESTONES_PROPOSAL.md §4.2). Activity-tracking layer:
// the debounce + tick engine that turns "user wrote a file" into
// "streak count incremented and milestone events emitted".
//
// Builds on S0 (streak-sidecar.ts) and is wired into the canonical
// write path in file-service.ts. No UI here. S2 owns the badge, S3
// owns Settings, S6 owns the celebration surface.
//
// Design notes:
//  - Debounce is per-username (Map keyed by username), so two users
//    typing in two tabs do not cross-contaminate. Each user has its
//    own pending timer.
//  - The debounce flush computes "today" at FLUSH time, not at notify
//    time. A write at 23:59:55 with the 5s window flushes at 00:00:00
//    the next day, so the date is the new day (covers cross-midnight
//    safely).
//  - The persistent write goes through S0's `patchStreak`, which has
//    its own per-user serial queue. We do not have to layer another
//    queue here.
//  - Milestone events fire AFTER `patchStreak` resolves. S6 owns the
//    subscriber that flips `celebrations_seen.streak_milestones`, so
//    the tracker itself only checks the seen set as a read-side
//    guard. This keeps S1 free of any "did we already celebrate?"
//    write logic.

import {
  STREAK_MILESTONE_THRESHOLDS,
  isSkipDay,
  patchStreak,
  readStreak,
  type StreakSidecar,
} from "./streak-sidecar";

// ----- module-private state ----------------------------------------

const DEBOUNCE_MS = 5_000;

// Per-username pending debounce timers. The value is the
// setTimeout id (a number in browser, NodeJS.Timeout in node, so we
// type via `ReturnType<typeof setTimeout>` to cover both).
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Tracks which usernames have a tick currently in-flight (between
// debounce-fire and patchStreak-resolved). Used by flushStreakActivity
// to await the in-flight tick rather than returning early. Stores the
// promise so callers can await.
const inflightTicks = new Map<string, Promise<void>>();

type MilestoneListener = (event: {
  username: string;
  tag: string;
  count: number;
}) => void;

const milestoneListeners = new Set<MilestoneListener>();

// ----- public API --------------------------------------------------

/**
 * Notify the streak system that the active user just wrote to their
 * data folder. Debounced: actual streak tick fires DEBOUNCE_MS after
 * the LAST notify call (typical of write flurries). Idempotent: calling
 * twice in the same calendar day is a no-op after the first tick.
 *
 * Fire-and-forget. The caller (file-service.ts atomicWrite) does NOT
 * await this. Errors inside the deferred tick are swallowed at the
 * top boundary so a streak-write failure can never propagate up into
 * the user-data write path.
 */
export function notifyStreakActivity(username: string): void {
  if (typeof username !== "string" || username.length === 0) return;
  if (username === "_no_user_") return;

  // Restart the debounce window. setTimeout in node returns an object,
  // in browser a number; clearTimeout accepts both.
  const existing = pendingTimers.get(username);
  if (existing !== undefined) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(username);
    // Kick the tick. Capture the promise so flushStreakActivity can
    // await an in-flight tick. Swallow rejections at this boundary so
    // a streak-write failure never propagates to the host.
    const p = runStreakTick(username).catch((err) => {
      console.warn(
        "[streak-activity-tracker] tick failed for user",
        username,
        err,
      );
    });
    inflightTicks.set(username, p);
    p.finally(() => {
      // Only clear if the in-flight slot still belongs to this run.
      if (inflightTicks.get(username) === p) {
        inflightTicks.delete(username);
      }
    });
  }, DEBOUNCE_MS);

  pendingTimers.set(username, timer);
}

/**
 * Force-flush any pending debounced tick. With a username argument,
 * flushes that user only. With no argument, flushes ALL pending users
 * (used by the page-unload handler). Also awaits any tick already in
 * flight so callers can be sure the streak state is up to date when
 * the promise resolves.
 */
export async function flushStreakActivity(username?: string): Promise<void> {
  const targets: string[] =
    typeof username === "string"
      ? [username]
      : Array.from(
          new Set<string>([
            ...pendingTimers.keys(),
            ...inflightTicks.keys(),
          ]),
        );

  const ps: Promise<void>[] = [];

  for (const u of targets) {
    const t = pendingTimers.get(u);
    if (t !== undefined) {
      clearTimeout(t);
      pendingTimers.delete(u);
      // Start the tick immediately. Reuse the same swallowing wrapper
      // as the deferred path so a failure here also can't escape.
      const p = runStreakTick(u).catch((err) => {
        console.warn(
          "[streak-activity-tracker] flushed tick failed for user",
          u,
          err,
        );
      });
      inflightTicks.set(u, p);
      ps.push(
        p.finally(() => {
          if (inflightTicks.get(u) === p) inflightTicks.delete(u);
        }),
      );
    } else {
      const inflight = inflightTicks.get(u);
      if (inflight) ps.push(inflight);
    }
  }

  if (ps.length === 0) return;
  await Promise.all(ps);
}

/**
 * Subscribe to milestone-crossed events. Returns an unsubscribe fn.
 * S6 wires this to the CelebrationManager. Multiple subscribers are
 * supported (e.g. dev-mode logging + the live celebration surface),
 * each fires once per milestone-crossed event.
 */
export function onStreakMilestoneCrossed(cb: MilestoneListener): () => void {
  milestoneListeners.add(cb);
  return () => {
    milestoneListeners.delete(cb);
  };
}

/** @internal: test-only. Resets the debounce timers and the listener
 *  set. The S0 module exposes its own `__resetStreakWriteQueueForTests`
 *  for the sidecar write queue; tests should call both. */
export function __resetStreakActivityTrackerForTests(): void {
  for (const t of pendingTimers.values()) clearTimeout(t);
  pendingTimers.clear();
  inflightTicks.clear();
  milestoneListeners.clear();
}

// ----- the 10-step tick (per §4.2) ---------------------------------

/**
 * The streak tick. Reads the sidecar, decides whether today counts as
 * a continuation (or a break), persists, then emits any newly-crossed
 * milestone events. Pure with respect to the rest of the system: all
 * side effects go through S0's `patchStreak`, no shared state outside
 * the listener set is touched here.
 */
async function runStreakTick(username: string): Promise<void> {
  // Step 1 + 2: read current sidecar.
  const current = await readStreak(username);

  // Step 3: respect the user's opt-out.
  if (current.enabled === false) return;

  // Step 4: today's date at FLUSH time (so a 23:59:55 notify with a 5s
  // debounce evaluates as the next calendar day, per the brief).
  const today = todayIso();

  // Step 5: idempotent within the same calendar day.
  if (current.last_activity_date === today) return;

  // Step 6: decide continuation vs break, and assemble the next
  // sidecar in a pure mutator that we then hand to patchStreak.
  // Step 7 + 8 are inlined in the mutator since they depend on the
  // continuation decision.
  let nextCountAfterTick = 0;

  const next: StreakSidecar = (() => {
    if (current.last_activity_date === null) {
      // First-ever activity.
      nextCountAfterTick = 1;
      return {
        ...current,
        current_count: 1,
        longest_count: Math.max(1, current.longest_count),
        last_activity_date: today,
        started_on: today,
      };
    }

    // Walk backward from yesterday to (and excluding) last_activity_date.
    // If every intermediate day is a skip-day, the streak continues.
    // If any intermediate day is a workday the user missed, it broke.
    const continued = everyIntermediateDayIsSkipped(
      current.last_activity_date,
      today,
      current.pto_dates,
    );

    if (continued) {
      const newCount = current.current_count + 1;
      nextCountAfterTick = newCount;
      return {
        ...current,
        current_count: newCount,
        longest_count: Math.max(newCount, current.longest_count),
        last_activity_date: today,
      };
    }

    // Streak broke. Reset to a fresh streak starting today.
    nextCountAfterTick = 1;
    return {
      ...current,
      current_count: 1,
      longest_count: Math.max(1, current.longest_count),
      last_activity_date: today,
      started_on: today,
    };
  })();

  // Step 9: persist through the S0 per-user queue. patchStreak will
  // re-read the file and apply our mutator, so we wrap `next` as a
  // pure thunk returning the already-computed shape. (Acceptable here
  // because we just read the file two lines ago and any concurrent
  // writer would have to be on another tab, which is out of scope per
  // the privacy contract. The queue still serializes vs S6's later write
  // to celebrations_seen, which IS critical.
  const persisted = await patchStreak(username, () => next);

  // Step 10: emit milestone-crossed events for any threshold newly
  // reached. We use `persisted` (the post-normalize shape returned by
  // patchStreak) as the source of truth for the seen set, since
  // patchStreak re-normalizes on write.
  const seen = new Set(persisted.celebrations_seen.streak_milestones);
  for (const { tag, count } of STREAK_MILESTONE_THRESHOLDS) {
    if (nextCountAfterTick >= count && !seen.has(tag)) {
      emitMilestone({ username, tag, count });
    }
  }
}

/** Emit a milestone-crossed event to every subscriber. Listener
 *  exceptions are caught individually so one bad listener can't
 *  starve the others (defensive for the dev-mode logging case). */
function emitMilestone(event: {
  username: string;
  tag: string;
  count: number;
}): void {
  for (const cb of milestoneListeners) {
    try {
      cb(event);
    } catch (err) {
      console.warn(
        "[streak-activity-tracker] milestone listener threw:",
        err,
      );
    }
  }
}

// ----- pure date helpers (S1-local, NOT exported) ------------------

/** Today's local-time date as ISO YYYY-MM-DD. Mirrors the S0 helper;
 *  inlined here so we don't have to widen the S0 export surface. */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD into a local Date at 00:00, or null on bad input. */
function parseIso(iso: string): Date | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return null;
  }
  const date = new Date(y, mo - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

/** ISO date one day after `iso`. Returns null on malformed input. */
function addDay(iso: string): string | null {
  const d = parseIso(iso);
  if (!d) return null;
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/**
 * True if every calendar day strictly between `lastActivity` and
 * `today` (exclusive of both) is a skip-day (weekend or PTO). Used to
 * decide streak continuation: a stretch of pure skip-days between
 * the last tick and today means the streak survived; any single
 * workday in that gap that the user missed broke it.
 *
 * `lastActivity` === `today` is caller-prevented by the step-5 guard,
 * but we treat it as "no gap" => continues for robustness.
 * `lastActivity` === yesterday is "no gap at all" => continues.
 * Bad input on either side: treats as broken (defensive: better to
 * reset than to silently extend across an unparseable date).
 */
function everyIntermediateDayIsSkipped(
  lastActivity: string,
  today: string,
  ptoDates: readonly string[],
): boolean {
  const last = parseIso(lastActivity);
  const cur = parseIso(today);
  if (!last || !cur) return false;
  // Walk from day-after-lastActivity up to (but not including) today.
  let cursor = addDay(lastActivity);
  let safety = 0;
  while (cursor && cursor !== today && safety < 10_000) {
    if (!isSkipDay(cursor, ptoDates)) return false;
    cursor = addDay(cursor);
    safety += 1;
  }
  // If the loop hit the safety cap something is very wrong with the
  // dates (more than ~27 years of gap); treat as broken.
  if (safety >= 10_000) return false;
  return true;
}
