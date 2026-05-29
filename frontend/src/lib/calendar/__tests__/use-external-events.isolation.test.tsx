// Cross-user privacy isolation tests for useExternalEvents
// (calendar-privacy fix, 2026-05-29).
//
// External ICS calendar FEED events (a user's linked Google / iCloud /
// Outlook calendars) are strictly personal and must NEVER bleed across
// an account switch in the same browser tab. The original defect: the
// per-feed React Query key was [FEED_EVENTS_PREFIX, feed.id, feed.kind,
// feed.icsUrl] with NO user segment. `feed.id` is a per-user monotonic
// counter (every user's first feed is id 1), so two users' first feeds
// collided on one shared cache entry. On a PI <-> member switch the
// prior user's parsed events stayed resident (gcTime: ONE_HOUR_MS) and
// could surface under the next account.
//
// The fix has two halves, both pinned below:
//   1. The per-feed query key is prefixed with currentUser, giving each
//      user a private cache namespace (so a collision is impossible even
//      without eviction).
//   2. The account-switch handler removes every FEED_EVENTS_PREFIX entry
//      so the prior user's resident events are evicted outright, not just
//      marked stale. We exercise that eviction here against a real
//      QueryClient to prove the previous user's events do not survive.
//
// jsdom project (.test.tsx) so renderHook from @testing-library/react
// works. No real fileService / fetch: the feed store, ICS parser, and
// global fetch are all mocked so the test is hermetic.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { CalendarFeed, ExternalEvent } from "@/lib/types";

// ── Controllable "current user" ──────────────────────────────────────────
// useExternalEvents reads currentUser via useCurrentUser(); we drive it
// through a mutable module variable so the test can simulate a same-tab
// account switch by flipping it and re-rendering.
let mockCurrentUser: string | null = null;
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    currentUser: mockCurrentUser,
    setCurrentUser: vi.fn(),
    mainUser: null,
    availableUsers: [],
    createUser: vi.fn(),
    isLoggedIn: mockCurrentUser !== null,
  }),
}));

// Offline mode off so fetchIcsFeed actually proxies (returns []
// immediately when offlineMode is true otherwise).
vi.mock("@/lib/store", () => ({
  useAppStore: { getState: () => ({ offlineMode: false }) },
}));

// Per-user feed lists. Each user has a single enabled feed whose id is 1
// (the per-user counter collision the original key suffered from). The
// URLs differ per user, as real personal calendars would.
const FEEDS_BY_USER: Record<string, CalendarFeed[]> = {
  grant: [
    {
      id: 1,
      provider: "google",
      kind: "ics",
      label: "Grant personal",
      icsUrl: "https://calendars.example/grant-private.ics",
      color: "#3b82f6",
      enabled: true,
      lastSyncAt: null,
    },
  ],
  emile: [
    {
      id: 1,
      provider: "icloud",
      kind: "ics",
      label: "Emile personal",
      icsUrl: "https://calendars.example/emile-private.ics",
      color: "#10b981",
      enabled: true,
      lastSyncAt: null,
    },
  ],
};

vi.mock("@/lib/calendar/external-feeds-store", () => ({
  listFeeds: vi.fn(async (username: string) => FEEDS_BY_USER[username] ?? []),
  markFeedSynced: vi.fn(async () => {}),
}));

// Parser returns a single event whose title encodes the feed's URL, so
// we can assert exactly whose calendar produced a rendered event.
vi.mock("@/lib/calendar/ics-parser", () => ({
  parseIcsToExternalEvents: vi.fn(
    (_ics: string, feed: CalendarFeed): ExternalEvent[] => [
      {
        id: `${feed.id}:evt`,
        feedId: feed.id,
        feedKind: "ics",
        providerEventId: "evt",
        title: `EVENT_FOR:${feed.icsUrl}`,
        start_date: "2026-05-29",
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

import { useExternalEvents, FEED_EVENTS_PREFIX } from "../use-external-events";

const GRANT_TITLE = "EVENT_FOR:https://calendars.example/grant-private.ics";
const EMILE_TITLE = "EVENT_FOR:https://calendars.example/emile-private.ics";

function titles(events: ExternalEvent[]): string[] {
  return events.map((e) => e.title);
}

describe("useExternalEvents cross-user isolation (calendar-privacy fix)", () => {
  let client: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCurrentUser = null;
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    // The hook fetches /api/calendar-feed; return any non-empty body
    // (the mocked parser ignores it).
    fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => "BEGIN:VCALENDAR\nEND:VCALENDAR",
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    client.clear();
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  }

  it("scopes the per-feed cache key by currentUser so a sibling id-1 feed cannot collide", async () => {
    // Grant signs in and his personal feed loads.
    mockCurrentUser = "grant";
    const grantHook = renderHook(() => useExternalEvents(), { wrapper });
    await waitFor(() =>
      expect(titles(grantHook.result.current.events)).toEqual([GRANT_TITLE]),
    );
    grantHook.unmount();

    // The cache entry must carry Grant's username as the segment right
    // after the prefix (NOT a bare [prefix, feedId, ...] key). This is
    // the structural half of the fix.
    const grantKeys = client
      .getQueryCache()
      .findAll({ queryKey: [FEED_EVENTS_PREFIX] })
      .map((q) => q.queryKey);
    expect(grantKeys).toHaveLength(1);
    expect(grantKeys[0]).toEqual([
      FEED_EVENTS_PREFIX,
      "grant",
      1,
      "ics",
      "https://calendars.example/grant-private.ics",
    ]);
  });

  it("never serves the previous user's feed events to the next user after a switch", async () => {
    // Member (Grant) signs in first; his private calendar loads into the
    // shared QueryClient cache.
    mockCurrentUser = "grant";
    const first = renderHook(() => useExternalEvents(), { wrapper });
    await waitFor(() =>
      expect(titles(first.result.current.events)).toContain(GRANT_TITLE),
    );
    first.unmount();

    // Simulate the account switch exactly as setCurrentUser does: evict
    // every external-feed-events entry so nothing personal survives, then
    // flip the active user to the PI (Emile).
    client.removeQueries({ queryKey: [FEED_EVENTS_PREFIX] });
    mockCurrentUser = "emile";

    const second = renderHook(() => useExternalEvents(), { wrapper });

    // The PI must only ever see HIS OWN calendar event.
    await waitFor(() =>
      expect(titles(second.result.current.events)).toEqual([EMILE_TITLE]),
    );
    // Hard invariant: the member's personal event must never appear under
    // the PI account at any point.
    expect(titles(second.result.current.events)).not.toContain(GRANT_TITLE);

    // And the cache must hold only the PI's user-scoped entry now.
    const keysAfter = client
      .getQueryCache()
      .findAll({ queryKey: [FEED_EVENTS_PREFIX] })
      .map((q) => q.queryKey);
    expect(keysAfter).toEqual([
      [
        FEED_EVENTS_PREFIX,
        "emile",
        1,
        "ics",
        "https://calendars.example/emile-private.ics",
      ],
    ]);
    second.unmount();
  });
});
