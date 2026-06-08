// Lab-tier Phase 7a: pure migration planner (multiuser -> one-folder-one-user).
//
// DESIGN PRINCIPLE: this module is a pure planner. It ONLY computes a
// MigrationPlan value; it makes NO file-system calls, NO calls to
// discoverUsers(), NO trashing, and NO bundle extraction. It is fully
// unit-testable against a fake countRecords implementation.
//
// DECOUPLING PATTERN: mirrors lab-work-enumerate.ts / lab-work-source-localapi.ts:
// the planner accepts an injected `countRecords` reader so callers choose what
// backs it. The real executor (a later chunk, gated on Grant's go + real-folder
// test) will wire countRecords to the live JsonStore layer and will then perform
// the extract-to-bundle + trash-not-delete steps. This module never needs to
// change when that wiring happens.
//
// WHAT THE EXECUTOR CHUNK MUST DO (seam description):
//   1. Wire countRecords: for each non-primary username, call
//      JsonStore<T>.listAllForUser(username) for each record type, return a
//      Record<string, number> of { task, experiment, note, method, purchase,
//      ... } counts. Pass this as the countRecords callback.
//   2. For each user in plan.usersToMove:
//      a. Extract their users/<username>/ directory to a portable single-user
//         bundle (reuse lib/export/extract.ts or equivalent).
//      b. Trash the original users/<username>/ directory via trashFile()
//         from lib/migrations/trash.ts (trash-not-delete, recoverable).
//   3. After all moves complete, the folder has one user and
//      isLabModeFolder() automatically returns false (solo mode).
//
// No emojis, no em-dashes, no mid-sentence colons.

// ---------------------------------------------------------------------------
// PerUserSummary: record counts for a single non-primary user.
// ---------------------------------------------------------------------------

/**
 * A summary of one non-primary user's records, shown in the migration preview.
 *
 * `recordCounts` is a per-type count map (e.g. { task: 3, note: 5 }).
 * `total` is the sum of all per-type counts (convenience field for the UI).
 */
export interface PerUserSummary {
  username: string;
  recordCounts: Record<string, number>;
  total: number;
}

// ---------------------------------------------------------------------------
// MigrationPlan: the complete preview the UI shows before the user confirms.
// ---------------------------------------------------------------------------

/**
 * The output of planMigrationToSolo. The UI renders this as a preview and
 * waits for an explicit confirm before invoking the executor.
 *
 * `primaryUser` is unchanged and stays in the folder.
 * `usersToMove` are sorted by username ascending for a stable preview.
 * `alreadySolo` is true when there is 0 or 1 user (nothing to migrate).
 */
export interface MigrationPlan {
  primaryUser: string;
  usersToMove: PerUserSummary[];
  alreadySolo: boolean;
}

// ---------------------------------------------------------------------------
// MigrationPlanInput: the injected inputs the planner needs.
// ---------------------------------------------------------------------------

/**
 * Inputs to planMigrationToSolo. Decoupled from the live data layer via the
 * injected `countRecords` callback.
 *
 * `allUsers`: the full list of usernames discovered in users/<owner>/ (the
 *   caller supplies this; in production it comes from discoverUsers()).
 *
 * `primaryUser`: the connecting user who keeps the folder. Must be in
 *   allUsers (a folder must contain its primary user).
 *
 * `countRecords`: injected reader returning a per-type count map for one
 *   username. The executor chunk wires this to the live JsonStore reads.
 *   Tests pass a fake. Called once per non-primary user and NOT called for
 *   the primary user (their data stays untouched; counting it would be noise).
 */
export interface MigrationPlanInput {
  allUsers: string[];
  primaryUser: string;
  countRecords: (username: string) => Promise<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// planMigrationToSolo: the pure planner entry point.
// ---------------------------------------------------------------------------

/**
 * Computes a MigrationPlan for reducing a multiuser folder to a single user.
 *
 * Behaviour:
 *   - If allUsers is empty or contains only the primary user, returns
 *     { primaryUser, usersToMove: [], alreadySolo: true }.
 *   - Otherwise, calls countRecords once for each user that is NOT the
 *     primary (never calls it for the primary user).
 *   - Builds a PerUserSummary per non-primary user with the returned
 *     recordCounts and a total = sum of all count values.
 *   - usersToMove is sorted ascending by username for a stable preview.
 *   - Throws a descriptive error if primaryUser is not in allUsers (the
 *     folder must contain the connecting user).
 *
 * PURE: no file I/O, no discoverUsers() call, no trashing, no bundle writes.
 * The executor (later chunk) performs the actual extract-to-bundle and
 * trash-not-delete steps after the user confirms the returned plan.
 */
export async function planMigrationToSolo(
  input: MigrationPlanInput,
): Promise<MigrationPlan> {
  const { allUsers, primaryUser, countRecords } = input;

  // Guard: a folder must contain its primary user.
  if (allUsers.length > 0 && !allUsers.includes(primaryUser)) {
    throw new Error(
      `planMigrationToSolo: primaryUser "${primaryUser}" is not present in allUsers (${allUsers.join(", ")}). ` +
        `A folder must contain its primary user.`,
    );
  }

  // Identify non-primary users.
  const othersUnsorted = allUsers.filter((u) => u !== primaryUser);

  // Nothing to migrate when 0 or 1 total users.
  if (othersUnsorted.length === 0) {
    return { primaryUser, usersToMove: [], alreadySolo: true };
  }

  // Sort non-primary users for a stable, deterministic preview.
  const others = othersUnsorted.slice().sort();

  // Call countRecords once per non-primary user (in parallel for speed).
  const summaries: PerUserSummary[] = await Promise.all(
    others.map(async (username) => {
      const recordCounts = await countRecords(username);
      const total = Object.values(recordCounts).reduce(
        (sum, n) => sum + n,
        0,
      );
      return { username, recordCounts, total };
    }),
  );

  return {
    primaryUser,
    usersToMove: summaries,
    alreadySolo: false,
  };
}
