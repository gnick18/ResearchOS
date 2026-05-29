"use client";

import { useMemo } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import type { CalendarFeed, ExternalEvent } from "@/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import {
  listFeeds,
  markFeedSynced,
} from "./external-feeds-store";
import { parseIcsToExternalEvents } from "./ics-parser";
import { FEED_EVENTS_PREFIX } from "./feed-cache-keys";

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

export function useCalendarFeeds() {
  const { currentUser } = useCurrentUser();
  return useQuery({
    queryKey: [...FEEDS_QUERY_KEY, currentUser],
    queryFn: async () => (currentUser ? listFeeds(currentUser) : []),
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
        const events = await fetchIcsFeed(feed);
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
      },
      staleTime: FIFTEEN_MIN_MS,
      gcTime: ONE_HOUR_MS,
      retry: 1,
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

  const isLoading = feedsQuery.isLoading || perFeed.some((q) => q.isLoading);
  const isFetching = feedsQuery.isFetching || perFeed.some((q) => q.isFetching);

  const refetch = async () => {
    await Promise.all(perFeed.map((q) => q.refetch()));
  };

  return {
    events,
    errorsByFeedId,
    isLoading,
    isFetching,
    refetch,
  };
}
