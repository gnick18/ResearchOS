"use client";

import { useMemo } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import type { CalendarFeed, ExternalEvent } from "@/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  listFeeds,
  markFeedSynced,
} from "./external-feeds-store";
import { parseIcsToExternalEvents } from "./ics-parser";
import { listEventsForFeed as listGoogleEvents } from "./google-client";
import { listEventsForFeed as listOutlookEvents } from "./microsoft-client";

const FEEDS_QUERY_KEY = ["calendar-feeds"] as const;
const FEED_EVENTS_PREFIX = "calendar-feed-events";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

async function fetchIcsFeed(feed: CalendarFeed): Promise<ExternalEvent[]> {
  if (!feed.icsUrl) return [];
  const proxyUrl = `/api/calendar-feed?url=${encodeURIComponent(feed.icsUrl)}`;
  const res = await fetch(proxyUrl, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Feed fetch failed (${res.status})`);
  }
  const ics = await res.text();
  return parseIcsToExternalEvents(ics, feed);
}

async function fetchFeed(
  feed: CalendarFeed,
  username: string | null,
): Promise<ExternalEvent[]> {
  switch (feed.kind) {
    case "ics":
      return fetchIcsFeed(feed);
    case "google":
      if (!username) return [];
      return listGoogleEvents(username, feed);
    case "outlook":
      if (!username) return [];
      return listOutlookEvents(username, feed);
  }
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
      queryKey: [
        FEED_EVENTS_PREFIX,
        feed.id,
        feed.kind,
        feed.icsUrl ?? feed.oauthCalendarId,
      ] as const,
      queryFn: async () => {
        const events = await fetchFeed(feed, currentUser);
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
