// sequence editor master. Tests for the taxonomy tree explorer data layer:
//   - getTaxonNode / suggestTaxa / batch-name parsing against SAVED real
//     responses (parents -> parentId, children, counts, classification)
//   - the backbone-vs-live merge in taxonomy-explorer (a family resolves from
//     the backbone, a genus / species resolves live)
//   - sibling derivation and child naming
// No network in the tests; the live calls are stubbed against the fixtures.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  parseExplorerNode,
  parseExplorerNodeMap,
  parseTaxonSuggestions,
} from "./ncbi-datasets";
import report9605 from "./__fixtures__/taxonomy-tree/report-9605.json";
import report9606 from "./__fixtures__/taxonomy-tree/report-9606.json";
import report7215 from "./__fixtures__/taxonomy-tree/report-7215.json";
import batch9605Children from "./__fixtures__/taxonomy-tree/batch-9605-children.json";
import suggestDroso from "./__fixtures__/taxonomy-tree/suggest-droso.json";

describe("parseExplorerNode", () => {
  it("normalizes the Homo genus report (parents -> parentId, children, counts, classification)", () => {
    const node = parseExplorerNode(report9605);
    expect(node.taxId).toBe("9605");
    expect(node.name).toBe("Homo");
    expect(node.rank).toBe("genus");
    // parentId is the LAST entry of the parents lineage (root -> parent order).
    // For Homo that is Homininae (207598, the subfamily), not the Hominidae
    // family, because NCBI inserts intermediate ranks.
    expect(node.parentId).toBe("207598");
    expect(node.childIds).toEqual(["2665952", "2813598", "9606", "1425170"]);
    // counts array mapped to named fields.
    expect(node.counts.assemblies).toBe(2564);
    expect(node.counts.genes).toBe(193908);
    // classification carries the named major ranks.
    expect(node.classification.family).toBe("Hominidae");
    expect(node.classification.domain).toBe("Eukaryota");
  });

  it("normalizes a species report (Homo sapiens)", () => {
    const node = parseExplorerNode(report9606);
    expect(node.taxId).toBe("9606");
    expect(node.name).toBe("Homo sapiens");
    expect(node.rank).toBe("species");
    expect(node.parentId).toBe("9605"); // Homo genus
  });

  it("throws a clear error on an empty report", () => {
    expect(() => parseExplorerNode({ reports: [] })).toThrow(/No taxon matched/);
  });
});

describe("parseExplorerNodeMap (batch child naming)", () => {
  it("maps a comma-separated batch report to tax id -> name + rank", () => {
    const map = parseExplorerNodeMap(batch9605Children);
    expect(map.get("9606")?.name).toBe("Homo sapiens");
    expect(map.get("9606")?.rank).toBe("species");
    expect(map.get("1425170")?.name).toBe("Homo heidelbergensis");
    // A child whose report carries no rank still resolves a name.
    expect(map.get("2665952")?.name).toBe("environmental samples");
  });
});

describe("parseTaxonSuggestions", () => {
  it("parses the taxon_suggest autocomplete response", () => {
    const out = parseTaxonSuggestions(suggestDroso);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].taxId).toBe("7227");
    expect(out[0].name).toBe("Drosophila melanogaster");
    expect(out[0].rank).toBe("species");
  });

  it("returns an empty list on a shape with no suggestions", () => {
    expect(parseTaxonSuggestions({})).toEqual([]);
  });
});

// --- The backbone-vs-live merge --------------------------------------------
//
// resolveExplorerNode prefers the curated backbone (family and above) and falls
// back to the live Datasets API below family. We stub the live client and the
// backbone loader so the merge logic is tested without network or the bundled
// JSON.

describe("taxonomy-explorer merge (backbone vs live)", () => {
  // A tiny fake backbone: Hominidae (family, 9604) with no kept children (genera
  // are below the backbone), under a Primates order (9443).
  const fakeBackbone = {
    byId: new Map<number, {
      taxId: number;
      name: string;
      rank: string;
      parentId: number | null;
      childIds: number[];
      speciesCount: number;
    }>([
      [9443, { taxId: 9443, name: "Primates", rank: "order", parentId: null, childIds: [9604], speciesCount: 500 }],
      [9604, { taxId: 9604, name: "Hominidae", rank: "family", parentId: 9443, childIds: [], speciesCount: 16 }],
    ]),
    roots: [
      { taxId: 9443, name: "Primates", rank: "order", parentId: null, childIds: [9604], speciesCount: 500 },
    ],
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("resolves a family from the backbone (offline, with a species count)", async () => {
    vi.doMock("./taxonomy-backbone", async () => {
      const actual = await vi.importActual<typeof import("./taxonomy-backbone")>(
        "./taxonomy-backbone",
      );
      return {
        ...actual,
        loadBackbone: vi.fn(async () => fakeBackbone),
      };
    });
    const getTaxonNode = vi.fn();
    vi.doMock("./ncbi-datasets", async () => {
      const actual = await vi.importActual<typeof import("./ncbi-datasets")>(
        "./ncbi-datasets",
      );
      return { ...actual, getTaxonNode };
    });

    const { resolveExplorerNode } = await import("./taxonomy-explorer");
    const node = await resolveExplorerNode("9604");
    expect(node.origin).toBe("backbone");
    expect(node.name).toBe("Hominidae");
    expect(node.speciesCount).toBe(16);
    expect(node.parentId).toBe("9443");
    // The live client is never called for a backbone node.
    expect(getTaxonNode).not.toHaveBeenCalled();
  });

  it("falls back to the live API for a genus below the backbone", async () => {
    vi.doMock("./taxonomy-backbone", async () => {
      const actual = await vi.importActual<typeof import("./taxonomy-backbone")>(
        "./taxonomy-backbone",
      );
      return {
        ...actual,
        loadBackbone: vi.fn(async () => fakeBackbone),
      };
    });
    const getTaxonNode = vi.fn(async () => parseExplorerNode(report9605));
    vi.doMock("./ncbi-datasets", async () => {
      const actual = await vi.importActual<typeof import("./ncbi-datasets")>(
        "./ncbi-datasets",
      );
      return { ...actual, getTaxonNode };
    });

    const { resolveExplorerNode, __resetExplorerLiveCache } = await import(
      "./taxonomy-explorer"
    );
    __resetExplorerLiveCache();
    const node = await resolveExplorerNode("9605"); // Homo genus, not in the fake backbone
    expect(node.origin).toBe("live");
    expect(node.name).toBe("Homo");
    expect(node.assembliesCount).toBe(2564);
    expect(getTaxonNode).toHaveBeenCalledTimes(1);
    // Child refs from the live node start name-less (ids only).
    expect(node.childRefs.map((c) => c.taxId)).toEqual([
      "2665952",
      "2813598",
      "9606",
      "1425170",
    ]);
    expect(node.childRefs.every((c) => c.name === "")).toBe(true);
  });

  it("resolveSiblings derives a node's siblings as the parent's other children", async () => {
    // Backbone with an order that has two family children, so the families are
    // siblings via the backbone path.
    const sibBackbone = {
      byId: new Map<number, {
        taxId: number;
        name: string;
        rank: string;
        parentId: number | null;
        childIds: number[];
        speciesCount: number;
      }>([
        [9443, { taxId: 9443, name: "Primates", rank: "order", parentId: null, childIds: [9604, 9479], speciesCount: 500 }],
        [9604, { taxId: 9604, name: "Hominidae", rank: "family", parentId: 9443, childIds: [], speciesCount: 16 }],
        [9479, { taxId: 9479, name: "Cebidae", rank: "family", parentId: 9443, childIds: [], speciesCount: 50 }],
      ]),
      roots: [
        { taxId: 9443, name: "Primates", rank: "order", parentId: null, childIds: [9604, 9479], speciesCount: 500 },
      ],
    };
    vi.doMock("./taxonomy-backbone", async () => {
      const actual = await vi.importActual<typeof import("./taxonomy-backbone")>(
        "./taxonomy-backbone",
      );
      return { ...actual, loadBackbone: vi.fn(async () => sibBackbone) };
    });
    vi.doMock("./ncbi-datasets", async () => {
      const actual = await vi.importActual<typeof import("./ncbi-datasets")>(
        "./ncbi-datasets",
      );
      return { ...actual, getTaxonNode: vi.fn() };
    });

    const { resolveExplorerNode, resolveSiblings } = await import(
      "./taxonomy-explorer"
    );
    const hominidae = await resolveExplorerNode("9604");
    const sibs = await resolveSiblings(hominidae);
    expect(sibs.map((s) => s.taxId)).toEqual(["9479"]);
    expect(sibs[0].name).toBe("Cebidae");
  });

  it("resolveChildNames batch-names live children", async () => {
    vi.doMock("./taxonomy-backbone", async () => {
      const actual = await vi.importActual<typeof import("./taxonomy-backbone")>(
        "./taxonomy-backbone",
      );
      return { ...actual, loadBackbone: vi.fn(async () => fakeBackbone) };
    });
    const resolveTaxonNames = vi.fn(async () => parseExplorerNodeMap(batch9605Children));
    vi.doMock("./ncbi-datasets", async () => {
      const actual = await vi.importActual<typeof import("./ncbi-datasets")>(
        "./ncbi-datasets",
      );
      return {
        ...actual,
        getTaxonNode: vi.fn(async () => parseExplorerNode(report9605)),
        resolveTaxonNames,
      };
    });

    const { resolveExplorerNode, resolveChildNames, __resetExplorerLiveCache } =
      await import("./taxonomy-explorer");
    __resetExplorerLiveCache();
    const homo = await resolveExplorerNode("9605");
    const named = await resolveChildNames(homo);
    expect(resolveTaxonNames).toHaveBeenCalledTimes(1);
    const sapiens = named.find((c) => c.taxId === "9606");
    expect(sapiens?.name).toBe("Homo sapiens");
  });

  it("the Drosophila genus report normalizes its 9 children", async () => {
    // Pure-parse sanity on a second real genus fixture.
    const node = parseExplorerNode(report7215);
    expect(node.name).toBe("Drosophila");
    expect(node.rank).toBe("genus");
    expect(node.childIds.length).toBe(9);
    expect(node.counts.assemblies).toBe(633);
  });
});
