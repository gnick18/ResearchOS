import ICAL from "ical.js";
import type { CalendarFeed, ExternalEvent } from "../types";

/**
 * Parse an iCal/ICS string into ExternalEvent[] suitable for merging into
 * ResearchOS's calendar grid.
 *
 * Recurring events are expanded inside a sliding ±2-year window around the
 * current date so the user can navigate a few years back/forward without the
 * grid going blank, while keeping the expansion bounded (one feed with a
 * 20-year-long daily recurrence would otherwise generate ~7300 events).
 *
 * Dates are emitted as `YYYY-MM-DD` strings in the user's local time zone,
 * matching the format the rest of the calendar code consumes.
 */

const RECURRENCE_WINDOW_PAST_YEARS = 2;
const RECURRENCE_WINDOW_FUTURE_YEARS = 2;
const MAX_OCCURRENCES_PER_RULE = 1000;

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toLocalTimeString(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractEventUrl(vevent: ICAL.Component): string | null {
  const prop = vevent.getFirstPropertyValue("url");
  if (typeof prop !== "string") return null;
  const trimmed = prop.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface InstanceWindow {
  start: Date;
  end: Date;
}

function expandRecurrence(
  event: ICAL.Event,
  window: InstanceWindow
): Array<{ startDate: ICAL.Time; endDate: ICAL.Time }> {
  const out: Array<{ startDate: ICAL.Time; endDate: ICAL.Time }> = [];
  const iterator = event.iterator();
  let count = 0;
  // ICAL.Time.fromJSDate handles both date-only and date-time inputs.
  const windowEnd = ICAL.Time.fromJSDate(window.end, false);
  while (count < MAX_OCCURRENCES_PER_RULE) {
    const next = iterator.next();
    if (!next) break;
    if (next.compare(windowEnd) > 0) break;
    const details = event.getOccurrenceDetails(next);
    const startJs = details.startDate.toJSDate();
    if (startJs < window.start) {
      count++;
      continue;
    }
    out.push({ startDate: details.startDate, endDate: details.endDate });
    count++;
  }
  return out;
}

function eventToExternal(
  feed: CalendarFeed,
  uid: string,
  startDate: ICAL.Time,
  endDate: ICAL.Time,
  vevent: ICAL.Component,
  occurrenceKey: string | null
): ExternalEvent {
  const start = startDate.toJSDate();
  // ICS DTEND for all-day events is the day after the last day (exclusive).
  // Subtract one day so the rendered range matches user expectations.
  const isAllDay = startDate.isDate;
  const endJs = endDate.toJSDate();
  let endStr: string | null = null;
  if (endJs.getTime() > start.getTime()) {
    const inclusiveEnd = new Date(endJs);
    if (isAllDay) inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
    endStr = toLocalDateString(inclusiveEnd);
  }
  const startStr = toLocalDateString(start);

  const startTime = isAllDay ? null : toLocalTimeString(start);
  const endTime = isAllDay ? null : toLocalTimeString(endJs);

  const summary = safeText(vevent.getFirstPropertyValue("summary")) ?? "(no title)";
  const location = safeText(vevent.getFirstPropertyValue("location"));
  const description = safeText(vevent.getFirstPropertyValue("description"));
  const url = extractEventUrl(vevent);

  return {
    id: `ext-${feed.id}-${uid}${occurrenceKey ? `-${occurrenceKey}` : ""}`,
    feedId: feed.id,
    title: summary,
    start_date: startStr,
    end_date: endStr && endStr !== startStr ? endStr : null,
    start_time: startTime,
    end_time: endTime,
    location,
    url,
    notes: description,
    color: feed.color,
    source: "external",
  };
}

export function parseIcsToExternalEvents(
  icsText: string,
  feed: CalendarFeed
): ExternalEvent[] {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(icsText);
  } catch {
    return [];
  }
  const root = new ICAL.Component(jcal as [string, unknown[], unknown[]]);
  const vevents = root.getAllSubcomponents("vevent");

  const now = new Date();
  const window: InstanceWindow = {
    start: new Date(now.getFullYear() - RECURRENCE_WINDOW_PAST_YEARS, 0, 1),
    end: new Date(now.getFullYear() + RECURRENCE_WINDOW_FUTURE_YEARS, 11, 31),
  };

  const out: ExternalEvent[] = [];
  for (const vevent of vevents) {
    let ev: ICAL.Event;
    try {
      ev = new ICAL.Event(vevent);
    } catch {
      continue;
    }
    if (!ev.startDate) continue;
    const uid = ev.uid || `${out.length}`;

    if (ev.isRecurring()) {
      const instances = expandRecurrence(ev, window);
      for (const inst of instances) {
        const occKey = toLocalDateString(inst.startDate.toJSDate());
        out.push(eventToExternal(feed, uid, inst.startDate, inst.endDate, vevent, occKey));
      }
    } else {
      const startJs = ev.startDate.toJSDate();
      if (startJs < window.start || startJs > window.end) continue;
      out.push(
        eventToExternal(
          feed,
          uid,
          ev.startDate,
          ev.endDate ?? ev.startDate,
          vevent,
          null
        )
      );
    }
  }
  return out;
}
