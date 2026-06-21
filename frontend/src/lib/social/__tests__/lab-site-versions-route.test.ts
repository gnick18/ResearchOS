// Route gating tests for GET + POST /api/social/lab-site/page/versions.
//
// Mirrors the pattern in lab-site-route.test.ts: vi.mock all dependencies,
// then import the route handlers and exercise the gating matrix.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const isLabSitesEnabled = vi.fn();
const resolveCallerOwnerKey = vi.fn();
const isLabPublishEntitled = vi.fn();
const listPageVersionsFn = vi.fn();
const restorePageVersionFn = vi.fn();
const isSiteEditor = vi.fn();

vi.mock("@/lib/social/config", () => ({
  isLabSitesEnabled: () => isLabSitesEnabled(),
}));
vi.mock("@/lib/social/lab-site-session", () => ({
  resolveCallerOwnerKey: () => resolveCallerOwnerKey(),
}));
vi.mock("@/lib/billing/db", () => ({
  isLabPublishEntitled: (k: string) => isLabPublishEntitled(k),
}));
vi.mock("@/lib/social/lab-site-db", () => ({
  listPageVersions: (k: string, p: string) => listPageVersionsFn(k, p),
  restorePageVersion: (k: string, p: string, v: number) =>
    restorePageVersionFn(k, p, v),
  ensureLabSiteSchema: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/social/lab-site-editors-db", () => ({
  isSiteEditor: (...args: unknown[]) => isSiteEditor(...args),
}));
vi.mock("@/lib/social/lab-site", () => ({
  normalizePagePath: (p: string) => p.replace(/^\/+|\/+$/g, ""),
}));

import { GET, POST } from "@/app/api/social/lab-site/page/versions/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequest(path: string, siteOwnerKey?: string): Request {
  const params = new URLSearchParams({ path });
  if (siteOwnerKey) params.set("siteOwnerKey", siteOwnerKey);
  return new Request(`http://localhost/api/social/lab-site/page/versions?${params}`);
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/social/lab-site/page/versions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function restoredPageRow() {
  return {
    labOwnerKey: "owner-1",
    path: "people",
    title: "People",
    bodyMd: "# People",
    status: "published",
    version: 4,
    updatedAt: "2026-06-20T12:00:00Z",
    snapshotsJson: null,
    hostedJson: null,
    blocksJson: null,
  };
}

// ---------------------------------------------------------------------------
// GET gating matrix
// ---------------------------------------------------------------------------

describe("GET /api/social/lab-site/page/versions gating matrix", () => {
  beforeEach(() => {
    isLabSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    listPageVersionsFn.mockResolvedValue([]);
    isSiteEditor.mockResolvedValue(false);
  });
  afterEach(() => vi.clearAllMocks());

  it("404s when the flag is off", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    expect((await GET(getRequest("people"))).status).toBe(404);
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect((await GET(getRequest("people"))).status).toBe(401);
  });

  it("403s when not entitled (owner path)", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    expect((await GET(getRequest("people"))).status).toBe(403);
  });

  it("200s an entitled owner and returns the version list", async () => {
    listPageVersionsFn.mockResolvedValue([
      { version: 2, title: "People", publishedAt: "2026-06-20T12:00:00Z", isLive: true },
    ]);
    const res = await GET(getRequest("people"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { versions: unknown[] };
    expect(body.versions).toHaveLength(1);
  });

  it("400s when the path param is missing", async () => {
    const req = new Request("http://localhost/api/social/lab-site/page/versions");
    expect((await GET(req)).status).toBe(400);
  });

  it("403s when siteOwnerKey is supplied but isSiteEditor returns false", async () => {
    isSiteEditor.mockResolvedValue(false);
    expect((await GET(getRequest("people", "other-owner"))).status).toBe(403);
  });

  it("200s when siteOwnerKey is supplied and isSiteEditor returns true", async () => {
    isSiteEditor.mockResolvedValue(true);
    listPageVersionsFn.mockResolvedValue([]);
    const res = await GET(getRequest("people", "other-owner"));
    expect(res.status).toBe(200);
  });

  it("503s when the store throws", async () => {
    listPageVersionsFn.mockRejectedValue(new Error("neon down"));
    expect((await GET(getRequest("people"))).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// POST (restore) gating matrix
// ---------------------------------------------------------------------------

describe("POST /api/social/lab-site/page/versions (restore) gating matrix", () => {
  beforeEach(() => {
    isLabSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    restorePageVersionFn.mockResolvedValue(restoredPageRow());
    isSiteEditor.mockResolvedValue(false);
  });
  afterEach(() => vi.clearAllMocks());

  it("404s when the flag is off", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    expect(
      (await POST(postRequest({ path: "people", version: 2 }))).status,
    ).toBe(404);
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect(
      (await POST(postRequest({ path: "people", version: 2 }))).status,
    ).toBe(401);
  });

  it("403s when not entitled (owner path)", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    expect(
      (await POST(postRequest({ path: "people", version: 2 }))).status,
    ).toBe(403);
  });

  it("400s when path is missing", async () => {
    expect((await POST(postRequest({ version: 2 }))).status).toBe(400);
  });

  it("400s when version is missing", async () => {
    expect((await POST(postRequest({ path: "people" }))).status).toBe(400);
  });

  it("200s an entitled owner and returns the new live page", async () => {
    const res = await POST(postRequest({ path: "people", version: 2 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: { version: number } };
    expect(body.page.version).toBe(4);
  });

  it("404s when the version does not exist in history", async () => {
    restorePageVersionFn.mockResolvedValue(null);
    expect(
      (await POST(postRequest({ path: "people", version: 99 }))).status,
    ).toBe(404);
  });

  it("403s when siteOwnerKey is supplied but isSiteEditor returns false", async () => {
    isSiteEditor.mockResolvedValue(false);
    expect(
      (
        await POST(
          postRequest({ path: "people", version: 2, siteOwnerKey: "other-owner" }),
        )
      ).status,
    ).toBe(403);
  });

  it("200s when siteOwnerKey is supplied and isSiteEditor returns true", async () => {
    isSiteEditor.mockResolvedValue(true);
    const res = await POST(
      postRequest({ path: "people", version: 2, siteOwnerKey: "other-owner" }),
    );
    expect(res.status).toBe(200);
  });

  it("503s when the store throws", async () => {
    restorePageVersionFn.mockRejectedValue(new Error("neon down"));
    expect(
      (await POST(postRequest({ path: "people", version: 2 }))).status,
    ).toBe(503);
  });
});
