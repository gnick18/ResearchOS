import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for the IO primitives the runner depends on. The pure check
// (isReclaimDue, liveAssetIdsFromManifests) needs none of these.
const getLabLapse = vi.fn();
const isHostedAssetArchived = vi.fn();
const removeHostedAsset = vi.fn();
const deleteAsset = vi.fn();
const deleteByoSite = vi.fn();
const listAllSiteHostedManifests = vi.fn();
const listAllByoSites = vi.fn();
const deleteByoSiteRow = vi.fn();

vi.mock("@/lib/billing/db", () => ({
  getLabLapse: (k: string) => getLabLapse(k),
}));
vi.mock("@/lib/collab/server/db", () => ({
  isHostedAssetArchived: (id: string) => isHostedAssetArchived(id),
  removeHostedAsset: (id: string) => removeHostedAsset(id),
}));
vi.mock("@/lib/social/lab-site-asset-store", () => ({
  deleteAsset: (id: string) => deleteAsset(id),
  deleteByoSite: (frag: string) => deleteByoSite(frag),
}));
vi.mock("@/lib/social/lab-site-db", () => ({
  listAllSiteHostedManifests: () => listAllSiteHostedManifests(),
}));
vi.mock("@/lib/social/lab-byo-db", () => ({
  listAllByoSites: () => listAllByoSites(),
  deleteByoSiteRow: (k: string) => deleteByoSiteRow(k),
}));

import { byoAssetId, byoLabFragment } from "@/lib/social/lab-byo";
import {
  GRACE_DAYS,
  isReclaimDue,
  liveAssetIdsFromManifests,
  reclaimAsset,
  reclaimByoSite,
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
    // The runner now also enumerates BYO sites; default to none so the native
    // dataset assertions below are unaffected.
    listAllByoSites.mockResolvedValue([]);
    deleteByoSite.mockResolvedValue(true);
    deleteByoSiteRow.mockResolvedValue(undefined);
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

describe("reclaimByoSite", () => {
  beforeEach(() => {
    isHostedAssetArchived.mockResolvedValue(false);
    deleteByoSite.mockResolvedValue(true);
    removeHostedAsset.mockResolvedValue(undefined);
    deleteByoSiteRow.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("reclaims (R2 prefix delete + billing remove + row cleared) for a normal BYO site", async () => {
    const outcome = await reclaimByoSite("byo-lab");
    expect(outcome).toBe("reclaimed");
    expect(deleteByoSite).toHaveBeenCalledWith(byoLabFragment("byo-lab"));
    expect(removeHostedAsset).toHaveBeenCalledWith(byoAssetId("byo-lab"));
    expect(deleteByoSiteRow).toHaveBeenCalledWith("byo-lab");
  });

  it("SKIPS a prepaid-archived BYO asset (no delete, no remove, no row clear)", async () => {
    isHostedAssetArchived.mockResolvedValue(true);
    const outcome = await reclaimByoSite("byo-lab");
    expect(outcome).toBe("archived");
    expect(deleteByoSite).not.toHaveBeenCalled();
    expect(removeHostedAsset).not.toHaveBeenCalled();
    expect(deleteByoSiteRow).not.toHaveBeenCalled();
  });

  it("reports failed (does not throw) when the R2 prefix delete throws", async () => {
    deleteByoSite.mockRejectedValue(new Error("r2 down"));
    const outcome = await reclaimByoSite("byo-lab");
    expect(outcome).toBe("failed");
    // Billing row + DB row left for the next idempotent run to retry.
    expect(removeHostedAsset).not.toHaveBeenCalled();
    expect(deleteByoSiteRow).not.toHaveBeenCalled();
  });

  it("checks archived against the lab's single BYO billing asset id", async () => {
    await reclaimByoSite("byo-lab");
    expect(isHostedAssetArchived).toHaveBeenCalledWith(byoAssetId("byo-lab"));
  });
});

describe("runHostedAssetGc BYO reclaim (folded into the same run)", () => {
  beforeEach(() => {
    // Native pass enumerates nothing so we isolate the BYO half.
    listAllSiteHostedManifests.mockResolvedValue([]);
    isHostedAssetArchived.mockResolvedValue(false);
    deleteAsset.mockResolvedValue(true);
    deleteByoSite.mockResolvedValue(true);
    removeHostedAsset.mockResolvedValue(undefined);
    deleteByoSiteRow.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  function byoRow(labOwnerKey: string) {
    return {
      labOwnerKey,
      manifest: { version: 1, indexPath: "index.html", files: [], totalBytes: 0 },
      totalBytes: 0,
      updatedAt: new Date(NOW).toISOString(),
    };
  }

  it("keeps an active-lab BYO site (lapse null)", async () => {
    listAllByoSites.mockResolvedValue([byoRow("active-byo")]);
    getLabLapse.mockResolvedValue(null);
    const report = await runHostedAssetGc(NOW);
    expect(report.byoScanned).toBe(1);
    expect(report.byoReclaimed).toBe(0);
    expect(deleteByoSite).not.toHaveBeenCalled();
    expect(removeHostedAsset).not.toHaveBeenCalled();
    expect(deleteByoSiteRow).not.toHaveBeenCalled();
  });

  it("keeps a lapsed-but-in-grace BYO site", async () => {
    listAllByoSites.mockResolvedValue([byoRow("grace-byo")]);
    getLabLapse.mockResolvedValue({ lapsedAt: new Date(NOW - 5 * DAY).toISOString() });
    const report = await runHostedAssetGc(NOW);
    expect(report.byoReclaimed).toBe(0);
    expect(deleteByoSite).not.toHaveBeenCalled();
  });

  it("reclaims a lapsed-past-grace BYO site (delete + remove + row cleared)", async () => {
    listAllByoSites.mockResolvedValue([byoRow("expired-byo")]);
    getLabLapse.mockResolvedValue({ lapsedAt: new Date(NOW - 31 * DAY).toISOString() });
    const report = await runHostedAssetGc(NOW);
    expect(report.byoReclaimed).toBe(1);
    expect(deleteByoSite).toHaveBeenCalledWith(byoLabFragment("expired-byo"));
    expect(removeHostedAsset).toHaveBeenCalledWith(byoAssetId("expired-byo"));
    expect(deleteByoSiteRow).toHaveBeenCalledWith("expired-byo");
  });

  it("SKIPS an archived BYO site even when past grace", async () => {
    listAllByoSites.mockResolvedValue([byoRow("archived-byo")]);
    getLabLapse.mockResolvedValue({ lapsedAt: new Date(NOW - 31 * DAY).toISOString() });
    isHostedAssetArchived.mockResolvedValue(true);
    const report = await runHostedAssetGc(NOW);
    expect(report.byoArchived).toBe(1);
    expect(report.byoReclaimed).toBe(0);
    expect(deleteByoSite).not.toHaveBeenCalled();
    expect(deleteByoSiteRow).not.toHaveBeenCalled();
  });

  it("one failing BYO delete does not abort the run (resilient)", async () => {
    listAllByoSites.mockResolvedValue([byoRow("bad-byo"), byoRow("good-byo")]);
    getLabLapse.mockResolvedValue({ lapsedAt: new Date(NOW - 31 * DAY).toISOString() });
    deleteByoSite.mockImplementation(async (frag: string) => {
      if (frag === byoLabFragment("bad-byo")) throw new Error("r2 down");
      return true;
    });
    const report = await runHostedAssetGc(NOW);
    expect(report.byoFailed).toBe(1);
    expect(report.byoReclaimed).toBe(1);
    expect(deleteByoSiteRow).toHaveBeenCalledWith("good-byo");
    expect(deleteByoSiteRow).not.toHaveBeenCalledWith("bad-byo");
  });

  it("one lab's billing-read error does not abort the BYO pass", async () => {
    listAllByoSites.mockResolvedValue([byoRow("bad-billing-byo"), byoRow("expired-byo")]);
    getLabLapse.mockImplementation(async (k: string) => {
      if (k === "bad-billing-byo") throw new Error("billing down");
      return { lapsedAt: new Date(NOW - 31 * DAY).toISOString() };
    });
    const report = await runHostedAssetGc(NOW);
    expect(report.byoScanned).toBe(2);
    expect(report.byoReclaimed).toBe(1);
    expect(deleteByoSite).toHaveBeenCalledWith(byoLabFragment("expired-byo"));
  });

  it("native + BYO reclaim coexist in one run", async () => {
    listAllSiteHostedManifests.mockResolvedValue([
      { labOwnerKey: "expired-lab", hostedJsonByPath: [{ path: "", hostedJson: hostedJson(["lab-0000000a"]) }] },
    ]);
    listAllByoSites.mockResolvedValue([byoRow("expired-byo")]);
    getLabLapse.mockResolvedValue({ lapsedAt: new Date(NOW - 31 * DAY).toISOString() });
    const report = await runHostedAssetGc(NOW);
    expect(report.assetsReclaimed).toBe(1);
    expect(report.byoReclaimed).toBe(1);
    expect(deleteAsset).toHaveBeenCalledWith("lab-0000000a");
    expect(deleteByoSite).toHaveBeenCalledWith(byoLabFragment("expired-byo"));
  });

  it("is idempotent on an empty BYO enumeration", async () => {
    listAllByoSites.mockResolvedValue([]);
    const report = await runHostedAssetGc(NOW);
    expect(report.byoScanned).toBe(0);
    expect(report.byoReclaimed).toBe(0);
  });
});
