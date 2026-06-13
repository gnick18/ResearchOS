// Phylo Tree Studio, layout math + tree editing (Phase 2).
//
// Pure functions only: no DOM, no SVG, no React. They take a parsed TreeNode
// (parse.ts) and produce either laid-out coordinates (for the renderer) or a NEW
// edited tree (reroot / ladderize / collapse). The renderer (render.ts) consumes
// the laid-out result and is the ONLY file that emits raw SVG, so the geometry
// stays testable in isolation.
//
// We do NOT reuse the Sequences taxonomy-radial-layout primitives here: those are
// purpose-built for the NCBI taxonomy explorer (zoom-level culling, damped node
// weights, viewport math) and do not model branch-length phylograms. We reuse the
// one primitive that fits, polarToCartesian, for the circular layout angle math.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { polarToCartesian } from "@/lib/sequences/taxonomy-radial-layout";
import { allNodes, leaves, type TreeNode } from "./parse";

/** A node placed in 2D for the rectangular layout (x grows with depth, y is tip order). */
export interface LaidOutNode {
  node: TreeNode;
  x: number;
  y: number;
  /** Parent placement, null for the root, so the renderer can draw the elbow. */
  parentX: number | null;
  parentY: number | null;
}

export interface RectLayout {
  kind: "rectangular";
  nodes: LaidOutNode[];
  width: number;
  height: number;
  /** Branch-length units per pixel of x, for the scale bar (null in cladogram). */
  unitsPerPx: number | null;
  /** Max cumulative branch length, for the scale-bar tick. */
  maxDepth: number;
}

/** A node placed in polar space (radius = depth, angle = tip order) for circular. */
export interface PolarNode {
  node: TreeNode;
  /** Cartesian position relative to the SVG center. */
  x: number;
  y: number;
  parentX: number | null;
  parentY: number | null;
  /** Radius + angle, kept so the renderer can draw the connecting arc + labels. */
  radius: number;
  angle: number;
  parentRadius: number | null;
  parentAngle: number | null;
}

export interface CircularLayout {
  kind: "circular";
  cx: number;
  cy: number;
  nodes: PolarNode[];
  radius: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Inset reserved on the right for tip labels + annotation tracks (rectangular). */
  rightInset: number;
  padding: number;
  /** true = phylogram (x = cumulative branch length), false = cladogram (x = rank depth). */
  phylogram: boolean;
  /**
   * Extra radial room (px) the circular renderer needs OUTSIDE the tip circle for
   * its ring tracks (strip / heat / bar) before labels. Optional and 0 by default
   * so an unannotated circular tree, and every rectangular caller, are unchanged.
   */
  circularRingRoom?: number;
}

/** Sum of branch lengths from the root to each node. Treats missing lengths as 0. */
function cumulativeDepths(root: TreeNode): Map<number, number> {
  const out = new Map<number, number>();
  const walk = (n: TreeNode, acc: number) => {
    out.set(n.id, acc);
    for (const c of n.children) walk(c, acc + (c.branchLength ?? 0));
  };
  walk(root, 0);
  return out;
}

/** Rank depth (edge count from the root) for the cladogram x axis. */
function rankDepths(root: TreeNode): Map<number, number> {
  const out = new Map<number, number>();
  const walk = (n: TreeNode, r: number) => {
    out.set(n.id, r);
    for (const c of n.children) walk(c, r + 1);
  };
  walk(root, 0);
  return out;
}

/**
 * Y position of every node: leaves at evenly-spaced rows (their index), internal
 * nodes centered on the midpoint of their first and last child. Shared by both
 * the rectangular and circular layouts (circular reads it as the angle slot).
 */
function yPositions(root: TreeNode): Map<number, number> {
  const lv = leaves(root);
  const out = new Map<number, number>();
  lv.forEach((l, idx) => out.set(l.id, idx));
  const place = (n: TreeNode): number => {
    if (n.children.length === 0) return out.get(n.id) ?? 0;
    const ys = n.children.map(place);
    const mid = (ys[0] + ys[ys.length - 1]) / 2;
    out.set(n.id, mid);
    return mid;
  };
  place(root);
  return out;
}

/** Lay out the tree as a rectangular phylogram or cladogram. */
export function layoutRectangular(
  root: TreeNode,
  opts: LayoutOptions,
): RectLayout {
  const { width, height, rightInset, padding, phylogram } = opts;
  const depths = phylogram ? cumulativeDepths(root) : rankDepths(root);
  const ys = yPositions(root);
  const lv = leaves(root);
  const maxDepth = Math.max(1e-9, ...[...depths.values()]);
  const yMax = Math.max(1, lv.length - 1);
  const plotW = Math.max(1, width - padding - rightInset);
  const plotH = Math.max(1, height - padding * 2);

  const xScale = (d: number) => padding + (d / maxDepth) * plotW;
  const yScale = (y: number) => padding + (y / yMax) * plotH;

  const nodes: LaidOutNode[] = allNodes(root).map((n) => {
    const x = xScale(depths.get(n.id) ?? 0);
    const y = yScale(ys.get(n.id) ?? 0);
    return { node: n, x, y, parentX: null, parentY: null };
  });
  // Stitch parent coords for elbow drawing.
  const byId = new Map(nodes.map((p) => [p.node.id, p]));
  const linkParents = (n: TreeNode) => {
    const here = byId.get(n.id)!;
    for (const c of n.children) {
      const cp = byId.get(c.id)!;
      cp.parentX = here.x;
      cp.parentY = here.y;
      linkParents(c);
    }
  };
  linkParents(root);

  return {
    kind: "rectangular",
    nodes,
    width,
    height,
    unitsPerPx: phylogram ? maxDepth / plotW : null,
    maxDepth,
  };
}

/** Lay out the tree as a circular / fan phylogram or cladogram. */
export function layoutCircular(
  root: TreeNode,
  opts: LayoutOptions,
): CircularLayout {
  const { width, height, phylogram } = opts;
  const depths = phylogram ? cumulativeDepths(root) : rankDepths(root);
  const ys = yPositions(root);
  const lv = leaves(root);
  const maxDepth = Math.max(1e-9, ...[...depths.values()]);
  const aMax = Math.max(1, lv.length - 1);
  const cx = width / 2;
  const cy = height / 2;
  // Leave room for tip labels outside the circle, plus any ring tracks the
  // renderer draws between the tips and the labels (Phase 0 bar / heat rings).
  const ringRoom = Math.max(0, opts.circularRingRoom ?? 0);
  const radius = Math.max(
    20,
    Math.min(width, height) / 2 - opts.padding - 56 - ringRoom,
  );
  const innerR = 18;

  // Spread tips over a 330 degree fan (the open gap reads as a rooted fan).
  const sweep = Math.PI * (330 / 180);
  const startA = -sweep / 2 - Math.PI / 2;
  const angleOf = (y: number) => startA + (y / aMax) * sweep;
  const radiusOf = (d: number) => innerR + (d / maxDepth) * (radius - innerR);

  const nodes: PolarNode[] = allNodes(root).map((n) => {
    const angle = angleOf(ys.get(n.id) ?? 0);
    const r = radiusOf(depths.get(n.id) ?? 0);
    const p = polarToCartesian(angle, r);
    return {
      node: n,
      x: cx + p.x,
      y: cy + p.y,
      radius: r,
      angle,
      parentX: null,
      parentY: null,
      parentRadius: null,
      parentAngle: null,
    };
  });
  const byId = new Map(nodes.map((p) => [p.node.id, p]));
  const linkParents = (n: TreeNode) => {
    const here = byId.get(n.id)!;
    for (const c of n.children) {
      const cp = byId.get(c.id)!;
      cp.parentX = here.x;
      cp.parentY = here.y;
      cp.parentRadius = here.radius;
      cp.parentAngle = here.angle;
      linkParents(c);
    }
  };
  linkParents(root);

  return { kind: "circular", cx, cy, nodes, radius };
}

// ---------------------------------------------------------------------------
// Tree editing (each returns a NEW tree, never mutating the input).
// ---------------------------------------------------------------------------

let cloneCounter = 0;
function clone(n: TreeNode, fresh: boolean): TreeNode {
  return {
    id: fresh ? cloneCounter++ : n.id,
    name: n.name,
    branchLength: n.branchLength,
    support: n.support,
    children: n.children.map((c) => clone(c, fresh)),
  };
}

/** Deep copy with stable ids (used internally before structural surgery). */
function deepClone(n: TreeNode): TreeNode {
  return clone(n, false);
}

/**
 * Ladderize: sort children so the smaller (or larger) subtree sits on top. The
 * usual published convention puts the smaller clade up (ascending), the default.
 */
export function ladderize(root: TreeNode, ascending = true): TreeNode {
  const size = (n: TreeNode): number =>
    n.children.length === 0
      ? 1
      : n.children.reduce((s, c) => s + size(c), 0);
  const rec = (n: TreeNode): TreeNode => {
    const kids = n.children.map(rec);
    kids.sort((a, b) => (ascending ? size(a) - size(b) : size(b) - size(a)));
    return { ...n, children: kids };
  };
  return rec(deepClone(root));
}

/** Collapse a clade to a single triangle tip by id (keeps the node, drops kids). */
export function collapseClade(root: TreeNode, nodeId: number): TreeNode {
  const rec = (n: TreeNode): TreeNode => {
    if (n.id === nodeId) {
      const name = n.name || cladeLabel(n);
      return { ...n, name, children: [] };
    }
    return { ...n, children: n.children.map(rec) };
  };
  return rec(deepClone(root));
}

/** A readable fallback name for a collapsed unnamed clade ("N tips"). */
function cladeLabel(n: TreeNode): string {
  return `${leaves(n).length} tips`;
}

/** Find the path of nodes from the root down to a target id, inclusive. */
function pathToNode(root: TreeNode, targetId: number): TreeNode[] | null {
  const path: TreeNode[] = [];
  const dfs = (n: TreeNode): boolean => {
    path.push(n);
    if (n.id === targetId) return true;
    for (const c of n.children) if (dfs(c)) return true;
    path.pop();
    return false;
  };
  return dfs(root) ? path : null;
}

/**
 * Reroot the tree on the branch leading to the given node (outgroup rooting).
 * Inserts a new root on the midpoint of that branch and reverses the parent
 * links along the path from the old root. Returns a new tree; the input is
 * unchanged. Falls back to the original tree if the node is the root.
 */
export function rerootOnNode(root: TreeNode, nodeId: number): TreeNode {
  if (root.id === nodeId) return deepClone(root);
  const work = deepClone(root);
  const path = pathToNode(work, nodeId);
  if (!path || path.length < 2) return work;
  const outgroup = path[path.length - 1];
  const splitLen = (outgroup.branchLength ?? 0) / 2;

  // Walk the path from the outgroup up to the old root, re-parenting each step.
  const newRoot: TreeNode = {
    id: cloneCounter++,
    name: "",
    branchLength: null,
    support: null,
    children: [],
  };
  // Detach the outgroup from its parent and hang it under the new root.
  const parentOfOut = path[path.length - 2];
  parentOfOut.children = parentOfOut.children.filter((c) => c.id !== outgroup.id);
  outgroup.branchLength = splitLen;

  // The remaining backbone (old subtree above the cut) becomes the second child,
  // with branch links reversed up the path.
  let prevLen = splitLen;
  let down: TreeNode = parentOfOut;
  for (let k = path.length - 3; k >= 0; k--) {
    const up = path[k];
    up.children = up.children.filter((c) => c.id !== down.id);
    const lenToFlip = down.branchLength ?? 0;
    down.children.push(up);
    down.branchLength = prevLen;
    prevLen = lenToFlip;
    down = up;
  }
  down.branchLength = prevLen;

  newRoot.children = [outgroup, parentOfOut];
  return newRoot;
}

/**
 * Midpoint root: place the root at the midpoint of the longest leaf-to-leaf
 * path (the two most distant tips). Standard when no outgroup is known. Returns
 * a new tree.
 */
export function midpointRoot(root: TreeNode): TreeNode {
  const lv = leaves(root);
  if (lv.length < 2) return deepClone(root);
  // Distances between every pair of tips via their MRCA, using cumulative depth.
  const depths = cumulativeDepths(root);
  // Find the farthest-apart tip pair (n^2 over tips, fine for figure-scale trees).
  let best = { a: lv[0], b: lv[0], dist: -1 };
  for (let i = 0; i < lv.length; i++) {
    for (let j = i + 1; j < lv.length; j++) {
      const a = lv[i];
      const b = lv[j];
      const mrca = mrcaDepth(root, a.id, b.id, depths);
      const d = (depths.get(a.id) ?? 0) + (depths.get(b.id) ?? 0) - 2 * mrca;
      if (d > best.dist) best = { a, b, dist: d };
    }
  }
  const half = best.dist / 2;
  // Walk up from the deeper tip until we cross the midpoint, then reroot there.
  const path = pathToNode(root, best.a.id);
  if (!path) return deepClone(root);
  let acc = 0;
  let target = best.a;
  for (let k = path.length - 1; k > 0; k--) {
    acc += path[k].branchLength ?? 0;
    if (acc >= half) {
      target = path[k];
      break;
    }
  }
  return rerootOnNode(root, target.id);
}

/** Cumulative depth of the MRCA of two tips (helper for midpoint distance). */
function mrcaDepth(
  root: TreeNode,
  aId: number,
  bId: number,
  depths: Map<number, number>,
): number {
  const pa = pathToNode(root, aId);
  const pb = pathToNode(root, bId);
  if (!pa || !pb) return 0;
  const setB = new Set(pb.map((n) => n.id));
  let mrca = root;
  for (const n of pa) if (setB.has(n.id)) mrca = n;
  return depths.get(mrca.id) ?? 0;
}

// ---------------------------------------------------------------------------
// Metadata linking (CSV -> rows, fuzzy match to tips).
// ---------------------------------------------------------------------------

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
}

/**
 * Parse a CSV (or TSV) string into columns + rows. Minimal but quote-aware so a
 * value with a comma inside quotes is not split. The why: metadata is pasted or
 * dropped raw and a researcher should never have to clean it first.
 */
export function parseCsv(text: string): ParsedCsv {
  const delimiter = text.includes("\t") && !text.includes(",") ? "\t" : ",";
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { columns: [], rows: [] };
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delimiter) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const columns = splitLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    columns.forEach((col, idx) => (row[col] = cells[idx] ?? ""));
    return row;
  });
  return { columns, rows };
}

/** Normalize a label for fuzzy tip matching (case, spaces, underscores, dots). */
function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[_\s.]+/g, " ").trim();
}

/**
 * Split a label into the distinct tokens real tip names are built from, so a
 * composite label like "SC144|FJ385264" or "Homo_sapiens_AB12345" can join to a
 * metadata table keyed on just one part (the strain, the accession). Splits on
 * the delimiters tip labels commonly use, lowercases, and drops tokens shorter
 * than three characters so a stray "1" or "sp" can never cause a false join.
 */
function labelTokens(s: string): string[] {
  const norm = s.toLowerCase().replace(/[|/\\,;:_\s.()]+/g, " ").trim();
  return Array.from(new Set(norm.split(" ").filter((t) => t.length >= 3)));
}

export interface MetadataMatch {
  /** tip id -> the matched metadata row. */
  matched: Map<number, Record<string, string>>;
  /** Tip names with no metadata row, surfaced so they are never silently dropped. */
  unmatchedTips: string[];
  /** Metadata tip-column values that matched no tip in the tree. */
  unmatchedRows: string[];
}

/**
 * Match metadata rows to tree tips by a chosen tip-id column, in three passes of
 * decreasing confidence: exact, then normalized (case / space / underscore / dot
 * insensitive), then a token pass for composite labels (e.g. tip "SC144|FJ385264"
 * joins a row keyed "SC144"). The token pass only accepts a UNIQUE candidate, so
 * a token shared by several rows stays unmatched rather than joining the wrong
 * row. Both sides of the mismatch are returned so the UI can show them; nothing
 * is dropped silently (the design rule).
 */
export function matchMetadataToTips(
  root: TreeNode,
  rows: Record<string, string>[],
  tipColumn: string,
): MetadataMatch {
  const tips = leaves(root);
  const byExact = new Map<string, Record<string, string>>();
  const byNorm = new Map<string, Record<string, string>>();
  const byToken = new Map<string, Set<Record<string, string>>>();
  for (const row of rows) {
    const key = row[tipColumn] ?? "";
    if (key === "") continue;
    byExact.set(key, row);
    byNorm.set(normalizeLabel(key), row);
    for (const t of labelTokens(key)) {
      let set = byToken.get(t);
      if (!set) {
        set = new Set();
        byToken.set(t, set);
      }
      set.add(row);
    }
  }
  const matched = new Map<number, Record<string, string>>();
  const unmatchedTips: string[] = [];
  const usedKeys = new Set<string>();
  for (const tip of tips) {
    let row = byExact.get(tip.name) ?? byNorm.get(normalizeLabel(tip.name));
    if (!row) {
      // Token / containment fallback for composite labels. Gather every row any
      // of the tip's tokens points at; accept only if exactly one distinct row.
      const cand = new Set<Record<string, string>>();
      for (const t of labelTokens(tip.name)) {
        const s = byToken.get(t);
        if (s) for (const r of s) cand.add(r);
      }
      if (cand.size === 1) row = cand.values().next().value;
    }
    if (row) {
      matched.set(tip.id, row);
      usedKeys.add(row[tipColumn] ?? "");
    } else {
      unmatchedTips.push(tip.name);
    }
  }
  const unmatchedRows = rows
    .map((r) => r[tipColumn] ?? "")
    .filter((k) => k !== "" && !usedKeys.has(k));
  return { matched, unmatchedTips, unmatchedRows };
}

/** Fraction of tips (0 to 1) that join metadata on a given column. */
export function tipColumnMatchRate(
  root: TreeNode,
  rows: Record<string, string>[],
  column: string,
): number {
  const total = leaves(root).length;
  if (total === 0) return 0;
  return matchMetadataToTips(root, rows, column).matched.size / total;
}

/**
 * Pick the metadata column that joins the most tips, the likely tip-id column.
 * Used to auto-select the join key on import so the user does not have to hunt
 * for which column matches the tree. Ties keep the earliest column.
 */
export function bestTipColumn(
  root: TreeNode,
  rows: Record<string, string>[],
  columns: string[],
): string {
  let best = columns[0] ?? "";
  let bestRate = -1;
  for (const c of columns) {
    const rate = tipColumnMatchRate(root, rows, c);
    if (rate > bestRate) {
      bestRate = rate;
      best = c;
    }
  }
  return best;
}
