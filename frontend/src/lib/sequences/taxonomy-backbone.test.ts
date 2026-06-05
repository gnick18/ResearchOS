// sequence editor master: taxonomy backbone tests (stage 1).
//
// Two layers.
//   1. The pure build transform on a tiny synthetic taxdump (no network), proving
//      the keep set, the re-parenting that collapses unranked intermediates, the
//      derived childIds, and the species-under counts.
//   2. The loader against the REAL emitted backbone.json under public/, proving
//      the bundle is sane (the two backbone roots, the cellular domains as their
//      children, a known family resolving with a parent chain up to a domain, and
//      a below-family genus being absent).
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildBackbone,
  parseNodes,
  parseNames,
} from "../../../../tools/taxonomy-backbone/transform.mjs";
import {
  getBackboneNode,
  backboneChildren,
  backboneSiblings,
  backboneRoots,
  type BackboneNode,
} from "./taxonomy-backbone";

// ---------------------------------------------------------------------------
// Layer 1: the pure transform on a synthetic taxdump.
//
// A hand-written mini tree:
//   1   no rank      root (self-parent, the taxdump convention)
//   10  domain       child of 1                 KEPT (root of backbone)
//   20  no rank      child of 10 (unranked)     dropped, collapsed away
//   30  family       child of 20                KEPT, re-parented to 10
//   40  genus        child of 30 (below family) dropped
//   50  species      child of 40                species under family 30
//   51  species      child of 40                species under family 30
//   60  order        child of 10                KEPT, child of 10
//   70  family       child of 60                KEPT, child of 60
//   80  species      child of 70                species under family 70 + order 60
// ---------------------------------------------------------------------------

const NODES_DMP = [
  "1\t|\t1\t|\tno rank\t|",
  "10\t|\t1\t|\tdomain\t|",
  "20\t|\t10\t|\tno rank\t|",
  "30\t|\t20\t|\tfamily\t|",
  "40\t|\t30\t|\tgenus\t|",
  "50\t|\t40\t|\tspecies\t|",
  "51\t|\t40\t|\tspecies\t|",
  "60\t|\t10\t|\torder\t|",
  "70\t|\t60\t|\tfamily\t|",
  "80\t|\t70\t|\tspecies\t|",
].join("\n");

const NAMES_DMP = [
  "1\t|\troot\t|\t\t|\tscientific name\t|",
  "10\t|\tDomainia\t|\t\t|\tscientific name\t|",
  "20\t|\tUnrankedia\t|\t\t|\tscientific name\t|",
  "30\t|\tFamilia\t|\t\t|\tscientific name\t|",
  // A synonym row that must be ignored (not a scientific name).
  "30\t|\tFamilia synonym\t|\t\t|\tsynonym\t|",
  "40\t|\tGenusia\t|\t\t|\tscientific name\t|",
  "50\t|\tSpeciesia one\t|\t\t|\tscientific name\t|",
  "51\t|\tSpeciesia two\t|\t\t|\tscientific name\t|",
  "60\t|\tOrderia\t|\t\t|\tscientific name\t|",
  "70\t|\tFamilia two\t|\t\t|\tscientific name\t|",
  "80\t|\tSpeciesia three\t|\t\t|\tscientific name\t|",
].join("\n");

describe("buildBackbone transform", () => {
  const nodes = parseNodes(NODES_DMP);
  const names = parseNames(NAMES_DMP);
  const { nodes: backbone, rankCounts } = buildBackbone(nodes, names);
  const byId = new Map(backbone.map((n) => [n.i, n]));

  it("keeps exactly the family-and-above ranks", () => {
    expect([...byId.keys()].sort((a, b) => a - b)).toEqual([10, 30, 60, 70]);
    expect(byId.has(1)).toBe(false); // no rank
    expect(byId.has(20)).toBe(false); // unranked intermediate, collapsed
    expect(byId.has(40)).toBe(false); // genus, below family
    expect(byId.has(50)).toBe(false); // species
  });

  it("keeps scientific names only, ignoring synonyms", () => {
    expect(byId.get(30).n).toBe("Familia");
  });

  it("re-parents kept nodes to the nearest kept ancestor", () => {
    // 10 (domain) is the root, the no-rank id 1 is dropped, so its parent is null.
    expect(byId.get(10).p).toBeNull();
    // 30 (family) sat under the unranked 20; it collapses up to 10.
    expect(byId.get(30).p).toBe(10);
    // 60 (order) is a direct child of 10.
    expect(byId.get(60).p).toBe(10);
    // 70 (family) sits under the kept order 60.
    expect(byId.get(70).p).toBe(60);
  });

  it("derives childIds from the re-parented links", () => {
    expect(byId.get(10).c.sort((a: number, b: number) => a - b)).toEqual([30, 60]);
    expect(byId.get(60).c).toEqual([70]);
    expect(byId.get(30).c).toEqual([]);
    expect(byId.get(70).c).toEqual([]);
  });

  it("counts species under each kept node over the full tree", () => {
    // Family 30 has two species (50, 51) under its dropped genus 40.
    expect(byId.get(30).s).toBe(2);
    // Family 70 has one species (80).
    expect(byId.get(70).s).toBe(1);
    // Order 60 carries the one species under its family 70.
    expect(byId.get(60).s).toBe(1);
    // Domain 10 carries all three species in the tree.
    expect(byId.get(10).s).toBe(3);
  });

  it("reports per-rank counts", () => {
    expect(rankCounts).toEqual({ domain: 1, family: 2, order: 1 });
  });
});

// ---------------------------------------------------------------------------
// Layer 2: the loader against the real emitted backbone.json.
// ---------------------------------------------------------------------------

interface CompactNode {
  i: number;
  n: string;
  r: string;
  p: number | null;
  c: number[];
  s: number;
}

const PUBLIC_DIR = join(__dirname, "../../../public/taxonomy-backbone");

// Build a LoadedBackbone directly from the file to exercise the helper functions
// without mocking fetch. The loadBackbone() fetch+cache path is the same mapping.
function indexCompact(compact: CompactNode[]) {
  const byId = new Map<number, BackboneNode>();
  const roots: BackboneNode[] = [];
  for (const c of compact) {
    const node: BackboneNode = {
      taxId: c.i,
      name: c.n,
      rank: c.r,
      parentId: c.p,
      childIds: c.c,
      speciesCount: c.s,
    };
    byId.set(node.taxId, node);
    if (node.parentId === null) roots.push(node);
  }
  return { byId, roots };
}

describe("real backbone.json sanity", () => {
  let backbone: ReturnType<typeof indexCompact>;

  beforeAll(() => {
    const raw = readFileSync(join(PUBLIC_DIR, "backbone.json"), "utf8");
    backbone = indexCompact(JSON.parse(raw) as CompactNode[]);
  });

  it("has the two backbone roots cellular organisms and Viruses", () => {
    const rootNames = backboneRoots(backbone).map((r) => r.name).sort();
    expect(rootNames).toEqual(["Viruses", "cellular organisms"]);
  });

  it("places the three cellular domains directly under cellular organisms", () => {
    const cellular = backboneRoots(backbone).find(
      (r) => r.name === "cellular organisms",
    )!;
    const domainIds = backboneChildren(backbone, cellular.taxId).map((n) => n.taxId);
    expect(domainIds).toContain(2); // Bacteria
    expect(domainIds).toContain(2157); // Archaea
    expect(domainIds).toContain(2759); // Eukaryota
    for (const id of [2, 2157, 2759]) {
      expect(getBackboneNode(backbone, id)!.rank).toBe("domain");
    }
  });

  it("resolves Hominidae (9604) as a family with a chain up to a domain", () => {
    const hominidae = getBackboneNode(backbone, 9604);
    expect(hominidae).toBeDefined();
    expect(hominidae!.rank).toBe("family");
    // A sane species-under count (a handful, not zero, not millions).
    expect(hominidae!.speciesCount).toBeGreaterThan(0);
    expect(hominidae!.speciesCount).toBeLessThan(1000);

    // Walk the parent chain and assert it reaches the Eukaryota domain.
    const ranks: string[] = [];
    let cur: BackboneNode | undefined = hominidae!;
    let domainReached = false;
    let guard = 0;
    while (cur && guard++ < 50) {
      ranks.push(cur.rank);
      if (cur.taxId === 2759) domainReached = true;
      cur = cur.parentId !== null ? getBackboneNode(backbone, cur.parentId) : undefined;
    }
    expect(domainReached).toBe(true);
    expect(ranks).toContain("order"); // Primates is in the chain
  });

  it("excludes below-family ids (Homo 9605 genus is not in the backbone)", () => {
    expect(getBackboneNode(backbone, 9605)).toBeUndefined();
  });

  it("derives siblings as the parent's other children minus self", () => {
    const hominidae = getBackboneNode(backbone, 9604)!;
    const siblings = backboneSiblings(backbone, hominidae.taxId);
    // Siblings are the other children of Hominoidea (the superfamily parent).
    expect(siblings.every((s) => s.taxId !== hominidae.taxId)).toBe(true);
    expect(siblings.every((s) => s.parentId === hominidae.parentId)).toBe(true);
  });
});
