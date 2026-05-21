// frontend/src/lib/streak/calendar-pto-sync.ts
//
// Phase S5 of the Streak-and-Milestones arc (see
// STREAK_AND_MILESTONES_PROPOSAL.md §6.5). One-way sync from Calendar
// events flagged `is_pto: true` to the user's `pto_dates` list in
// `_streak.json`.
//
// One-way only. PTO list is the source of truth; events write to it,
// the list does NOT push back to create calendar events. Avoids
// feedback loops between the two surfaces.
//
// Semantics:
//   - Checking the box on an event ADDS every date in the event's
//     inclusive [start_date, end_date] range to pto_dates.
//   - Unchecking REMOVES every date in the event's previous range
//     from pto_dates.
//   - Editing an event whose PTO flag stayed on but whose dates moved
//     removes the previous range and adds the new one (atomic in a
//     single patchStreak call).
//
// All mutations route through S0's `patchStreak` so the per-user write
// queue serializes us with the streak tick, settings toggles, and
// other PTO entry points (Gantt right-click, Settings → PTO editor).

import { patchStreak } from "./streak-sidecar";

// ----- pure date helpers ------------------------------------------

/** Parse a YYYY-MM-DD string into a local-time Date at 00:00. Returns
 *  null on malformed input. Mirrors the helper inside streak-sidecar
 *  but kept local so S5 doesn't widen S0's export surface. */
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

/** Format a local-time Date as YYYY-MM-DD. */
function formatIso(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/**
 * Expand an inclusive [start, end] date range into a list of
 * YYYY-MM-DD strings. Returns [start] for single-day ranges. Caps the
 * expansion at 366 days as a defensive bound; a calendar event that
 * spans more than a year is almost certainly user error or a parser
 * artifact, and a runaway expansion would balloon pto_dates.
 *
 * `end` defaults to `start` for single-day events. If `end` is before
 * `start` (malformed range) returns just [start].
 *
 * Exported for unit testing and for reuse by the page's update path
 * when the user edits an existing PTO event's date range.
 */
export function expandDateRange(
  start: string,
  end: string | null | undefined,
): string[] {
  const startDate = parseIso(start);
  if (!startDate) return [];
  const endIso = end && typeof end === "string" && end.length > 0 ? end : start;
  const endDate = parseIso(endIso);
  if (!endDate || endDate < startDate) return [formatIso(startDate)];

  const out: string[] = [];
  const cursor = new Date(startDate);
  let safety = 0;
  // Inclusive walk start..end. Safety cap at 366 days so a malformed
  // multi-year range can't blow up the user's pto_dates.
  while (cursor <= endDate && safety < 367) {
    out.push(formatIso(cursor));
    cursor.setDate(cursor.getDate() + 1);
    safety += 1;
  }
  return out;
}

/** Add a list of ISO dates to an existing set, returning a new sorted +
 *  deduped array. Defensive against bad inputs (non-strings, empty
 *  strings): those are silently dropped, matching the
 *  streak-sidecar normalize() behavior. */
export function addDatesToPto(
  existing: readonly string[],
  toAdd: readonly string[],
): string[] {
  const set = new Set<string>();
  for (const d of existing) {
    if (typeof d === "string" && d.length > 0) set.add(d);
  }
  for (const d of toAdd) {
    if (typeof d === "string" && d.length > 0) set.add(d);
  }
  return Array.from(set).sort();
}

/** Remove a list of ISO dates from an existing set, returning a new
 *  sorted array. Dates not present in `existing` are simply ignored. */
export function removeDatesFromPto(
  existing: readonly string[],
  toRemove: readonly string[],
): string[] {
  const removeSet = new Set<string>(
    toRemove.filter((d) => typeof d === "string" && d.length > 0),
  );
  return existing
    .filter((d) => typeof d === "string" && d.length > 0 && !removeSet.has(d))
    .slice()
    .sort();
}

// ----- public API --------------------------------------------------

/**
 * Reconcile a calendar event's PTO state with the user's `pto_dates`
 * list. Called from the event create / update / delete handlers in
 * the Calendar page. One round trip through `patchStreak` covers
 * both the add-side and the remove-side so the queue serializes a
 * single read-modify-write per change.
 *
 * Parameters:
 *   - `username`: active user; pulled from `useCurrentUser`.
 *   - `prev`: { isPto, dates } the event had BEFORE this edit.
 *     For a new event (create), pass `null`.
 *   - `next`: { isPto, dates } the event has AFTER this edit. For a
 *     deletion, pass `null`.
 *
 * Behavior matrix:
 *   - prev=null, next.isPto=true  -> add next.dates
 *   - prev=null, next.isPto=false -> no-op
 *   - prev.isPto=false, next.isPto=true -> add next.dates
 *   - prev.isPto=true, next.isPto=false -> remove prev.dates
 *   - prev.isPto=true, next.isPto=true and dates changed -> remove prev.dates, add next.dates
 *   - prev.isPto=false, next.isPto=false -> no-op (no patchStreak call)
 *   - next=null (delete) -> if prev.isPto, remove prev.dates
 *
 * Returns void. Failures are swallowed at the boundary so a streak
 * write error never blocks the calendar event save (matches the S1
 * fire-and-forget discipline at file-service.ts).
 */
export async function syncEventPtoChange(
  username: string,
  prev: { isPto: boolean; dates: readonly string[] } | null,
  next: { isPto: boolean; dates: readonly string[] } | null,
): Promise<void> {
  if (typeof username !== "string" || username.length === 0) return;
  if (username === "_no_user_") return;

  const prevPto = prev?.isPto === true;
  const nextPto = next?.isPto === true;

  // Fast path: neither side flagged. No work to do.
  if (!prevPto && !nextPto) return;

  const removeList = prevPto ? Array.from(prev?.dates ?? []) : [];
  const addList = nextPto ? Array.from(next?.dates ?? []) : [];

  // If nothing actually changes (same flag, same dates), skip the
  // write. Caller typically guards this too but defending here keeps
  // the helper safe to call unconditionally.
  if (
    prevPto &&
    nextPto &&
    sameStringSet(prev?.dates ?? [], next?.dates ?? [])
  ) {
    return;
  }

  try {
    await patchStreak(username, (cur) => {
      let pto = cur.pto_dates;
      if (removeList.length > 0) pto = removeDatesFromPto(pto, removeList);
      if (addList.length > 0) pto = addDatesToPto(pto, addList);
      return { ...cur, pto_dates: pto };
    });
  } catch (err) {
    // Same swallow-at-boundary discipline as S1's notifyStreakActivity:
    // a streak-side write failure must never block the calendar save.
    console.warn(
      "[calendar-pto-sync] patchStreak failed for user",
      username,
      err,
    );
  }
}

function sameStringSet(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const x of b) {
    if (!setA.has(x)) return false;
  }
  return true;
}
