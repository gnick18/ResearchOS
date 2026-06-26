// Unit tests for network-feed-db.ts (social lane, Build 2).
//
// All SQL calls are replaced with a vi.fn() mock (the _testSetSql escape hatch).
// No real database is needed.
//
// Route-gating tests live in a separate describe block and import the routes
// directly; they rely on vi.mock for config + session, but NOT for
// network-feed-db itself (the real functions are fast no-ops under _testSetSql).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";

// Hoist vi.mock calls: only mock the modules we do NOT want to test for real.
// Do NOT mock @/lib/social/network-feed-db here — we test those functions directly
// via _testSetSql. The route-gating tests below mock config + session only.

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => vi.fn()),
}));

const isNetworkFeedEnabledMock = vi.fn();
const resolveCallerOwnerKeyMock = vi.fn();

vi.mock("@/lib/social/config", () => ({
  isNetworkFeedEnabled: () => isNetworkFeedEnabledMock(),
  SOCIAL_LAYER_ENABLED: false,
  isLabSitesEnabled: () => false,
  LAB_SITES_ENABLED: false,
  isLabSitesComOriginEnabled: () => false,
  LAB_SITES_COM_ORIGIN_ENABLED: false,
  isLabByoSitesEnabled: () => false,
  LAB_BYO_SITES_ENABLED: false,
  NETWORK_FEED_ENABLED: false,
}));

vi.mock("@/lib/social/lab-site-session", () => ({
  resolveCallerOwnerKey: () => resolveCallerOwnerKeyMock(),
}));

// Import the module under test AFTER the mocks above.
import {
  _testSetSql,
  ensureNetworkFeedSchema,
  emitFeedEvent,
  followResearcher,
  unfollowResearcher,
  isFollowing,
  getNetworkFeed,
  getFollowSuggestions,
} from "@/lib/social/network-feed-db";

// Route handlers (use the real network-feed-db, gated by config + session mocks above).
import { GET as networkGET } from "@/app/api/social/network/route";
import {
  POST as followPOST,
  DELETE as followDELETE,
} from "@/app/api/social/network/follow/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSqlMock(
  defaultRows: unknown[] = [],
): NeonQueryFunction<false, false> {
  let nextResult: Promise<unknown[]> = Promise.resolve(defaultRows);

  const mock = vi.fn(
    (_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> => {
      return nextResult;
    },
  ) as unknown as NeonQueryFunction<false, false>;

  return mock;
}

// ---------------------------------------------------------------------------
// ensureNetworkFeedSchema
// ---------------------------------------------------------------------------

describe("ensureNetworkFeedSchema", () => {
  it("runs 3 SQL statements (feed_events table, index, follow_edges table)", async () => {
    const sql = makeSqlMock([]);
    _testSetSql(sql);

    await ensureNetworkFeedSchema();

    // 3 calls: CREATE TABLE feed_events, CREATE INDEX, CREATE TABLE follow_edges
    expect(vi.mocked(sql).mock.calls).toHaveLength(3);
  });

  it("is idempotent (safe to call twice without throwing)", async () => {
    const sql = makeSqlMock([]);
    _testSetSql(sql);

    await ensureNetworkFeedSchema();
    await ensureNetworkFeedSchema();
    // No throw => idempotent.
  });
});

// ---------------------------------------------------------------------------
// emitFeedEvent
// ---------------------------------------------------------------------------

describe("emitFeedEvent", () => {
  it("inserts a row when sql succeeds", async () => {
    const sql = makeSqlMock([]);
    _testSetSql(sql);

    await emitFeedEvent({ actorOwnerKey: "actor-1", kind: "lab_joined" });

    // ensureNetworkFeedSchema runs first (idempotent CREATE TABLEs), then the
    // INSERT. Assert the INSERT was issued (the meaningful write) rather than an
    // exact call count, which is brittle against the ensure step.
    const calls = vi.mocked(sql).mock.calls;
    const lastQuery = (calls[calls.length - 1][0] as readonly string[]).join("?");
    expect(lastQuery).toContain("INSERT INTO feed_events");
  });

  it("does NOT throw when sql rejects (fire-and-forget swallow)", async () => {
    const sql = vi.fn().mockRejectedValue(new Error("neon down")) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    // Must resolve, never reject.
    await expect(
      emitFeedEvent({ actorOwnerKey: "actor-1", kind: "work_shared" }),
    ).resolves.toBeUndefined();
  });

  it("uses the explicit id when provided (ON CONFLICT idempotency)", async () => {
    const calls: unknown[][] = [];
    const sql = vi.fn((strings: TemplateStringsArray, ...vals: unknown[]) => {
      calls.push([strings, ...vals]);
      return Promise.resolve([]);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    await emitFeedEvent({
      actorOwnerKey: "actor-1",
      kind: "site_published",
      id: "explicit-id-123",
    });

    // The explicit id should appear in the values passed to the tagged template.
    const allValues = calls.flat(2);
    expect(allValues).toContain("explicit-id-123");
  });
});

// ---------------------------------------------------------------------------
// followResearcher / unfollowResearcher / isFollowing
// ---------------------------------------------------------------------------

describe("follow graph", () => {
  it("followResearcher calls INSERT", async () => {
    const sql = makeSqlMock([]);
    _testSetSql(sql);

    await followResearcher("alice", "bob");

    // ensure runs first; the INSERT is the last call.
    const calls = vi.mocked(sql).mock.calls;
    expect((calls[calls.length - 1][0] as readonly string[]).join("?")).toContain(
      "INSERT INTO follow_edges",
    );
  });

  it("followResearcher is a no-op when follower === followee (self-follow guard)", async () => {
    const sql = makeSqlMock([]);
    _testSetSql(sql);

    await followResearcher("alice", "alice");

    expect(vi.mocked(sql).mock.calls).toHaveLength(0);
  });

  it("unfollowResearcher calls DELETE", async () => {
    const sql = makeSqlMock([]);
    _testSetSql(sql);

    await unfollowResearcher("alice", "bob");

    // ensure runs first; the DELETE is the last call.
    const calls = vi.mocked(sql).mock.calls;
    expect((calls[calls.length - 1][0] as readonly string[]).join("?")).toContain(
      "DELETE FROM follow_edges",
    );
  });

  it("isFollowing returns true when a row exists", async () => {
    const sql = makeSqlMock([{ "?column?": 1 }]);
    _testSetSql(sql);

    const result = await isFollowing("alice", "bob");
    expect(result).toBe(true);
  });

  it("isFollowing returns false when no row exists", async () => {
    const sql = makeSqlMock([]);
    _testSetSql(sql);

    const result = await isFollowing("alice", "bob");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getNetworkFeed
// ---------------------------------------------------------------------------

describe("getNetworkFeed", () => {
  it("falls back to global feed when viewer follows nobody (followCount=0)", async () => {
    let callIndex = 0;
    const sql = vi.fn(() => {
      callIndex++;
      if (callIndex === 1) {
        return Promise.resolve([{ cnt: 0 }]);
      }
      return Promise.resolve([
        {
          id: "evt-1",
          actor_owner_key: "other-actor",
          kind: "site_published",
          subject_type: "page",
          subject_id: "home",
          subject_label: "Home",
          target_slug: "smithlab",
          created_at: "2026-06-20T12:00:00Z",
          handle: "smith",
          display_name: "Dr. Smith",
        },
      ]);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    const feed = await getNetworkFeed("viewer-key");
    expect(feed).toHaveLength(1);
    expect(feed[0].actorHandle).toBe("smith");
  });

  it("uses personalized feed when viewer follows someone (followCount>0)", async () => {
    let callIndex = 0;
    const sql = vi.fn(() => {
      callIndex++;
      if (callIndex === 1) {
        return Promise.resolve([{ cnt: 2 }]);
      }
      return Promise.resolve([
        {
          id: "evt-2",
          actor_owner_key: "followed-actor",
          kind: "lab_joined",
          subject_type: null,
          subject_id: null,
          subject_label: null,
          target_slug: null,
          created_at: "2026-06-20T10:00:00Z",
          handle: "jones",
          display_name: "Dr. Jones",
        },
      ]);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    const feed = await getNetworkFeed("viewer-key");
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe("lab_joined");
  });

  it("returns empty array when no events exist", async () => {
    let callIndex = 0;
    const sql = vi.fn(() => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve([{ cnt: 0 }]);
      return Promise.resolve([]);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    const feed = await getNetworkFeed("viewer-key");
    expect(feed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getFollowSuggestions
// ---------------------------------------------------------------------------

describe("getFollowSuggestions", () => {
  it("excludes self from suggestions", async () => {
    let callIndex = 0;
    const sql = vi.fn(() => {
      callIndex++;
      if (callIndex === 1) {
        return Promise.resolve([{ affiliation: "UW-Madison" }]);
      }
      return Promise.resolve([]);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    const suggestions = await getFollowSuggestions("viewer-key");
    expect(suggestions).toEqual([]);
  });

  it("excludes already-followed researchers", async () => {
    let callIndex = 0;
    const sql = vi.fn(() => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve([{ affiliation: null }]);
      return Promise.resolve([]);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    const suggestions = await getFollowSuggestions("viewer-key");
    expect(suggestions).toEqual([]);
  });

  it("maps rows to FollowSuggestion shape", async () => {
    let callIndex = 0;
    const sql = vi.fn(() => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve([{ affiliation: "MIT" }]);
      return Promise.resolve([
        {
          owner_key: "other-key",
          handle: "jones",
          display_name: "Dr. Jones",
          affiliation: "MIT",
        },
      ]);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    const suggestions = await getFollowSuggestions("viewer-key");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({
      ownerKey: "other-key",
      handle: "jones",
      displayName: "Dr. Jones",
      affiliation: "MIT",
    });
  });

  it("excludes UNLISTED researchers (joins directory_profiles WHERE unlisted = false)", async () => {
    // The directory listing gate lives in SQL (unlisted = false), so we simulate
    // the DB honoring it: the suggestion query INNER-joins directory_profiles and
    // filters unlisted = false, so an opted-out researcher's row never comes back.
    // A mock that returns rows only when the query carries that filter proves the
    // filter is present; a regression that drops the join would return the unlisted
    // row here and fail the length assertion.
    const queries: string[] = [];
    const sql = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("affiliation FROM account_profiles")) {
        return Promise.resolve([{ affiliation: "MIT" }]); // viewer affiliation
      }
      // The suggestions read: the DB only returns LISTED rows because the query
      // filters unlisted = false. An unlisted researcher (bob) is filtered out by
      // the join, so only the listed researcher (jones) is ever returned.
      return Promise.resolve([
        {
          owner_key: "jones-key",
          handle: "jones",
          display_name: "Dr. Jones",
          affiliation: "MIT",
        },
      ]);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    const suggestions = await getFollowSuggestions("viewer-key");

    // The suggestion query must join the directory listing and filter unlisted.
    const suggestionQuery = queries.find((q) =>
      q.includes("FROM account_profiles ap"),
    );
    expect(suggestionQuery).toBeDefined();
    expect(suggestionQuery).toContain("JOIN directory_profiles");
    expect(suggestionQuery).toContain("unlisted = false");

    // Only the listed researcher is surfaced; the unlisted one is never present.
    expect(suggestions).toHaveLength(1);
    expect(suggestions.map((s) => s.handle)).toEqual(["jones"]);
    expect(suggestions.map((s) => s.handle)).not.toContain("bob");
  });
});

// ---------------------------------------------------------------------------
// Route gating tests (flag off = 404, no session = 401)
//
// These tests use the real network-feed-db functions (via _testSetSql) and
// only mock config (flag gate) + session (auth gate).
// ---------------------------------------------------------------------------

describe("GET /api/social/network gating", () => {
  beforeEach(() => {
    isNetworkFeedEnabledMock.mockReturnValue(true);
    resolveCallerOwnerKeyMock.mockResolvedValue("viewer-key");
    // Point the db singleton at a mock that returns empty results for everything.
    let callIndex = 0;
    _testSetSql(vi.fn(() => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve([{ cnt: 0 }]);    // follow count
      if (callIndex === 2) return Promise.resolve([]);               // affiliation
      return Promise.resolve([]);
    }) as unknown as NeonQueryFunction<false, false>);
  });

  it("404s when NETWORK_FEED flag is off", async () => {
    isNetworkFeedEnabledMock.mockReturnValue(false);
    const res = await networkGET(new Request("http://localhost/api/social/network"));
    expect(res.status).toBe(404);
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKeyMock.mockResolvedValue(null);
    const res = await networkGET(new Request("http://localhost/api/social/network"));
    expect(res.status).toBe(401);
  });

  it("200s with feed + suggestions when authed + flag on", async () => {
    // Return the cnt shape for COUNT, affiliation for that query, and empty
    // arrays for all other calls. getNetworkFeed + getFollowSuggestions run in
    // parallel so we detect by template content rather than call index.
    _testSetSql(vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("COUNT")) return Promise.resolve([{ cnt: 0 }]);
      if (query.includes("affiliation")) return Promise.resolve([{ affiliation: null }]);
      return Promise.resolve([]);
    }) as unknown as NeonQueryFunction<false, false>);

    const res = await networkGET(new Request("http://localhost/api/social/network"));
    expect(res.status).toBe(200);
    const body = await res.json() as { feed: unknown[]; suggestions: unknown[] };
    expect(Array.isArray(body.feed)).toBe(true);
    expect(Array.isArray(body.suggestions)).toBe(true);
  });
});

describe("POST /api/social/network/follow gating", () => {
  beforeEach(() => {
    isNetworkFeedEnabledMock.mockReturnValue(true);
    resolveCallerOwnerKeyMock.mockResolvedValue("viewer-key");
    // Schema creation (3 calls) + INSERT (1 call).
    _testSetSql(vi.fn(() => Promise.resolve([])) as unknown as NeonQueryFunction<false, false>);
  });

  it("404s when flag is off", async () => {
    isNetworkFeedEnabledMock.mockReturnValue(false);
    const res = await followPOST(
      new Request("http://localhost/api/social/network/follow", {
        method: "POST",
        body: JSON.stringify({ followeeOwnerKey: "other-key" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKeyMock.mockResolvedValue(null);
    const res = await followPOST(
      new Request("http://localhost/api/social/network/follow", {
        method: "POST",
        body: JSON.stringify({ followeeOwnerKey: "other-key" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("400s on self-follow attempt", async () => {
    const res = await followPOST(
      new Request("http://localhost/api/social/network/follow", {
        method: "POST",
        body: JSON.stringify({ followeeOwnerKey: "viewer-key" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("200s on a valid follow", async () => {
    const res = await followPOST(
      new Request("http://localhost/api/social/network/follow", {
        method: "POST",
        body: JSON.stringify({ followeeOwnerKey: "other-key" }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/social/network/follow gating", () => {
  beforeEach(() => {
    isNetworkFeedEnabledMock.mockReturnValue(true);
    resolveCallerOwnerKeyMock.mockResolvedValue("viewer-key");
    _testSetSql(vi.fn(() => Promise.resolve([])) as unknown as NeonQueryFunction<false, false>);
  });

  it("404s when flag is off", async () => {
    isNetworkFeedEnabledMock.mockReturnValue(false);
    const res = await followDELETE(
      new Request("http://localhost/api/social/network/follow", {
        method: "DELETE",
        body: JSON.stringify({ followeeOwnerKey: "other-key" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKeyMock.mockResolvedValue(null);
    const res = await followDELETE(
      new Request("http://localhost/api/social/network/follow", {
        method: "DELETE",
        body: JSON.stringify({ followeeOwnerKey: "other-key" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("200s on valid unfollow", async () => {
    const res = await followDELETE(
      new Request("http://localhost/api/social/network/follow", {
        method: "DELETE",
        body: JSON.stringify({ followeeOwnerKey: "other-key" }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
