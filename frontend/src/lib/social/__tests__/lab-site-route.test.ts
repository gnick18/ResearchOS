import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isLabSitesEnabled = vi.fn();
const resolveCallerOwnerKey = vi.fn();
const isLabPublishEntitled = vi.fn();
const getSiteByOwner = vi.fn();
const listPages = vi.fn();
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
  getSiteByOwner: (k: string) => getSiteByOwner(k),
  listPages: (k: string) => listPages(k),
  createSite: vi.fn(),
}));
vi.mock("@/lib/social/slug-registry-db", () => ({
  getSlug: vi.fn(),
  loadTakenSlugsWithPrefix: vi.fn(),
  reserveSlug: vi.fn(),
}));
vi.mock("@/lib/social/lab-site-editors-db", () => ({
  isSiteEditor: (...args: unknown[]) => isSiteEditor(...args),
}));

import { GET } from "@/app/api/social/lab-site/route";

/** Build a minimal Request for the owner-path (no siteOwnerKey param). */
function ownerRequest(): Request {
  return new Request("http://localhost/api/social/lab-site");
}

/** Build a Request with a siteOwnerKey param for the editor-grant path. */
function editorRequest(siteOwnerKey: string): Request {
  return new Request(
    `http://localhost/api/social/lab-site?siteOwnerKey=${encodeURIComponent(siteOwnerKey)}`,
  );
}

describe("GET /api/social/lab-site gating matrix", () => {
  beforeEach(() => {
    isLabSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    getSiteByOwner.mockResolvedValue(null);
    listPages.mockResolvedValue([]);
    isSiteEditor.mockResolvedValue(false);
  });
  afterEach(() => vi.clearAllMocks());

  it("404s when the flag is off (inert)", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    expect((await GET(ownerRequest())).status).toBe(404);
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect((await GET(ownerRequest())).status).toBe(401);
  });

  it("403s a signed-in but not-entitled caller", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    expect((await GET(ownerRequest())).status).toBe(403);
  });

  it("200s an entitled owner (site null until claimed)", async () => {
    const res = await GET(ownerRequest());
    expect(res.status).toBe(200);
    // toMatchObject (not toEqual), the response additionally carries the
    // owner-aware-nav fields (editToken/ownerKey) added by the edit-token handoff,
    // which are not the concern of this gating-matrix assertion.
    expect(await res.json()).toMatchObject({ site: null, pages: [] });
  });

  it("503s when the store throws (fail closed, not a crash)", async () => {
    getSiteByOwner.mockRejectedValue(new Error("neon down"));
    expect((await GET(ownerRequest())).status).toBe(503);
  });

  it("403s when siteOwnerKey is supplied but isSiteEditor returns false", async () => {
    isSiteEditor.mockResolvedValue(false);
    expect((await GET(editorRequest("other-owner"))).status).toBe(403);
  });

  it("200s when siteOwnerKey is supplied and isSiteEditor returns true", async () => {
    isSiteEditor.mockResolvedValue(true);
    getSiteByOwner.mockResolvedValue({ labSlug: "smithlab", createdAt: "2026-01-01" });
    listPages.mockResolvedValue([]);
    const res = await GET(editorRequest("other-owner"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { site: { slug: string } };
    expect(body.site?.slug).toBe("smithlab");
  });
});
