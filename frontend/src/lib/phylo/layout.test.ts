import { describe, it, expect } from "vitest";
import { parseNewick, leaves, tipCount, type TreeNode } from "./parse";
import {
  layoutRectangular,
  layoutCircular,
  ladderize,
  collapseClade,
  mrca,
  rotateNode,
  rerootOnNode,
  midpointRoot,
  parseCsv,
  matchMetadataToTips,
  bestTipColumn,
  tipColumnMatchRate,
  type LayoutOptions,
} from "./layout";

const OPTS: LayoutOptions = {
  width: 560,
  height: 420,
  rightInset: 120,
  padding: 16,
  phylogram: true,
};

describe("layoutRectangular", () => {
  it("places every node and keeps leaves in tip order", () => {
    const t = parseNewick("((A:0.1,B:0.1):0.2,C:0.3);");
    const lo = layoutRectangular(t, OPTS);
    expect(lo.kind).toBe("rectangular");
    // root + 1 internal + 3 leaves = 5
    expect(lo.nodes).toHaveLength(5);
    const byName = new Map(
      lo.nodes.filter((p) => p.node.name).map((p) => [p.node.name, p]),
    );
    // Leaves are ordered top to bottom by y.
    expect(byName.get("A")!.y).toBeLessThan(byName.get("C")!.y);
  });

  it("phylogram x reflects cumulative branch length, cladogram reflects rank", () => {
    const t = parseNewick("((A:0.1,B:0.1):0.5,C:0.1);");
    const phylo = layoutRectangular(t, { ...OPTS, phylogram: true });
    const clado = layoutRectangular(t, { ...OPTS, phylogram: false });
    const aPhylo = phylo.nodes.find((p) => p.node.name === "A")!;
    const cPhylo = phylo.nodes.find((p) => p.node.name === "C")!;
    // A is deeper (0.6) than C (0.1) in the phylogram.
    expect(aPhylo.x).toBeGreaterThan(cPhylo.x);
    // In the cladogram, tips at the same rank align on x regardless of branch
    // length (A and B are both rank-2 leaves, so their x must match exactly).
    const aClado = clado.nodes.find((p) => p.node.name === "A")!;
    const bClado = clado.nodes.find((p) => p.node.name === "B")!;
    expect(aClado.x).toBeCloseTo(bClado.x);
    expect(clado.unitsPerPx).toBeNull();
  });

  it("links parent coordinates for edge drawing", () => {
    const t = parseNewick("(A,B);");
    const lo = layoutRectangular(t, OPTS);
    const a = lo.nodes.find((p) => p.node.name === "A")!;
    expect(a.parentX).not.toBeNull();
    expect(a.parentY).not.toBeNull();
  });
});

describe("layoutCircular", () => {
  it("centers the layout and places all nodes", () => {
    const t = parseNewick("((A,B),(C,D));");
    const lo = layoutCircular(t, OPTS);
    expect(lo.kind).toBe("circular");
    expect(lo.cx).toBeCloseTo(280);
    // cy is nudged down by TOP_ROOM (10px) so the topmost tips do not clip.
    expect(lo.cy).toBeCloseTo(220);
    expect(lo.nodes).toHaveLength(7); // root + 2 internal + 4 leaves
  });
});

describe("ladderize", () => {
  it("orders children so the smaller clade sits first (ascending)", () => {
    // Left child is a 2-tip clade, right child is a single tip.
    const t = parseNewick("((A,B),C);");
    const lad = ladderize(t, true);
    // Smaller (single tip C) should come first.
    expect(lad.children[0].children.length).toBe(0);
    expect(lad.children[0].name).toBe("C");
  });

  it("does not mutate the input tree", () => {
    const t = parseNewick("((A,B),C);");
    const before = t.children.map((c) => c.children.length);
    ladderize(t, true);
    expect(t.children.map((c) => c.children.length)).toEqual(before);
  });
});

describe("mrca (find a clade by tip names)", () => {
  // ((A,B),(C,D)): MRCA(A,B) is the left clade root; MRCA(A,C) is the whole-tree
  // root; MRCA(A,B,C) is also the root; a missing name is undefinable.
  const t = parseNewick("((A,B),(C,D));");
  const idOf = (name: string) => leaves(t).find((l) => l.name === name)!.id;

  it("finds the MRCA of two sister tips (the clade above them, not a tip)", () => {
    const node = mrca(t, ["A", "B"]);
    expect(node).not.toBeNull();
    expect(node).not.toBe(idOf("A"));
    expect(node).not.toBe(idOf("B"));
    // The (A,B) clade has exactly tips A and B beneath it.
    const found = (function find(n): TreeNode | null {
      if (n.id === node) return n;
      for (const c of n.children) {
        const r = find(c);
        if (r) return r;
      }
      return null;
    })(t);
    expect(leaves(found!).map((l) => l.name).sort()).toEqual(["A", "B"]);
  });

  it("MRCA of tips in different clades is the deeper shared ancestor", () => {
    const ab = mrca(t, ["A", "B"]);
    const ac = mrca(t, ["A", "C"]);
    expect(ac).not.toBeNull();
    expect(ac).not.toBe(ab); // A and C only meet at the root
  });

  it("returns null when a named tip is not in the tree", () => {
    expect(mrca(t, ["A", "Nope"])).toBeNull();
  });

  it("returns null for an empty set", () => {
    expect(mrca(t, [])).toBeNull();
  });
});

describe("rotateNode (flip a clade)", () => {
  it("reverses a node's child order and preserves the tip set", () => {
    const t = parseNewick("((A,B),(C,D));");
    const rotated = rotateNode(t, t.id);
    expect(rotated.children[0].id).toBe(t.children[1].id);
    expect(rotated.children[1].id).toBe(t.children[0].id);
    expect(leaves(rotated).map((l) => l.name).sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
});

describe("collapseClade", () => {
  it("drops a clade's children and names it", () => {
    const t = parseNewick("((A,B)Clade1,C);");
    const clade = t.children.find((c) => c.name === "Clade1")!;
    const collapsed = collapseClade(t, clade.id);
    const node = collapsed.children.find((c) => c.id === clade.id)!;
    expect(node.children).toHaveLength(0);
    expect(node.name).toBe("Clade1");
    expect(tipCount(collapsed)).toBe(2); // Clade1 (now a tip) + C
  });
});

describe("rerootOnNode", () => {
  it("makes the chosen branch descend from a fresh root", () => {
    const t = parseNewick("((A:0.1,B:0.1):0.2,(C:0.1,D:0.1):0.2);");
    const outgroup = leaves(t).find((l) => l.name === "C")!;
    const rerooted = rerootOnNode(t, outgroup.id);
    // Same tips after rerooting (nothing dropped).
    expect(leaves(rerooted).map((l) => l.name).sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    // New root has two children and the outgroup is directly under it.
    expect(rerooted.children).toHaveLength(2);
    const hasOutgroupChild = rerooted.children.some((c) => c.name === "C");
    expect(hasOutgroupChild).toBe(true);
  });

  it("returns a tree with the same tip count for midpoint rooting", () => {
    const t = parseNewick("((A:0.1,B:0.5):0.2,(C:0.1,D:0.1):0.2);");
    const mid = midpointRoot(t);
    expect(tipCount(mid)).toBe(4);
    expect(mid.children.length).toBeGreaterThanOrEqual(2);
  });
});

describe("parseCsv", () => {
  it("parses headers and rows", () => {
    const csv = "tip,section,genome\nA,Fumigati,29.4\nB,Flavi,37.0";
    const parsed = parseCsv(csv);
    expect(parsed.columns).toEqual(["tip", "section", "genome"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({ tip: "A", section: "Fumigati", genome: "29.4" });
  });

  it("respects quoted values containing commas", () => {
    const csv = 'tip,note\nA,"hello, world"';
    const parsed = parseCsv(csv);
    expect(parsed.rows[0].note).toBe("hello, world");
  });

  it("parses TSV when no commas are present", () => {
    const tsv = "tip\tsection\nA\tFumigati";
    const parsed = parseCsv(tsv);
    expect(parsed.columns).toEqual(["tip", "section"]);
    expect(parsed.rows[0].section).toBe("Fumigati");
  });
});

describe("matchMetadataToTips", () => {
  const tree: TreeNode = parseNewick("('A. fumigatus','A. flavus',Lonely);");

  it("matches exact tip names", () => {
    const rows = [
      { tip: "A. fumigatus", sec: "Fumigati" },
      { tip: "A. flavus", sec: "Flavi" },
    ];
    const m = matchMetadataToTips(tree, rows, "tip");
    expect(m.matched.size).toBe(2);
    expect(m.unmatchedTips).toEqual(["Lonely"]);
  });

  it("fuzzy-matches across case / underscore / dot differences", () => {
    const rows = [{ tip: "a_fumigatus", sec: "Fumigati" }];
    const m = matchMetadataToTips(tree, rows, "tip");
    // "A. fumigatus" normalizes to "a fumigatus" == "a_fumigatus".
    expect(m.matched.size).toBe(1);
  });

  it("surfaces metadata rows that match no tip, never dropping silently", () => {
    const rows = [
      { tip: "A. fumigatus", sec: "Fumigati" },
      { tip: "Ghost", sec: "Nowhere" },
    ];
    const m = matchMetadataToTips(tree, rows, "tip");
    expect(m.unmatchedRows).toEqual(["Ghost"]);
  });
});

describe("composite-label + auto-column matching", () => {
  it("joins composite tip labels on a single token (strain or accession)", () => {
    const tree = parseNewick("((SC144|FJ385264,PPH58|D90400),SC100|FJ385261);");
    const byStrain = [
      { id: "SC144", lineage: "A" },
      { id: "PPH58", lineage: "B" },
      { id: "SC100", lineage: "C" },
    ];
    const m1 = matchMetadataToTips(tree, byStrain, "id");
    expect(m1.matched.size).toBe(3);
    expect(m1.unmatchedTips).toEqual([]);
    // and the same tree joined on the accession half instead
    const byAcc = [
      { id: "FJ385264", lineage: "A" },
      { id: "D90400", lineage: "B" },
      { id: "FJ385261", lineage: "C" },
    ];
    expect(matchMetadataToTips(tree, byAcc, "id").matched.size).toBe(3);
  });

  it("does not guess when a token points at more than one row", () => {
    const tree = parseNewick("(human_AB12,human_CD34);");
    // "human" is shared by both rows, so it is ambiguous and must NOT join
    const rows = [
      { id: "human_one", x: "1" },
      { id: "human_two", x: "2" },
    ];
    const m = matchMetadataToTips(tree, rows, "id");
    expect(m.matched.size).toBe(0);
  });

  it("bestTipColumn picks the column that matches the most tips", () => {
    const tree = parseNewick("((B11201,B11207),B11200);");
    const rows = [
      { sample: "x1", strain: "B11201", country: "US" },
      { sample: "x2", strain: "B11207", country: "UK" },
      { sample: "x3", strain: "B11200", country: "US" },
    ];
    expect(bestTipColumn(tree, rows, ["sample", "strain", "country"])).toBe("strain");
    expect(tipColumnMatchRate(tree, rows, "strain")).toBe(1);
    expect(tipColumnMatchRate(tree, rows, "sample")).toBe(0);
  });
});
