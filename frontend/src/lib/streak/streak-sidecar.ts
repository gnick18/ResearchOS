import { fileService } from "@/lib/file-system/file-service";
import { getUserMetadata } from "@/lib/file-system/user-metadata";

/**
 * Per-user streak sidecar at `users/<u>/_streak.json`.
 *
 * Phase S0 of the Streak-and-Milestones arc (see
 * STREAK_AND_MILESTONES_PROPOSAL.md §4.1 / §8 / §9). Pure data-layer
 * foundation: read, patch, initialize. NO UI, NO activity hook, NO
 * milestone scheduling — those land in S1+.
 *
 * Schema history:
 *  - v1 (2026-05-21): initial. enabled toggle, current_count,
 *    longest_count, last_activity_date, started_on,
 *    shown_privacy_notice, pto_dates (ISO YYYY-MM-DD, sorted +
 *    deduped), celebrations_seen split into account_anniversaries +
 *    streak_milestones tag lists.
 *
 * Write-queue discipline: every read-modify-write goes through a
 * per-user promise chain so concurrent patches on the same user
 * serialize. Concurrent patches on DIFFERENT users don't block each
 * other (per-username Map). Mirrors the
 * `frontend/src/lib/file-system/user-metadata.ts` fix landed in
 * fd98b0df ("Serialize _user_metadata.json writes to fix W6
 * color-pick race"), scoped to per-user since each streak file is
 * isolated to one user's directory. Tab-scoped only (does not
 * protect against cross-tab or external-process writes).
 */

const SCHEMA_VERSION = 1 as const;

export interface StreakSidecar {
  schema_version: 1;
  enabled: boolean;
  current_count: number;
  longest_count: number;
  last_activity_date: string | null;
  started_on: string | null;
  shown_privacy_notice: boolean;
  pto_dates: string[];
  celebrations_seen: {
    account_anniversaries: string[];
    streak_milestones: string[];
  };
}

export const INITIAL_STREAK: StreakSidecar = {
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
};

/** Account anniversary thresholds in days (locks L10 / §4.1). */
export const ACCOUNT_ANNIVERSARY_THRESHOLDS: ReadonlyArray<{
  tag: string;
  days: number;
}> = [
  { tag: "1w", days: 7 },
  { tag: "1mo", days: 30 },
  { tag: "3mo", days: 90 },
  { tag: "6mo", days: 180 },
  { tag: "1y", days: 365 },
  { tag: "2y", days: 730 },
  { tag: "5y", days: 1825 },
];

/** Streak milestone thresholds in days (lock L11). */
export const STREAK_MILESTONE_THRESHOLDS: ReadonlyArray<{
  tag: string;
  count: number;
}> = [
  { tag: "3d", count: 3 },
  { tag: "7d", count: 7 },
  { tag: "14d", count: 14 },
  { tag: "30d", count: 30 },
  { tag: "100d", count: 100 },
  { tag: "365d", count: 365 },
];

function sidecarPath(username: string): string {
  return `users/${username}/_streak.json`;
}

/** Deep, defensive clone of INITIAL_STREAK. The module-level constant
 *  is exported as a shared reference for callers that only want to
 *  read its shape; mutators get a fresh copy so they cannot scribble
 *  on the canonical default. */
function freshInitial(): StreakSidecar {
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
  };
}

/** Parse + defend a raw sidecar payload. Backfills missing fields and
 *  coerces malformed values to the v1 default so a hand-edited or
 *  partially-written file reads cleanly. Also re-sorts and de-dupes
 *  pto_dates as a self-healing invariant. */
function normalize(raw: Partial<StreakSidecar> | null | undefined): StreakSidecar {
  if (!raw || typeof raw !== "object") return freshInitial();
  const r = raw as Record<string, unknown>;

  const enabled = r.enabled === false ? false : true; // default true
  const current_count =
    typeof r.current_count === "number" && r.current_count >= 0
      ? Math.floor(r.current_count)
      : 0;
  const longest_count =
    typeof r.longest_count === "number" && r.longest_count >= 0
      ? Math.floor(r.longest_count)
      : 0;
  const last_activity_date =
    typeof r.last_activity_date === "string" && r.last_activity_date.length > 0
      ? r.last_activity_date
      : null;
  const started_on =
    typeof r.started_on === "string" && r.started_on.length > 0
      ? r.started_on
      : null;
  const shown_privacy_notice = r.shown_privacy_notice === true;

  const rawPto = r.pto_dates;
  const ptoIn: string[] = Array.isArray(rawPto)
    ? (rawPto.filter((d) => typeof d === "string") as string[])
    : [];
  const pto_dates = sortAndDedupeDates(ptoIn);

  const rawSeen = r.celebrations_seen;
  const seenObj =
    rawSeen && typeof rawSeen === "object"
      ? (rawSeen as Record<string, unknown>)
      : {};
  const accIn = seenObj.account_anniversaries;
  const stkIn = seenObj.streak_milestones;
  const account_anniversaries: string[] = Array.isArray(accIn)
    ? (accIn.filter((t) => typeof t === "string") as string[])
    : [];
  const streak_milestones: string[] = Array.isArray(stkIn)
    ? (stkIn.filter((t) => typeof t === "string") as string[])
    : [];

  return {
    schema_version: 1,
    enabled,
    current_count,
    longest_count,
    last_activity_date,
    started_on,
    shown_privacy_notice,
    pto_dates,
    celebrations_seen: {
      account_anniversaries,
      streak_milestones,
    },
  };
}

/** Sort an ISO-date string array ascending and de-dupe. Pure. */
function sortAndDedupeDates(dates: readonly string[]): string[] {
  const set = new Set<string>();
  for (const d of dates) {
    if (typeof d === "string" && d.length > 0) set.add(d);
  }
  return Array.from(set).sort();
}

// ----- sidecar change-event subscribers ----------------------------
//
// S2 needs to re-render the badge whenever the sidecar is patched
// (S1's debounced tick AND the Settings toggle that lands in S3).
// Rather than have every UI surface poll readStreak on a timer, the
// patcher itself emits a synchronous event after the write resolves.
// Listeners get (username, nextSidecar) so they can re-render without
// a follow-up read. Non-breaking additive export.

type SidecarChangeListener = (
  username: string,
  next: StreakSidecar,
) => void;

const sidecarChangeListeners = new Set<SidecarChangeListener>();

/**
 * Subscribe to sidecar-change events. Fires after every successful
 * `patchStreak` write with the post-normalize shape. Returns an
 * unsubscribe fn. Listener exceptions are caught per-listener so one
 * bad subscriber cannot starve the others.
 */
export function onStreakSidecarChanged(
  cb: SidecarChangeListener,
): () => void {
  sidecarChangeListeners.add(cb);
  return () => {
    sidecarChangeListeners.delete(cb);
  };
}

function emitSidecarChange(username: string, next: StreakSidecar): void {
  for (const cb of sidecarChangeListeners) {
    try {
      cb(username, next);
    } catch (err) {
      console.warn(
        "[streak-sidecar] change listener threw:",
        err,
      );
    }
  }
}

// ----- per-user write queue ----------------------------------------
//
// Per-user promise chain. Concurrent patchStreak calls on the same
// username serialize through the chain; calls on different usernames
// run in parallel because each user has its own chain. Errors don't
// poison the chain — a failed write returns its rejection to the
// caller and the chain continues with the next queued task.

const userWriteQueues = new Map<string, Promise<unknown>>();

function enqueueStreakWrite<T>(
  username: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = userWriteQueues.get(username) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Swallow rejections on the queue tail so one failure doesn't
  // poison subsequent enqueues. The caller still sees the original
  // rejection via `next`.
  userWriteQueues.set(
    username,
    next.catch(() => {}),
  );
  return next;
}

// ----- public API --------------------------------------------------

/**
 * Read the streak sidecar for a user. Returns a fresh-default record
 * (INITIAL_STREAK shape) when the file is missing — callers should
 * NOT have to special-case the first-read case. Does NOT persist the
 * default; lazy creation happens via `initializeStreakForUser` or
 * the first `patchStreak` call.
 */
export async function readStreak(username: string): Promise<StreakSidecar> {
  const raw = await fileService.readJson<Partial<StreakSidecar>>(
    sidecarPath(username),
  );
  return normalize(raw);
}

/**
 * Atomic read-modify-write. The mutator receives the current sidecar
 * (or a fresh default if the file is missing) and returns the next
 * one. Serialized per-username so concurrent callers don't lose
 * updates and don't race the underlying atomic-write .tmp lock.
 *
 * Mutator MUST be pure with respect to the input (return a NEW object
 * or a shallow-cloned object). The queue serializes the entire
 * read + apply + write triple, so the mutator sees a fresh read on
 * each invocation.
 */
export async function patchStreak(
  username: string,
  mutator: (cur: StreakSidecar) => StreakSidecar,
): Promise<StreakSidecar> {
  return enqueueStreakWrite(username, async () => {
    const current = await readStreak(username);
    const next = mutator(current);
    // Defensive: re-normalize before write so a mutator that hands back
    // unsorted pto_dates or a slightly-off shape still persists cleanly.
    const cleaned = normalize(next);
    await fileService.writeJson(sidecarPath(username), cleaned);
    emitSidecarChange(username, cleaned);
    return cleaned;
  });
}

/**
 * Initialize a fresh `_streak.json` for a user. Reads `created_at`
 * from `_user_metadata.json` via `getUserMetadata` and backfills the
 * account-anniversary "seen" set with every threshold the user has
 * ALREADY crossed (per §9 migration rule). This prevents an existing
 * user from being ambushed by a "1 year!" celebration the moment
 * streaks ship — they only see future anniversaries.
 *
 * If the user has no metadata entry yet (no `created_at` recorded),
 * the initialization persists INITIAL_STREAK with an empty seen list.
 * In that path the user will see anniversaries as they cross, but
 * the missing `created_at` means we can't backfill; that is the
 * expected behavior for a brand-new user whose metadata has not yet
 * been written.
 *
 * Serialized through the same per-user write queue as patchStreak so
 * it can't race a concurrent first-write.
 */
export async function initializeStreakForUser(
  username: string,
): Promise<StreakSidecar> {
  return enqueueStreakWrite(username, async () => {
    const meta = await getUserMetadata(username);
    const createdAt =
      meta && typeof meta.created_at === "string" ? meta.created_at : null;
    const today = todayIso();
    const seenAnniversaries = createdAt
      ? computeReachedAnniversaries(createdAt, today)
      : [];
    const sidecar: StreakSidecar = {
      ...freshInitial(),
      celebrations_seen: {
        account_anniversaries: seenAnniversaries,
        streak_milestones: [],
      },
    };
    await fileService.writeJson(sidecarPath(username), sidecar);
    emitSidecarChange(username, sidecar);
    return sidecar;
  });
}

// ----- pure date helpers -------------------------------------------

/** Return today's local-time date as an ISO YYYY-MM-DD string. */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a local-time Date at 00:00. Returns
 *  null on malformed input so callers can treat invalid dates as
 *  non-skip-days rather than throwing. */
function parseIsoDate(iso: string): Date | null {
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

/** True if the given ISO YYYY-MM-DD date is Saturday or Sunday in
 *  LOCAL time. Returns false on malformed input. */
export function isWeekend(date: string): boolean {
  const d = parseIsoDate(date);
  if (!d) return false;
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

/** True if the given ISO date is in the user's pto_dates list.
 *  Exact-string match (both sides should be YYYY-MM-DD). */
export function isPtoDay(
  date: string,
  ptoDates: readonly string[],
): boolean {
  if (typeof date !== "string" || date.length === 0) return false;
  for (const d of ptoDates) {
    if (d === date) return true;
  }
  return false;
}

/** True if the date should be skipped for streak / scheduling
 *  purposes (Sat/Sun OR in the user's PTO list). Used by both the
 *  streak-tick walk (S1) and the project schedule extension (S4). */
export function isSkipDay(
  date: string,
  ptoDates: readonly string[],
): boolean {
  return isWeekend(date) || isPtoDay(date, ptoDates);
}

/** Days between two YYYY-MM-DD strings (b - a). Returns 0 if either
 *  is malformed. Calendar-day difference, not 24-hour-block — uses
 *  local midnight anchors so DST transitions don't shift the count. */
function daysBetween(a: string, b: string): number {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (!da || !db) return 0;
  // Normalize to UTC midnight for the subtraction so DST gaps in
  // local time don't add or drop a day.
  const aUtc = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const bUtc = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((bUtc - aUtc) / 86_400_000);
}

/**
 * Compute the list of account anniversary tags whose threshold has
 * been reached as of `today` (defaults to today's local date). Used
 * by `initializeStreakForUser` to backfill the "seen" set and by S6
 * to evaluate which celebrations are pending.
 *
 * Returns tags in their natural ascending threshold order
 * (1w, 1mo, 3mo, 6mo, 1y, 2y, 5y).
 */
export function computeReachedAnniversaries(
  createdAt: string,
  today?: string,
): string[] {
  if (typeof createdAt !== "string" || createdAt.length === 0) return [];
  // _user_metadata.json `created_at` is an ISO timestamp (toISOString);
  // pull just the date portion.
  const createdDate = createdAt.slice(0, 10);
  if (!parseIsoDate(createdDate)) return [];
  const todayDate = today ?? todayIso();
  if (!parseIsoDate(todayDate)) return [];
  const elapsed = daysBetween(createdDate, todayDate);
  if (elapsed < 0) return [];
  const reached: string[] = [];
  for (const { tag, days } of ACCOUNT_ANNIVERSARY_THRESHOLDS) {
    if (elapsed >= days) reached.push(tag);
  }
  return reached;
}

// ----- test-only escape hatch --------------------------------------
//
// Vitest needs to reset the per-user queue map between tests so a
// queued write from one test doesn't leak into the next. Exposed as
// an internal helper, not part of the public surface.

/** @internal — test-only. Clears the per-user write queues AND the
 *  sidecar-change listener set. Tests should call this in beforeEach so
 *  a leftover subscription from a prior test cannot fire mid-render in
 *  the next one. */
export function __resetStreakWriteQueueForTests(): void {
  userWriteQueues.clear();
  sidecarChangeListeners.clear();
}
