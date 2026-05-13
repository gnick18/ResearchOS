"use client";

import {
  clearTokens,
  readTokens,
  writeTokens,
  type OAuthTokens,
} from "./oauth-tokens-store";
import type { CalendarFeed, ExternalEvent } from "@/lib/types";

/**
 * Browser-side Google Calendar API wrapper.
 *
 * Tokens live in the user's FSA folder (see `oauth-tokens-store`). Each
 * call wraps `fetch` with a 401-then-refresh retry: when Google reports
 * an expired access token, we hit our own `/api/auth/google/refresh`
 * route (which holds the client secret) to mint a new one, persist it,
 * and replay the original call exactly once.
 */

const API_ROOT = "https://www.googleapis.com/calendar/v3";

const RECURRENCE_WINDOW_PAST_YEARS = 2;
const RECURRENCE_WINDOW_FUTURE_YEARS = 2;

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  status?: string;
}

interface ListEventsResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

/** Token-refresh helper. Falls back to clearing the stored tokens if
 *  refresh fails, so the UI can surface a "reconnect" prompt instead of
 *  silently spinning on 401s forever. */
async function refreshIfNeeded(
  username: string,
  tokens: OAuthTokens,
): Promise<OAuthTokens> {
  if (Date.parse(tokens.expiresAt) - Date.now() > 30_000) return tokens; // still fresh
  if (!tokens.refreshToken) {
    throw new Error("Google access token expired and no refresh token is stored.");
  }
  const res = await fetch("/api/auth/google/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });
  if (!res.ok) {
    const text = await res.text();
    await clearTokens(username, "google");
    throw new Error(`Google token refresh failed: ${text || res.statusText}`);
  }
  const payload = (await res.json()) as {
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number;
    scope: string | null;
  };
  const next: OAuthTokens = {
    ...tokens,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken ?? tokens.refreshToken,
    expiresAt: new Date(Date.now() + payload.expiresIn * 1000).toISOString(),
    scopes: payload.scope ? payload.scope.split(" ") : tokens.scopes,
  };
  await writeTokens(username, "google", next);
  return next;
}

async function authedFetch(
  username: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let tokens = await readTokens(username, "google");
  if (!tokens) throw new Error("Google account not connected.");
  tokens = await refreshIfNeeded(username, tokens);

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status !== 401) return res;

  // Force a refresh and retry once. Some 401s come from a token that
  // expired between our staleness check and the request landing.
  const refreshed = await refreshIfNeeded(
    username,
    { ...tokens, expiresAt: new Date(0).toISOString() },
  );
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${refreshed.accessToken}`);
  return fetch(url, { ...init, headers: retryHeaders });
}

export async function listCalendars(
  username: string,
): Promise<GoogleCalendarListItem[]> {
  const res = await authedFetch(
    username,
    `${API_ROOT}/users/me/calendarList?minAccessRole=reader`,
  );
  if (!res.ok) throw new Error(`Google calendars list failed: ${res.statusText}`);
  const data = (await res.json()) as { items?: GoogleCalendarListItem[] };
  return data.items ?? [];
}

/** Iterate `events.list` with `singleEvents=true` so recurring events are
 *  expanded server-side into individual instances within the window. */
export async function listEventsForFeed(
  username: string,
  feed: CalendarFeed,
): Promise<ExternalEvent[]> {
  if (feed.kind !== "google" || !feed.oauthCalendarId) return [];
  const now = new Date();
  const timeMin = new Date(
    now.getFullYear() - RECURRENCE_WINDOW_PAST_YEARS,
    0,
    1,
  ).toISOString();
  const timeMax = new Date(
    now.getFullYear() + RECURRENCE_WINDOW_FUTURE_YEARS,
    11,
    31,
  ).toISOString();

  const out: ExternalEvent[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const u = new URL(
      `${API_ROOT}/calendars/${encodeURIComponent(feed.oauthCalendarId)}/events`,
    );
    u.searchParams.set("singleEvents", "true");
    u.searchParams.set("orderBy", "startTime");
    u.searchParams.set("timeMin", timeMin);
    u.searchParams.set("timeMax", timeMax);
    u.searchParams.set("maxResults", "250");
    if (pageToken) u.searchParams.set("pageToken", pageToken);

    const res = await authedFetch(username, u.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google events.list failed: ${text || res.statusText}`);
    }
    const data = (await res.json()) as ListEventsResponse;
    for (const ev of data.items ?? []) {
      const ee = toExternalEvent(ev, feed);
      if (ee) out.push(ee);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return out;
}

function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The subset of fields we let the user edit. `null` clears the field on
 *  the provider side; `undefined` leaves it unchanged. Pass `start_time`
 *  with `null` (and the corresponding `end_time`) to move an event to
 *  all-day, or supply both to schedule a timed event. */
export interface ExternalEventPatch {
  title?: string;
  start_date?: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  notes?: string | null;
}

/** Convert a local YYYY-MM-DD + HH:MM into an ISO datetime in the user's
 *  local timezone (sans the trailing Z so Google interprets it in the
 *  supplied timeZone). */
function localToProviderDateTime(dateStr: string, timeStr: string): {
  iso: string;
  timeZone: string;
} {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  const dt = new Date(y, m - 1, d, h, min, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso =
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T` +
    `${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return { iso, timeZone };
}

/** Read an event back from the provider so we can compose a clean PATCH
 *  body that preserves fields we don't touch (attendees, recurrence
 *  exceptions, attachments, …). */
async function getGoogleEvent(
  username: string,
  calendarId: string,
  eventId: string,
): Promise<GoogleEvent> {
  const res = await authedFetch(
    username,
    `${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google events.get failed: ${text || res.statusText}`);
  }
  return (await res.json()) as GoogleEvent;
}

/** PATCH an event upstream. Returns the freshly-parsed ExternalEvent so the
 *  caller can update its local cache without a refetch. */
export async function updateEvent(
  username: string,
  feed: CalendarFeed,
  eventId: string,
  patch: ExternalEventPatch,
): Promise<ExternalEvent> {
  if (feed.kind !== "google" || !feed.oauthCalendarId) {
    throw new Error("Google update called on a non-google feed.");
  }
  const calendarId = feed.oauthCalendarId;
  const existing = await getGoogleEvent(username, calendarId, eventId);

  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.location !== undefined) body.location = patch.location ?? "";
  if (patch.notes !== undefined) body.description = patch.notes ?? "";

  // Time handling: if either the date or the time fields changed, we
  // rebuild both `start` and `end` from scratch — Google rejects partial
  // start/end (they have to both carry either `date` or `dateTime`).
  const touchedDateOrTime =
    patch.start_date !== undefined ||
    patch.end_date !== undefined ||
    patch.start_time !== undefined ||
    patch.end_time !== undefined;

  if (touchedDateOrTime) {
    // Read merged values: patch ⊕ existing (so callers can change one
    // field at a time without losing context).
    const existingStartDate = existing.start?.date ?? existing.start?.dateTime?.slice(0, 10);
    const existingStartTime =
      existing.start?.dateTime
        ? new Date(existing.start.dateTime).toTimeString().slice(0, 5)
        : null;
    const existingEndDate = existing.end?.date ?? existing.end?.dateTime?.slice(0, 10);
    const existingEndTime =
      existing.end?.dateTime
        ? new Date(existing.end.dateTime).toTimeString().slice(0, 5)
        : null;

    const startDate = patch.start_date ?? existingStartDate;
    if (!startDate) throw new Error("Cannot rebuild start/end without a start_date.");
    const startTime =
      patch.start_time !== undefined ? patch.start_time : existingStartTime;
    const endDate =
      patch.end_date !== undefined
        ? patch.end_date ?? startDate
        : existingEndDate ?? startDate;
    const endTime =
      patch.end_time !== undefined ? patch.end_time : existingEndTime;

    if (startTime === null && endTime === null) {
      // All-day. Google's end.date is exclusive (day after the last day).
      const [y, m, d] = endDate.split("-").map(Number);
      const exclusive = new Date(y, m - 1, d + 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      const exclusiveStr = `${exclusive.getFullYear()}-${pad(exclusive.getMonth() + 1)}-${pad(exclusive.getDate())}`;
      body.start = { date: startDate };
      body.end = { date: exclusiveStr };
    } else {
      const startResolved = localToProviderDateTime(
        startDate,
        startTime ?? "09:00",
      );
      const endResolved = localToProviderDateTime(
        endDate,
        endTime ?? startTime ?? "10:00",
      );
      body.start = { dateTime: startResolved.iso, timeZone: startResolved.timeZone };
      body.end = { dateTime: endResolved.iso, timeZone: endResolved.timeZone };
    }
  }

  const res = await authedFetch(
    username,
    `${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google events.patch failed: ${text || res.statusText}`);
  }
  const updated = (await res.json()) as GoogleEvent;
  const ee = toExternalEvent(updated, feed);
  if (!ee) throw new Error("Update succeeded but the response couldn't be parsed.");
  return ee;
}

export async function deleteEvent(
  username: string,
  feed: CalendarFeed,
  eventId: string,
): Promise<void> {
  if (feed.kind !== "google" || !feed.oauthCalendarId) {
    throw new Error("Google delete called on a non-google feed.");
  }
  const res = await authedFetch(
    username,
    `${API_ROOT}/calendars/${encodeURIComponent(feed.oauthCalendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 410) {
    // 410 Gone = already deleted; treat as success.
    const text = await res.text();
    throw new Error(`Google events.delete failed: ${text || res.statusText}`);
  }
}

function toExternalEvent(
  ev: GoogleEvent,
  feed: CalendarFeed,
): ExternalEvent | null {
  if (ev.status === "cancelled") return null;
  const startDateOnly = ev.start?.date;
  const endDateOnly = ev.end?.date;
  const startTimeIso = ev.start?.dateTime;
  const endTimeIso = ev.end?.dateTime;

  let startDate: string;
  let endDate: string | null;
  let startTime: string | null;
  let endTime: string | null;

  if (startDateOnly) {
    // All-day. Google's end.date is exclusive (day after).
    startDate = startDateOnly;
    if (endDateOnly && endDateOnly > startDateOnly) {
      const [y, m, d] = endDateOnly.split("-").map(Number);
      const inclusive = new Date(y, m - 1, d - 1);
      endDate = toLocalDateString(inclusive);
      if (endDate === startDate) endDate = null;
    } else {
      endDate = null;
    }
    startTime = null;
    endTime = null;
  } else if (startTimeIso) {
    const s = new Date(startTimeIso);
    startDate = toLocalDateString(s);
    startTime = toLocalTimeString(s);
    if (endTimeIso) {
      const e = new Date(endTimeIso);
      const ed = toLocalDateString(e);
      endDate = ed === startDate ? null : ed;
      endTime = toLocalTimeString(e);
    } else {
      endDate = null;
      endTime = null;
    }
  } else {
    return null;
  }

  return {
    id: `ext-${feed.id}-${ev.id}`,
    feedId: feed.id,
    feedKind: "google",
    providerEventId: ev.id,
    title: ev.summary?.trim() || "(no title)",
    start_date: startDate,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
    location: ev.location?.trim() || null,
    url: ev.htmlLink ?? null,
    notes: ev.description?.trim() || null,
    color: feed.color,
    source: "external",
  };
}
