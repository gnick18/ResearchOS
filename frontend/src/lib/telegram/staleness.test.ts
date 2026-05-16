// frontend/src/lib/telegram/staleness.test.ts
//
// Unit tests for the pure stale-polling detection helper. Story: Grant
// hit a stale Telegram long-poll today — sidecar paired, badge green,
// but new bot messages never arrived. Recovery is "send any message to
// refresh the cursor," and these tests pin the three-condition AND that
// fires the recovery banner. Each test isolates one branch so a future
// edit can't silently relax the conjunction.

import { describe, expect, it } from "vitest";

import {
  STALE_EMPTY_POLLS,
  STALE_TIME_MS,
  isStaleState,
} from "./staleness";

const MOUNT = 1_000_000_000_000;

describe("isStaleState", () => {
  it("fresh polling (no empties, no updates yet) is not stale", () => {
    // Hook just mounted, first poll hasn't returned. None of the three
    // gates fire — sidecar exists but empty-poll count is 0 and the
    // mounted-at reference is `now`, so 0ms have elapsed.
    expect(
      isStaleState({
        consecutiveEmptyPolls: 0,
        lastUpdateAt: null,
        mountedAt: MOUNT,
        sidecarExists: true,
        now: MOUNT,
      }),
    ).toBe(false);
  });

  it("below empty-poll threshold is not stale even with stale time", () => {
    // 2 < N=3. Time gate alone could match (8 min elapsed), but the
    // empty-poll counter has not crossed. Guards against false-positives
    // when the user has only briefly idled.
    expect(
      isStaleState({
        consecutiveEmptyPolls: STALE_EMPTY_POLLS - 1,
        lastUpdateAt: null,
        mountedAt: MOUNT,
        sidecarExists: true,
        now: MOUNT + 8 * 60_000,
      }),
    ).toBe(false);
  });

  it("below time threshold is not stale even with empty-poll run", () => {
    // 5 empties is well past N, but only 4 min have elapsed since the
    // last update (M=7). User just hasn't sent anything yet.
    expect(
      isStaleState({
        consecutiveEmptyPolls: 5,
        lastUpdateAt: MOUNT,
        mountedAt: MOUNT,
        sidecarExists: true,
        now: MOUNT + 4 * 60_000,
      }),
    ).toBe(false);
  });

  it("all three conditions met returns stale", () => {
    // The bug Grant hit: N empties in a row, M minutes since the last
    // update, sidecar paired. This is the case the banner exists for.
    expect(
      isStaleState({
        consecutiveEmptyPolls: STALE_EMPTY_POLLS,
        lastUpdateAt: MOUNT,
        mountedAt: MOUNT,
        sidecarExists: true,
        now: MOUNT + STALE_TIME_MS + 60_000,
      }),
    ).toBe(true);
  });

  it("missing sidecar is never stale (unpaired is Chip 3's territory)", () => {
    // The future IDB-recovery banner owns the missing-sidecar case.
    // This banner explicitly only fires for paired-but-stalled, so a
    // missing sidecar must short-circuit the check.
    expect(
      isStaleState({
        consecutiveEmptyPolls: STALE_EMPTY_POLLS,
        lastUpdateAt: MOUNT,
        mountedAt: MOUNT,
        sidecarExists: false,
        now: MOUNT + STALE_TIME_MS + 60_000,
      }),
    ).toBe(false);
  });

  it("reset state (counters cleared on update) is not stale", () => {
    // After a stale period the polling hook receives an update, which
    // resets `consecutiveEmptyPolls` to 0 and bumps `lastUpdateAt` to
    // now. The pure helper sees a fresh-looking input and returns
    // false — confirming the consumer's reset logic is sufficient.
    const updateAt = MOUNT + STALE_TIME_MS + 60_000;
    expect(
      isStaleState({
        consecutiveEmptyPolls: 0,
        lastUpdateAt: updateAt,
        mountedAt: MOUNT,
        sidecarExists: true,
        now: updateAt + 1000,
      }),
    ).toBe(false);
  });
});
