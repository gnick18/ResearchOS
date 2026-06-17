import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for the IO primitives the runner depends on. The pure check
// (isReclaimDue, liveAssetIdsFromManifests) needs none of these.
const getLabLapse = vi.fn();
const isHostedAssetArchived = vi.fn();
const removeHostedAsset = vi.fn();
const deleteAsset = vi.fn();
const listAllSiteHostedManifests = vi.fn();

vi.mock("@/lib/billing/db", () => ({
  getLabLapse: (k: string) => getLabLapse(k),
}));
vi.mock("@/lib/collab/server/db", () => ({
  isHostedAssetArchived: (id: string) => isHostedAssetArchived(id),
  removeHostedAsset: (id: string) => removeHostedAsset(id),
}));
vi.mock("@/lib/social/lab-site-asset-store", () => ({
  deleteAsset: (id: string) => deleteAsset(id),
}));
vi.mock("@/lib/social/lab-site-db", () => ({
  listAllSiteHostedManifests: () => listAllSiteHostedManifests(),
}));

import {
  GRACE_DAYS,
  isReclaimDue,
  liveAssetIdsFromManifests,
  reclaimAsset,
  runHostedAssetGc,
} from "@/lib/social/lab-site-asset-gc";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-16T00:00:00.000Z");

/** Build a valid hosted_json blob for a set of asset ids, keyed by fake hrefs. */
function hostedJson(assetIds: string[]): string {
  const assets: Record<string, unknown> = {};
  assetIds.forEach((id, i) => {
    assets[`/datahub?d=${i}#ros=table`] = {
      assetId: id,
      readUrl: `/api/social/lab-site/asset/read?id=${id}`,
      bytes: 1234,
      columns: ["a", "b"],
      rowCount: 10,
    };
  });
  return JSON.stringify({ version: 1, assets });
}

describe("GRACE_DAYS", () => {
  it("is 30 (policy constant)", () => {
    expect(GRACE_DAYS).toBe(30);
  });
});

describe("isReclaimDue (pure grace-period check)", () => {
  it("NOT due when not lapsed (lapsedAt null) => keep", () => {
    expect(isReclaimDue(NOW, null)).toBe(false);
  });

  it("NOT due when lapsed less than 30 days ago => keep", () => {
    const lapsedAt = new Date(NOW - 10 * DAY).toISOString();
    expect(isReclaimDue(NOW, lapsedAt)).toBe(false);
  });

  it("NOT due exactly at the 30-day boundary (strictly greater-than) => keep", () => {
    const lapsedAt = new Date(NOW - 30 * DAY).toISOString();
    expect(isReclaimDue(NOW, lapsedAt)).toBe(false);
  });

  it("DUE when lapsed more than 30 days ago => reclaim", () => {
    const lapsedAt = new Date(NOW - 31 * DAY).toISOString();
    expect(isReclaimDue(NOW, lapsedAt)).toBe(true);
  });

  it("NOT due on a garbage timestamp (fail safe)", () => {
    expect(isReclaimDue(NOW, "not-a-date")).toBe(false);
  });

  it("honors a custom grace window", () => {
    const lapsedAt = new Date(NOW - 5 * DAY).toISOString();
    expect(isReclaimDue(NOW, lapsedAt, 3)).toBe(true);
    expect(isReclaimDue(NOW, lapsedAt, 10)).toBe(false);
  });
});

describe("liveAssetIdsFromManifests (pure enumeration)", () => {
  it("collects distinct asset ids across pages, dropping duplicates", () => {
    const ids = liveAssetIdsFromManifests([
      { path: "", hostedJson: hostedJson(["lab-aaaaaaaa", "lab-bbbbbbbb"]) },
      { path: "data", hostedJson: hostedJson(["lab-bbbbbbbb", "lab-cccccccc"]) },
    ]);
    expect(ids.sort()).toEqual(["lab-aaaaaaaa", "lab-bbbbbbbb", "lab-cccccccc"]);
  });

  it("ignores a malformed manifest blob (no throw, no ids)", () => {
    expect(liveAssetIdsFromManifests([{ path: "", hostedJson: "{bad json" }])).toEqual(
      [],
    );
  });
});

describe("reclaimAsset", () => {
  beforeEach(() => {
    isHostedAssetArchived.mockResolvedValue(false);
    deleteAsset.mockResolvedValue(true);
    removeHostedAsset.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("reclaims (R2 delete + billing remove) for a normal asset", async () => {
    const outcome = await reclaimAsset("lab-aaaaaaaa");
    expect(outcome).toBe("reclaimed");
    expect(deleteAsset).toHaveBeenCalledWith("lab-aaaaaaaa");
    expect(removeHostedAsset).toHaveBeenCalledWith("lab-aaaaaaaa");
  });

  it("SKIPS a prepaid-archived asset (no delete, no remove)", async () => {
    isHostedAssetArchived.mockResolvedValue(true);
    const outcome = await reclaimAsset("lab-aaaaaaaa");
    expect(outcome).toBe("archived");
    expect(deleteAsset).not.toHaveBeenCalled();
    expect(removeHostedAsset).not.toHaveBeenCalled();
  });

  it("reports failed (does not throw) when R2 delete throws", async () => {
    deleteAsset.mockRejectedValue(new Error("r2 down"));
    const outcome = await reclaimAsset("lab-aaaaaaaa");
    expect(outcome).toBe("failed");
    // Billing row left for the next idempotent run to retry.
    expect(removeHostedAsset).not.toHaveBeenCalled();
  });
});

describe("runHostedAssetGc", () => {
  beforeEach(() => {
    isHostedAssetArchived.mockResolvedValue(false);
    deleteAsset.mockResolvedValue(true);
    removeHostedAsset.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("skips an active lab (lapse null) entirely", async () => {
    listAllSiteHostedManifests.mockResolvedValue([
      { labOwnerKey: "active-lab", hostedJsonByPath: [{ path: "", hostedJson: hostedJson(["lab-aaaaaaaa"]) }] },
    ]);
    getLabLapse.mockResolvedValue(null);
    const report = await runHostedAssetGc(NOW);
    expect(report.labsActive).toBe(1);
    expect(report.labsReclaimed).toBe(0);
    expect(report.assetsReclaimed).toBe(0);
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("keeps a lapsed-but-in-grace lab", async () => {
    listAllSiteHostedManifests.mockResolvedValue([
      { labOwnerKey: "grace-lab", hostedJsonByPath: [{ path: "", hostedJson: hostedJson(["lab-aaaaaaaa"]) }] },
    ]);
    getLabLapse.mockResolvedValue({ lapsedAt: new Date(NOW - 5 * DAY).toISOString() });
    const report = await runHostedAssetGc(NOW);
    expect(report.labsInGrace).toBe(1);
    expect(report.assetsReclaimed).toBe(0);
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("reclaims every asset of a lapsed-past-grace lab", async () => {
    listAllSiteHostedManifests.mockResolvedValue([
      {
        labOwnerKey: "expired-lab",
        hostedJsonByPath: [
          { path: "", hostedJson: hostedJson(["lab-aaaaaaaa", "lab-bbbbbbbb"]) },
        ],
      },
    ]);
    getLabLapse.mockResolvedValue({ lapsedAt: new Date(NOW - 31 * DAY).toISOString() });
    const report = await runHostedAssetGc(NOW);
    expect(report.labsReclaimed).toBe(1);
    expect(report.assetsReclaimed).toBe(2);
    expect(deleteAsset).toHaveBeenCalledTimes(2);
    expect(removeHostedAsset).toHaveBeenCalledTimes(2);
  });

  it("SKIPS an archived asset even when the lab is past grace", async () => {
    listAllSiteHostedManifests.mockResolvedValue([
      {
        labOwnerKey: "expired-lab",
        hostedJsonByPath: [
          { path: "", hostedJson: hostedJson(["lab-11111111", "lab-22222222"]) },
        ],
      },
    ]);
    getLabLapse.mockResolvedValue({ lapsedAt: new Date(NOW - 31 * DAY).toISOString() });
    isHostedAssetArchived.mockImplementation(async (id: string) => id === "lab-22222222");
    const report = await runHostedAssetGc(NOW);
    expect(report.assetsReclaimed).toBe(1);
    expect(report.assetsArchived).toBe(1);
    expect(deleteAsset).toHaveBeenCalledTimes(1);
    expect(deleteAsset).toHaveBeenCalledWith("lab-11111111");
  });

  it("one failing asset does not abort the run (resilient)", async () => {
    listAllSiteHostedManifests.mockResolvedValue([
      {
        labOwnerKey: "expired-lab",
        hostedJsonByPath: [
          { path: "", hostedJson: hostedJson(["lab-deadbeef", "lab-feedface"]) },
        ],
      },
    ]);
    getLabLapse.mockResolvedValue({ lapsedAt: new Date(NOW - 31 * DAY).toISOString() });
    deleteAsset.mockImplementation(async (id: string) => {
      if (id === "lab-deadbeef") throw new Error("r2 down");
      return true;
    });
    const report = await runHostedAssetGc(NOW);
    expect(report.assetsFailed).toBe(1);
    expect(report.assetsReclaimed).toBe(1);
    expect(removeHostedAsset).toHaveBeenCalledWith("lab-feedface");
  });

  it("one lab's billing-read error does not abort the whole run", async () => {
    listAllSiteHostedManifests.mockResolvedValue([
      { labOwnerKey: "bad-billing-lab", hostedJsonByPath: [{ path: "", hostedJson: hostedJson(["lab-0000000a"]) }] },
      { labOwnerKey: "expired-lab", hostedJsonByPath: [{ path: "", hostedJson: hostedJson(["lab-0000000b"]) }] },
    ]);
    getLabLapse.mockImplementation(async (k: string) => {
      if (k === "bad-billing-lab") throw new Error("billing down");
      return { lapsedAt: new Date(NOW - 31 * DAY).toISOString() };
    });
    const report = await runHostedAssetGc(NOW);
    expect(report.labsScanned).toBe(2);
    expect(report.assetsReclaimed).toBe(1);
    expect(deleteAsset).toHaveBeenCalledWith("lab-0000000b");
  });

  it("is idempotent on an empty enumeration", async () => {
    listAllSiteHostedManifests.mockResolvedValue([]);
    const report = await runHostedAssetGc(NOW);
    expect(report.labsScanned).toBe(0);
    expect(report.assetsReclaimed).toBe(0);
  });
});
