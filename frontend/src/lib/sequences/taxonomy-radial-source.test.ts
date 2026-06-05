// sequence editor master. Tests for the radial pool builder + the live drill
// splice. The drill is network-bound, so getTaxonNode / resolveTaxonNames are
// mocked; the pool build and the path helper are pure.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ncbi-datasets", () => ({
  getTaxonNode: vi.fn(),
  resolveTaxonNames: vi.fn(),
}));

import { getTaxonNode, resolveTaxonNames } from "./ncbi-datasets";
import {
  buildPoolFromBackbone,
  drillNode,
  findPoolNode,
  pathToNode,
  spliceLineagePath,
  resolveLineageToPool,
  SYNTHETIC_ROOT_ID,
} from "./taxonomy-radial-source";
import type { LoadedBackbone, BackboneNode } from "./taxonomy-backbone";

function node(taxId: number, name: string, rank: string, parentId: number | null, childIds: number[], speciesCount: number): BackboneNode {
  return { taxId, name, rank, parentId, childIds, speciesCount };
}

// A tiny backbone: one root (cellular organisms) with one domain and one family.
function tinyBackbone(): LoadedBackbone {
  const root = node(131567, "cellular organisms", "cellular root", null, [2759], 1000);
  const euk = node(2759, "Eukaryota", "domain", 131567, [7215], 900);
  const fam = node(7215, "Drosophilidae", "family", 2759, [], 120);
  const byId = new Map<number, BackboneNode>([
    [131567, root],
    [2759, euk],
    [7215, fam],
  ]);
  return { byId, roots: [root] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildPoolFromBackbone", () => {
  it("includes a synthetic root over the backbone roots", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    const synth = pool.byId.get(SYNTHETIC_ROOT_ID)!;
    expect(synth).toBeTruthy();
    expect(synth.childIds).toEqual(["131567"]);
    expect(pool.rootIds).toEqual(["131567"]);
  });

  it("maps every backbone node into the pool with string ids", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    expect(pool.byId.get("2759")!.name).toBe("Eukaryota");
    expect(pool.byId.get("2759")!.childIds).toEqual(["7215"]);
    expect(pool.byId.get("7215")!.origin).toBe("backbone");
    expect(pool.byId.get("7215")!.childrenLoaded).toBe(true);
  });
});

describe("drillNode", () => {
  it("splices live children into the pool and marks the parent loaded", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    const family = pool.byId.get("7215")!;
    family.childrenLoaded = false; // a family is a backbone leaf to drill

    vi.mocked(getTaxonNode).mockResolvedValue({
      taxId: "7215",
      name: "Drosophilidae",
      rank: "family",
      parentId: "2759",
      ancestorIds: ["131567", "2759"],
      childIds: ["7214", "7220"],
      classification: {},
      counts: {},
    });
    vi.mocked(resolveTaxonNames).mockResolvedValue(
      new Map([
        ["7214", { taxId: "7214", name: "Drosophila", rank: "genus" }],
        ["7220", { taxId: "7220", name: "Scaptodrosophila", rank: "genus" }],
      ]),
    );

    const spliced = await drillNode(pool, "7215");
    expect(spliced).toEqual(["7214", "7220"]);
    expect(pool.byId.get("7215")!.childIds).toEqual(["7214", "7220"]);
    expect(pool.byId.get("7215")!.childrenLoaded).toBe(true);
    expect(pool.byId.get("7214")!.name).toBe("Drosophila");
    expect(pool.byId.get("7214")!.origin).toBe("live");
    expect(pool.byId.get("7214")!.childrenLoaded).toBe(false);
  });

  it("is a no-op for an already-loaded node (no fetch)", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    const out = await drillNode(pool, "2759"); // backbone node, children loaded
    expect(out).toEqual(["7215"]);
    expect(getTaxonNode).not.toHaveBeenCalled();
  });

  it("degrades names to id labels when the batch resolve fails", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    pool.byId.get("7215")!.childrenLoaded = false;
    vi.mocked(getTaxonNode).mockResolvedValue({
      taxId: "7215", name: "Drosophilidae", rank: "family", parentId: "2759",
      ancestorIds: ["131567", "2759"], childIds: ["7214"], classification: {}, counts: {},
    });
    vi.mocked(resolveTaxonNames).mockRejectedValue(new Error("network"));

    const spliced = await drillNode(pool, "7215");
    expect(spliced).toEqual(["7214"]);
    expect(pool.byId.get("7214")!.name).toBe("Taxon 7214");
  });

  it("handles a leaf with no live children", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    pool.byId.get("7215")!.childrenLoaded = false;
    vi.mocked(getTaxonNode).mockResolvedValue({
      taxId: "7215", name: "Drosophilidae", rank: "family", parentId: "2759",
      ancestorIds: ["131567", "2759"], childIds: [], classification: {}, counts: {},
    });
    const spliced = await drillNode(pool, "7215");
    expect(spliced).toEqual([]);
    expect(pool.byId.get("7215")!.childrenLoaded).toBe(true);
  });
});

describe("findPoolNode + pathToNode", () => {
  it("finds a node and the root-down path to it", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    expect(findPoolNode(pool, "2759")!.name).toBe("Eukaryota");
    const path = pathToNode(pool, "7215");
    expect(path).toEqual([SYNTHETIC_ROOT_ID, "131567", "2759", "7215"]);
  });

  it("returns null for an unknown id", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    expect(pathToNode(pool, "999999")).toBeNull();
    expect(findPoolNode(pool, "999999")).toBeUndefined();
  });
});

describe("drillNode deeper-drill guard (genus -> species and no double-load)", () => {
  it("drills a genus the same way as a family (not capped at one level)", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    // Splice a genus in as a live node with childrenLoaded false (as a family
    // drill would have left it), then drill THAT genus for its species.
    pool.byId.set("7214", {
      id: "7214", name: "Drosophila", rank: "genus", speciesCount: 1,
      childIds: [], origin: "live", childrenLoaded: false,
    });
    pool.byId.get("7215")!.childIds = ["7214"];

    vi.mocked(getTaxonNode).mockResolvedValue({
      taxId: "7214", name: "Drosophila", rank: "genus", parentId: "7215",
      ancestorIds: ["131567", "2759", "7215"], childIds: ["7227"],
      classification: {}, counts: {},
    });
    vi.mocked(resolveTaxonNames).mockResolvedValue(
      new Map([["7227", { taxId: "7227", name: "Drosophila melanogaster", rank: "species" }]]),
    );

    const spliced = await drillNode(pool, "7214");
    expect(spliced).toEqual(["7227"]);
    expect(pool.byId.get("7214")!.childIds).toEqual(["7227"]);
    expect(pool.byId.get("7214")!.childrenLoaded).toBe(true);
    expect(pool.byId.get("7227")!.name).toBe("Drosophila melanogaster");
    expect(pool.byId.get("7227")!.childrenLoaded).toBe(false);
  });

  it("does not re-fetch a node already drilled (guard against double-load)", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    pool.byId.get("7215")!.childrenLoaded = false;
    vi.mocked(getTaxonNode).mockResolvedValue({
      taxId: "7215", name: "Drosophilidae", rank: "family", parentId: "2759",
      ancestorIds: ["131567", "2759"], childIds: ["7214"],
      classification: {}, counts: {},
    });
    vi.mocked(resolveTaxonNames).mockResolvedValue(
      new Map([["7214", { taxId: "7214", name: "Drosophila", rank: "genus" }]]),
    );

    await drillNode(pool, "7215");
    expect(getTaxonNode).toHaveBeenCalledTimes(1);
    // A second drill of the now-loaded node is a no-op (no extra fetch).
    const again = await drillNode(pool, "7215");
    expect(again).toEqual(["7214"]);
    expect(getTaxonNode).toHaveBeenCalledTimes(1);
  });
});

describe("spliceLineagePath (below-family search splice, pure)", () => {
  it("threads a missing chain under an in-pool anchor and wires the links", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    // Anchor is the family 7215; splice genus 7214 then species 7227 under it.
    const added = spliceLineagePath(pool, "7215", [
      { id: "7214", name: "Drosophila", rank: "genus" },
      { id: "7227", name: "Drosophila melanogaster", rank: "species" },
    ]);
    expect(added).toEqual(["7214", "7227"]);
    expect(pool.byId.get("7215")!.childIds).toContain("7214");
    expect(pool.byId.get("7214")!.childIds).toContain("7227");
    expect(pool.byId.get("7227")!.rank).toBe("species");
    // The whole path is now reachable root-down to the target.
    expect(pathToNode(pool, "7227")).toEqual([
      SYNTHETIC_ROOT_ID, "131567", "2759", "7215", "7214", "7227",
    ]);
  });

  it("skips ids already present and does not duplicate child links", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    spliceLineagePath(pool, "7215", [{ id: "7214", name: "Drosophila", rank: "genus" }]);
    const added2 = spliceLineagePath(pool, "7215", [
      { id: "7214", name: "Drosophila", rank: "genus" },
      { id: "7227", name: "D. melanogaster", rank: "species" },
    ]);
    expect(added2).toEqual(["7227"]); // 7214 was already there
    expect(pool.byId.get("7215")!.childIds.filter((c) => c === "7214")).toHaveLength(1);
  });

  it("is a no-op when the anchor is not in the pool", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    const added = spliceLineagePath(pool, "999999", [{ id: "1", name: "x", rank: "genus" }]);
    expect(added).toEqual([]);
    expect(pool.byId.has("1")).toBe(false);
  });
});

describe("resolveLineageToPool (below-family search-zoom resolution)", () => {
  it("walks the lineage, finds the in-pool anchor, and splices down to the target", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    // Target species 7227 sits below the family 7215 (in the pool). Its lineage
    // ancestorIds is root-first and excludes self.
    vi.mocked(getTaxonNode).mockResolvedValue({
      taxId: "7227", name: "Drosophila melanogaster", rank: "species", parentId: "7214",
      ancestorIds: ["131567", "2759", "7215", "7214"], childIds: [],
      classification: {}, counts: {},
    });
    vi.mocked(resolveTaxonNames).mockResolvedValue(
      new Map([["7214", { taxId: "7214", name: "Drosophila", rank: "genus" }]]),
    );

    const res = await resolveLineageToPool(pool, "7227");
    expect(res).not.toBeNull();
    expect(res!.anchorId).toBe("7215"); // deepest in-pool ancestor
    expect(res!.targetId).toBe("7227");
    expect(res!.added).toEqual(["7214", "7227"]);
    expect(pool.byId.get("7227")!.name).toBe("Drosophila melanogaster");
    expect(pathToNode(pool, "7227")).toEqual([
      SYNTHETIC_ROOT_ID, "131567", "2759", "7215", "7214", "7227",
    ]);
  });

  it("returns the target as its own anchor when it is already in the pool (no fetch)", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    const res = await resolveLineageToPool(pool, "7215");
    expect(res).toEqual({ anchorId: "7215", targetId: "7215", added: [] });
    expect(getTaxonNode).not.toHaveBeenCalled();
  });

  it("returns null when the target has no in-pool ancestor (off the backbone)", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    vi.mocked(getTaxonNode).mockResolvedValue({
      taxId: "555", name: "Off backbone", rank: "species", parentId: "444",
      ancestorIds: ["111", "222", "444"], childIds: [],
      classification: {}, counts: {},
    });
    const res = await resolveLineageToPool(pool, "555");
    expect(res).toBeNull();
  });
});
