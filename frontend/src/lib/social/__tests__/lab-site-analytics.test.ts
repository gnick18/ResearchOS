// Unit tests for lab-site-analytics.ts.
//
// The sql layer is mocked via _testSetSql so no database connection is needed.
// Tests cover: ensureLabSiteViewsSchema idempotency, bumpLabSiteView UPSERT
// +1 conflict path, bumpLabSiteView error swallowing, and getLabSiteViews
// result shaping.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";

// Pull in the module under test AFTER setting up the sql mock below.
// The _testSetSql call must happen before any function that calls getSql().
import {
  _testSetSql,
  ensureLabSiteViewsSchema,
  bumpLabSiteView,
  getLabSiteViews,
} from "@/lib/social/lab-site-analytics";

// ---------------------------------------------------------------------------
// Mock sql helper
// ---------------------------------------------------------------------------

// The neon sql function is a tagged-template-literal callable. We model it as
// a plain vitest mock and cast through unknown so _testSetSql accepts it.
// The `.mock.calls` vitest accessor is then used directly on the mock.
type SqlMock = Mock & NeonQueryFunction<false, false>;

/**
 * Creates a vitest mock that acts as a tagged-template-literal sql function.
 * The mock is callable as sql`...` (the neon driver passes (strings, ...values)
 * to the function) and returns the configured resolved value.
 */
function makeSqlMock(resolvedWith: unknown[] = []): SqlMock {
  return vi.fn().mockResolvedValue(resolvedWith) as unknown as SqlMock;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts the first positional SQL string from a mock call. */
function sqlText(mock: SqlMock, callIndex = 0): string {
  const args = mock.mock.calls[callIndex];
  // Tagged template: first arg is a TemplateStringsArray (array of string parts).
  const strings = args[0] as TemplateStringsArray;
  return strings.join("?").trim();
}

// ---------------------------------------------------------------------------
// ensureLabSiteViewsSchema
// ---------------------------------------------------------------------------

describe("ensureLabSiteViewsSchema", () => {
  let sql: SqlMock;

  beforeEach(() => {
    sql = makeSqlMock([]);
    _testSetSql(sql);
  });

  afterEach(() => {
    _testSetSql(null);
    vi.clearAllMocks();
  });

  it("issues a CREATE TABLE IF NOT EXISTS for lab_site_views", async () => {
    await ensureLabSiteViewsSchema();
    expect(sql).toHaveBeenCalledTimes(1);
    const text = sqlText(sql);
    expect(text).toContain("CREATE TABLE IF NOT EXISTS lab_site_views");
  });

  it("schema includes the required columns", async () => {
    await ensureLabSiteViewsSchema();
    const text = sqlText(sql);
    expect(text).toContain("lab_owner_key");
    expect(text).toContain("site_key");
    expect(text).toContain("day");
    expect(text).toContain("views");
    expect(text).toContain("BIGINT");
    expect(text).toContain("PRIMARY KEY");
  });

  it("is idempotent (IF NOT EXISTS means calling it twice issues two identical CREATE statements without error)", async () => {
    await ensureLabSiteViewsSchema();
    await ensureLabSiteViewsSchema();
    expect(sql).toHaveBeenCalledTimes(2);
    // Both calls issue the same CREATE TABLE IF NOT EXISTS, so the second is a
    // no-op from the DB's perspective (the mock always resolves without error).
    expect(sqlText(sql, 0)).toBe(sqlText(sql, 1));
  });
});

// ---------------------------------------------------------------------------
// bumpLabSiteView -- happy path (UPSERT +1)
// ---------------------------------------------------------------------------

describe("bumpLabSiteView (UPSERT increment)", () => {
  let sql: SqlMock;

  beforeEach(() => {
    sql = makeSqlMock([]);
    _testSetSql(sql);
  });

  afterEach(() => {
    _testSetSql(null);
    vi.clearAllMocks();
  });

  it("issues an INSERT ... ON CONFLICT DO UPDATE SET views = views + 1", async () => {
    await bumpLabSiteView("owner-abc", "home");
    // Two calls now: the ensureLabSiteViewsSchema CREATE (call 0) then the INSERT
    // (call 1). The ensure guards against 42P01 on a fresh database.
    expect(sql).toHaveBeenCalledTimes(2);
    const text = sqlText(sql, 1);
    expect(text).toContain("INSERT INTO lab_site_views");
    expect(text).toContain("ON CONFLICT");
    expect(text).toContain("DO UPDATE SET views = lab_site_views.views + 1");
  });

  it("passes labOwnerKey and siteKey as template values", async () => {
    await bumpLabSiteView("owner-xyz", "people");
    // calls[0] is the ensure CREATE; the INSERT (with the values) is calls[1].
    const args = sql.mock.calls[1];
    // Template values are the rest args after the TemplateStringsArray.
    const values = args.slice(1);
    expect(values).toContain("owner-xyz");
    expect(values).toContain("people");
  });

  it("includes CURRENT_DATE in the query", async () => {
    await bumpLabSiteView("owner-abc", "byo");
    // calls[0] is the ensure CREATE; the INSERT (with CURRENT_DATE) is calls[1].
    const text = sqlText(sql, 1);
    expect(text).toContain("CURRENT_DATE");
  });
});

// ---------------------------------------------------------------------------
// bumpLabSiteView -- error swallowing (fire-and-forget safety)
// ---------------------------------------------------------------------------

describe("bumpLabSiteView (error swallowing)", () => {
  afterEach(() => {
    _testSetSql(null);
    vi.clearAllMocks();
  });

  it("does NOT reject when the sql call throws (swallows the error)", async () => {
    const throwingSql = vi
      .fn()
      .mockRejectedValue(new Error("neon down")) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(throwingSql);

    // Must resolve (not reject) even though the underlying sql threw.
    await expect(bumpLabSiteView("owner-abc", "home")).resolves.toBeUndefined();
  });

  it("emits a console.warn on sql failure (visible in server logs)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingSql = vi
      .fn()
      .mockRejectedValue(new Error("neon timeout")) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(throwingSql);

    await bumpLabSiteView("owner-abc", "papers/2024");

    expect(warnSpy).toHaveBeenCalledOnce();
    const [msg] = warnSpy.mock.calls[0] as [string, ...unknown[]];
    expect(msg).toContain("bumpLabSiteView failed");
    warnSpy.mockRestore();
  });

  it("does NOT reject when DATABASE_URL is missing (getSql throws)", async () => {
    // Reset to null so getSql() tries to construct the singleton and finds no URL.
    _testSetSql(null);
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    await expect(bumpLabSiteView("owner-abc", "home")).resolves.toBeUndefined();

    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
  });
});

// ---------------------------------------------------------------------------
// getLabSiteViews -- result shaping
// ---------------------------------------------------------------------------

describe("getLabSiteViews (result shaping)", () => {
  afterEach(() => {
    _testSetSql(null);
    vi.clearAllMocks();
  });

  it("shapes bySite + daily + total from query rows", async () => {
    const bySiteRows = [
      { site_key: "home", views: "42" },
      { site_key: "people", views: "8" },
    ];
    const dailyRows = [
      { day: "2026-06-19", views: "15" },
      { day: "2026-06-20", views: "35" },
    ];
    // call 1 = ensureLabSiteViewsSchema CREATE, call 2 = bySite query, call 3 =
    // daily query (the ensure runs before the Promise.all).
    let callCount = 0;
    const sql = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([]);
      if (callCount === 2) return Promise.resolve(bySiteRows);
      return Promise.resolve(dailyRows);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    const result = await getLabSiteViews("owner-abc", 30);

    expect(result.total).toBe(50);
    expect(result.bySite).toEqual([
      { siteKey: "home", views: 42 },
      { siteKey: "people", views: 8 },
    ]);
    expect(result.daily).toEqual([
      { day: "2026-06-19", views: 15 },
      { day: "2026-06-20", views: 35 },
    ]);
  });

  it("returns zero totals and empty arrays when no rows exist", async () => {
    const sql = makeSqlMock([]);
    _testSetSql(sql);

    const result = await getLabSiteViews("owner-no-views");

    expect(result.total).toBe(0);
    expect(result.bySite).toEqual([]);
    expect(result.daily).toEqual([]);
  });

  it("clamps sinceDays to [1, 365] (values outside the range are clamped)", async () => {
    // Use a mock that captures calls so we can inspect the interpolated day value.
    let capturedValues: unknown[] = [];
    const sql = vi.fn().mockImplementation((_strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedValues = values;
      return Promise.resolve([]);
    }) as unknown as NeonQueryFunction<false, false>;
    _testSetSql(sql);

    // 0 should clamp to 1.
    await getLabSiteViews("owner-abc", 0);
    expect(capturedValues).toContain(1);

    // 9999 should clamp to 365.
    capturedValues = [];
    await getLabSiteViews("owner-abc", 9999);
    expect(capturedValues).toContain(365);
  });

  it("issues two parallel queries (bySite + daily)", async () => {
    const sql = makeSqlMock([]);
    _testSetSql(sql);

    await getLabSiteViews("owner-abc");

    // Three calls now: the ensureLabSiteViewsSchema CREATE then the two parallel
    // (bySite + daily) reads.
    expect(sql).toHaveBeenCalledTimes(3);
  });
});
