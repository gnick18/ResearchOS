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
  drillSubtreeToDepth,
  windowNeedsDrill,
  findPoolNode,
  pathToNode,
  spliceLineagePath,
  resolveLineageToPool,
  currentFocus,
  pushFocus,
  popFocus,
  focusTo,
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
        ["7214", { taxId: "7214", name: "Drosophila", rank: "genus", assemblies: 312 }],
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
    // The batch dataset_report carries each child's assembly count, threaded onto
    // the spliced pool node so the genus-or-below branch width can read it.
    expect(pool.byId.get("7214")!.assemblyCount).toBe(312);
    expect(pool.byId.get("7220")!.assemblyCount).toBeUndefined();
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

describe("focus stack (the re-rooting navigation, pure)", () => {
  it("currentFocus reads the top, falling back to the root for an empty stack", () => {
    expect(currentFocus([SYNTHETIC_ROOT_ID, "a", "b"])).toBe("b");
    expect(currentFocus([])).toBe(SYNTHETIC_ROOT_ID);
  });

  it("pushFocus drills in by pushing a new center", () => {
    const start = [SYNTHETIC_ROOT_ID];
    const next = pushFocus(start, "a");
    expect(next).toEqual([SYNTHETIC_ROOT_ID, "a"]);
    // The input is not mutated (a new array).
    expect(start).toEqual([SYNTHETIC_ROOT_ID]);
  });

  it("pushFocus is a no-op on the current center (no duplicate stacking)", () => {
    const stack = [SYNTHETIC_ROOT_ID, "a"];
    expect(pushFocus(stack, "a")).toBe(stack);
  });

  it("pushFocus walks back to an ancestor already in the stack rather than re-pushing", () => {
    const stack = [SYNTHETIC_ROOT_ID, "a", "b", "c"];
    // Clicking an ancestor (a) truncates to it, so the path stays a simple chain.
    expect(pushFocus(stack, "a")).toEqual([SYNTHETIC_ROOT_ID, "a"]);
  });

  it("popFocus goes back one level", () => {
    expect(popFocus([SYNTHETIC_ROOT_ID, "a", "b"])).toEqual([SYNTHETIC_ROOT_ID, "a"]);
  });

  it("popFocus is a no-op at the root (stack length 1)", () => {
    const root = [SYNTHETIC_ROOT_ID];
    expect(popFocus(root)).toBe(root);
    expect(popFocus([])).toEqual([]);
  });

  it("a drill-in then center-click chain walks back exactly one level per pop", () => {
    // full tree -> Kingdom -> Genus -> Species (a drill chain).
    let stack = [SYNTHETIC_ROOT_ID];
    stack = pushFocus(stack, "kingdom");
    stack = pushFocus(stack, "genus");
    stack = pushFocus(stack, "species");
    expect(currentFocus(stack)).toBe("species");
    // Center-click on Species returns to Genus, then Kingdom, then the root.
    stack = popFocus(stack);
    expect(currentFocus(stack)).toBe("genus");
    stack = popFocus(stack);
    expect(currentFocus(stack)).toBe("kingdom");
    stack = popFocus(stack);
    expect(currentFocus(stack)).toBe(SYNTHETIC_ROOT_ID);
    // At the bottom, a center-click does nothing.
    expect(popFocus(stack)).toBe(stack);
  });

  it("focusTo jumps straight to a crumb already in the stack", () => {
    const stack = [SYNTHETIC_ROOT_ID, "a", "b", "c"];
    expect(focusTo(stack, "b")).toEqual([SYNTHETIC_ROOT_ID, "a", "b"]);
    // A crumb not in the stack is a no-op.
    expect(focusTo(stack, "z")).toBe(stack);
  });
});

describe("drillSubtreeToDepth (below-family fan-out window load)", () => {
  it("drills every level within the fan-out window below a family", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    // The family 7215 is a backbone leaf; drilling its window loads genus then
    // species (two levels below family) within a depth-2 window.
    pool.byId.get("7215")!.childrenLoaded = false;

    vi.mocked(getTaxonNode).mockImplementation(async (rawId: string | number) => {
      const id = String(rawId);
      if (id === "7215") {
        return {
          taxId: "7215", name: "Drosophilidae", rank: "family", parentId: "2759",
          ancestorIds: ["131567", "2759"], childIds: ["7214"],
          classification: {}, counts: {},
        };
      }
      // The genus 7214 drills to a species.
      return {
        taxId: "7214", name: "Drosophila", rank: "genus", parentId: "7215",
        ancestorIds: ["131567", "2759", "7215"], childIds: ["7227"],
        classification: {}, counts: {},
      };
    });
    vi.mocked(resolveTaxonNames).mockImplementation(async (rawIds: (string | number)[]) => {
      const ids = rawIds.map(String);
      const m = new Map<string, { taxId: string; name: string; rank: string }>();
      if (ids.includes("7214")) m.set("7214", { taxId: "7214", name: "Drosophila", rank: "genus" });
      if (ids.includes("7227")) m.set("7227", { taxId: "7227", name: "Drosophila melanogaster", rank: "species" });
      return m;
    });

    const added = await drillSubtreeToDepth(pool, "7215", 2);
    // Both the genus and the species were spliced (the whole window filled).
    expect(added).toContain("7214");
    expect(added).toContain("7227");
    expect(pool.byId.get("7214")!.childIds).toEqual(["7227"]);
    expect(pool.byId.get("7227")!.name).toBe("Drosophila melanogaster");
  });

  it("stops at the depth limit (does not drill past the window)", async () => {
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

    // Depth 1: only the family's direct children load; the genus is not drilled.
    const added = await drillSubtreeToDepth(pool, "7215", 1);
    expect(added).toEqual(["7214"]);
    // getTaxonNode was called once (for the family), not again for the genus.
    expect(getTaxonNode).toHaveBeenCalledTimes(1);
    expect(pool.byId.get("7214")!.childrenLoaded).toBe(false);
  });

  it("is a pure cache hit (no fetch) when the window is already loaded", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    // The backbone above family is fully loaded, so a shallow window over it does
    // not fetch.
    const added = await drillSubtreeToDepth(pool, SYNTHETIC_ROOT_ID, 2);
    expect(added).toEqual([]);
    expect(getTaxonNode).not.toHaveBeenCalled();
  });

  it("returns empty for an unknown focus or a zero depth", async () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    expect(await drillSubtreeToDepth(pool, "999999", 3)).toEqual([]);
    expect(await drillSubtreeToDepth(pool, "7215", 0)).toEqual([]);
  });
});

describe("windowNeedsDrill (the loading-note guard, pure)", () => {
  it("is true when an unloaded node sits inside the window (above the deepest drawn level)", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    pool.byId.get("7215")!.childrenLoaded = false; // a family to drill
    // tinyBackbone is root (L0) -> domain (L2) -> family (L3). The family sits at
    // the deepest drawn level of a depth-3 window, so its children are PAST the
    // window and the root-centered view does not need a drill. Centering the
    // family directly makes it level 0 and unloaded, so that DOES need a drill.
    expect(windowNeedsDrill(pool, SYNTHETIC_ROOT_ID, 3)).toBe(false);
    expect(windowNeedsDrill(pool, "7215", 3)).toBe(true);
    // A deeper window from the root reaches the family above its deepest level, so
    // it needs the drill.
    expect(windowNeedsDrill(pool, SYNTHETIC_ROOT_ID, 4)).toBe(true);
  });

  it("is false for a fully-loaded backbone window (a pure cache hit)", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    // Every backbone node here is loaded, so no drill is needed.
    expect(windowNeedsDrill(pool, SYNTHETIC_ROOT_ID, 3)).toBe(false);
    expect(windowNeedsDrill(pool, "2759", 3)).toBe(false);
  });

  it("is false for an unknown focus or zero depth", () => {
    const pool = buildPoolFromBackbone(tinyBackbone());
    pool.byId.get("7215")!.childrenLoaded = false;
    expect(windowNeedsDrill(pool, "999999", 3)).toBe(false);
    expect(windowNeedsDrill(pool, "7215", 0)).toBe(false);
  });
});
