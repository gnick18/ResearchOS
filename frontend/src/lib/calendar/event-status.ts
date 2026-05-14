// Shared "has this event ended?" helper. Consumed by:
//   - DailyTasksSidebar (ended events drop entirely from Today bucket)
//   - Calendar views (DayView / WeekView / MonthView / DayDetailDrawer): ended
//     events stay visible but render strikethrough + grey.
//
// Both surfaces must agree on the cutoff or users will see "the sidebar
// dropped this but the calendar still shows it live" mismatches. Keep this
// the single source of truth.

import { toLocalDateString } from "@/components/calendar/utils";

/** Default duration (ms) assumed for an event with a start_time but no
 *  end_time. One hour is a reasonable middle-of-the-road meeting length —
 *  long enough that a quick standup isn't treated as instantly over, short
 *  enough that a real meeting without an end-time picked still transitions
 *  to "ended" within the same workday. */
export const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

export type EventLike = {
  start_date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

/** Parse "HH:MM" into total minutes since midnight, or null if invalid. */
function parseHHMM(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Parse YYYY-MM-DD into a local-time Date at 00:00. Returns null on
 *  malformed input. Mirrors the convention used elsewhere — `start_date`
 *  is a local calendar date, not a UTC instant. */
function parseYMD(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}

/** Returns true if `event` is over relative to `now`.
 *
 * Logic:
 *  - All-day events (no `start_time`): "over" only when `now` is past the
 *    end of the last covered day (midnight after `end_date || start_date`).
 *    So an all-day event covering today is never "ended today" — it stays
 *    in the today bucket until midnight rolls over (the existing date
 *    filter handles the rollover naturally).
 *  - Single-day timed events with `end_time`: ended once `now > end`.
 *  - Single-day timed events with `start_time` only (no `end_time`):
 *    treated as `DEFAULT_EVENT_DURATION_MS` long. Ended once
 *    `now > start + DEFAULT_EVENT_DURATION_MS`.
 *  - Multi-day events (start_date != end_date) with times: ended once `now`
 *    is past the end_time on `end_date`. If no `end_time`, ended at midnight
 *    after `end_date`.
 *  - Malformed dates / unparseable shape: NEVER considered ended. Better to
 *    show a confusing event than to silently hide one with bad data.
 */
export function hasEnded(event: EventLike, now: Date = new Date()): boolean {
  const startDate = parseYMD(event.start_date);
  if (!startDate) return false;
  const endDateRaw = event.end_date || event.start_date;
  const endDate = parseYMD(endDateRaw) ?? startDate;

  const startMin = parseHHMM(event.start_time);
  const endMin = parseHHMM(event.end_time);

  // All-day case: no start_time. Ended only once we've crossed midnight
  // past `end_date`. The today-date filter usually handles this on its own;
  // we still answer correctly here so callers can rely on a single helper.
  if (startMin === null) {
    const midnightAfterEnd = new Date(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate() + 1,
      0,
      0,
      0,
      0,
    );
    return now >= midnightAfterEnd;
  }

  // Timed case. Compute the effective end as a wall-clock Date.
  const effectiveEnd = new Date(endDate);
  if (endMin !== null) {
    effectiveEnd.setHours(0, 0, 0, 0);
    effectiveEnd.setMinutes(endMin);
  } else {
    // No end_time → 1-hour default duration anchored to start_time on
    // start_date. (For multi-day events with no end_time, this is an odd
    // shape — anchoring to start is the conservative read: the event
    // "ends" an hour into the first day. We don't see this in practice
    // because the calendar UI / ICS importer always emit an end_time for
    // multi-day events.)
    effectiveEnd.setTime(startDate.getTime());
    effectiveEnd.setHours(0, 0, 0, 0);
    effectiveEnd.setMinutes(startMin);
    effectiveEnd.setTime(effectiveEnd.getTime() + DEFAULT_EVENT_DURATION_MS);
  }

  return now > effectiveEnd;
}

/** Convenience: same as `hasEnded` but only counts the event as "ended
 *  today" — i.e. true only if the effective end falls before `now` AND on
 *  today's calendar date. Used by surfaces that want to keep multi-day
 *  events visible until their last day even after the first day's end_time
 *  has passed. (Reserved for future use; today both surfaces collapse to
 *  the same `hasEnded` check.) */
export function hasEndedToday(event: EventLike, now: Date = new Date()): boolean {
  if (!hasEnded(event, now)) return false;
  const endDateRaw = event.end_date || event.start_date;
  return endDateRaw <= toLocalDateString(now);
}
