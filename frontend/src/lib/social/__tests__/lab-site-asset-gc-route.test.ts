import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isLabSitesEnabled = vi.fn();
const runHostedAssetGc = vi.fn();

vi.mock("@/lib/social/config", () => ({
  isLabSitesEnabled: () => isLabSitesEnabled(),
}));
vi.mock("@/lib/social/lab-site-asset-gc", () => ({
  runHostedAssetGc: () => runHostedAssetGc(),
}));

import { GET } from "@/app/api/cron/lab-site-asset-gc/route";

function req(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers.authorization = authHeader;
  return new Request("http://x/api/cron/lab-site-asset-gc", { headers });
}

const REPORT = {
  labsScanned: 1,
  labsActive: 0,
  labsInGrace: 0,
  labsReclaimed: 1,
  assetsReclaimed: 2,
  assetsArchived: 0,
  assetsFailed: 0,
};

describe("GET /api/cron/lab-site-asset-gc auth + flag gating", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cr3t";
    isLabSitesEnabled.mockReturnValue(true);
    runHostedAssetGc.mockResolvedValue(REPORT);
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  it("404 when no Authorization header (rejects without secret)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(runHostedAssetGc).not.toHaveBeenCalled();
  });

  it("404 on a wrong secret", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(404);
    expect(runHostedAssetGc).not.toHaveBeenCalled();
  });

  it("404 (fails closed) when CRON_SECRET is unset, even with a header", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(404);
    expect(runHostedAssetGc).not.toHaveBeenCalled();
  });

  it("flag OFF => inert no-op after auth (does not run the GC)", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    const res = await GET(req("Bearer s3cr3t"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.skipped).toBe("lab sites disabled");
    expect(runHostedAssetGc).not.toHaveBeenCalled();
  });

  it("authed + flag on => runs the GC and returns the report", async () => {
    const res = await GET(req("Bearer s3cr3t"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.assetsReclaimed).toBe(2);
    expect(runHostedAssetGc).toHaveBeenCalledTimes(1);
  });

  it("500 when the GC throws (still authed)", async () => {
    runHostedAssetGc.mockRejectedValue(new Error("boom"));
    const res = await GET(req("Bearer s3cr3t"));
    expect(res.status).toBe(500);
    const j = await res.json();
    expect(j.ok).toBe(false);
  });
});
