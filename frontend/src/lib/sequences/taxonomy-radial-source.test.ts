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
      childIds: ["7214"], classification: {}, counts: {},
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
      childIds: [], classification: {}, counts: {},
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
