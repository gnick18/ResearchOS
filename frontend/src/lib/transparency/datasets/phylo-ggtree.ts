/**
 * Phylogenetics layout validation cases for the transparency page.
 *
 * Where the bioinformatics datasets check ResearchOS against Biopython and the
 * Data Hub cases check our stats engine against scipy, these cases check the
 * native /phylo Tree Studio layout (frontend/src/lib/phylo/layout.ts) against
 * ggtree, the de-facto standard tree-plotting package in R.
 *
 * WHAT IS COMPARED (and what is NOT). ggtree and our renderer differ in scale,
 * pixel sizing, and y-axis orientation (ggtree counts tips bottom to top, we
 * count top to bottom), so a pixel-identical claim would be dishonest. What MUST
 * agree is the TOPOLOGY-INVARIANT structure both tools draw: the order tips fall
 * in along the tip axis, and the relative branch-length depth of every node. We
 * therefore compare two affine-robust quantities per tree:
 *   - tip-order agreement: the absolute Spearman rank correlation between our
 *     tip y-order and ggtree's (orientation-invariant, so a top-to-bottom vs
 *     bottom-to-top flip still scores 1.0). This is the headline, gated metric.
 *   - depth agreement: the Pearson correlation of normalized node x (cumulative
 *     branch-length depth) over every node both tools place. Reported alongside.
 *
 * THE REFERENCE IS REAL ggtree OUTPUT, PRODUCED OFFLINE. ggtree is R and cannot
 * run in CI, so (exactly like the scipy goldens) the coordinate table is produced
 * ONCE by scripts/gen-phylo-ggtree-golden.R in a real R + ggtree environment and
 * committed as JSON under ./phylo-ggtree-golden/<tree>.json. Until that human run
 * lands, this repo ships a PLACEHOLDER golden (pending = true) and the gate
 * SKIPS, so CI never goes red on a reference that does not exist yet.
 *
 * The source trees are REAL published phylogenies (Candida auris global
 * epidemiology, the Human Microbiome Project tree, an HPV58 phylogeny), committed
 * verbatim under frontend/src/lib/phylo/__seed__/sources with citations in that
 * folder's SOURCES.md and inlined here via phylo-trees.ts.
 *
 * No network and no filesystem at runtime: the trees and the golden are imported
 * as constants so buildTransparencyReport() and its gate stay pure and
 * deterministic. No em-dashes, no emojis, no mid-sentence colons.
 */

import { layoutRectangular, type LaidOutNode } from "@/lib/phylo/layout";
import { leaves, parseTree, type TreeNode } from "@/lib/phylo/parse";

import { CANDIDA_AURIS_NWK, HMP_NWK, HPV58_NWK } from "./phylo-trees";
import candidaGolden from "./phylo-ggtree-golden/candida_auris.json";
import hmpGolden from "./phylo-ggtree-golden/hmp.json";
import hpv58Golden from "./phylo-ggtree-golden/hpv58.json";

/** One node in a committed ggtree coordinate table (p$data row). */
export interface GgtreeNode {
  label: string;
  x: number;
  y: number;
  isTip: boolean;
}

/** A committed ggtree golden, real or placeholder (pending = true). */
export interface GgtreeGolden {
  /** true while this is the shipped placeholder (no real ggtree run yet). */
  pending: boolean;
  tree: string;
  layout: string;
  oracle: string;
  ggtreeVersion: string;
  tipCount: number;
  nodeCount: number;
  nodes: GgtreeNode[];
}

/** One seeded tree case: a source tree paired with its ggtree golden. */
export interface PhyloCase {
  /** Stable id, matches the source folder + golden file name. */
  id: string;
  /** Human label for the page. */
  label: string;
  /** The committed source Newick (verbatim, inlined from the seed folder). */
  newick: string;
  /** Short provenance line shown on the page. */
  source: string;
  /** Public path of the committed ggtree reference figure (PNG), or null until run. */
  figure: string | null;
  /** The committed ggtree golden coordinate table. */
  golden: GgtreeGolden;
}

/** The three seeded validation trees. */
export const PHYLO_CASES: PhyloCase[] = [
  {
    id: "candida_auris",
    label: "Candida auris global epidemiology (305 tips)",
    newick: CANDIDA_AURIS_NWK,
    source: "YuLab-SMU treedata-book Candida auris Microreact dataset",
    figure: "/transparency/phylo/candida_auris-ggtree.png",
    golden: candidaGolden as GgtreeGolden,
  },
  {
    id: "hmp",
    label: "Human Microbiome Project tree (333 tips)",
    newick: HMP_NWK,
    source: "ggtreeExtra HMP example tree (Xu et al. 2021)",
    figure: "/transparency/phylo/hmp-ggtree.png",
    golden: hmpGolden as GgtreeGolden,
  },
  {
    id: "hpv58",
    label: "HPV58 phylogeny with bootstrap support (90 tips)",
    newick: HPV58_NWK,
    source: "ggtree HPV58 example tree (Yu et al. 2017)",
    figure: "/transparency/phylo/hpv58-ggtree.png",
    golden: hpv58Golden as GgtreeGolden,
  },
];

/** Are all seeded goldens real ggtree output (none still the placeholder)? */
export function allGoldensReady(): boolean {
  return PHYLO_CASES.every((c) => !c.golden.pending);
}

/* ----------------------------------------------------- comparison primitives */

/** Rank-transform a list of values (average ranks for ties), 1-based. */
function ranks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let k = 0;
  while (k < indexed.length) {
    let j = k;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[k].v) j += 1;
    const avg = (k + j) / 2 + 1; // average of the tied positions, 1-based
    for (let m = k; m <= j; m++) out[indexed[m].i] = avg;
    k = j + 1;
  }
  return out;
}

/** Pearson correlation of two equal-length arrays (NaN if undefined). */
export function pearsonCorr(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2 || b.length !== n) return NaN;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return NaN;
  return cov / Math.sqrt(va * vb);
}

/** Spearman rank correlation = Pearson on the ranks. */
export function spearmanCorr(a: number[], b: number[]): number {
  return pearsonCorr(ranks(a), ranks(b));
}

/** The result of comparing our layout to a ggtree golden for one tree. */
export interface PhyloComparison {
  /** Number of tips matched by label between our layout and the golden. */
  matchedTips: number;
  /** Total tips in our layout. */
  ourTips: number;
  /** Absolute Spearman correlation of tip y-order (orientation-invariant). */
  tipOrderAgreement: number;
  /** Number of nodes matched by label for the depth correlation. */
  matchedNodes: number;
  /** Pearson correlation of normalized node depth (x) over matched nodes. */
  depthAgreement: number;
}

/** Normalize an array to [0, 1] by its own min and max (affine-robust frame). */
function normalize01(values: number[]): number[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  if (!Number.isFinite(span) || span === 0) return values.map(() => 0);
  return values.map((v) => (v - lo) / span);
}

/**
 * Compare OUR rectangular phylogram layout of `newick` to the ggtree `golden`.
 * Matches nodes by their (trimmed) label, which is how a reader would line the
 * two figures up. Internal nodes are often unlabeled, so the headline tip-order
 * metric uses tips only (always labeled), and the depth metric uses every
 * label-matched node (tips plus any labeled internal node, e.g. support values).
 */
export function comparePhyloLayout(
  newick: string,
  golden: GgtreeGolden,
): PhyloComparison {
  const root: TreeNode = parseTree(newick);
  const layout = layoutRectangular(root, {
    width: 1000,
    height: 1000,
    rightInset: 0,
    padding: 0,
    phylogram: true,
  });

  const norm = (s: string) => s.trim();

  // ggtree tips by label, and ggtree nodes by label (for the depth metric).
  const ggTipY = new Map<string, number>();
  const ggNodeX = new Map<string, number>();
  for (const g of golden.nodes) {
    const key = norm(g.label);
    if (key === "") continue;
    if (g.isTip) ggTipY.set(key, g.y);
    ggNodeX.set(key, g.x);
  }

  // Our tips in layout order, paired with the ggtree tip y where the label matches.
  const ourTipNodes: LaidOutNode[] = [];
  const byNodeId = new Map<number, LaidOutNode>();
  for (const ln of layout.nodes) byNodeId.set(ln.node.id, ln);
  for (const tip of leaves(root)) {
    const ln = byNodeId.get(tip.id);
    if (ln) ourTipNodes.push(ln);
  }

  const ourTipY: number[] = [];
  const ggMatchTipY: number[] = [];
  for (const ln of ourTipNodes) {
    const key = norm(ln.node.name);
    const gy = ggTipY.get(key);
    if (gy === undefined) continue;
    ourTipY.push(ln.y);
    ggMatchTipY.push(gy);
  }
  const rawTipCorr = spearmanCorr(ourTipY, ggMatchTipY);
  // Orientation-invariant: ggtree y runs bottom-to-top, ours top-to-bottom, so an
  // identical tree scores -1 before the abs. We claim ORDER agreement, not sign.
  const tipOrderAgreement = Number.isFinite(rawTipCorr) ? Math.abs(rawTipCorr) : NaN;

  // Depth (x) over every label-matched node, each side normalized to [0, 1] so
  // the different pixel-vs-branch-length scales cannot affect the correlation.
  const ourX: number[] = [];
  const ggX: number[] = [];
  for (const ln of layout.nodes) {
    const key = norm(ln.node.name);
    if (key === "") continue;
    const gx = ggNodeX.get(key);
    if (gx === undefined) continue;
    ourX.push(ln.x);
    ggX.push(gx);
  }
  const depthAgreement = pearsonCorr(normalize01(ourX), normalize01(ggX));

  return {
    matchedTips: ourTipY.length,
    ourTips: ourTipNodes.length,
    tipOrderAgreement,
    matchedNodes: ourX.length,
    depthAgreement,
  };
}
