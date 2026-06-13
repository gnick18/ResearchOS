// Tests for the Robinson-Foulds tree comparison.
//
// Trees are built with the real parseNewick so the tests exercise the same
// TreeNode shape the renderer uses. No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { compareTrees } from "./rf";

describe("compareTrees", () => {
  it("scores identical topologies as rf 0 with full recovery", () => {
    const a = parseNewick("((A,B),(C,D));");
    const b = parseNewick("((A,B),(C,D));");
    const r = compareTrees(a, b);
    expect(r.sharedTaxa).toBe(4);
    expect(r.rf).toBe(0);
    expect(r.normalizedRf).toBe(0);
    expect(r.percentRecovered).toBe(100);
    expect(r.missingFromOurs).toEqual([]);
    expect(r.extraInOurs).toEqual([]);
  });

  it("treats a rooted and an unrooted writing of the same topology as rf 0", () => {
    // Six tips so there are real internal bipartitions to compare. One string is
    // written with a bifurcating root, the other rooted differently on the same
    // unrooted topology. The clade {A,B} and {E,F} must match either way.
    const rooted = parseNewick("(((A,B),(C,D)),(E,F));");
    const reRooted = parseNewick("((A,B),((C,D),(E,F)));");
    const r = compareTrees(rooted, reRooted);
    expect(r.sharedTaxa).toBe(6);
    expect(r.rf).toBe(0);
    expect(r.normalizedRf).toBe(0);
    expect(r.percentRecovered).toBe(100);
  });

  it("scores a single NNI / topology swap as rf 2", () => {
    // Swap which pair groups: ((A,B),(C,D)) vs ((A,C),(B,D)). Each tree has one
    // nontrivial bipartition that the other lacks, so the symmetric difference is 2.
    const ours = parseNewick("((A,C),(B,D));");
    const published = parseNewick("((A,B),(C,D));");
    const r = compareTrees(ours, published);
    expect(r.sharedTaxa).toBe(4);
    expect(r.rf).toBe(2);
    expect(r.maxRf).toBe(2);
    expect(r.normalizedRf).toBe(1);
    expect(r.missingFromOurs).toHaveLength(1);
    expect(r.extraInOurs).toHaveLength(1);
  });

  it("compares over the shared taxa only and drops a tip present in one tree", () => {
    // ours carries an extra tip X not in published. X must be pruned, not crash,
    // and the shared topology over A..D is identical.
    const ours = parseNewick("(((A,B),(C,D)),X);");
    const published = parseNewick("((A,B),(C,D));");
    const r = compareTrees(ours, published);
    expect(r.sharedTaxa).toBe(4);
    expect(r.rf).toBe(0);
    expect(r.percentRecovered).toBe(100);
  });

  it("reports a missing published clade in percentRecovered and missingFromOurs", () => {
    // published groups {A,B} and {C,D} among 5 tips, ours collapses the {C,D}
    // grouping so it recovers one of the two clades but not the other.
    const published = parseNewick("(((A,B),(C,D)),E);");
    const ours = parseNewick("(((A,B),C),(D,E));");
    const r = compareTrees(ours, published);
    expect(r.sharedTaxa).toBe(5);
    expect(r.cladesTotal).toBe(2);
    expect(r.cladesRecovered).toBe(1);
    expect(r.percentRecovered).toBeCloseTo((100 * 1) / 2, 6);
    // The not-recovered clade is the {C,D} split. Its canonical side is the
    // lexicographically smaller of the two sides, which is {A,B,E} here.
    expect(r.missingFromOurs).toHaveLength(1);
    expect(r.missingFromOurs[0]).toEqual(["A", "B", "E"]);
  });

  it("guards trees with fewer than 4 shared taxa", () => {
    const ours = parseNewick("((A,B),C);");
    const published = parseNewick("(A,(B,C));");
    const r = compareTrees(ours, published);
    expect(r.sharedTaxa).toBe(3);
    expect(r.maxRf).toBe(0);
    expect(r.normalizedRf).toBe(0);
    expect(r.rf).toBe(0);
    expect(r.percentRecovered).toBe(100);
  });

  it("handles a tree pair sharing only a subset of taxa", () => {
    // ours has A..D plus Y, Z; published has A..D plus W. Shared is A..D.
    const ours = parseNewick("(((A,B),(C,D)),(Y,Z));");
    const published = parseNewick("(((A,B),(C,D)),W);");
    const r = compareTrees(ours, published);
    expect(r.sharedTaxa).toBe(4);
    expect(r.rf).toBe(0);
    expect(r.percentRecovered).toBe(100);
  });

  it("reports the published support on each missing clade, aligned with missingFromOurs", () => {
    // published groups (A,B) with support 88 and (E,F) with support 42; ours
    // breaks both groupings, so both are missing and carry their support values.
    const published = parseNewick("(((A,B)88,(C,D)),((E,F)42,G));");
    const ours = parseNewick("(((A,C),(B,D)),((E,G),F));");
    const r = compareTrees(ours, published);
    expect(r.missingFromOurs.length).toBe(r.missingFromOursSupport.length);
    expect(r.missingFromOurs.length).toBeGreaterThan(0);
    // Every missing clade reports a number or null, never undefined.
    for (const s of r.missingFromOursSupport) {
      expect(s === null || typeof s === "number").toBe(true);
    }
    // The (A,B) split (support 88) was missed, so 88 appears among the supports.
    const ab = r.missingFromOurs.findIndex((side) => side.join(",") === "A,B");
    expect(ab).toBeGreaterThanOrEqual(0);
    expect(r.missingFromOursSupport[ab]).toBe(88);
  });

  it("emits an empty support list when topologies match", () => {
    const a = parseNewick("((A,B)90,(C,D)70);");
    const r = compareTrees(a, parseNewick("((A,B)90,(C,D)70);"));
    expect(r.rf).toBe(0);
    expect(r.missingFromOurs).toHaveLength(0);
    expect(r.missingFromOursSupport).toHaveLength(0);
  });
});
