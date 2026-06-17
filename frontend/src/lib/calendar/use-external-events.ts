"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import type { CalendarFeed, ExternalEvent } from "@/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import {
  listFeeds,
  markFeedSynced,
  resolveEffectiveFeeds,
} from "./external-feeds-store";
import { parseIcsToExternalEvents } from "./ics-parser";
import { FEED_EVENTS_PREFIX } from "./feed-cache-keys";
import { isAccountSettingsEnabled } from "@/lib/account/account-settings-config";
import { fetchAccountSettings } from "@/lib/account/account-settings";

const FEEDS_QUERY_KEY = ["calendar-feeds"] as const;

// Re-exported for back-compat with existing importers; the canonical
// definition lives in `./feed-cache-keys` (a cycle-free module shared
// with the account-switch handler). See that file for the rationale.
export { FEED_EVENTS_PREFIX };

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

async function fetchIcsFeed(feed: CalendarFeed): Promise<ExternalEvent[]> {
  if (!feed.icsUrl) return [];
  // Offline-mode honors the user's "stop talking to our deploy" preference.
  // The feed list itself stays untouched on disk; toggling off resumes sync.
  if (useAppStore.getState().offlineMode) return [];
  const res = await fetch("/api/calendar-feed", {
    cache: "no-store",
    headers: { "x-calendar-url": feed.icsUrl },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Feed fetch failed (${res.status})`);
  }
  const ics = await res.text();
  return parseIcsToExternalEvents(ics, feed);
}

// ── Per-feed circuit breaker ─────────────────────────────────────────────
// A dead or expired ICS share URL fails the same way on every poll. Without
// a breaker, React Query's refetch-on-focus + retry re-fires the failing
// feed on every window focus and every component that mounts the hook
// (the calendar page, the daily sidebar, the lab-overview widget…), which
// is exactly the "console floods with 502s" failure mode. After
// MAX_CONSECUTIVE_FAILURES failures a feed is "tripped": its query is
// disabled so it stops auto-refetching until the user explicitly retries
// (or edits the URL, which changes the breaker key). Module-level so the
// tripped state is shared across every mount and survives remounts within a
// session; it resets on reload (a natural "try again").
const MAX_CONSECUTIVE_FAILURES = 3;
type BreakerEntry = { failures: number; tripped: boolean };
const feedBreaker = new Map<string, BreakerEntry>();

function breakerKey(feed: CalendarFeed): string {
  // Include the URL so editing a broken feed's link mints a fresh key and
  // clears the tripped state automatically.
  return `${feed.id}::${feed.icsUrl ?? ""}`;
}
function isFeedTripped(feed: CalendarFeed): boolean {
  return feedBreaker.get(breakerKey(feed))?.tripped ?? false;
}
function recordFeedSuccess(feed: CalendarFeed): void {
  feedBreaker.delete(breakerKey(feed));
}
function recordFeedFailure(feed: CalendarFeed): void {
  const key = breakerKey(feed);
  const entry = feedBreaker.get(key) ?? { failures: 0, tripped: false };
  entry.failures += 1;
  if (entry.failures >= MAX_CONSECUTIVE_FAILURES) entry.tripped = true;
  feedBreaker.set(key, entry);
}
function resetFeedBreaker(): void {
  feedBreaker.clear();
}

export function useCalendarFeeds() {
  const { currentUser } = useCurrentUser();
  return useQuery({
    queryKey: [...FEEDS_QUERY_KEY, currentUser],
    queryFn: async () => {
      if (!currentUser) return [];
      const folderFeeds = await listFeeds(currentUser);
      // Account-scoped feeds (the Owen case): when the flag is on and the account
      // store carries calendar feeds, they FOLLOW the user across folders, so the
      // calendar renders the account list merged OVER the folder-local one. Flag
      // off / no account blob falls through to the folder list unchanged.
      // fetchAccountSettings is memoized per session, so this adds no per-feed I/O.
      if (!isAccountSettingsEnabled()) return folderFeeds;
      try {
        const account = await fetchAccountSettings();
        return resolveEffectiveFeeds(folderFeeds, account?.calendarFeeds ?? null);
      } catch {
        // Never let an account lookup break the calendar; fall back to folder.
        return folderFeeds;
      }
    },
    enabled: !!currentUser,
    staleTime: ONE_HOUR_MS,
  });
}

/**
 * Returns the merged read-only events from every enabled external feed, plus
 * per-feed loading/error state. Each feed gets its own React Query so one
 * broken URL doesn't sink the rest.
 */
export function useExternalEvents() {
  const { currentUser } = useCurrentUser();
  const feedsQuery = useCalendarFeeds();
  const enabledFeeds = useMemo(
    () => (feedsQuery.data ?? []).filter((f) => f.enabled),
    [feedsQuery.data]
  );

  const queryClient = useQueryClient();

  // Bumped when the user retries stalled feeds: forces the per-feed `enabled`
  // flags below to recompute from the (now-reset) breaker so a tripped query
  // re-enables and React Query re-runs it.
  const [breakerNonce, setBreakerNonce] = useState(0);

  const perFeed = useQueries({
    queries: enabledFeeds.map((feed) => ({
      // currentUser is the FIRST key segment (calendar-privacy fix,
      // 2026-05-29). External ICS feed events are strictly personal:
      // they are the read-only events fetched from a user's linked
      // Google / iCloud / Outlook calendars and must never surface
      // under another account. Before this fix the key was
      // [FEED_EVENTS_PREFIX, feed.id, feed.kind, feed.icsUrl] with NO
      // user segment. `feed.id` is a per-user monotonic counter (it
      // starts at 1 for every user), so two different users' "first
      // feed" collide on the same cache key. On a same-browser account
      // switch (a PI testing the member experience, or vice versa) the
      // prior user's parsed events stayed resident in this shared cache
      // (`gcTime: ONE_HOUR_MS`) and could be served to the next user.
      // Prefixing with currentUser gives every user a private cache
      // namespace so a feed-events entry can never be read across
      // accounts. The matching cache CLEAR on switch lives in
      // file-system-context.tsx setCurrentUser (removeQueries by the
      // FEED_EVENTS_PREFIX), which evicts the previous user's resident
      // events outright rather than merely marking them stale.
      queryKey: [FEED_EVENTS_PREFIX, currentUser, feed.id, feed.kind, feed.icsUrl] as const,
      queryFn: async () => {
        try {
          const events = await fetchIcsFeed(feed);
          recordFeedSuccess(feed);
          if (currentUser) {
            try {
              await markFeedSynced(currentUser, feed.id);
              queryClient.invalidateQueries({ queryKey: [...FEEDS_QUERY_KEY, currentUser] });
            } catch {
              // markFeedSynced is best-effort; surfacing its failure would just
              // bury the actual events behind a non-fatal error.
            }
          }
          return events;
        } catch (err) {
          recordFeedFailure(feed);
          throw err;
        }
      },
      // Once a feed has failed MAX_CONSECUTIVE_FAILURES times in a row it is
      // almost certainly a dead/expired share URL, not a blip. Disable the
      // query so it stops auto-refetching on every focus / remount (the
      // console-flood failure mode) until the user explicitly retries.
      enabled: !isFeedTripped(feed),
      // A 502 from a dead feed won't recover on an immediate retry; it just
      // doubles the noise. Let the breaker + manual retry handle recovery.
      retry: 0,
      // The default focus/reconnect refetch is what turns one bad feed into a
      // console flood as the user clicks around. Feeds refresh on the
      // staleTime cadence and on explicit retry instead.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: FIFTEEN_MIN_MS,
      gcTime: ONE_HOUR_MS,
    })),
  });

  const events = useMemo(() => {
    const out: ExternalEvent[] = [];
    for (const q of perFeed) {
      if (q.data) out.push(...q.data);
    }
    return out;
  }, [perFeed]);

  const errorsByFeedId = useMemo(() => {
    const map = new Map<number, string>();
    enabledFeeds.forEach((feed, idx) => {
      const q = perFeed[idx];
      if (q?.error) {
        const msg = q.error instanceof Error ? q.error.message : String(q.error);
        map.set(feed.id, msg);
      }
    });
    return map;
  }, [enabledFeeds, perFeed]);

  // Feeds the breaker has given up on. The UI shows these as "stopped
  // syncing — check the link" (a likely-broken subscription needing the
  // user's attention), distinct from a transient "couldn't fetch, will
  // retry". perFeed + breakerNonce are the signals the tripped set changed
  // (a query just errored, or the user retried).
  const staleFeedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const feed of enabledFeeds) {
      if (isFeedTripped(feed)) ids.add(feed.id);
    }
    return ids;
  }, [enabledFeeds, perFeed, breakerNonce]);

  const isLoading = feedsQuery.isLoading || perFeed.some((q) => q.isLoading);
  const isFetching = feedsQuery.isFetching || perFeed.some((q) => q.isFetching);

  const refetch = async () => {
    // Clear every breaker entry and force `enabled` to recompute true so
    // tripped queries re-enable, then re-run all feed queries. Backs the
    // user-facing "Retry" affordances.
    resetFeedBreaker();
    setBreakerNonce((n) => n + 1);
    await Promise.all(perFeed.map((q) => q.refetch()));
  };

  return {
    events,
    errorsByFeedId,
    staleFeedIds,
    isLoading,
    isFetching,
    refetch,
  };
}
