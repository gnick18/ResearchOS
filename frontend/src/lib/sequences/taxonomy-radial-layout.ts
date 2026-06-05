// sequence editor master. PURE RADIAL LAYOUT for the taxonomy tree-of-life view.
//
// This module turns a (sub)tree of taxonomy nodes into a radial layout, the
// oseiskar tree-of-life look reimplemented over OUR backbone. Each node gets an
// angle, an angular width, a radius, and a stroke thickness. There is no DOM and
// no d3 here on purpose, so the math is unit-tested in isolation and the render
// layer (TaxonomyTreeView) is a thin d3 drawing pass over these numbers.
//
// The hard part is SCALE. Raw species counts span six orders of magnitude (a
// 1.6M-species domain next to a 1-species family). If angular width were the raw
// count, the big clade would eat the whole circle and small siblings would be
// invisible slivers. So every node's WEIGHT is a LOG-DAMPED species count,
//   weight = log1p(speciesCount) + LEAF_FLOOR
// which compresses the range (log keeps order but flattens the gap) while the
// floor guarantees even a zero or one-species twig still earns a drawable slice.
// A subtree's children split their parent's arc in proportion to these damped
// weights, so a fat clade is a fat wedge and a sparse one a thin wedge, but the
// thin one never vanishes. Thickness uses the same damped weight on a separate
// scale, so the visual branch width also reads as diversity.
//
// Depth maps to radius linearly (each level one ring out from the center), the
// classic radial-dendrogram mapping.
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence
// colons.

/** The minimal node shape this layout needs. Backbone nodes satisfy it, and a
 *  live-drilled node mapped to this shape does too. Children are referenced by a
 *  resolver the caller passes, so the layout is agnostic to the data source. */
export interface RadialInputNode {
  /** Stable id (tax id as a string), unique within the laid-out subtree. */
  id: string;
  /** Display name (used by the render layer, passed through untouched). */
  name: string;
  /** NCBI rank (passed through for rank-aware coloring in the render layer). */
  rank: string;
  /** Species under this node, the diversity signal. Zero is allowed (an
   *  interior backbone node whose species sit below family). */
  speciesCount: number;
  /** Ids of this node's children within the laid-out tree. */
  childIds: string[];
}

/** One node positioned in the radial layout. Angles are in radians, measured
 *  clockwise from the top is NOT assumed; the render layer decides orientation.
 *  We use the convention that angle 0 points along +x and increases counter to
 *  the math standard only inside the render, so here angle is just a number in
 *  [0, 2*PI) and angularWidth is the arc this node owns. */
export interface RadialLaidOutNode {
  id: string;
  name: string;
  rank: string;
  speciesCount: number;
  /** Tree depth, root is 0. */
  depth: number;
  /** Center angle of this node's wedge, in radians. */
  angle: number;
  /** Angular width of this node's wedge, in radians (its share of the circle). */
  angularWidth: number;
  /** Distance from the center, from depth. */
  radius: number;
  /** Stroke / wedge thickness for the branch, in layout units. */
  thickness: number;
  /** Parent id, or null at the laid-out root. */
  parentId: string | null;
  /** The damped weight that drove the angular allocation (exposed for tests
   *  and for label-priority heuristics in the render layer). */
  weight: number;
}

/** Tunables for the layout. Defaults give the oseiskar feel on our backbone. */
export interface RadialLayoutOptions {
  /** Total arc the whole tree spans, in radians. A full circle by default; a
   *  search-focus animation can lay a subtree out into a smaller arc. */
  totalAngle?: number;
  /** The angle the whole tree is centered on / starts at, in radians. */
  startAngle?: number;
  /** Radius of the innermost ring (the root sits near the center). */
  innerRadius?: number;
  /** Radius added per depth level. */
  ringStep?: number;
  /** Minimum damped weight floor, so a zero or one-species leaf still gets a
   *  visible slice. Added to log1p(speciesCount). */
  leafFloor?: number;
  /** Thickness at the maximum damped weight in the tree (the fattest branch). */
  maxThickness?: number;
  /** Thickness at the minimum damped weight (the thinnest twig). */
  minThickness?: number;
}

const DEFAULTS: Required<RadialLayoutOptions> = {
  totalAngle: Math.PI * 2,
  startAngle: 0,
  innerRadius: 40,
  ringStep: 90,
  leafFloor: 0.6,
  maxThickness: 14,
  minThickness: 1,
};

/** The damped diversity weight of a node from its species count. log1p keeps the
 *  ordering (more species is always a larger weight) but compresses the six
 *  orders of magnitude, and the floor keeps a zero-species twig drawable. Pure
 *  and exported so a test can pin the damping curve. */
export function dampedWeight(speciesCount: number, leafFloor = DEFAULTS.leafFloor): number {
  const safe = Number.isFinite(speciesCount) && speciesCount > 0 ? speciesCount : 0;
  return Math.log1p(safe) + leafFloor;
}

/**
 * The SUBTREE weight of a node, the sum of damped weights over the node and all
 * its laid-out descendants. This is what a parent splits its arc by, so a clade
 * that is diverse all the way down owns a proportionally larger wedge than one
 * that is diverse only at its tip. Memoized into `weightOf` by id.
 */
function computeSubtreeWeights(
  rootId: string,
  byId: Map<string, RadialInputNode>,
  leafFloor: number,
): Map<string, number> {
  const weightOf = new Map<string, number>();

  // Iterative post-order so a deep tree does not blow the stack. We walk down
  // pushing children, then accumulate on the way back up.
  const stack: Array<{ id: string; childIndex: number }> = [{ id: rootId, childIndex: 0 }];
  const acc = new Map<string, number>();

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const node = byId.get(frame.id);
    if (!node) {
      stack.pop();
      continue;
    }
    const presentChildren = node.childIds.filter((c) => byId.has(c));
    if (frame.childIndex < presentChildren.length) {
      const childId = presentChildren[frame.childIndex];
      frame.childIndex += 1;
      stack.push({ id: childId, childIndex: 0 });
      continue;
    }
    // All children processed: this node's subtree weight is its own damped
    // weight plus the children's subtree weights.
    let total = dampedWeight(node.speciesCount, leafFloor);
    for (const childId of presentChildren) {
      total += acc.get(childId) ?? 0;
    }
    acc.set(frame.id, total);
    weightOf.set(frame.id, total);
    stack.pop();
  }

  return weightOf;
}

/**
 * Lay out a (sub)tree radially from a focus root. Returns a flat array of
 * positioned nodes (root first, then a stable depth-first order). Each node's
 * children split the node's allotted arc in proportion to their SUBTREE damped
 * weights, depth maps to radius, and thickness comes from the node's own damped
 * weight scaled across the tree's weight range.
 *
 * `nodes` is the pool of available nodes (a Map or array); `rootId` is the focus.
 * Only nodes reachable from `rootId` through `childIds` are laid out, so passing
 * the whole backbone but a deep rootId lays out just that subtree.
 *
 * Pure. No DOM, no d3, no mutation of the inputs.
 */
export function layoutRadialTree(
  nodes: RadialInputNode[] | Map<string, RadialInputNode>,
  rootId: string,
  options: RadialLayoutOptions = {},
): RadialLaidOutNode[] {
  const opts = { ...DEFAULTS, ...options };
  const byId =
    nodes instanceof Map
      ? nodes
      : new Map(nodes.map((n) => [n.id, n]));

  const root = byId.get(rootId);
  if (!root) return [];

  const subtreeWeight = computeSubtreeWeights(rootId, byId, opts.leafFloor);

  // First pass over the reachable subtree to find the damped-weight range, so
  // thickness can scale between minThickness and maxThickness. We scale on the
  // NODE's own damped weight (not subtree weight) so a branch's drawn width
  // reads as that taxon's own diversity.
  let minW = Infinity;
  let maxW = -Infinity;
  {
    const stack = [rootId];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (!node) continue;
      const w = dampedWeight(node.speciesCount, opts.leafFloor);
      if (w < minW) minW = w;
      if (w > maxW) maxW = w;
      for (const c of node.childIds) if (byId.has(c)) stack.push(c);
    }
  }
  if (!Number.isFinite(minW)) minW = 0;
  if (!Number.isFinite(maxW)) maxW = minW;

  const thicknessOf = (speciesCount: number): number => {
    const w = dampedWeight(speciesCount, opts.leafFloor);
    if (maxW <= minW) return opts.maxThickness;
    const t = (w - minW) / (maxW - minW);
    return opts.minThickness + t * (opts.maxThickness - opts.minThickness);
  };

  const out: RadialLaidOutNode[] = [];

  // Recursive placement. Each node owns an arc [arcStart, arcStart+arcSpan); its
  // own angle is the arc's center, and it hands each child a sub-arc sized by
  // the child's subtree weight. Depth gives the radius.
  const place = (
    id: string,
    depth: number,
    arcStart: number,
    arcSpan: number,
    parentId: string | null,
  ): void => {
    const node = byId.get(id);
    if (!node) return;

    out.push({
      id: node.id,
      name: node.name,
      rank: node.rank,
      speciesCount: node.speciesCount,
      depth,
      angle: arcStart + arcSpan / 2,
      angularWidth: arcSpan,
      radius: opts.innerRadius + depth * opts.ringStep,
      thickness: thicknessOf(node.speciesCount),
      parentId,
      weight: dampedWeight(node.speciesCount, opts.leafFloor),
    });

    const children = node.childIds.map((c) => byId.get(c)).filter((c): c is RadialInputNode => !!c);
    if (children.length === 0) return;

    // Split this node's arc among the children by their SUBTREE weights. We
    // allocate only the descendants' share of the arc (the parent itself does
    // not consume angular width from its own children's pool, the children fill
    // the whole arc), which keeps the radial fan tight.
    let childWeightTotal = 0;
    for (const child of children) childWeightTotal += subtreeWeight.get(child.id) ?? 0;
    if (childWeightTotal <= 0) {
      // Degenerate (all-zero) children: split evenly so nothing collapses.
      const even = arcSpan / children.length;
      let cursor = arcStart;
      for (const child of children) {
        place(child.id, depth + 1, cursor, even, id);
        cursor += even;
      }
      return;
    }
    let cursor = arcStart;
    for (const child of children) {
      const share = (subtreeWeight.get(child.id) ?? 0) / childWeightTotal;
      const childSpan = arcSpan * share;
      place(child.id, depth + 1, cursor, childSpan, id);
      cursor += childSpan;
    }
  };

  place(rootId, 0, opts.startAngle, opts.totalAngle, null);
  return out;
}

/**
 * LEVEL-OF-DETAIL test for one laid-out node at a given zoom. A node is worth
 * drawing only when its on-screen footprint is above a pixel threshold, so a
 * full zoom-out does not paint all ~16k nodes. The footprint is the smaller of
 * the wedge's tangential extent (angularWidth times its on-screen radius) and a
 * thickness floor, both multiplied by the current zoom scale. Pure, so a test
 * can assert that a thin far node culls and a fat near node survives.
 *
 * @param node       a laid-out node
 * @param zoomScale  the current d3-zoom scale (1 at the default fit)
 * @param minPixels  the pixel threshold below which a node is culled
 */
export function isNodeVisibleAtZoom(
  node: RadialLaidOutNode,
  zoomScale: number,
  minPixels: number,
): boolean {
  // The root is always drawn (it anchors the view).
  if (node.parentId === null) return true;
  // Tangential pixel extent of the wedge at this node's radius, after zoom. A
  // node near the center with a tiny radius still survives on its thickness, so
  // we take the max of the arc extent and the thickness.
  const arcPixels = node.angularWidth * node.radius * zoomScale;
  const thicknessPixels = node.thickness * zoomScale;
  const footprint = Math.max(arcPixels, thicknessPixels);
  return footprint >= minPixels;
}

/**
 * Filter a laid-out tree to the nodes visible at the current zoom, preserving
 * the input order and never orphaning a visible node (a node is kept only when
 * its parent is also kept, so links always connect). Pure helper for the render
 * pass and its test.
 */
export function visibleNodesAtZoom(
  laidOut: RadialLaidOutNode[],
  zoomScale: number,
  minPixels: number,
): RadialLaidOutNode[] {
  const kept = new Set<string>();
  const out: RadialLaidOutNode[] = [];
  for (const node of laidOut) {
    const selfVisible = isNodeVisibleAtZoom(node, zoomScale, minPixels);
    const parentKept = node.parentId === null || kept.has(node.parentId);
    if (selfVisible && parentKept) {
      kept.add(node.id);
      out.push(node);
    }
  }
  return out;
}

/**
 * Whether a node's LABEL should render at the current zoom. Labels are noisier
 * than markers, so they need a wider on-screen arc than a node needs just to be
 * drawn. Same footprint math, a higher threshold. Pure.
 */
export function isLabelVisibleAtZoom(
  node: RadialLaidOutNode,
  zoomScale: number,
  minLabelPixels: number,
): boolean {
  const arcPixels = node.angularWidth * node.radius * zoomScale;
  return arcPixels >= minLabelPixels;
}

/** Convert a laid-out node's polar position to cartesian, the render layer's
 *  one shared trig helper (kept here so the layout owns the angle convention).
 *  Angle 0 points up (negative y), increasing clockwise, the dendrogram norm. */
export function polarToCartesian(angle: number, radius: number): { x: number; y: number } {
  // Shift so 0 is up: subtract a quarter turn.
  const a = angle - Math.PI / 2;
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
}
