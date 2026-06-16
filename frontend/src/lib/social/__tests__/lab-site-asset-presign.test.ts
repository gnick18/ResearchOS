import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isLabSitesEnabled = vi.fn();
const resolveCallerOwnerKey = vi.fn();
const isLabPublishEntitled = vi.fn();
const getSiteByOwner = vi.fn();
const isAssetStoreConfigured = vi.fn();
const presignAssetPut = vi.fn();

vi.mock("@/lib/social/config", () => ({ isLabSitesEnabled: () => isLabSitesEnabled() }));
vi.mock("@/lib/social/lab-site-session", () => ({
  resolveCallerOwnerKey: () => resolveCallerOwnerKey(),
}));
vi.mock("@/lib/billing/db", () => ({
  isLabPublishEntitled: (k: string) => isLabPublishEntitled(k),
}));
vi.mock("@/lib/social/lab-site-db", () => ({ getSiteByOwner: (k: string) => getSiteByOwner(k) }));
vi.mock("@/lib/social/lab-site-asset-store", () => ({
  isAssetStoreConfigured: () => isAssetStoreConfigured(),
  presignAssetPut: (id: string) => presignAssetPut(id),
  ASSET_PUT_CONTENT_TYPE: "application/vnd.apache.parquet",
}));

import { POST } from "@/app/api/social/lab-site/asset/presign/route";

function req(body: unknown): Request {
  return new Request("http://x/api/social/lab-site/asset/presign", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const okBody = { path: "", href: "/datahub?d=1#ros=table" };

describe("POST /api/social/lab-site/asset/presign gating", () => {
  beforeEach(() => {
    isLabSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    getSiteByOwner.mockResolvedValue({ labOwnerKey: "owner-1", labSlug: "smithlab" });
    isAssetStoreConfigured.mockReturnValue(true);
    presignAssetPut.mockResolvedValue("https://r2.example/presigned-put");
  });
  afterEach(() => vi.clearAllMocks());

  it("404 when the flag is off (inert)", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    expect((await POST(req(okBody))).status).toBe(404);
  });
  it("401 when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect((await POST(req(okBody))).status).toBe(401);
  });
  it("403 when not entitled", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    expect((await POST(req(okBody))).status).toBe(403);
  });
  it("400 on an invalid body (missing href)", async () => {
    expect((await POST(req({ path: "" }))).status).toBe(400);
  });
  it("409 when the lab has no site yet", async () => {
    getSiteByOwner.mockResolvedValue(null);
    expect((await POST(req(okBody))).status).toBe(409);
  });
  it("503 when R2 is not configured (no silent stub)", async () => {
    isAssetStoreConfigured.mockReturnValue(false);
    expect((await POST(req(okBody))).status).toBe(503);
  });
  it("200 with a presigned URL for an entitled owner", async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.uploadUrl).toBe("https://r2.example/presigned-put");
    expect(typeof j.assetId).toBe("string");
  });
});
