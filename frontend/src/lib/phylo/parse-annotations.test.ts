// Parser: FigTree / BEAST [&key=value] node annotations. A timed tree carries
// node-age HPD intervals and posterior probabilities in `[&...]` comment blocks;
// the parser used to throw on the "[" (unexpected character), so a BEAST tree
// failed to import at all. Now those blocks are captured into node.annotations,
// and a plain Newick tree (no comments) is unchanged.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick, parseTree, allNodes } from "./parse";

describe("node annotation parsing", () => {
  it("no longer throws on a tree carrying [&...] comments", () => {
    expect(() =>
      parseNewick("(A[&height=1.2]:0.3,B:0.4)[&posterior=0.98]:0.0;"),
    ).not.toThrow();
  });

  it("captures a {lo,hi} range as a number array on the node", () => {
    const tree = parseNewick(
      "((A:1,B:1)[&height_95%_HPD={0.9,1.5}]:1,C:2);",
    );
    const withHpd = allNodes(tree).find((n) => n.annotations?.["height_95%_HPD"]);
    expect(withHpd).toBeDefined();
    expect(withHpd!.annotations!["height_95%_HPD"]).toEqual([0.9, 1.5]);
  });

  it("parses scalars (number) and labels (string) by type", () => {
    const tree = parseNewick("(A[&rate=0.5,clade=Foo]:0.3,B:0.4);");
    const a = allNodes(tree).find((n) => n.name === "A");
    expect(a!.annotations!.rate).toBe(0.5);
    expect(a!.annotations!.clade).toBe("Foo");
  });

  it("keeps the topology + branch lengths intact alongside annotations", () => {
    const tree = parseNewick("(A[&h=1]:0.3,B:0.4):0;");
    const a = allNodes(tree).find((n) => n.name === "A");
    expect(a!.branchLength).toBe(0.3);
    const b = allNodes(tree).find((n) => n.name === "B");
    expect(b!.branchLength).toBe(0.4);
    expect(b!.annotations).toBeUndefined(); // B carried no comment
  });

  it("a plain Newick tree has no annotations field (back-compat)", () => {
    const tree = parseNewick("((A:0.1,B:0.2):0.3,C:0.4);");
    expect(allNodes(tree).every((n) => n.annotations === undefined)).toBe(true);
  });

  it("reads a BEAST-style Nexus tree through parseTree with translate + [&R]", () => {
    const nexus = [
      "#NEXUS",
      "begin trees;",
      "translate 1 Homo, 2 Pan, 3 Gorilla;",
      "tree TREE1 = [&R] ((1[&height_95%_HPD={0.1,0.3}]:1,2:1)[&posterior=1.0]:1,3:2);",
      "end;",
    ].join("\n");
    const tree = parseTree(nexus);
    const names = allNodes(tree)
      .filter((n) => n.children.length === 0)
      .map((n) => n.name)
      .sort();
    expect(names).toEqual(["Gorilla", "Homo", "Pan"]);
    const hpd = allNodes(tree).find((n) => n.annotations?.["height_95%_HPD"]);
    expect(hpd!.annotations!["height_95%_HPD"]).toEqual([0.1, 0.3]);
  });
});
