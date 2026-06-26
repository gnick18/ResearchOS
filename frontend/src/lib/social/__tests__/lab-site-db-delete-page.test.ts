// Unit tests for deletePage in lib/social/lab-site-db.ts:
//   - removes the live lab_site_pages row AND its lab_site_page_versions history
//   - returns true only when a live row existed (idempotent no-op otherwise)
//   - best-effort cleanup of the native-page billing meter
//   - best-effort cleanup of each hosted dataset asset (R2 object + billing row)
//   - never throws when billing / R2 cleanup fails (fire-and-forget)
//
// Neon, collab/server/db, and the (dynamically imported) asset store are mocked.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

const setHostedAssetBytesMock = vi.fn().mockResolvedValue(undefined);
const removeHostedAssetMock = vi.fn().mockResolvedValue(undefined);
const deleteAssetMock = vi.fn().mockResolvedValue(true);

vi.mock("@/lib/collab/server/db", () => ({
  setHostedAssetBytes: (...a: unknown[]) => setHostedAssetBytesMock(...a),
  removeHostedAsset: (assetId: string) => removeHostedAssetMock(assetId),
}));

// The asset store is imported dynamically inside cleanupDeletedPageAssets.
vi.mock("../lab-site-asset-store", () => ({
  deleteAsset: (assetId: string) => deleteAssetMock(assetId),
}));

vi.mock("../slug-registry-db", () => ({
  ensureSlugRegistrySchema: vi.fn().mockResolvedValue(undefined),
  reserveSlug: vi.fn().mockResolvedValue({ ok: true }),
}));

type SqlCall = { text: string; values: unknown[] };
const sqlCalls: SqlCall[] = [];
let mockSqlImpl:
  | ((strings: TemplateStringsArray, ...params: unknown[]) => unknown)
  | null = null;

function render(strings: TemplateStringsArray, params: unknown[]): string {
  return strings.reduce(
    (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
  );
}

function defaultSqlImpl(strings: TemplateStringsArray, ...params: unknown[]): unknown {
  sqlCalls.push({ text: render(strings, params), values: params });
  return Promise.resolve([]);
}

vi.mock("@neondatabase/serverless", () => ({
  neon: (_url: string) => (strings: TemplateStringsArray, ...params: unknown[]) =>
    (mockSqlImpl ?? defaultSqlImpl)(strings, ...params),
}));

vi.stubEnv("DATABASE_URL", "postgresql://mock-delete");

import { deletePage } from "../lab-site-db";
import { hostedAssetId } from "../lab-site-hosted";

function resetMocks(): void {
  sqlCalls.length = 0;
  setHostedAssetBytesMock.mockClear();
  removeHostedAssetMock.mockClear();
  deleteAssetMock.mockClear();
  deleteAssetMock.mockResolvedValue(true);
  removeHostedAssetMock.mockResolvedValue(undefined);
  mockSqlImpl = null;
}

/**
 * Build a mock sql impl that returns `pageRow` for the getPage SELECT and one
 * deleted row for the live-row DELETE (so deletePage reports success), or null +
 * no deleted row when `pageRow` is null.
 */
function sqlWithPage(pageRow: Record<string, unknown> | null) {
  return (strings: TemplateStringsArray, ...params: unknown[]): unknown => {
    const text = render(strings, params);
    sqlCalls.push({ text, values: params });
    if (text.includes("SELECT") && text.includes("FROM lab_site_pages")) {
      return Promise.resolve(pageRow ? [pageRow] : []);
    }
    if (text.includes("DELETE FROM lab_site_pages")) {
      return Promise.resolve(pageRow ? [{ lab_owner_key: "owner-1" }] : []);
    }
    return Promise.resolve([]);
  };
}

const PLAIN_PAGE = {
  lab_owner_key: "owner-1",
  path: "methods",
  title: "Methods",
  body_md: "# Methods",
  status: "published",
  version: "2",
  updated_at: new Date(0).toISOString(),
  snapshots_json: null,
  hosted_json: null,
  blocks_json: null,
};

describe("deletePage", () => {
  beforeEach(resetMocks);

  it("deletes the live row and the version history, returning true", async () => {
    mockSqlImpl = sqlWithPage(PLAIN_PAGE);
    const ok = await deletePage("owner-1", "methods");
    expect(ok).toBe(true);

    const deletedPages = sqlCalls.some((c) =>
      c.text.includes("DELETE FROM lab_site_pages"),
    );
    const deletedVersions = sqlCalls.some((c) =>
      c.text.includes("DELETE FROM lab_site_page_versions"),
    );
    expect(deletedPages).toBe(true);
    expect(deletedVersions).toBe(true);
  });

  it("returns false when no live row existed (idempotent no-op)", async () => {
    mockSqlImpl = sqlWithPage(null);
    const ok = await deletePage("owner-1", "gone");
    expect(ok).toBe(false);
    // History delete still runs (cleans any orphaned rows) but no row was removed.
    expect(
      sqlCalls.some((c) => c.text.includes("DELETE FROM lab_site_page_versions")),
    ).toBe(true);
  });

  it("returns false for an empty owner key without touching the store", async () => {
    mockSqlImpl = sqlWithPage(PLAIN_PAGE);
    const ok = await deletePage("", "methods");
    expect(ok).toBe(false);
    expect(sqlCalls.length).toBe(0);
  });

  it("drops the native-page billing meter row", async () => {
    mockSqlImpl = sqlWithPage(PLAIN_PAGE);
    await deletePage("owner-1", "methods");
    await new Promise((r) => setTimeout(r, 10));
    expect(removeHostedAssetMock).toHaveBeenCalled();
  });

  it("deletes each hosted dataset asset (R2 object + billing row)", async () => {
    const assetId = hostedAssetId("owner-1", "methods", "/data?seq=1");
    const hosted = JSON.stringify({
      version: 1,
      assets: {
        "/data?seq=1": {
          assetId,
          readUrl: "/api/social/lab-site/asset/read?id=x",
          bytes: 1024,
          columns: ["a", "b"],
          rowCount: 10,
        },
      },
    });
    mockSqlImpl = sqlWithPage({ ...PLAIN_PAGE, hosted_json: hosted });

    await deletePage("owner-1", "methods");
    await new Promise((r) => setTimeout(r, 10));

    expect(deleteAssetMock).toHaveBeenCalledWith(assetId);
    // removeHostedAsset is called for both the native-page meter and the asset.
    expect(removeHostedAssetMock).toHaveBeenCalledWith(assetId);
  });

  it("does not throw when billing/R2 cleanup fails (fire-and-forget)", async () => {
    removeHostedAssetMock.mockRejectedValue(new Error("billing down"));
    deleteAssetMock.mockRejectedValue(new Error("r2 down"));
    mockSqlImpl = sqlWithPage(PLAIN_PAGE);
    await expect(deletePage("owner-1", "methods")).resolves.toBe(true);
  });
});
