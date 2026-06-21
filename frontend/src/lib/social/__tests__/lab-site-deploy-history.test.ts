// Unit tests for the deploy-history DB layer (lab-site-db.ts Phase 5a).
//
// Covers:
//   - ensureLabSiteSchema idempotency (the new table DDL is issued)
//   - publishPage snapshots into lab_site_page_versions on success
//   - publishPage swallows a history-insert failure (live publish not blocked)
//   - listPageVersions returns entries newest-first with correct isLive marking
//   - restorePageVersion writes draft + re-publishes as a new version
//
// All DB calls are intercepted by mocking @neondatabase/serverless (same
// pattern as lab-site-editors-db.test.ts). Module is reloaded per-describe
// via vi.resetModules() + dynamic import so the sqlMock singleton resets
// between describe blocks.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Neon mock -- must be registered before any module that imports it.
// ---------------------------------------------------------------------------

const sqlMock = vi.fn();

vi.mock("@neondatabase/serverless", () => ({
  neon: () => sqlMock,
}));

// DATABASE_URL must be set for getSql() to not throw.
process.env.DATABASE_URL = "postgresql://mock/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER = "owner-key-pi";
const PATH = "people";

function pageRow(overrides: Record<string, unknown> = {}) {
  return {
    lab_owner_key: OWNER,
    path: PATH,
    title: "People",
    body_md: "# People",
    blocks_json: null,
    status: "published",
    version: 3,
    updated_at: "2026-06-20T12:00:00Z",
    snapshots_json: null,
    hosted_json: null,
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    lab_owner_key: OWNER,
    path: PATH,
    version: 3,
    title: "People",
    body_md: "# People",
    blocks_json: null,
    snapshots_json: null,
    hosted_json: null,
    published_at: "2026-06-20T12:00:00Z",
    ...overrides,
  };
}

// Reloads the module under test after resetting module registry + sqlMock.
// The top-level vi.mock("@neondatabase/serverless") is hoisted by vitest and
// remains active across reloads, so the fresh module always gets sqlMock.
async function loadDb() {
  vi.resetModules();
  sqlMock.mockReset();
  sqlMock.mockResolvedValue([]); // Default: all schema calls return [].
  return await import("@/lib/social/lab-site-db");
}

// ---------------------------------------------------------------------------
// ensureLabSiteSchema: history table DDL
// ---------------------------------------------------------------------------

describe("ensureLabSiteSchema (history table)", () => {
  afterEach(() => vi.clearAllMocks());

  it("issues CREATE TABLE for lab_site_page_versions", async () => {
    sqlMock.mockResolvedValue([]);
    const { ensureLabSiteSchema } = await loadDb();
    await ensureLabSiteSchema();

    // Collect raw SQL strings from all tagged-template calls.
    const allSql = sqlMock.mock.calls
      .map((args) => (Array.isArray(args[0]) ? (args[0] as string[]).join("") : ""))
      .join("\n");

    expect(allSql).toMatch(/CREATE TABLE IF NOT EXISTS lab_site_page_versions/);
    expect(allSql).toMatch(/primary key \(lab_owner_key, path, version\)/i);
    expect(allSql).toMatch(/CREATE INDEX IF NOT EXISTS idx_lab_site_page_versions_owner_path/);
  });
});

// ---------------------------------------------------------------------------
// publishPage: history snapshot
// ---------------------------------------------------------------------------

describe("publishPage: history snapshot", () => {
  afterEach(() => vi.clearAllMocks());

  it("inserts a snapshot into lab_site_page_versions after the live row update", async () => {
    const { publishPage } = await loadDb();

    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join("");
      if (q.includes("UPDATE lab_site_pages") && q.includes("version = version + 1")) {
        return [pageRow()];
      }
      // All other calls (schema + history INSERT): return [].
      return [];
    });

    const result = await publishPage(OWNER, PATH, null, null);

    expect(result).not.toBeNull();
    expect(result?.version).toBe(3);

    const historyCalls = sqlMock.mock.calls.filter((args) => {
      const q = Array.isArray(args[0]) ? (args[0] as string[]).join("") : "";
      return q.includes("INSERT INTO lab_site_page_versions");
    });
    expect(historyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("swallows a history-insert failure and still returns the live row", async () => {
    const { publishPage } = await loadDb();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join("");
      if (q.includes("UPDATE lab_site_pages") && q.includes("version = version + 1")) {
        return [pageRow()];
      }
      if (q.includes("INSERT INTO lab_site_page_versions")) {
        throw new Error("neon down");
      }
      return [];
    });

    const result = await publishPage(OWNER, PATH, null, null);

    expect(result).not.toBeNull();
    expect(result?.version).toBe(3);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("history snapshot failed"),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it("returns null and does not attempt history insert when the page does not exist", async () => {
    const { publishPage } = await loadDb();

    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join("");
      if (q.includes("UPDATE lab_site_pages") && q.includes("version = version + 1")) {
        return []; // Page not found: RETURNING returns no rows.
      }
      return [];
    });

    const result = await publishPage(OWNER, "nonexistent", null, null);
    expect(result).toBeNull();

    const historyCalls = sqlMock.mock.calls.filter((args) => {
      const q = Array.isArray(args[0]) ? (args[0] as string[]).join("") : "";
      return q.includes("INSERT INTO lab_site_page_versions");
    });
    expect(historyCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// listPageVersions: isLive marking
// ---------------------------------------------------------------------------

describe("listPageVersions", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns versions newest-first with isLive on the current live version", async () => {
    const { listPageVersions } = await loadDb();

    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join("");
      if (q.includes("SELECT version FROM lab_site_pages")) {
        return [{ version: "3" }];
      }
      if (q.includes("FROM lab_site_page_versions")) {
        return [
          versionRow({ version: 3, published_at: "2026-06-20T12:00:00Z" }),
          versionRow({ version: 2, published_at: "2026-06-15T09:00:00Z" }),
          versionRow({ version: 1, published_at: "2026-06-10T08:00:00Z" }),
        ];
      }
      return [];
    });

    const versions = await listPageVersions(OWNER, PATH);
    expect(versions).toHaveLength(3);
    expect(versions[0].version).toBe(3);
    expect(versions[0].isLive).toBe(true);
    expect(versions[1].version).toBe(2);
    expect(versions[1].isLive).toBe(false);
    expect(versions[2].version).toBe(1);
    expect(versions[2].isLive).toBe(false);
  });

  it("returns an empty array when no history rows exist", async () => {
    const { listPageVersions } = await loadDb();

    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join("");
      if (q.includes("SELECT version FROM lab_site_pages")) return [{ version: "1" }];
      if (q.includes("FROM lab_site_page_versions")) return [];
      return [];
    });

    const versions = await listPageVersions(OWNER, PATH);
    expect(versions).toHaveLength(0);
  });

  it("returns [] immediately when labOwnerKey is empty", async () => {
    const { listPageVersions } = await loadDb();
    const versions = await listPageVersions("", PATH);
    expect(versions).toHaveLength(0);
    // No SQL should have been issued.
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// restorePageVersion: new top version
// ---------------------------------------------------------------------------

describe("restorePageVersion", () => {
  afterEach(() => vi.clearAllMocks());

  it("copies historical content to the live row and publishes as a new version", async () => {
    const { restorePageVersion } = await loadDb();

    let updateDraftCalled = false;

    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join("");
      // getPageVersion SELECT
      if (
        q.includes("FROM lab_site_page_versions") &&
        q.includes("AND version")
      ) {
        return [versionRow({ version: 2, title: "People v2", body_md: "# People v2" })];
      }
      // Draft-reset UPDATE
      if (
        q.includes("UPDATE lab_site_pages") &&
        q.includes("status         = 'draft'")
      ) {
        updateDraftCalled = true;
        return [];
      }
      // publishPage UPDATE (increments version)
      if (
        q.includes("UPDATE lab_site_pages") &&
        q.includes("version = version + 1")
      ) {
        return [pageRow({ version: 4, title: "People v2" })];
      }
      // All other (schema, history INSERT): return [].
      return [];
    });

    const result = await restorePageVersion(OWNER, PATH, 2);

    expect(updateDraftCalled).toBe(true);
    expect(result).not.toBeNull();
    expect(result?.version).toBe(4);
  });

  it("returns null when the requested version does not exist in history", async () => {
    const { restorePageVersion } = await loadDb();

    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join("");
      if (
        q.includes("FROM lab_site_page_versions") &&
        q.includes("AND version")
      ) {
        return []; // Version not found.
      }
      return [];
    });

    const result = await restorePageVersion(OWNER, PATH, 99);
    expect(result).toBeNull();
  });
});
