// Circuit-breaker coverage for useExternalEvents.
//
// A dead/expired ICS share URL fails identically on every poll. Without a
// breaker, React Query's refetch-on-focus + retry re-fires it on every window
// focus and every component that mounts the hook, flooding the console with
// 502s. These tests pin the breaker that ends that flood and surfaces the
// feed as "stale" so the UI can prompt the user to re-check the link:
//
//   - retry is 0 (one fetch attempt per cycle, no doubling),
//   - after MAX_CONSECUTIVE_FAILURES (3) consecutive failures the feed query
//     is disabled (enabled:false) so it stops fetching entirely,
//   - the feed id then appears in `staleFeedIds`,
//   - `refetch()` resets the breaker and re-attempts.
//
// The breaker is module-level (shared across mounts within a session) so the
// test walks the lifecycle across successive mounts. Hermetic: feed store,
// parser, current-user, store, and global fetch are all mocked.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { CalendarFeed, ExternalEvent } from "@/lib/types";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    currentUser: "grant",
    setCurrentUser: vi.fn(),
    mainUser: null,
    availableUsers: [],
    createUser: vi.fn(),
    isLoggedIn: true,
  }),
}));

vi.mock("@/lib/store", () => ({
  useAppStore: { getState: () => ({ offlineMode: false }) },
}));

const FEED: CalendarFeed = {
  id: 1,
  provider: "other",
  kind: "ics",
  label: "Dead feed",
  icsUrl: "https://calendars.example/dead.ics",
  color: "#3b82f6",
  enabled: true,
  lastSyncAt: null,
};

vi.mock("@/lib/calendar/external-feeds-store", () => ({
  listFeeds: vi.fn(async () => [FEED]),
  markFeedSynced: vi.fn(async () => {}),
}));

vi.mock("@/lib/calendar/ics-parser", () => ({
  parseIcsToExternalEvents: vi.fn(
    (_ics: string, feed: CalendarFeed): ExternalEvent[] => [
      {
        id: `${feed.id}:evt`,
        feedId: feed.id,
        feedKind: "ics",
        providerEventId: "evt",
        title: "ok",
        start_date: "2026-06-07",
        end_date: null,
        start_time: null,
        end_time: null,
        location: null,
        url: null,
        notes: null,
        color: feed.color,
        source: "external",
      },
    ],
  ),
}));

import { useExternalEvents } from "../use-external-events";

describe("useExternalEvents circuit breaker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Every proxy call 502s — the dead-feed failure mode.
    fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => "Bad Gateway",
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function freshClient() {
    // gcTime:0 so an unmounted query is dropped immediately and the next
    // mount actually re-runs (we rely on the module-level breaker, not the
    // React Query cache, to carry state across mounts).
    return new QueryClient({
      defaultOptions: { queries: { gcTime: 0 } },
    });
  }

  function mountOnce() {
    const client = freshClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);
    return renderHook(() => useExternalEvents(), { wrapper });
  }

  it("trips after 3 failures: stops fetching and marks the feed stale; retry resets", async () => {
    // Mount 1 → attempt #1 (fails). retry:0 means exactly one fetch.
    let hook = mountOnce();
    await waitFor(() => expect(hook.result.current.errorsByFeedId.size).toBe(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.staleFeedIds.has(1)).toBe(false); // not tripped yet
    hook.unmount();

    // Mount 2 → attempt #2 (fails). Still under the threshold.
    hook = mountOnce();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(hook.result.current.staleFeedIds.has(1)).toBe(false);
    hook.unmount();

    // Mount 3 → attempt #3 (fails) → breaker trips.
    hook = mountOnce();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(hook.result.current.staleFeedIds.has(1)).toBe(true));
    hook.unmount();

    // Mount 4 → query is now disabled: NO further fetch, and the feed reports
    // stale immediately (this is the end of the console flood).
    hook = mountOnce();
    await waitFor(() => expect(hook.result.current.staleFeedIds.has(1)).toBe(true));
    // Give any stray fetch a tick to land, then assert the count is unchanged.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Retry resets the breaker and re-attempts → one more fetch, no longer stale.
    await hook.result.current.refetch();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(hook.result.current.staleFeedIds.has(1)).toBe(false);
    hook.unmount();
  });
});
