import {
  addDays,
  subDays,
  isWeekend,
  nextMonday,
  parseISO,
  format,
  isValid,
} from "date-fns";

export function parseDate(val: string | Date): Date {
  if (val instanceof Date) return val;
  const parsed = parseISO(val);
  if (!isValid(parsed)) {
    throw new Error(`Invalid date: ${val}`);
  }
  return parsed;
}

export function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

// ---- PTO-aware skip helpers (Streak Phase S4, proposal §6.6 / L9) ----
//
// `weekend_active` on Project has the inverted-feeling semantic:
//   weekend_active=TRUE  → weekends are active workdays (no skip)
//   weekend_active=FALSE → skip Sat/Sun
//
// L9 extends the "skip" side: when weekend_active=false, ALSO skip any date
// in the active user's pto_dates list. When weekend_active=true, the project
// runs 7 days a week and PTO is ignored for scheduling purposes (the user
// can still see the PTO stripe in the Gantt for personal context).
//
// Every existing helper here keeps its (date, weekendActive) signature.
// The PTO list is threaded through as an optional trailing param so old
// call sites stay compiling and behave identically when ptoDates is empty
// or omitted — the L9 backward-compat invariant.

/** True if the date is a "skip day" for this project: weekend when the
 *  project skips weekends, OR a PTO day from the user's list when the
 *  project skips weekends. Mirrors the brief snippet in §6.6 with the
 *  boolean correctly oriented to the actual `weekend_active` semantic. */
export function isProjectSkipDate(
  date: Date,
  weekendActive: boolean,
  ptoDates: readonly string[] = [],
): boolean {
  if (weekendActive) return false;
  if (isWeekend(date)) return true;
  if (ptoDates.length === 0) return false;
  const iso = formatDate(date);
  for (const d of ptoDates) {
    if (d === iso) return true;
  }
  return false;
}

export function resolveWeekend(
  date: Date,
  weekendActive: boolean,
  ptoDates: readonly string[] = [],
): Date {
  if (weekendActive) return date;
  // Loop instead of one-shot: a PTO day landing on the Monday after a
  // weekend (e.g. Memorial Day in the US) would otherwise be settled to a
  // PTO day rather than the next workday. Iterating until we hit a true
  // non-skip date keeps the invariant.
  let current = date;
  while (isProjectSkipDate(current, false, ptoDates)) {
    if (isWeekend(current)) {
      current = nextMonday(current);
    } else {
      // It's a weekday PTO day — step forward one day and re-check.
      current = addDays(current, 1);
    }
  }
  return current;
}

export function isWeekendActiveForTask(
  taskWeekendOverride: boolean | null | undefined,
  projectWeekendActive: boolean
): boolean {
  if (taskWeekendOverride !== null && taskWeekendOverride !== undefined) {
    return taskWeekendOverride;
  }
  return projectWeekendActive;
}

export function computeEndDate(
  startDate: Date,
  durationDays: number,
  weekendActive: boolean,
  ptoDates: readonly string[] = [],
): Date {
  if (durationDays < 1) {
    throw new Error("duration_days must be >= 1");
  }

  if (weekendActive) {
    return addDays(startDate, durationDays - 1);
  }

  let current = startDate;
  let remaining = durationDays - 1;

  while (remaining > 0) {
    current = addDays(current, 1);
    if (!isProjectSkipDate(current, false, ptoDates)) {
      remaining--;
    }
  }

  return current;
}

export function computeStartDateFromEnd(
  endDate: Date,
  durationDays: number,
  weekendActive: boolean,
  ptoDates: readonly string[] = [],
): Date {
  if (durationDays < 1) {
    throw new Error("duration_days must be >= 1");
  }

  if (weekendActive) {
    return subDays(endDate, durationDays - 1);
  }

  let current = endDate;
  let remaining = durationDays - 1;

  while (remaining > 0) {
    current = subDays(current, 1);
    if (!isProjectSkipDate(current, false, ptoDates)) {
      remaining--;
    }
  }

  return current;
}

export function addBusinessDays(
  start: Date,
  days: number,
  weekendActive: boolean,
  ptoDates: readonly string[] = [],
): Date {
  if (weekendActive || days === 0) {
    return addDays(start, days);
  }

  let current = start;
  let remaining = days;

  while (remaining > 0) {
    current = addDays(current, 1);
    if (!isProjectSkipDate(current, false, ptoDates)) {
      remaining--;
    }
  }

  return current;
}

export function subtractBusinessDays(
  start: Date,
  days: number,
  weekendActive: boolean,
  ptoDates: readonly string[] = [],
): Date {
  if (weekendActive || days === 0) {
    return subDays(start, days);
  }

  let current = start;
  let remaining = days;

  while (remaining > 0) {
    current = subDays(current, 1);
    if (!isProjectSkipDate(current, false, ptoDates)) {
      remaining--;
    }
  }

  return current;
}

export function getDayOfWeek(date: Date): number {
  return date.getDay();
}

export function isMonday(date: Date): boolean {
  return getDayOfWeek(date) === 1;
}

export function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

export function getWeekdaysBetween(start: Date, end: Date): number {
  if (start > end) return 0;

  let count = 0;
  let current = start;

  while (current <= end) {
    if (!isWeekend(current)) {
      count++;
    }
    current = addDays(current, 1);
  }

  return count;
}

export function getCalendarDaysBetween(start: Date, end: Date): number {
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
