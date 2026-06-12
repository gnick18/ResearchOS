import { describe, it, expect } from "vitest";
import {
  parseNewick,
  parseTree,
  isNexus,
  leaves,
  allNodes,
  tipCount,
  TreeParseError,
} from "./parse";

describe("parseNewick", () => {
  it("parses a simple bifurcating tree with branch lengths", () => {
    const t = parseNewick("(A:0.1,B:0.2);");
    expect(t.children).toHaveLength(2);
    expect(t.children[0].name).toBe("A");
    expect(t.children[0].branchLength).toBe(0.1);
    expect(t.children[1].name).toBe("B");
    expect(t.children[1].branchLength).toBe(0.2);
  });

  it("parses nested clades and internal names", () => {
    const t = parseNewick("((A,B)Clade1,C);");
    expect(leaves(t).map((l) => l.name)).toEqual(["A", "B", "C"]);
    const internal = t.children.find((c) => c.children.length > 0);
    expect(internal?.name).toBe("Clade1");
  });

  it("reads numeric internal labels as support values", () => {
    const t = parseNewick("((A,B)95,C);");
    const internal = t.children.find((c) => c.children.length > 0);
    expect(internal?.support).toBe(95);
    expect(internal?.name).toBe("");
  });

  it("handles multifurcation", () => {
    const t = parseNewick("(A,B,C,D);");
    expect(t.children).toHaveLength(4);
    expect(tipCount(t)).toBe(4);
  });

  it("handles quoted labels with spaces and escaped quotes", () => {
    const t = parseNewick("('A. fumigatus','it''s here');");
    expect(t.children[0].name).toBe("A. fumigatus");
    expect(t.children[1].name).toBe("it's here");
  });

  it("treats underscores in bare labels as spaces", () => {
    const t = parseNewick("(A_fumigatus,B_flavus);");
    expect(t.children[0].name).toBe("A fumigatus");
  });

  it("handles unnamed internal nodes", () => {
    const t = parseNewick("((A,B),(C,D));");
    expect(t.children).toHaveLength(2);
    expect(t.children[0].name).toBe("");
    expect(tipCount(t)).toBe(4);
  });

  it("assigns unique ids to every node", () => {
    const t = parseNewick("((A,B),(C,D));");
    const ids = allNodes(t).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("parses a single-tip tree", () => {
    const t = parseNewick("A;");
    expect(t.name).toBe("A");
    expect(t.children).toHaveLength(0);
  });

  it("tolerates surrounding text / comment lines before the newick", () => {
    const t = parseNewick("# IQ-TREE result\n(A:0.1,B:0.2);\n");
    expect(leaves(t)).toHaveLength(2);
  });

  it("throws TreeParseError on empty input", () => {
    expect(() => parseNewick("   ")).toThrow(TreeParseError);
  });

  it("throws TreeParseError on a malformed string", () => {
    expect(() => parseNewick("(A,B")).toThrow(TreeParseError);
  });
});

describe("Nexus support", () => {
  it("detects a Nexus file", () => {
    expect(isNexus("#NEXUS\nbegin trees;")).toBe(true);
    expect(isNexus("(A,B);")).toBe(false);
  });

  it("extracts the newick from a Nexus TREES block with a translate table", () => {
    const nexus = [
      "#NEXUS",
      "begin trees;",
      "  translate 1 Apple, 2 Banana, 3 Cherry;",
      "  tree t1 = [&R] ((1,2),3);",
      "end;",
    ].join("\n");
    const t = parseTree(nexus);
    expect(leaves(t).map((l) => l.name).sort()).toEqual([
      "Apple",
      "Banana",
      "Cherry",
    ]);
  });

  it("parseTree routes plain newick straight through", () => {
    const t = parseTree("(A,B);");
    expect(tipCount(t)).toBe(2);
  });
});
