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
 * Prune a pool down to the subtree rooted at `focusId` and limited to `maxDepth`
 * generations of descendants (focus is level 0, its children level 1, and so on
 * down to level maxDepth). The pruned Map is what the RE-ROOTING navigation lays
 * out, so the user sees only the centered clade and a few levels under it, not
 * the whole tree.
 *
 * The deepest KEPT nodes (those at level maxDepth) have their childIds trimmed to
 * empty so layoutRadialTree stops there, even though deeper nodes still exist in
 * the source pool. Nodes already-trimmed elsewhere keep only the children present
 * in the source. Any childId not in the source is dropped so the layout never
 * dangles.
 *
 * Pure. Returns a fresh Map and fresh node objects (childIds arrays are new), so
 * the source pool is untouched. Returns an empty Map when the focus is absent.
 *
 * @param nodes    the source pool (a Map or array of RadialInputNode)
 * @param focusId  the node to center on (level 0)
 * @param maxDepth how many generations of descendants to keep (>= 0)
 */
export function subtreeToDepth(
  nodes: RadialInputNode[] | Map<string, RadialInputNode>,
  focusId: string,
  maxDepth: number,
): Map<string, RadialInputNode> {
  const source =
    nodes instanceof Map ? nodes : new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, RadialInputNode>();
  const root = source.get(focusId);
  if (!root) return out;

  const limit = Math.max(0, Math.floor(maxDepth));

  // Breadth-first from the focus, carrying each node's level. A node at the depth
  // limit is added with empty childIds so the layout stops; a node above the
  // limit keeps only the children that exist in the source.
  const queue: Array<{ id: string; level: number }> = [{ id: focusId, level: 0 }];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = source.get(id);
    if (!node) continue;

    if (level >= limit) {
      out.set(id, { ...node, childIds: [] });
      continue;
    }
    const keptChildIds = node.childIds.filter((c) => source.has(c));
    out.set(id, { ...node, childIds: [...keptChildIds] });
    for (const childId of keptChildIds) {
      if (!seen.has(childId)) queue.push({ id: childId, level: level + 1 });
    }
  }

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
 * A rectangle in the LAYOUT coordinate space (the same space polarToCartesian
 * returns). The render layer computes it by inverse-transforming the on-screen
 * viewport through the current d3-zoom transform, so it is the slice of the tree
 * the user can actually see. Used to bound the drawn node count at any zoom.
 */
export interface ViewportRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Default viewport-cull options. The margin is a fraction of the rect's larger
 *  side, so panning a little does not pop nodes in. The cap is a hard ceiling on
 *  the drawn node count, a safety net against a pathological zoom. */
const VIEWPORT_DEFAULTS = {
  /** Padding as a fraction of the viewport's larger side (15 percent). */
  marginFraction: 0.15,
  /** Never draw more than this many nodes, whatever the filters pass. */
  hardCap: 2500,
};

/**
 * Whether a laid-out node's on-screen position falls within the visible viewport
 * (expanded by a margin so a small pan does not pop nodes). The viewport is given
 * in LAYOUT coordinates (already inverse-transformed by the caller), so this is a
 * plain rectangle test on the node's cartesian position. Pure and exported so a
 * test can pin the inside / outside / near-edge behavior.
 *
 * @param node    a laid-out node
 * @param rect    the visible rectangle in layout coordinates
 * @param margin  absolute padding added to every side, in layout units
 */
export function isNodeInViewport(
  node: RadialLaidOutNode,
  rect: ViewportRect,
  margin = 0,
): boolean {
  const { x, y } = polarToCartesian(node.angle, node.radius);
  return (
    x >= rect.minX - margin &&
    x <= rect.maxX + margin &&
    y >= rect.minY - margin &&
    y <= rect.maxY + margin
  );
}

/** Options for visibleNodesAtZoom's viewport-aware path. All optional, so the
 *  legacy size-only call (zoomScale + minPixels) still works unchanged. */
export interface VisibleNodesOptions {
  /** The visible rectangle in layout coordinates. When given, a node must fall
   *  inside it (plus the margin) on top of clearing the size threshold. */
  viewport?: ViewportRect;
  /** Padding fraction of the viewport's larger side. Defaults to 15 percent. */
  marginFraction?: number;
  /** Hard ceiling on the drawn node count. Defaults to 2500. When more nodes
   *  pass the filters, the largest-footprint ones win (priority by on-screen
   *  arc / thickness), so a pathological zoom cannot explode the DOM. */
  hardCap?: number;
}

/** The on-screen footprint of a node at a zoom, the same measure the size cull
 *  uses (max of the wedge's tangential arc and its thickness, times the zoom).
 *  Exposed only to rank nodes for the hard cap. */
function nodeFootprint(node: RadialLaidOutNode, zoomScale: number): number {
  const arcPixels = node.angularWidth * node.radius * zoomScale;
  const thicknessPixels = node.thickness * zoomScale;
  return Math.max(arcPixels, thicknessPixels);
}

/**
 * Filter a laid-out tree to the nodes worth drawing at the current zoom,
 * preserving the input order and never orphaning a node (a kept node always has
 * its ancestors kept, so links always connect to a drawn parent).
 *
 * Two filters stack:
 *  1. SIZE. A node's on-screen footprint must clear minPixels (the legacy cull).
 *  2. VIEWPORT (optional). The node's on-screen position must fall inside the
 *     visible rectangle plus a margin. This is what bounds the count at high
 *     zoom, because zooming in shrinks the visible tree-space rectangle even as
 *     the size footprint grows.
 *
 * Ancestors of any kept node are force-kept so links never orphan, even when an
 * ancestor sits just outside the viewport. Finally a HARD CAP trims to the
 * largest-footprint nodes (root and the forced ancestors are always retained so
 * the fan stays connected), a safety net against a pathological zoom.
 *
 * Backward compatible: called as visibleNodesAtZoom(laidOut, zoom, minPixels)
 * with no options, it is the old size-only cull.
 */
export function visibleNodesAtZoom(
  laidOut: RadialLaidOutNode[],
  zoomScale: number,
  minPixels: number,
  options: VisibleNodesOptions = {},
): RadialLaidOutNode[] {
  const viewport = options.viewport;
  const marginFraction = options.marginFraction ?? VIEWPORT_DEFAULTS.marginFraction;
  const hardCap = options.hardCap ?? VIEWPORT_DEFAULTS.hardCap;

  // Absolute margin in layout units, a fraction of the viewport's larger side so
  // the padding tracks how zoomed in we are (a small viewport gets a small ring
  // of slack, one node-ring or so).
  const margin = viewport
    ? Math.max(viewport.maxX - viewport.minX, viewport.maxY - viewport.minY) * marginFraction
    : 0;

  // Index by id so the ancestor walk can resolve parents.
  const byId = new Map<string, RadialLaidOutNode>();
  for (const n of laidOut) byId.set(n.id, n);

  // Without a viewport this is the LEGACY size-only cull, in input order, never
  // orphaning a visible node (a node is kept only when its parent is also kept,
  // so links always connect). Preserved exactly so the old contract holds.
  if (!viewport) {
    const keptLegacy = new Set<string>();
    const outLegacy: RadialLaidOutNode[] = [];
    for (const node of laidOut) {
      const selfVisible = isNodeVisibleAtZoom(node, zoomScale, minPixels);
      const parentKept = node.parentId === null || keptLegacy.has(node.parentId);
      if (selfVisible && parentKept) {
        keptLegacy.add(node.id);
        outLegacy.push(node);
      }
    }
    return outLegacy;
  }

  // VIEWPORT path. First pass: a node passes the FILTERS when it clears the size
  // threshold and sits inside the padded rectangle. The root always passes (it
  // anchors the view).
  const passes = new Set<string>();
  for (const node of laidOut) {
    if (node.parentId === null) {
      passes.add(node.id);
      continue;
    }
    const sizeOk = isNodeVisibleAtZoom(node, zoomScale, minPixels);
    const viewportOk = isNodeInViewport(node, viewport, margin);
    if (sizeOk && viewportOk) passes.add(node.id);
  }

  // Force-keep the ancestors of every passing node so a kept node never orphans
  // (its link always reaches a drawn parent), even if an ancestor sits just
  // outside the viewport. Walk each passing node up to the root.
  const kept = new Set<string>();
  for (const id of passes) {
    let cursor: string | null = id;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      kept.add(cursor);
      const node = byId.get(cursor);
      cursor = node ? node.parentId : null;
    }
  }

  // The kept set in input order. If it is within the cap, we are done.
  let out = laidOut.filter((n) => kept.has(n.id));
  if (out.length <= hardCap) return out;

  // Over the cap: keep the largest-footprint nodes, but always retain the root
  // and the FORCED ancestors (nodes kept only to connect a child), so trimming
  // never orphans a survivor. The forced ancestors are the kept nodes that did
  // not pass the filters on their own.
  const mandatory = new Set<string>();
  for (const n of out) {
    if (n.parentId === null || !passes.has(n.id)) mandatory.add(n.id);
  }

  // Candidates are the on-their-own-merit nodes, ranked by footprint descending.
  const candidates = out
    .filter((n) => !mandatory.has(n.id))
    .sort((a, b) => nodeFootprint(b, zoomScale) - nodeFootprint(a, zoomScale));

  const room = Math.max(0, hardCap - mandatory.size);
  const capped = new Set<string>(mandatory);
  for (let i = 0; i < candidates.length && capped.size < mandatory.size + room; i += 1) {
    capped.add(candidates[i].id);
  }

  out = laidOut.filter((n) => capped.has(n.id));
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

/**
 * The font-size MULTIPLIER for a label by its level out from the current center
 * (the depth in the re-rooted fan, which is also the depth in a root-centered
 * whole-tree view). The center and its immediate children read biggest; each
 * level outward is quieter; past the fan-out depth the label is hidden, returned
 * as 0 so the render layer can skip drawing it.
 *
 * The scale steps down by a fixed fraction per level and floors so a far label is
 * small but still legible, then drops to 0 once the level exceeds maxLabelLevel.
 * Monotonic decreasing across the drawn band. Pure and exported so a test can pin
 * the curve (biggest at 0, smaller each step, 0 past the depth).
 *
 * @param level         the node's depth from the centered focus (0 is the center)
 * @param maxLabelLevel the deepest level that still earns a label (>= this is 0)
 */
export function labelScaleForLevel(level: number, maxLabelLevel = 3): number {
  if (!Number.isFinite(level) || level < 0) return 0;
  if (level > maxLabelLevel) return 0;
  // Step down a fifth per level from a slightly enlarged center, floored so the
  // deepest still-drawn label keeps a readable size.
  const FONT_STEP = 0.2;
  const FONT_FLOOR = 0.62;
  const raw = 1.25 - level * FONT_STEP;
  return Math.max(FONT_FLOOR, raw);
}

/**
 * The visible viewport in LAYOUT coordinates from a d3-zoom transform and the
 * on-screen drawing box. d3-zoom maps a layout point to screen as
 *   screen = k * layout + [tx, ty]
 * so the inverse of a screen point is (screen - [tx, ty]) / k. We invert the two
 * opposite corners of the [0, viewSize] square (the SVG viewBox) to get the tree
 * slice on screen. Pure, so a test can pin the rect math without a real d3
 * transform. The render layer passes k / tx / ty straight off event.transform.
 *
 * @param k        the zoom scale (event.transform.k)
 * @param tx       the x translation (event.transform.x)
 * @param ty       the y translation (event.transform.y)
 * @param viewSize the SVG drawing box side, in screen units
 */
export function viewportRectFromTransform(
  k: number,
  tx: number,
  ty: number,
  viewSize: number,
): ViewportRect {
  const safeK = k === 0 ? 1 : k;
  const x0 = (0 - tx) / safeK;
  const y0 = (0 - ty) / safeK;
  const x1 = (viewSize - tx) / safeK;
  const y1 = (viewSize - ty) / safeK;
  return {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  };
}

/** Convert a laid-out node's polar position to cartesian, the render layer's
 *  one shared trig helper (kept here so the layout owns the angle convention).
 *  Angle 0 points up (negative y), increasing clockwise, the dendrogram norm. */
export function polarToCartesian(angle: number, radius: number): { x: number; y: number } {
  // Shift so 0 is up: subtract a quarter turn.
  const a = angle - Math.PI / 2;
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
}

/**
 * The screen-space center point of the SVG viewport, the anchor the +/- buttons
 * zoom AROUND. d3-zoom's scaleBy(selection, k, point) keeps `point` fixed while
 * it scales, so passing the center of what is on screen makes a button-zoom grow
 * or shrink whatever the user has centered, instead of flying toward the fixed
 * tree origin. The point is in the SVG's own coordinate system (the viewBox), so
 * for a square [0, viewSize] viewBox it is simply the middle of that box. Pure
 * and exported so a test can pin it without a live d3 selection.
 *
 * @param viewSize the SVG drawing box side (the viewBox is [0, viewSize])
 */
export function viewportCenterPoint(viewSize: number): [number, number] {
  return [viewSize / 2, viewSize / 2];
}

/**
 * The cartesian bounding box of a node and its laid-out descendants, in LAYOUT
 * coordinates (the polarToCartesian space). This is what a click-to-dive frames
 * so the clicked clade fills the view. The box spans every descendant's marker
 * position. Pure, so a test can pin it; the caller turns it into a zoom
 * transform with fitTransform.
 *
 * Returns null when the node is not present (an empty box is meaningless).
 *
 * @param laidOut a flat laid-out tree (the layout output)
 * @param rootId  the node to bound (its whole subtree is included)
 */
export function subtreeBounds(
  laidOut: RadialLaidOutNode[],
  rootId: string,
): ViewportRect | null {
  const byId = new Map<string, RadialLaidOutNode>();
  const childrenOf = new Map<string, RadialLaidOutNode[]>();
  for (const n of laidOut) {
    byId.set(n.id, n);
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId);
      if (arr) arr.push(n);
      else childrenOf.set(n.parentId, [n]);
    }
  }
  const root = byId.get(rootId);
  if (!root) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const stack: RadialLaidOutNode[] = [root];
  const guard = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (guard.has(node.id)) continue;
    guard.add(node.id);
    const { x, y } = polarToCartesian(node.angle, node.radius);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    for (const child of childrenOf.get(node.id) ?? []) stack.push(child);
  }
  return { minX, minY, maxX, maxY };
}

/** A d3-zoom transform as plain numbers, the shape the render layer hands to
 *  zoomIdentity.translate(x, y).scale(k). Kept framework-free so the fit math is
 *  unit-tested without a real d3 transform. */
export interface ZoomTransformParts {
  k: number;
  x: number;
  y: number;
}

/**
 * A zoom transform that FRAMES a layout-space rectangle inside the SVG viewport,
 * the math behind click-to-dive and search-zoom. The rectangle (a subtree's
 * bounds) is centered in the [0, viewSize] box and scaled so it fills a
 * comfortable fraction of the view (padding leaves breathing room around the
 * clade). A degenerate (zero-area) box, a single leaf, falls back to a readable
 * default scale centered on the box. Pure, so a test can pin the centering and
 * the fill fraction without driving d3.
 *
 * d3-zoom maps layout to screen as screen = k * layout + [x, y]. To center the
 * box center C at the viewport center V at scale k, we need x = V - k * C.
 *
 * @param rect       the layout-space rectangle to frame (e.g. subtreeBounds)
 * @param viewSize   the SVG drawing box side
 * @param opts.padding   fraction of the view to leave as margin (0.1 = 10 percent each side)
 * @param opts.maxScale  the largest scale a tiny box is allowed to reach
 * @param opts.minScale  the smallest scale the fit will use
 * @param opts.fallbackScale  the scale for a zero-area box (a single leaf)
 */
export function fitTransform(
  rect: ViewportRect,
  viewSize: number,
  opts: {
    padding?: number;
    maxScale?: number;
    minScale?: number;
    fallbackScale?: number;
  } = {},
): ZoomTransformParts {
  const padding = opts.padding ?? 0.12;
  const maxScale = opts.maxScale ?? 18;
  const minScale = opts.minScale ?? 0.3;
  const fallbackScale = opts.fallbackScale ?? 6;

  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  const width = rect.maxX - rect.minX;
  const height = rect.maxY - rect.minY;
  const usable = viewSize * (1 - 2 * padding);

  let k: number;
  if (width <= 1e-6 && height <= 1e-6) {
    // A single point (a leaf): no extent to fit, use the readable default.
    k = fallbackScale;
  } else {
    const span = Math.max(width, height);
    k = usable / span;
  }
  k = Math.min(maxScale, Math.max(minScale, k));

  const center = viewSize / 2;
  return { k, x: center - k * cx, y: center - k * cy };
}
