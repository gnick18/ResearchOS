// Unit tests for lab-site-editors-db.ts.
//
// All DB calls are intercepted by mocking the @neondatabase/serverless module so
// that no real Neon connection is needed. The mock sql tagged-template captures
// the raw SQL string and returns whatever the test configures via mockReturnValue.
//
// Pattern follows the repo's other DB-module tests (grants/route.test.ts, etc.):
// vi.mock the Neon module before the module under test is imported, then import
// the module via a dynamic import inside the test (so vi.mock hoisting wins).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared sql mock
// ---------------------------------------------------------------------------

const sqlMock = vi.fn();

// The tagged-template call `sql\`...\`` is compiled to sql(strings, ...values).
// We capture it as a plain function so we can inspect calls and configure
// return values with mockResolvedValue / mockResolvedValueOnce.
vi.mock("@neondatabase/serverless", () => ({
  neon: () => sqlMock,
}));

// DATABASE_URL must be present for getSql() to not throw. The value is fake
// because neon() is mocked and never actually opens a connection.
process.env.DATABASE_URL = "postgresql://mock/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER = "owner-key-pi";
const MEMBER = "member-key-grad";
const GRANTED_BY = OWNER;
const PATH = "";

function editorRow(overrides: Partial<{
  lab_owner_key: string;
  path: string;
  member_key: string;
  granted_by: string;
  granted_at: string;
}> = {}) {
  return {
    lab_owner_key: OWNER,
    path: PATH,
    member_key: MEMBER,
    granted_by: GRANTED_BY,
    granted_at: "2026-06-20T12:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Module under test (loaded fresh per-describe so mocks stay clean)
// ---------------------------------------------------------------------------

async function loadModule() {
  vi.resetModules();
  // Re-inject the mock after resetModules because the singleton is cleared too.
  sqlMock.mockReset();
  // ensureEditorsSchema calls sql once (CREATE TABLE) + once (CREATE INDEX).
  // Default: make schema calls succeed so they do not interfere with the target
  // assertion. Tests that need to control schema behavior override the first call.
  sqlMock.mockResolvedValue([]);
  return await import("@/lib/social/lab-site-editors-db");
}

// ---------------------------------------------------------------------------
// ensureEditorsSchema
// ---------------------------------------------------------------------------

describe("ensureEditorsSchema", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues CREATE TABLE and CREATE INDEX statements", async () => {
    vi.resetModules();
    const mod = await import("@/lib/social/lab-site-editors-db");
    await mod.ensureEditorsSchema();
    // Two sql calls: CREATE TABLE + CREATE INDEX.
    expect(sqlMock).toHaveBeenCalledTimes(2);
    const firstCall = sqlMock.mock.calls[0][0] as TemplateStringsArray;
    expect(firstCall[0]).toContain("CREATE TABLE IF NOT EXISTS lab_site_editors");
    const secondCall = sqlMock.mock.calls[1][0] as TemplateStringsArray;
    expect(secondCall[0]).toContain("CREATE INDEX IF NOT EXISTS");
  });
});

// ---------------------------------------------------------------------------
// grantSiteEditor
// ---------------------------------------------------------------------------

describe("grantSiteEditor", () => {
  it("calls INSERT ... ON CONFLICT for a valid grant", async () => {
    const mod = await loadModule();
    await mod.grantSiteEditor(OWNER, PATH, MEMBER, GRANTED_BY);
    // schema (2) + insert (1) = 3 calls
    expect(sqlMock).toHaveBeenCalledTimes(3);
    const insertCall = sqlMock.mock.calls[2][0] as TemplateStringsArray;
    // The tagged-template splits at interpolations; check across all parts.
    const insertSql = Array.from(insertCall).join("");
    expect(insertSql).toContain("INSERT INTO lab_site_editors");
    expect(insertSql).toContain("ON CONFLICT");
  });

  it("is a no-op when labOwnerKey is empty", async () => {
    const mod = await loadModule();
    await mod.grantSiteEditor("", PATH, MEMBER, GRANTED_BY);
    // No sql calls at all (guard returns early before ensureEditorsSchema).
    expect(sqlMock).toHaveBeenCalledTimes(0);
  });

  it("is a no-op when memberKey is empty", async () => {
    const mod = await loadModule();
    await mod.grantSiteEditor(OWNER, PATH, "", GRANTED_BY);
    expect(sqlMock).toHaveBeenCalledTimes(0);
  });

  it("is a no-op when grantedBy is empty", async () => {
    const mod = await loadModule();
    await mod.grantSiteEditor(OWNER, PATH, MEMBER, "");
    expect(sqlMock).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// revokeSiteEditor
// ---------------------------------------------------------------------------

describe("revokeSiteEditor", () => {
  it("calls DELETE for a valid revoke", async () => {
    const mod = await loadModule();
    await mod.revokeSiteEditor(OWNER, PATH, MEMBER);
    // schema (2) + delete (1) = 3 calls
    expect(sqlMock).toHaveBeenCalledTimes(3);
    const deleteCall = sqlMock.mock.calls[2][0] as TemplateStringsArray;
    expect(deleteCall[0]).toContain("DELETE FROM lab_site_editors");
  });

  it("is a no-op when labOwnerKey is empty", async () => {
    const mod = await loadModule();
    await mod.revokeSiteEditor("", PATH, MEMBER);
    expect(sqlMock).toHaveBeenCalledTimes(0);
  });

  it("is a no-op when memberKey is empty", async () => {
    const mod = await loadModule();
    await mod.revokeSiteEditor(OWNER, PATH, "");
    expect(sqlMock).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// listSiteEditors
// ---------------------------------------------------------------------------

describe("listSiteEditors", () => {
  it("returns an empty array when no rows exist", async () => {
    const mod = await loadModule();
    sqlMock.mockResolvedValue([]); // schema calls succeed, SELECT returns []
    const result = await mod.listSiteEditors(OWNER, PATH);
    expect(result).toEqual([]);
  });

  it("maps raw rows to SiteEditorRow shape", async () => {
    const mod = await loadModule();
    // First two calls are schema; the third is the SELECT.
    sqlMock
      .mockResolvedValueOnce([]) // CREATE TABLE
      .mockResolvedValueOnce([]) // CREATE INDEX
      .mockResolvedValueOnce([editorRow()]); // SELECT
    const result = await mod.listSiteEditors(OWNER, PATH);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      labOwnerKey: OWNER,
      path: PATH,
      memberKey: MEMBER,
      grantedBy: GRANTED_BY,
      grantedAt: "2026-06-20T12:00:00Z",
    });
  });

  it("returns an empty array when labOwnerKey is empty", async () => {
    const mod = await loadModule();
    const result = await mod.listSiteEditors("", PATH);
    // Guard fires before any sql call.
    expect(sqlMock).toHaveBeenCalledTimes(0);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isSiteEditor
// ---------------------------------------------------------------------------

describe("isSiteEditor", () => {
  it("returns true when a matching grant row exists", async () => {
    const mod = await loadModule();
    sqlMock
      .mockResolvedValueOnce([]) // CREATE TABLE
      .mockResolvedValueOnce([]) // CREATE INDEX
      .mockResolvedValueOnce([{ "?column?": 1 }]); // SELECT 1
    const result = await mod.isSiteEditor(OWNER, PATH, MEMBER);
    expect(result).toBe(true);
  });

  it("returns false when no matching grant row exists", async () => {
    const mod = await loadModule();
    sqlMock
      .mockResolvedValueOnce([]) // CREATE TABLE
      .mockResolvedValueOnce([]) // CREATE INDEX
      .mockResolvedValueOnce([]); // SELECT 1 -> empty
    const result = await mod.isSiteEditor(OWNER, PATH, MEMBER);
    expect(result).toBe(false);
  });

  it("returns false when memberKey equals labOwnerKey (owner is never their own editor)", async () => {
    const mod = await loadModule();
    // The PI-is-owner short circuit fires before any sql call.
    const result = await mod.isSiteEditor(OWNER, PATH, OWNER);
    expect(sqlMock).toHaveBeenCalledTimes(0);
    expect(result).toBe(false);
  });

  it("returns false when labOwnerKey is empty", async () => {
    const mod = await loadModule();
    const result = await mod.isSiteEditor("", PATH, MEMBER);
    expect(sqlMock).toHaveBeenCalledTimes(0);
    expect(result).toBe(false);
  });

  it("returns false when memberKey is empty", async () => {
    const mod = await loadModule();
    const result = await mod.isSiteEditor(OWNER, PATH, "");
    expect(sqlMock).toHaveBeenCalledTimes(0);
    expect(result).toBe(false);
  });

  it("checks the correct path parameter in the SQL call", async () => {
    const mod = await loadModule();
    sqlMock
      .mockResolvedValueOnce([]) // CREATE TABLE
      .mockResolvedValueOnce([]) // CREATE INDEX
      .mockResolvedValueOnce([]);
    await mod.isSiteEditor(OWNER, "papers/my-paper", MEMBER);
    // The SELECT call is the third one.
    const selectCall = sqlMock.mock.calls[2];
    // The parameterized values are the interleaved args after the template strings.
    // Template: SELECT 1 FROM ... WHERE lab_owner_key = ${OWNER} AND member_key = ${MEMBER}
    //            AND (path = '' OR path = ${"papers/my-paper"})
    // Values arrive as the rest args: [OWNER, MEMBER, "papers/my-paper"]
    const values = selectCall.slice(1);
    expect(values).toContain(OWNER);
    expect(values).toContain(MEMBER);
    expect(values).toContain("papers/my-paper");
  });
});
