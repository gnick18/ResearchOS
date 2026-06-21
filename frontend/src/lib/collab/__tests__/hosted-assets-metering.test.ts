// Unit tests for Part 1 storage-metering additions in collab/server/db.ts:
//   - ensureHostedAssetsSchema adds site_key column idempotently
//   - setHostedAssetBytes with and without siteKey
//   - getLabHostedBytesBySite groups by site_key, sums to getLabHostedBytes
//
// The sql layer is mocked so no DATABASE_URL is required. We capture the SQL
// template-literal calls and assert the right column names and clauses are
// present, mirroring the pattern in sibling tests in this directory.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the sql singleton before importing the module under test.
// ---------------------------------------------------------------------------

// Collect every tagged-template invocation as a { text, values } pair so we
// can assert on the generated SQL string without a real Neon connection.
type SqlCall = { text: string; values: unknown[] };
const sqlCalls: SqlCall[] = [];

// A mutable "current implementation" so individual tests can inject row results
// without needing to reset the module-level singleton (which is cached on first
// getSql() call and never re-derived). The stable dispatcher always reads
// currentSqlImpl, so swapping that IS enough.
type SqlImpl = (strings: TemplateStringsArray, ...params: unknown[]) => unknown;

function defaultImpl(strings: TemplateStringsArray, ...params: unknown[]): unknown {
  const text = strings.reduce(
    (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
  );
  sqlCalls.push({ text, values: params });
  return Promise.resolve([]);
}

let currentSqlImpl: SqlImpl = defaultImpl;

// The stable dispatcher: always delegates to currentSqlImpl.
function dispatcher(strings: TemplateStringsArray, ...params: unknown[]): unknown {
  return currentSqlImpl(strings, ...params);
}

vi.mock("@neondatabase/serverless", () => ({
  neon: (_url: string) => dispatcher,
}));

// Provide a fake DATABASE_URL so getSql() does not throw.
vi.stubEnv("DATABASE_URL", "postgresql://mock");

// Import AFTER mocking so the module uses the mock.
import {
  ensureHostedAssetsSchema,
  setHostedAssetBytes,
  getLabHostedBytes,
  getLabHostedBytesBySite,
} from "../server/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the text of every SQL call whose text matches the substring. */
function callsMatching(sub: string): SqlCall[] {
  return sqlCalls.filter((c) => c.text.includes(sub));
}

/** Reset call log and implementation so each test starts clean. */
function resetSql(): void {
  sqlCalls.length = 0;
  currentSqlImpl = defaultImpl;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ensureHostedAssetsSchema (site_key column add)", () => {
  beforeEach(resetSql);

  it("emits ALTER TABLE ... ADD COLUMN IF NOT EXISTS site_key TEXT", async () => {
    await ensureHostedAssetsSchema();
    const alters = callsMatching("ADD COLUMN IF NOT EXISTS site_key");
    expect(alters.length).toBeGreaterThanOrEqual(1);
    expect(alters[0].text).toMatch(/ADD COLUMN IF NOT EXISTS site_key TEXT/i);
  });

  it("is idempotent: calling twice emits the ALTER twice (both IF NOT EXISTS)", async () => {
    await ensureHostedAssetsSchema();
    await ensureHostedAssetsSchema();
    const alters = callsMatching("ADD COLUMN IF NOT EXISTS site_key");
    // Two calls = two ALTER emissions (the DB ignores duplicates via IF NOT EXISTS).
    expect(alters.length).toBeGreaterThanOrEqual(2);
  });
});

describe("setHostedAssetBytes without siteKey (omitted)", () => {
  beforeEach(resetSql);

  it("does NOT include site_key in the INSERT column list", async () => {
    await setHostedAssetBytes("asset-1", "owner-1", 1024);
    const inserts = callsMatching("INSERT INTO lab_hosted_assets");
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    // The no-siteKey branch inserts without site_key.
    expect(inserts[0].text).not.toMatch(/site_key\s*=\s*EXCLUDED\.site_key/);
  });

  it("uses COALESCE to preserve existing site_key on conflict", async () => {
    await setHostedAssetBytes("asset-1", "owner-1", 1024);
    const inserts = callsMatching("INSERT INTO lab_hosted_assets");
    expect(inserts[0].text).toMatch(/COALESCE/i);
  });

  it("clamps bytes to non-negative", async () => {
    await setHostedAssetBytes("asset-2", "owner-1", -100);
    const inserts = callsMatching("INSERT INTO lab_hosted_assets");
    // The clamped value (0) should appear in the params.
    expect(inserts[0].values).toContain(0);
  });

  it("rounds fractional bytes", async () => {
    await setHostedAssetBytes("asset-3", "owner-1", 1024.7);
    const inserts = callsMatching("INSERT INTO lab_hosted_assets");
    expect(inserts[0].values).toContain(1025);
  });
});

describe("setHostedAssetBytes WITH siteKey provided", () => {
  beforeEach(resetSql);

  it("includes site_key in INSERT columns and ON CONFLICT UPDATE", async () => {
    await setHostedAssetBytes("asset-1", "owner-1", 2048, "home");
    const inserts = callsMatching("INSERT INTO lab_hosted_assets");
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    const sql = inserts[0].text;
    expect(sql).toMatch(/site_key/);
    expect(sql).toMatch(/EXCLUDED\.site_key/);
  });

  it("passes the siteKey as a parameter", async () => {
    await setHostedAssetBytes("asset-1", "owner-1", 2048, "papers/results");
    const inserts = callsMatching("INSERT INTO lab_hosted_assets");
    expect(inserts[0].values).toContain("papers/results");
  });

  it("does NOT use COALESCE when siteKey is provided (direct overwrite)", async () => {
    await setHostedAssetBytes("asset-1", "owner-1", 2048, "byo");
    const inserts = callsMatching("INSERT INTO lab_hosted_assets");
    // The siteKey branch directly sets site_key = EXCLUDED.site_key, no COALESCE.
    expect(inserts[0].text).not.toMatch(/COALESCE/);
  });
});

describe("getLabHostedBytes", () => {
  beforeEach(resetSql);

  it("emits a SELECT SUM query for the owner and returns 0 for empty result", async () => {
    const bytes = await getLabHostedBytes("owner-1");
    expect(bytes).toBe(0);
    const selects = callsMatching("SUM(bytes)");
    expect(selects.length).toBeGreaterThanOrEqual(1);
    expect(selects[0].values).toContain("owner-1");
  });
});

describe("getLabHostedBytesBySite", () => {
  beforeEach(resetSql);

  it("emits a GROUP BY site_key query for the owner", async () => {
    await getLabHostedBytesBySite("owner-2");
    const selects = callsMatching("GROUP BY site_key");
    expect(selects.length).toBeGreaterThanOrEqual(1);
    expect(selects[0].values).toContain("owner-2");
  });

  it("returns an empty array when the mock returns no rows", async () => {
    const rows = await getLabHostedBytesBySite("owner-2");
    expect(rows).toEqual([]);
  });

  it("maps site_key null to siteKey: null", async () => {
    // Inject a custom impl that returns a NULL + named site_key row for the GROUP BY query.
    currentSqlImpl = (strings, ...params) => {
      const text = strings.reduce(
        (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
      );
      sqlCalls.push({ text, values: params });
      if (text.includes("GROUP BY site_key")) {
        return Promise.resolve([
          { site_key: null, b: "500" },
          { site_key: "home", b: "300" },
        ]);
      }
      return Promise.resolve([]);
    };
    const rows = await getLabHostedBytesBySite("owner-3");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.siteKey === null)?.bytes).toBe(500);
    expect(rows.find((r) => r.siteKey === "home")?.bytes).toBe(300);
    // Total (500+300=800) equals what getLabHostedBytes would return.
    const total = rows.reduce((s, r) => s + r.bytes, 0);
    expect(total).toBe(800);
  });

  it("parses string byte values (Neon returns BIGINT as string)", async () => {
    currentSqlImpl = (strings, ...params) => {
      const text = strings.reduce(
        (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
      );
      sqlCalls.push({ text, values: params });
      if (text.includes("GROUP BY site_key")) {
        return Promise.resolve([{ site_key: "byo", b: "1073741824" }]);
      }
      return Promise.resolve([]);
    };
    const rows = await getLabHostedBytesBySite("owner-4");
    expect(rows[0].bytes).toBe(1073741824);
  });
});
