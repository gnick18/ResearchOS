"use client";

import {
  clearTokens,
  readTokens,
  writeTokens,
  type OAuthTokens,
} from "./oauth-tokens-store";
import type { CalendarFeed, ExternalEvent } from "@/lib/types";

/**
 * Browser-side Microsoft Graph (Outlook Calendar) API wrapper.
 *
 * Tokens live in the user's FSA folder. Calls wrap `fetch` with the same
 * 401-then-refresh-and-retry pattern as the Google client; the only
 * provider-specific quirks are the API base URL, the calendarView endpoint
 * (Graph's equivalent of Google's `singleEvents=true`), and the way
 * refresh tokens are rotated on each refresh.
 */

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

const RECURRENCE_WINDOW_PAST_YEARS = 2;
const RECURRENCE_WINDOW_FUTURE_YEARS = 2;

export interface OutlookCalendarListItem {
  id: string;
  name: string;
  isDefaultCalendar: boolean;
  color?: string;
  hexColor?: string;
  canEdit?: boolean;
}

interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  webLink?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
}

interface ListEventsResponse {
  value?: GraphEvent[];
  "@odata.nextLink"?: string;
}

/** Refresh helper. Microsoft rotates refresh tokens on each refresh, so we
 *  persist the new one if the server returned it. */
async function refreshIfNeeded(
  username: string,
  tokens: OAuthTokens,
): Promise<OAuthTokens> {
  if (Date.parse(tokens.expiresAt) - Date.now() > 30_000) return tokens;
  if (!tokens.refreshToken) {
    throw new Error("Outlook access token expired and no refresh token is stored.");
  }
  const res = await fetch("/api/auth/microsoft/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });
  if (!res.ok) {
    const text = await res.text();
    await clearTokens(username, "outlook");
    throw new Error(`Outlook token refresh failed: ${text || res.statusText}`);
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
  await writeTokens(username, "outlook", next);
  return next;
}

async function authedFetch(
  username: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let tokens = await readTokens(username, "outlook");
  if (!tokens) throw new Error("Outlook account not connected.");
  tokens = await refreshIfNeeded(username, tokens);

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status !== 401) return res;

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
): Promise<OutlookCalendarListItem[]> {
  const res = await authedFetch(username, `${GRAPH_ROOT}/me/calendars?$top=100`);
  if (!res.ok) throw new Error(`Outlook calendars list failed: ${res.statusText}`);
  const data = (await res.json()) as { value?: OutlookCalendarListItem[] };
  return data.value ?? [];
}

/** Graph's `calendarView` endpoint expands recurring series into individual
 *  occurrences within the supplied window — same idea as Google's
 *  `singleEvents=true`. */
export async function listEventsForFeed(
  username: string,
  feed: CalendarFeed,
): Promise<ExternalEvent[]> {
  if (feed.kind !== "outlook" || !feed.oauthCalendarId) return [];
  const now = new Date();
  const startDateTime = new Date(
    now.getFullYear() - RECURRENCE_WINDOW_PAST_YEARS,
    0,
    1,
  ).toISOString();
  const endDateTime = new Date(
    now.getFullYear() + RECURRENCE_WINDOW_FUTURE_YEARS,
    11,
    31,
  ).toISOString();

  const out: ExternalEvent[] = [];
  let nextUrl: string | null =
    `${GRAPH_ROOT}/me/calendars/${encodeURIComponent(feed.oauthCalendarId)}` +
    `/calendarView?startDateTime=${encodeURIComponent(startDateTime)}` +
    `&endDateTime=${encodeURIComponent(endDateTime)}&$top=200`;

  while (nextUrl) {
    const res = await authedFetch(username, nextUrl);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph calendarView failed: ${text || res.statusText}`);
    }
    const data = (await res.json()) as ListEventsResponse;
    for (const ev of data.value ?? []) {
      const ee = toExternalEvent(ev, feed);
      if (ee) out.push(ee);
    }
    nextUrl = data["@odata.nextLink"] ?? null;
  }

  return out;
}

function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Graph returns datetimes in the timezone you asked for (we don't pass a
 *  Prefer header, so we get UTC). `new Date(...)` parses the trailing 'Z'
 *  correctly and we then read local components, putting the event in the
 *  user's local time — the same convention the Google client uses. */
function toExternalEvent(
  ev: GraphEvent,
  feed: CalendarFeed,
): ExternalEvent | null {
  if (ev.isCancelled) return null;
  const startIso = ev.start?.dateTime;
  if (!startIso) return null;

  // Graph omits the trailing Z but treats datetimes as UTC by default when
  // no Prefer: outlook.timezone header is set.
  const startD = new Date(startIso.endsWith("Z") ? startIso : startIso + "Z");
  const endIso = ev.end?.dateTime;
  const endD = endIso ? new Date(endIso.endsWith("Z") ? endIso : endIso + "Z") : null;

  let startDate: string;
  let endDate: string | null;
  let startTime: string | null;
  let endTime: string | null;

  if (ev.isAllDay) {
    startDate = toLocalDateString(startD);
    if (endD && endD.getTime() > startD.getTime()) {
      // Graph all-day events use an exclusive end (same as Google). Walk
      // back one day so we render the inclusive last day.
      const inclusive = new Date(endD);
      inclusive.setDate(inclusive.getDate() - 1);
      const ed = toLocalDateString(inclusive);
      endDate = ed === startDate ? null : ed;
    } else {
      endDate = null;
    }
    startTime = null;
    endTime = null;
  } else {
    startDate = toLocalDateString(startD);
    startTime = toLocalTimeString(startD);
    if (endD) {
      const ed = toLocalDateString(endD);
      endDate = ed === startDate ? null : ed;
      endTime = toLocalTimeString(endD);
    } else {
      endDate = null;
      endTime = null;
    }
  }

  return {
    id: `ext-${feed.id}-${ev.id}`,
    feedId: feed.id,
    feedKind: "outlook",
    providerEventId: ev.id,
    title: ev.subject?.trim() || "(no title)",
    start_date: startDate,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
    location: ev.location?.displayName?.trim() || null,
    url: ev.webLink ?? null,
    notes: ev.bodyPreview?.trim() || null,
    color: feed.color,
    source: "external",
  };
}
