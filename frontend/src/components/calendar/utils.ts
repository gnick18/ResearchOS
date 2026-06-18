import type { Event, ExternalEvent } from "@/lib/types";

export type CalendarView = "month" | "week" | "day";

export type CalendarItem =
  | { kind: "native"; event: Event }
  | { kind: "external"; event: ExternalEvent };

export const EVENT_TYPE_COLORS: Record<string, string> = {
  conference: "#8b5cf6",
  deadline: "#ef4444",
  meeting: "#3b82f6",
  other: "#6b7280",
};

/** Format an HH:MM string into a compact 12h form. `09:00` -> `9a`,
 *  `13:30` -> `1:30p`, empty/invalid -> "". */
export function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const hour = parseInt(m[1], 10);
  const minute = m[2];
  const period = hour >= 12 ? "p" : "a";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${hour12}${period}` : `${hour12}:${minute}${period}`;
}

export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Local YYYY-MM-DD string from a Date — avoids the timezone shift that
 *  `toISOString()` introduces. */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function itemColor(item: CalendarItem): string {
  if (item.kind === "native") {
    return item.event.color || EVENT_TYPE_COLORS[item.event.event_type];
  }
  return item.event.color;
}

export function eventTimeOrder(
  a: { start_time: string | null },
  b: { start_time: string | null }
): number {
  const at = a.start_time ?? "";
  const bt = b.start_time ?? "";
  if (at === bt) return 0;
  if (!at) return -1;
  if (!bt) return 1;
  return at.localeCompare(bt);
}

/** Build an array of 7 consecutive dates starting on Sunday of the week
 *  containing `anchor`. */
export function getWeekDays(anchor: Date): Date[] {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** The event's end date, clamped to never fall before its start date.
 *  A blank end date collapses to the start (single-day event). An inverted
 *  range (end_date before start_date) would otherwise cover zero days and
 *  make the event render nowhere, leaving it unclickable and looking like
 *  data loss, so we collapse it to a single day on the start date. Every
 *  render path should resolve the end date through this helper. */
export function effectiveEndDate(event: {
  start_date: string;
  end_date: string | null;
}): string {
  const end = event.end_date || event.start_date;
  return end < event.start_date ? event.start_date : end;
}

/** Validates an event's date/time range as entered in the create and edit
 *  forms. Returns a flag per field so the forms can place inline errors and
 *  block Save.
 *
 *  - endDateInvalid: the end date falls before the start date. Such a range
 *    expands to zero days, so the event would render on no calendar day and
 *    become unclickable, which looks like data loss. Always blocked.
 *  - endTimeInvalid: the end time falls before the start time ON THE SAME
 *    DAY. An overnight event (later end date, earlier wall-clock time) is
 *    legitimate, so the time is only checked when the end date equals the
 *    start date (or no end date is set). */
export function validateEventRange(input: {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
}): { endDateInvalid: boolean; endTimeInvalid: boolean } {
  const { startDate, endDate, startTime, endTime } = input;
  const endDateInvalid = !!endDate && !!startDate && endDate < startDate;
  const sameDay = !endDate || endDate === startDate;
  const endTimeInvalid =
    sameDay && !!startTime && !!endTime && endTime < startTime;
  return { endDateInvalid, endTimeInvalid };
}

/** Returns true if `dateStr` (YYYY-MM-DD) falls within the event's
 *  inclusive start_date..end_date range. */
export function eventCoversDate(
  event: { start_date: string; end_date: string | null },
  dateStr: string
): boolean {
  return dateStr >= event.start_date && dateStr <= effectiveEndDate(event);
}

/** Split a set of items for a given day into all-day-or-multi-day items vs.
 *  single-day timed items. The latter are the ones that get positioned in the
 *  hourly time grid. Multi-day timed events (rare) render in the all-day
 *  strip to keep positioning sane. */
export function splitDayItems(
  items: CalendarItem[],
  dateStr: string
): { allDay: CalendarItem[]; timed: CalendarItem[] } {
  const allDay: CalendarItem[] = [];
  const timed: CalendarItem[] = [];
  for (const item of items) {
    const e = item.event;
    const hasTime = !!e.start_time;
    const sameDay = (e.end_date ?? e.start_date) === e.start_date;
    if (hasTime && sameDay && e.start_date === dateStr) {
      timed.push(item);
    } else {
      allDay.push(item);
    }
  }
  return { allDay, timed };
}

/** Compute lane assignments for overlapping timed events on a single day.
 *  Returns an array of `{ item, lane, laneCount }` where laneCount is the
 *  maximum overlap depth for the cluster the event belongs to. */
export function assignLanes(
  items: CalendarItem[]
): Array<{ item: CalendarItem; lane: number; laneCount: number }> {
  if (items.length === 0) return [];
  const withRange = items
    .map((item) => {
      const start = timeToMinutes(item.event.start_time) ?? 0;
      // Default 30-min duration if no end time set
      const end = timeToMinutes(item.event.end_time) ?? start + 30;
      return { item, start, end: Math.max(end, start + 15) };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Group into clusters where each event overlaps with at least one other in
  // the cluster. Within a cluster, do a greedy lane assignment.
  const result: Array<{ item: CalendarItem; lane: number; laneCount: number }> = [];
  let clusterStart = 0;
  while (clusterStart < withRange.length) {
    let clusterEnd = clusterStart;
    let maxEnd = withRange[clusterStart].end;
    while (
      clusterEnd + 1 < withRange.length &&
      withRange[clusterEnd + 1].start < maxEnd
    ) {
      clusterEnd++;
      maxEnd = Math.max(maxEnd, withRange[clusterEnd].end);
    }
    const cluster = withRange.slice(clusterStart, clusterEnd + 1);
    const lanes: number[] = []; // lanes[i] = end-time of the latest event in lane i
    const assigned: Array<{ item: CalendarItem; lane: number }> = [];
    for (const ev of cluster) {
      let placed = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= ev.start) {
          placed = i;
          lanes[i] = ev.end;
          break;
        }
      }
      if (placed === -1) {
        placed = lanes.length;
        lanes.push(ev.end);
      }
      assigned.push({ item: ev.item, lane: placed });
    }
    const laneCount = lanes.length;
    for (const a of assigned) {
      result.push({ ...a, laneCount });
    }
    clusterStart = clusterEnd + 1;
  }
  return result;
}
