// Unit tests for Part 1 storage-metering additions in lib/social/lab-site-db.ts:
//   - siteKeyForPath: "home" for "", page path otherwise
//   - pageNativeAssetId: stable per-(lab, path) id
//   - nativePageBytes: UTF-8 byte computation
//   - publishPage: calls setHostedAssetBytes with correct args (via mocked db)
//
// The Neon sql layer and collab/server/db are both mocked. No DATABASE_URL needed.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Neon and collab/server/db before importing module under test.
// ---------------------------------------------------------------------------

const setHostedAssetBytesMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/collab/server/db", () => ({
  setHostedAssetBytes: (
    assetId: string,
    labOwnerKey: string,
    bytes: number,
    siteKey?: string,
  ) => setHostedAssetBytesMock(assetId, labOwnerKey, bytes, siteKey),
}));

// Mock slug-registry-db (imported by lab-site-db for rebindLabSlug).
vi.mock("../slug-registry-db", () => ({
  ensureSlugRegistrySchema: vi.fn().mockResolvedValue(undefined),
  reserveSlug: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock Neon: a simple sql tag that records calls and returns [] by default.
type SqlCall = { text: string; values: unknown[] };
const sqlCalls: SqlCall[] = [];
let mockSqlImpl: ((strings: TemplateStringsArray, ...params: unknown[]) => unknown) | null = null;

function defaultSqlImpl(strings: TemplateStringsArray, ...params: unknown[]): unknown {
  const text = strings.reduce(
    (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
  );
  sqlCalls.push({ text, values: params });
  return Promise.resolve([]);
}

vi.mock("@neondatabase/serverless", () => ({
  neon: (_url: string) => (strings: TemplateStringsArray, ...params: unknown[]) =>
    (mockSqlImpl ?? defaultSqlImpl)(strings, ...params),
}));

vi.stubEnv("DATABASE_URL", "postgresql://mock-metering");

// Import AFTER mocking.
import {
  siteKeyForPath,
  pageNativeAssetId,
  nativePageBytes,
  publishPage,
} from "../lab-site-db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks(): void {
  sqlCalls.length = 0;
  setHostedAssetBytesMock.mockClear();
  mockSqlImpl = null;
}

// ---------------------------------------------------------------------------
// siteKeyForPath
// ---------------------------------------------------------------------------

describe("siteKeyForPath", () => {
  it('returns "home" for the empty string (home page)', () => {
    expect(siteKeyForPath("")).toBe("home");
  });

  it("returns the page path for a non-home page", () => {
    expect(siteKeyForPath("people")).toBe("people");
    expect(siteKeyForPath("papers/2024-myresult")).toBe("papers/2024-myresult");
  });

  it("normalizes the path (strips leading/trailing slashes) before comparing", () => {
    // normalizePagePath strips leading/trailing slashes, so "/" -> "" -> "home".
    // We rely on the same normalizePagePath call inside siteKeyForPath.
    expect(siteKeyForPath("/")).toBe("home");
  });

  it("preserves internal slashes for companion paths", () => {
    expect(siteKeyForPath("papers/methods")).toBe("papers/methods");
  });
});

// ---------------------------------------------------------------------------
// pageNativeAssetId
// ---------------------------------------------------------------------------

describe("pageNativeAssetId", () => {
  it("is deterministic for the same (lab, path)", () => {
    const a = pageNativeAssetId("owner-1", "");
    const b = pageNativeAssetId("owner-1", "");
    expect(a).toBe(b);
  });

  it("differs across labOwnerKey or pagePath", () => {
    const base = pageNativeAssetId("owner-1", "");
    expect(pageNativeAssetId("owner-2", "")).not.toBe(base);
    expect(pageNativeAssetId("owner-1", "people")).not.toBe(base);
  });

  it("produces a well-formed id (alphanumeric+dash, ends in 8 hex chars)", () => {
    const id = pageNativeAssetId("owner-1", "");
    expect(/^[a-z0-9-]+-[0-9a-f]{8}$/.test(id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nativePageBytes
// ---------------------------------------------------------------------------

describe("nativePageBytes", () => {
  it("uses blocks_json when non-null (blocks page)", () => {
    const blocksJson = JSON.stringify({ type: "doc", content: [] });
    const result = nativePageBytes(blocksJson, "", null);
    expect(result).toBe(Buffer.byteLength(blocksJson, "utf8"));
  });

  it("falls back to body_md when blocks_json is null (markdown page)", () => {
    const bodyMd = "# Hello\nThis is my lab page.";
    const result = nativePageBytes(null, bodyMd, null);
    expect(result).toBe(Buffer.byteLength(bodyMd, "utf8"));
  });

  it("adds snapshots_json bytes when present", () => {
    const bodyMd = "hello";
    const snapshotsJson = JSON.stringify({ version: 1, snapshots: [] });
    const result = nativePageBytes(null, bodyMd, snapshotsJson);
    expect(result).toBe(
      Buffer.byteLength(bodyMd, "utf8") + Buffer.byteLength(snapshotsJson, "utf8"),
    );
  });

  it("returns 0 for all-null/empty inputs", () => {
    expect(nativePageBytes(null, "", null)).toBe(0);
  });

  it("counts multi-byte UTF-8 characters correctly", () => {
    // Japanese: each character is 3 bytes in UTF-8.
    const bodyMd = "研究室"; // 3 chars, 9 bytes
    const result = nativePageBytes(null, bodyMd, null);
    expect(result).toBe(9);
  });

  it("prefers blocks_json over body_md when both provided (blocks page)", () => {
    const blocksJson = "{}";
    const bodyMd = "some old markdown";
    const result = nativePageBytes(blocksJson, bodyMd, null);
    // Should use blocksJson (2 bytes), not bodyMd (17 bytes).
    expect(result).toBe(Buffer.byteLength(blocksJson, "utf8"));
  });
});

// ---------------------------------------------------------------------------
// publishPage metering hook
// ---------------------------------------------------------------------------

describe("publishPage native-page metering", () => {
  beforeEach(resetMocks);

  it("calls setHostedAssetBytes with correct assetId, owner, bytes, and siteKey on a successful publish", async () => {
    // Provide a mock sql that:
    //   - returns [] for schema-ensure queries (ALTER, CREATE)
    //   - returns a fake published row for the UPDATE ... RETURNING
    mockSqlImpl = (strings, ...params) => {
      const text = strings.reduce(
        (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
      );
      sqlCalls.push({ text, values: params });
      if (text.includes("UPDATE lab_site_pages")) {
        return Promise.resolve([
          {
            lab_owner_key: "owner-1",
            path: "",
            title: "Home",
            body_md: "# Hello",
            status: "published",
            version: "2",
            updated_at: new Date().toISOString(),
            snapshots_json: null,
            hosted_json: null,
            blocks_json: null,
          },
        ]);
      }
      return Promise.resolve([]);
    };

    const result = await publishPage("owner-1", "", null, null);
    expect(result).not.toBeNull();

    // Allow the fire-and-forget metering to settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(setHostedAssetBytesMock).toHaveBeenCalledOnce();
    const [assetId, ownerKey, bytes, siteKey] = setHostedAssetBytesMock.mock.calls[0];
    expect(ownerKey).toBe("owner-1");
    expect(siteKey).toBe("home");
    // bytes = nativePageBytes(null, "# Hello", null)
    expect(bytes).toBe(Buffer.byteLength("# Hello", "utf8"));
    // assetId should be the stable per-page id.
    expect(typeof assetId).toBe("string");
    expect(/^[a-z0-9-]+-[0-9a-f]{8}$/.test(assetId as string)).toBe(true);
  });

  it("uses page path (not 'home') as siteKey for a non-home page", async () => {
    mockSqlImpl = (strings, ...params) => {
      const text = strings.reduce(
        (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
      );
      sqlCalls.push({ text, values: params });
      if (text.includes("UPDATE lab_site_pages")) {
        return Promise.resolve([
          {
            lab_owner_key: "owner-1",
            path: "people",
            title: "People",
            body_md: "## Team",
            status: "published",
            version: "1",
            updated_at: new Date().toISOString(),
            snapshots_json: null,
            hosted_json: null,
            blocks_json: null,
          },
        ]);
      }
      return Promise.resolve([]);
    };

    await publishPage("owner-1", "people", null, null);
    await new Promise((r) => setTimeout(r, 10));

    expect(setHostedAssetBytesMock).toHaveBeenCalledOnce();
    const [, , , siteKey] = setHostedAssetBytesMock.mock.calls[0];
    expect(siteKey).toBe("people");
  });

  it("counts blocks_json bytes (blocks page)", async () => {
    const blocksJson = JSON.stringify({ type: "doc", children: [] });
    mockSqlImpl = (strings, ...params) => {
      const text = strings.reduce(
        (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
      );
      sqlCalls.push({ text, values: params });
      if (text.includes("UPDATE lab_site_pages")) {
        return Promise.resolve([
          {
            lab_owner_key: "owner-2",
            path: "",
            title: "Home",
            body_md: "",
            status: "published",
            version: "1",
            updated_at: new Date().toISOString(),
            snapshots_json: null,
            hosted_json: null,
            blocks_json: blocksJson,
          },
        ]);
      }
      return Promise.resolve([]);
    };

    await publishPage("owner-2", "", null, null);
    await new Promise((r) => setTimeout(r, 10));

    expect(setHostedAssetBytesMock).toHaveBeenCalledOnce();
    const [, , bytes] = setHostedAssetBytesMock.mock.calls[0];
    expect(bytes).toBe(Buffer.byteLength(blocksJson, "utf8"));
  });

  it("returns null and does NOT call metering when the page does not exist", async () => {
    // UPDATE returns 0 rows = page not found.
    mockSqlImpl = (strings, ...params) => {
      const text = strings.reduce(
        (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
      );
      sqlCalls.push({ text, values: params });
      return Promise.resolve([]);
    };

    const result = await publishPage("owner-1", "nonexistent", null, null);
    await new Promise((r) => setTimeout(r, 10));

    expect(result).toBeNull();
    expect(setHostedAssetBytesMock).not.toHaveBeenCalled();
  });

  it("does not throw when setHostedAssetBytes rejects (fire-and-forget)", async () => {
    setHostedAssetBytesMock.mockRejectedValueOnce(new Error("billing down"));
    mockSqlImpl = (strings, ...params) => {
      const text = strings.reduce(
        (acc, s, i) => acc + (i < params.length ? `$${i + 1}` : "") + s,
      );
      sqlCalls.push({ text, values: params });
      if (text.includes("UPDATE lab_site_pages")) {
        return Promise.resolve([
          {
            lab_owner_key: "owner-1",
            path: "",
            title: "Home",
            body_md: "hello",
            status: "published",
            version: "3",
            updated_at: new Date().toISOString(),
            snapshots_json: null,
            hosted_json: null,
            blocks_json: null,
          },
        ]);
      }
      return Promise.resolve([]);
    };

    // Must not throw even though billing fails.
    await expect(publishPage("owner-1", "", null, null)).resolves.not.toThrow();
  });
});
