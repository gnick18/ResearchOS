// Gating-matrix tests for GET /api/social/lab-site/usage.
//
// Mirrors the style of frontend/src/lib/social/__tests__/lab-site-route.test.ts.
// Mocks the data-layer functions (getLabHostedBytes, getLabHostedBytesBySite,
// getLabSiteViews, hostedAssetMonthlyCost) and the authz helpers so the route
// logic is tested in isolation without a database.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the authz + config helpers (same shape as lab-site-route.test.ts).
const isLabSitesEnabled = vi.fn();
const resolveCallerOwnerKey = vi.fn();
const isLabPublishEntitled = vi.fn();
const isSiteEditor = vi.fn();

// Mock the data-layer functions (the route calls these, we never hit the DB).
const getLabHostedBytes = vi.fn();
const getLabHostedBytesBySite = vi.fn();
const getLabSiteViews = vi.fn();
// hostedAssetMonthlyCost is pure math, but we mock it to control the response
// and verify the route passes the right bytes values to it.
const hostedAssetMonthlyCost = vi.fn();

vi.mock("@/lib/social/config", () => ({
  isLabSitesEnabled: () => isLabSitesEnabled(),
}));
vi.mock("@/lib/social/lab-site-session", () => ({
  resolveCallerOwnerKey: () => resolveCallerOwnerKey(),
}));
vi.mock("@/lib/billing/db", () => ({
  isLabPublishEntitled: (k: string) => isLabPublishEntitled(k),
}));
vi.mock("@/lib/social/lab-site-editors-db", () => ({
  isSiteEditor: (...args: unknown[]) => isSiteEditor(...args),
}));
vi.mock("@/lib/collab/server/db", () => ({
  getLabHostedBytes: (k: string) => getLabHostedBytes(k),
  getLabHostedBytesBySite: (k: string) => getLabHostedBytesBySite(k),
}));
vi.mock("@/lib/social/lab-site-analytics", () => ({
  getLabSiteViews: (k: string, d?: number) => getLabSiteViews(k, d),
}));
vi.mock("@/lib/pricing/service-model", () => ({
  hostedAssetMonthlyCost: (b: number) => hostedAssetMonthlyCost(b),
}));

import { GET } from "@/app/api/social/lab-site/usage/route";

/** Request for the owner path (no siteOwnerKey param). */
function ownerRequest(): Request {
  return new Request("http://localhost/api/social/lab-site/usage");
}

/** Request with a siteOwnerKey param for the editor-grant path. */
function editorRequest(siteOwnerKey: string): Request {
  return new Request(
    `http://localhost/api/social/lab-site/usage?siteOwnerKey=${encodeURIComponent(siteOwnerKey)}`,
  );
}

/** Default happy-path data-layer responses. */
const EMPTY_VIEWS = { total: 0, bySite: [], daily: [] };

describe("GET /api/social/lab-site/usage gating matrix", () => {
  beforeEach(() => {
    isLabSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    isSiteEditor.mockResolvedValue(false);
    getLabHostedBytes.mockResolvedValue(0);
    getLabHostedBytesBySite.mockResolvedValue([]);
    getLabSiteViews.mockResolvedValue(EMPTY_VIEWS);
    hostedAssetMonthlyCost.mockReturnValue(0);
  });

  afterEach(() => vi.clearAllMocks());

  it("404s when the flag is off (inert route)", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    expect((await GET(ownerRequest())).status).toBe(404);
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect((await GET(ownerRequest())).status).toBe(401);
  });

  it("403s a signed-in but not-entitled caller (owner path)", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    expect((await GET(ownerRequest())).status).toBe(403);
  });

  it("200s an entitled owner with zero usage", async () => {
    const res = await GET(ownerRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      storage: { totalBytes: number; totalMonthlyCostUsd: number; bySite: unknown[] };
      views: { total: number; bySite: unknown[]; daily: unknown[] };
    };
    expect(body.storage.totalBytes).toBe(0);
    expect(body.storage.bySite).toEqual([]);
    expect(body.views.total).toBe(0);
    expect(body.views.bySite).toEqual([]);
    expect(body.views.daily).toEqual([]);
  });

  it("503s when the store throws (fail closed, not a crash)", async () => {
    getLabHostedBytes.mockRejectedValue(new Error("neon down"));
    expect((await GET(ownerRequest())).status).toBe(503);
  });

  it("503s when getLabHostedBytesBySite throws", async () => {
    getLabHostedBytesBySite.mockRejectedValue(new Error("neon down"));
    expect((await GET(ownerRequest())).status).toBe(503);
  });

  it("503s when getLabSiteViews throws", async () => {
    getLabSiteViews.mockRejectedValue(new Error("neon down"));
    expect((await GET(ownerRequest())).status).toBe(503);
  });

  it("403s when siteOwnerKey is supplied but isSiteEditor returns false", async () => {
    isSiteEditor.mockResolvedValue(false);
    expect((await GET(editorRequest("other-owner"))).status).toBe(403);
  });

  it("503s when isSiteEditor throws (fail closed)", async () => {
    isSiteEditor.mockRejectedValue(new Error("db error"));
    expect((await GET(editorRequest("other-owner"))).status).toBe(503);
  });

  it("200s when siteOwnerKey is supplied and isSiteEditor returns true", async () => {
    isSiteEditor.mockResolvedValue(true);
    getLabHostedBytes.mockResolvedValue(1024);
    getLabHostedBytesBySite.mockResolvedValue([
      { siteKey: "home", bytes: 1024 },
    ]);
    getLabSiteViews.mockResolvedValue({
      total: 42,
      bySite: [{ siteKey: "home", views: 42 }],
      daily: [{ day: "2026-06-20", views: 42 }],
    });
    hostedAssetMonthlyCost.mockReturnValue(0.0001);

    const res = await GET(editorRequest("other-owner"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      storage: {
        totalBytes: number;
        totalMonthlyCostUsd: number;
        bySite: Array<{ siteKey: string; label: string; bytes: number; monthlyCostUsd: number }>;
      };
      views: {
        total: number;
        bySite: Array<{ siteKey: string; label: string; views: number }>;
        daily: Array<{ day: string; views: number }>;
      };
    };
    // Route loaded the editor's target site (other-owner), not its own.
    expect(body.storage.totalBytes).toBe(1024);
    // Label humanizer ran on the bySite row.
    expect(body.storage.bySite[0]?.label).toBe("Home page");
    expect(body.views.total).toBe(42);
    expect(body.views.bySite[0]?.label).toBe("Home page");
  });

  it("humanizes null siteKey as 'Other' in the storage breakdown", async () => {
    getLabHostedBytesBySite.mockResolvedValue([
      { siteKey: null, bytes: 512 },
    ]);
    hostedAssetMonthlyCost.mockReturnValue(0.00005);

    const res = await GET(ownerRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      storage: { bySite: Array<{ siteKey: null; label: string }> };
    };
    expect(body.storage.bySite[0]?.label).toBe("Other");
  });

  it("200s the owner path even when siteOwnerKey param equals the caller key", async () => {
    // When siteOwnerKey === callerOwnerKey the route falls through to the owner
    // path (no isSiteEditor check needed).
    const req = new Request(
      "http://localhost/api/social/lab-site/usage?siteOwnerKey=owner-1",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    // isSiteEditor should NOT have been called (not the editor path).
    expect(isSiteEditor).not.toHaveBeenCalled();
  });
});
