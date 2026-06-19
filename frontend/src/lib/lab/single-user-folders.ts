// Pure decision logic for the phase-out-multi-user-folders rollout.
//
// All policy here is pure and synchronous so it is unit-testable without React or
// the file system (mirroring how useIsMultiUserFolder and migrate-to-solo keep the
// pure logic out of the components). The React surfaces (UserLoginScreen,
// MigrationGate) read the flag and feed these helpers the counts / persisted
// grace state they already have.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { SINGLE_USER_FOLDERS_ENABLED } from "./single-user-folders-config";

// ---------------------------------------------------------------------------
// Lever 1: block creating a SECOND real user (close the create path).
// ---------------------------------------------------------------------------

/**
 * Whether the "create another user" action is allowed for a folder that already
 * holds `realLocalUserCount` genuine local users (count via discoverRealLocalUsers,
 * which excludes sentinels, tombstoned users, AND materialized co-members, so a
 * lab MEMBER folder reads as 1).
 *
 * Flag OFF -> always allowed (caller keeps today's behavior byte-identical).
 * Flag ON  -> allowed ONLY when the folder is empty (count 0, the first user has
 *             to be made somewhere). count >= 1 blocks, because the product is
 *             one folder per person.
 *
 * `enabled` is injected (defaults to the env flag) so tests can exercise both
 * branches deterministically.
 */
export function canCreateAnotherUser(
  realLocalUserCount: number,
  enabled: boolean = SINGLE_USER_FOLDERS_ENABLED,
): boolean {
  if (!enabled) return true;
  return realLocalUserCount <= 0;
}

// ---------------------------------------------------------------------------
// Lever 2: grace-then-force migration for EXISTING multi-user folders.
// ---------------------------------------------------------------------------

// Grace policy (Grant 2026-06-19, documented in the proposal): a genuinely
// multi-user folder may dismiss the migrate gate up to this many times. Whichever
// of the dismiss-count cap OR the days-since-first-seen window is hit first ends
// the grace and the gate becomes blocking (Convert / Take-my-data-out, plus the
// always-present disconnect escape). Stored per-folder in localStorage only (no
// on-disk data, so NO data-shape change).
export const MIGRATION_GRACE_MAX_DISMISSALS = 3;
export const MIGRATION_GRACE_WINDOW_DAYS = 7;
export const MIGRATION_GRACE_WINDOW_MS =
  MIGRATION_GRACE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Per-folder grace bookkeeping persisted in localStorage. `firstSeen` is the
 * epoch-ms the gate first appeared for this folder; `dismissals` counts how many
 * times the user clicked "Keep it shared for now".
 */
export interface MigrationGraceState {
  firstSeen: number;
  dismissals: number;
}

/**
 * Whether the migrate gate is still dismissible (within grace) for a multi-user
 * folder, given its persisted grace state and the current time.
 *
 * Flag OFF -> always dismissible (today's unlimited-dismiss behavior, byte-identical).
 * Flag ON  -> dismissible only while BOTH limits hold: fewer than the dismiss cap
 *             AND within the days window from first-seen. Exhausting EITHER makes
 *             the gate blocking (returns false). A null state (never seen) is
 *             treated as fresh, so the very first view is dismissible.
 *
 * `enabled` and `now` are injected (default to the env flag / wall clock) so tests
 * can drive both branches and time deterministically.
 */
export function isMigrationGateDismissible(
  state: MigrationGraceState | null,
  enabled: boolean = SINGLE_USER_FOLDERS_ENABLED,
  now: number = Date.now(),
): boolean {
  if (!enabled) return true;
  if (!state) return true; // first appearance, grace clock has not started yet
  const withinCount = state.dismissals < MIGRATION_GRACE_MAX_DISMISSALS;
  const withinWindow = now - state.firstSeen < MIGRATION_GRACE_WINDOW_MS;
  return withinCount && withinWindow;
}

/**
 * Advance the grace state after a dismissal. Starts the first-seen clock on the
 * first call (when `prev` is null) and increments the dismiss count. Pure, the
 * caller persists the returned value.
 */
export function recordMigrationDismissal(
  prev: MigrationGraceState | null,
  now: number = Date.now(),
): MigrationGraceState {
  if (!prev) return { firstSeen: now, dismissals: 1 };
  return { firstSeen: prev.firstSeen, dismissals: prev.dismissals + 1 };
}

/**
 * Stamp first-seen the moment the gate appears, WITHOUT counting a dismissal, so
 * the days window starts ticking even for a user who never clicks "Keep it shared
 * for now". Idempotent, returns `prev` unchanged once first-seen is set.
 */
export function ensureMigrationFirstSeen(
  prev: MigrationGraceState | null,
  now: number = Date.now(),
): MigrationGraceState {
  if (prev) return prev;
  return { firstSeen: now, dismissals: 0 };
}
