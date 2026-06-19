// Phase-out-multi-user-folders: pure decision-logic tests.
//
// Covers the two levers' pure helpers. The `enabled` and `now` params are
// injected so both flag branches and the time window are deterministic, no env
// mutation or fake timers needed.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  canCreateAnotherUser,
  isMigrationGateDismissible,
  recordMigrationDismissal,
  ensureMigrationFirstSeen,
  MIGRATION_GRACE_MAX_DISMISSALS,
  MIGRATION_GRACE_WINDOW_MS,
  type MigrationGraceState,
} from "./single-user-folders";

describe("canCreateAnotherUser (lever 1: block second real user)", () => {
  it("flag OFF: always allowed, regardless of count (byte-identical to today)", () => {
    expect(canCreateAnotherUser(0, false)).toBe(true);
    expect(canCreateAnotherUser(1, false)).toBe(true);
    expect(canCreateAnotherUser(5, false)).toBe(true);
  });

  it("flag ON: empty folder (count 0) allows the FIRST user", () => {
    expect(canCreateAnotherUser(0, true)).toBe(true);
  });

  it("flag ON: count >= 1 blocks creating another user", () => {
    expect(canCreateAnotherUser(1, true)).toBe(false);
    expect(canCreateAnotherUser(2, true)).toBe(false);
    expect(canCreateAnotherUser(10, true)).toBe(false);
  });

  it("flag ON: defensive against a negative/garbage count (treated as empty)", () => {
    expect(canCreateAnotherUser(-1, true)).toBe(true);
  });
});

describe("isMigrationGateDismissible (lever 2: grace-then-force)", () => {
  const now = 1_000_000_000_000;

  it("flag OFF: always dismissible (today's unlimited dismiss, byte-identical)", () => {
    expect(isMigrationGateDismissible(null, false, now)).toBe(true);
    expect(
      isMigrationGateDismissible(
        { firstSeen: 0, dismissals: 999 },
        false,
        now,
      ),
    ).toBe(true);
  });

  it("flag ON: a never-seen folder (null state) is dismissible on first view", () => {
    expect(isMigrationGateDismissible(null, true, now)).toBe(true);
  });

  it("flag ON: within both limits -> dismissible", () => {
    const state: MigrationGraceState = {
      firstSeen: now,
      dismissals: MIGRATION_GRACE_MAX_DISMISSALS - 1,
    };
    expect(isMigrationGateDismissible(state, true, now)).toBe(true);
  });

  it("flag ON: dismiss-count cap reached -> blocking", () => {
    const state: MigrationGraceState = {
      firstSeen: now,
      dismissals: MIGRATION_GRACE_MAX_DISMISSALS,
    };
    expect(isMigrationGateDismissible(state, true, now)).toBe(false);
  });

  it("flag ON: days window exceeded -> blocking even with zero dismissals", () => {
    const state: MigrationGraceState = { firstSeen: now, dismissals: 0 };
    const later = now + MIGRATION_GRACE_WINDOW_MS + 1;
    expect(isMigrationGateDismissible(state, true, later)).toBe(false);
  });

  it("flag ON: exactly at the window edge is no longer within (strictly less than)", () => {
    const state: MigrationGraceState = { firstSeen: now, dismissals: 0 };
    const edge = now + MIGRATION_GRACE_WINDOW_MS;
    expect(isMigrationGateDismissible(state, true, edge)).toBe(false);
  });

  it("flag ON: either limit alone exhausts grace (count OR days)", () => {
    // count spent, time fine
    expect(
      isMigrationGateDismissible(
        { firstSeen: now, dismissals: MIGRATION_GRACE_MAX_DISMISSALS },
        true,
        now + 1000,
      ),
    ).toBe(false);
    // time spent, count fine
    expect(
      isMigrationGateDismissible(
        { firstSeen: now, dismissals: 0 },
        true,
        now + MIGRATION_GRACE_WINDOW_MS + 1,
      ),
    ).toBe(false);
  });
});

describe("recordMigrationDismissal", () => {
  const now = 2_000_000_000_000;

  it("starts the clock and counts 1 on the first dismissal", () => {
    expect(recordMigrationDismissal(null, now)).toEqual({
      firstSeen: now,
      dismissals: 1,
    });
  });

  it("preserves firstSeen and increments on subsequent dismissals", () => {
    const first = recordMigrationDismissal(null, now);
    const second = recordMigrationDismissal(first, now + 5000);
    expect(second).toEqual({ firstSeen: now, dismissals: 2 });
  });

  it("drives the gate from dismissible to blocking after the cap", () => {
    let state: MigrationGraceState | null = null;
    for (let i = 0; i < MIGRATION_GRACE_MAX_DISMISSALS; i++) {
      expect(isMigrationGateDismissible(state, true, now)).toBe(true);
      state = recordMigrationDismissal(state, now);
    }
    expect(isMigrationGateDismissible(state, true, now)).toBe(false);
  });
});

describe("ensureMigrationFirstSeen", () => {
  const now = 3_000_000_000_000;

  it("stamps first-seen without counting a dismissal", () => {
    expect(ensureMigrationFirstSeen(null, now)).toEqual({
      firstSeen: now,
      dismissals: 0,
    });
  });

  it("is idempotent (returns prev unchanged once set, never resets the clock)", () => {
    const prev: MigrationGraceState = { firstSeen: now, dismissals: 2 };
    expect(ensureMigrationFirstSeen(prev, now + 10_000)).toBe(prev);
  });

  it("the stamped clock alone can exhaust grace by time (no dismissals)", () => {
    const stamped = ensureMigrationFirstSeen(null, now);
    expect(
      isMigrationGateDismissible(stamped, true, now + MIGRATION_GRACE_WINDOW_MS + 1),
    ).toBe(false);
  });
});
