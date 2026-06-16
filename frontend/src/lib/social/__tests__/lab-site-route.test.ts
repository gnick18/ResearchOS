import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isLabSitesEnabled = vi.fn();
const resolveCallerOwnerKey = vi.fn();
const isLabPublishEntitled = vi.fn();
const getSiteByOwner = vi.fn();
const listPages = vi.fn();

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

import { GET } from "@/app/api/social/lab-site/route";

describe("GET /api/social/lab-site gating matrix", () => {
  beforeEach(() => {
    isLabSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    getSiteByOwner.mockResolvedValue(null);
    listPages.mockResolvedValue([]);
  });
  afterEach(() => vi.clearAllMocks());

  it("404s when the flag is off (inert)", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    expect((await GET()).status).toBe(404);
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("403s a signed-in but not-entitled caller", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    expect((await GET()).status).toBe(403);
  });

  it("200s an entitled owner (site null until claimed)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ site: null, pages: [] });
  });

  it("503s when the store throws (fail closed, not a crash)", async () => {
    getSiteByOwner.mockRejectedValue(new Error("neon down"));
    expect((await GET()).status).toBe(503);
  });
});
