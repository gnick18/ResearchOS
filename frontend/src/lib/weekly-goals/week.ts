/**
 * Weekly goals widget (PI beta feedback, weekly-goals widget, 2026-05-29).
 *
 * Pure week-anchoring helpers shared by `weeklyGoalsApi`, the capture UI,
 * and the tests. A weekly goal is anchored to the MONDAY of its week, so a
 * goal added on any weekday groups under the same `week_of`.
 *
 * No I/O, no global state — pure functions only, mirroring the
 * `lib/sharing/unified.ts` "pure helpers" convention.
 */

/**
 * Return the YYYY-MM-DD of the Monday on or before the given date.
 *
 * Uses LOCAL date parts (not UTC) so a Sunday-evening local time doesn't
 * roll into the next week. The default `now` is the current time; pass a
 * fixed date in tests for determinism.
 */
export function mondayOf(now: Date = new Date()): string {
  // Work on a copy at local midnight so the day-of-week math is stable
  // regardless of the time component.
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  // Days to subtract to reach Monday: Sunday (0) -> 6, Monday (1) -> 0, etc.
  const deltaToMonday = (day + 6) % 7;
  d.setDate(d.getDate() - deltaToMonday);
  return formatYmdLocal(d);
}

/** Format a Date to YYYY-MM-DD using its LOCAL date parts. */
export function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A short human label for a `week_of` (YYYY-MM-DD Monday) value, e.g.
 * "Week of May 25". Falls back to the raw string if it can't be parsed.
 */
export function weekLabel(weekOf: string): string {
  // Parse as a LOCAL date (append T00:00 so the engine doesn't treat the
  // bare YYYY-MM-DD as UTC and shift it a day in negative-offset zones).
  const d = new Date(`${weekOf}T00:00:00`);
  if (Number.isNaN(d.getTime())) return weekOf;
  return `Week of ${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}
