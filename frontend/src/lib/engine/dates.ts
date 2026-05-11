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

export function resolveWeekend(date: Date, weekendActive: boolean): Date {
  if (weekendActive) return date;
  if (isWeekend(date)) return nextMonday(date);
  return date;
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
  weekendActive: boolean
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
    if (!isWeekend(current)) {
      remaining--;
    }
  }

  return current;
}

export function computeStartDateFromEnd(
  endDate: Date,
  durationDays: number,
  weekendActive: boolean
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
    if (!isWeekend(current)) {
      remaining--;
    }
  }

  return current;
}

export function addBusinessDays(
  start: Date,
  days: number,
  weekendActive: boolean
): Date {
  if (weekendActive || days === 0) {
    return addDays(start, days);
  }

  let current = start;
  let remaining = days;

  while (remaining > 0) {
    current = addDays(current, 1);
    if (!isWeekend(current)) {
      remaining--;
    }
  }

  return current;
}

export function subtractBusinessDays(
  start: Date,
  days: number,
  weekendActive: boolean
): Date {
  if (weekendActive || days === 0) {
    return subDays(start, days);
  }

  let current = start;
  let remaining = days;

  while (remaining > 0) {
    current = subDays(current, 1);
    if (!isWeekend(current)) {
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
