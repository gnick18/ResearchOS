// Robinson-Foulds tree comparison (Phase 1 of the phylo published-validation work).
//
// Compares two unrooted tree TOPOLOGIES by the Robinson-Foulds distance,
// restricted to the taxa the two trees share. This is the headline metric for
// "we reproduce the published tree": RF = 0 means identical topology, and the
// percent of the published tree's clades we recover is the intuitive read.
//
// Pure and SSR-safe. No DOM, no I/O, no new deps. Reads the parsed TreeNode
// shape from parse.ts and never mutates it.
//
// The core idea is the bipartition (split). Every internal edge of an unrooted
// tree partitions the tips into two sides. The full set of nontrivial
// bipartitions uniquely characterizes an unrooted topology, so comparing two
// trees reduces to comparing their bipartition sets. RF is the size of the
// symmetric difference of those two sets.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { TreeNode } from "./parse";

/**
 * The outcome of comparing our tree against a published tree. All counts and
 * lists are over the SHARED taxon set only, so a tree carrying an extra outgroup
 * does not distort the score.
 */
export interface RfResult {
  /** How many taxa the two trees have in common (the comparison is over these). */
  sharedTaxa: number;
  /** Robinson-Foulds distance, the count of bipartitions in exactly one tree. */
  rf: number;
  /** Maximum possible RF for this many shared taxa, 2*(n-3), or 0 when n < 4. */
  maxRf: number;
  /** rf / maxRf, in [0, 1]. 0 when maxRf is 0. */
  normalizedRf: number;
  /** How many of the published tree's clades our tree also recovers. */
  cladesRecovered: number;
  /** Total nontrivial clades (bipartitions) in the published tree. */
  cladesTotal: number;
  /** 100 * cladesRecovered / cladesTotal, or 100 when the published tree has none. */
  percentRecovered: number;
  /** Published clades absent from ours, each as the canonical sorted tip-name side. */
  missingFromOurs: string[][];
  /** Clades present in ours but not the published tree, same canonical form. */
  extraInOurs: string[][];
}

/**
 * Collect the tip names under a node, depth first. Local helper so we do not
 * depend on parse.ts internals beyond the TreeNode shape.
 */
function tipNamesUnder(node: TreeNode, acc: string[]): void {
  if (node.children.length === 0) {
    acc.push(node.name);
    return;
  }
  for (const c of node.children) tipNamesUnder(c, acc);
}

/** The set of tip names in a whole tree. */
function tipNameSet(root: TreeNode): Set<string> {
  const acc: string[] = [];
  tipNamesUnder(root, acc);
  return new Set(acc);
}

/**
 * Prune a tree to a target tip set, then suppress the degree-2 internal nodes
 * that pruning leaves behind, so the returned topology is clean.
 *
 * Returns null when a node and its whole subtree carry no kept tip. The caller
 * builds the pruned tree bottom up: each node keeps only the kept children, and
 * a node that ends up with a single child is suppressed (its child takes its
 * place), which removes the unifurcations / degree-2 nodes a naive prune leaves.
 */
function pruneToTaxa(node: TreeNode, keep: Set<string>): TreeNode | null {
  if (node.children.length === 0) {
    return keep.has(node.name) ? cloneLeaf(node) : null;
  }
  const keptChildren: TreeNode[] = [];
  for (const c of node.children) {
    const pruned = pruneToTaxa(c, keep);
    if (pruned) keptChildren.push(pruned);
  }
  if (keptChildren.length === 0) return null;
  if (keptChildren.length === 1) {
    // Suppress this degree-2 / unifurcation node, the single child stands in.
    return keptChildren[0];
  }
  return {
    id: node.id,
    name: node.name,
    branchLength: node.branchLength,
    support: node.support,
    children: keptChildren,
  };
}

function cloneLeaf(node: TreeNode): TreeNode {
  return {
    id: node.id,
    name: node.name,
    branchLength: node.branchLength,
    support: node.support,
    children: [],
  };
}

/**
 * Canonicalize a bipartition to a stable string key plus the canonical side.
 *
 * A bipartition splits all tips into one side and its complement. We pick the
 * lexicographically smaller side (by sorted tip-name array, comparing element by
 * element, shorter wins on a prefix tie) so the same split from either tree
 * serializes identically regardless of which subtree produced it. The key uses a
 * newline join, which cannot appear inside a tip name, so it is collision free.
 */
function canonicalBipartition(side: string[], allTips: string[]): {
  key: string;
  side: string[];
} {
  const sideSet = new Set(side);
  const sideSorted = [...side].sort();
  const other = allTips.filter((t) => !sideSet.has(t)).sort();
  const chosen = compareSides(sideSorted, other) <= 0 ? sideSorted : other;
  return { key: chosen.join("\n"), side: chosen };
}

/** Element-by-element compare of two sorted string arrays, shorter wins a prefix tie. */
function compareSides(a: string[], b: string[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * The set of nontrivial bipartitions of a pruned unrooted tree.
 *
 * We walk the tree once, accumulating the tip names under each node. Each node
 * other than the root defines the edge to its parent, and that edge's split is
 * "tips under this node" vs "everyone else". We keep only nontrivial splits
 * (each side has at least 2 tips, which also drops the size 0/1 and full-set
 * cases). The map is keyed by the canonical bipartition string so duplicates
 * collapse, which is exactly what handles the unrooted root edge: a rooted tree
 * whose root has 2 children produces the same split from both children, and the
 * shared key dedups it to one entry. That makes a rooted vs unrooted writing of
 * the same topology score rf = 0.
 */
function bipartitions(root: TreeNode): Map<string, string[]> {
  const allTipsArr: string[] = [];
  tipNamesUnder(root, allTipsArr);
  const n = allTipsArr.length;
  const splits = new Map<string, string[]>();

  function visit(node: TreeNode, isRoot: boolean): string[] {
    let under: string[];
    if (node.children.length === 0) {
      under = [node.name];
    } else {
      under = [];
      for (const c of node.children) {
        under = under.concat(visit(c, false));
      }
    }
    if (!isRoot) {
      // Both sides need at least 2 tips for the split to be nontrivial.
      const sideSize = under.length;
      const otherSize = n - sideSize;
      if (sideSize >= 2 && otherSize >= 2) {
        const { key, side } = canonicalBipartition(under, allTipsArr);
        if (!splits.has(key)) splits.set(key, side);
      }
    }
    return under;
  }

  visit(root, true);
  return splits;
}

/**
 * Compare our tree against a published tree by Robinson-Foulds over the shared
 * taxa. See RfResult for the returned fields.
 */
export function compareTrees(ours: TreeNode, published: TreeNode): RfResult {
  const oursTips = tipNameSet(ours);
  const pubTips = tipNameSet(published);
  const shared = new Set<string>();
  for (const t of oursTips) if (pubTips.has(t)) shared.add(t);
  const sharedTaxa = shared.size;

  const oursPruned = pruneToTaxa(ours, shared);
  const pubPruned = pruneToTaxa(published, shared);

  // With fewer than 4 shared taxa there are no nontrivial bipartitions, so RF is
  // trivially 0 and the normalization is undefined. Guard and return zeros.
  const emptyEdge = sharedTaxa < 4 || !oursPruned || !pubPruned;

  const oursSplits = emptyEdge || !oursPruned ? new Map<string, string[]>() : bipartitions(oursPruned);
  const pubSplits = emptyEdge || !pubPruned ? new Map<string, string[]>() : bipartitions(pubPruned);

  // Symmetric difference for RF, and the directed differences for the lists.
  let rf = 0;
  const missingFromOurs: string[][] = [];
  const extraInOurs: string[][] = [];
  let cladesRecovered = 0;

  for (const [key, side] of pubSplits) {
    if (oursSplits.has(key)) {
      cladesRecovered++;
    } else {
      rf++;
      missingFromOurs.push(side);
    }
  }
  for (const [key, side] of oursSplits) {
    if (!pubSplits.has(key)) {
      rf++;
      extraInOurs.push(side);
    }
  }

  const maxRf = sharedTaxa >= 4 ? 2 * (sharedTaxa - 3) : 0;
  const normalizedRf = maxRf > 0 ? rf / maxRf : 0;
  const cladesTotal = pubSplits.size;
  const percentRecovered = cladesTotal > 0 ? (100 * cladesRecovered) / cladesTotal : 100;

  return {
    sharedTaxa,
    rf,
    maxRf,
    normalizedRf,
    cladesRecovered,
    cladesTotal,
    percentRecovered,
    missingFromOurs,
    extraInOurs,
  };
}
