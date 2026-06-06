// sequence editor master. The IN-MEMORY TREE the radial view lays out.
//
// The radial layout (taxonomy-radial-layout.ts) is pure math over a pool of
// RadialInputNode. This module builds that pool from the curated backbone and
// grows it on demand. When a user zooms into a family (a backbone leaf), we
// drill live for its genera / species and SPLICE them into the same pool, then
// re-layout that subtree without disturbing the rest. The pool is a plain Map so
// a splice is a cheap insert, not a full rebuild.
//
// Live children carry no species count (the backbone's free count stops at
// family), so a spliced node gets a small synthetic weight from a fallback so it
// still draws a visible twig. The real assemblies / species counts for a focused
// node still come live in the click-detail; the tree only needs a relative
// weight to size the wedge.
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence
// colons.

import {
  loadBackbone,
  type LoadedBackbone,
  type BackboneNode,
} from "./taxonomy-backbone";
import { getTaxonNode, resolveTaxonNames } from "./ncbi-datasets";
import type { RadialInputNode } from "./taxonomy-radial-layout";

/** A node in the live-grown radial pool. RadialInputNode plus the bookkeeping
 *  the splice needs (origin and whether its children have been loaded). */
export interface RadialPoolNode extends RadialInputNode {
  origin: "backbone" | "live";
  /** True once this node's children are in the pool (so we do not re-drill). For
   *  backbone nodes this is always true; for a family it flips after a drill. */
  childrenLoaded: boolean;
  /** Genome assemblies under this node, when known (the live drill carries it via
   *  the batch dataset_report). Drives the BRANCH WIDTH when the centered view is
   *  genus-or-below. Undefined until a drill or a focus fetch fills it; the view
   *  treats undefined as 0 (a thin line). */
  assemblyCount?: number;
}

/** The growable pool the view lays out and the splice mutates. */
export interface RadialPool {
  byId: Map<string, RadialPoolNode>;
  /** The backbone roots, as ids, for the default whole-tree view. */
  rootIds: string[];
}

/** A synthetic root that gathers the real backbone roots (cellular organisms +
 *  Viruses) under one center, so the radial view fans out from a single point.
 *  Its id is reserved and never collides with a tax id. */
export const SYNTHETIC_ROOT_ID = "tree-of-life";

function backboneToPoolNode(n: BackboneNode): RadialPoolNode {
  return {
    id: String(n.taxId),
    name: n.name,
    rank: n.rank,
    speciesCount: n.speciesCount,
    childIds: n.childIds.map(String),
    origin: "backbone",
    childrenLoaded: true,
  };
}

/**
 * Build the radial pool from the loaded backbone. Every backbone node becomes a
 * pool node; a synthetic root gathers the backbone roots so the fan has one
 * center. Pure given the backbone, so it is testable without the network.
 */
export function buildPoolFromBackbone(backbone: LoadedBackbone): RadialPool {
  const byId = new Map<string, RadialPoolNode>();
  for (const node of backbone.byId.values()) {
    byId.set(String(node.taxId), backboneToPoolNode(node));
  }
  const rootIds = backbone.roots.map((r) => String(r.taxId));

  // The synthetic root sums its children's species so its own weight reads
  // sensibly, though it is rarely drawn as a branch (it is the center).
  let speciesTotal = 0;
  for (const id of rootIds) speciesTotal += byId.get(id)?.speciesCount ?? 0;
  byId.set(SYNTHETIC_ROOT_ID, {
    id: SYNTHETIC_ROOT_ID,
    name: "Tree of life",
    rank: "root",
    speciesCount: speciesTotal,
    childIds: rootIds,
    origin: "backbone",
    childrenLoaded: true,
  });

  return { byId, rootIds };
}

/** Load the backbone and build the pool in one step (the view's entry point). */
export async function loadRadialPool(opts: { signal?: AbortSignal } = {}): Promise<RadialPool> {
  const backbone = await loadBackbone({ signal: opts.signal });
  return buildPoolFromBackbone(backbone);
}

/** A weight fallback for a live-drilled node that has no backbone species
 *  count. One species worth, so the twig is thin but drawn. Genera / species
 *  below family are sparse by construction here, so a flat small weight is fine
 *  and keeps the spliced fan readable. */
const LIVE_LEAF_SPECIES = 1;

/**
 * Drill one level below a FAMILY (or any pool node whose children are not yet
 * loaded), fetch its children live, name them in a batch, and SPLICE them into
 * the pool. Mutates `pool` in place (adds the children, marks the parent loaded,
 * sets the parent's childIds) and returns the spliced child ids so the caller
 * can animate them in. A no-op (returns the existing child ids) when the node's
 * children are already loaded or the node is unknown.
 *
 * Network-bound, so it is exercised through a mocked getTaxonNode in tests.
 */
export async function drillNode(
  pool: RadialPool,
  nodeId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string[]> {
  const node = pool.byId.get(nodeId);
  if (!node) return [];
  if (node.childrenLoaded) return node.childIds;

  const live = await getTaxonNode(nodeId, { signal: opts.signal });
  const childIds = live.childIds;
  if (childIds.length === 0) {
    node.childrenLoaded = true;
    node.childIds = [];
    return [];
  }

  // Name the children in one batch (the batch dataset_report also carries each
  // child's assembly count, which the genus-or-below branch width reads). A names
  // failure degrades to id labels so navigation still works.
  let nameMap: Map<string, { taxId: string; name: string; rank: string; assemblies?: number }>;
  try {
    nameMap = await resolveTaxonNames(childIds, { signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    nameMap = new Map();
  }

  const splicedIds: string[] = [];
  for (const childId of childIds) {
    // Do not overwrite a node already in the pool (a re-drill or a shared id).
    if (!pool.byId.has(childId)) {
      const named = nameMap.get(childId);
      pool.byId.set(childId, {
        id: childId,
        name: named?.name ?? `Taxon ${childId}`,
        rank: named?.rank ?? "",
        speciesCount: LIVE_LEAF_SPECIES,
        assemblyCount: named?.assemblies,
        childIds: [],
        origin: "live",
        childrenLoaded: false,
      });
    }
    splicedIds.push(childId);
  }

  node.childIds = childIds;
  node.childrenLoaded = true;
  return splicedIds;
}

/** Locate a tax id in the pool, returning the node or undefined. Used by
 *  search-to-node to decide whether to drill live before zooming. */
export function findPoolNode(pool: RadialPool, taxId: string): RadialPoolNode | undefined {
  return pool.byId.get(String(taxId));
}

/**
 * Drill every node WITHIN the fan-out window below a focus so the re-rooted view
 * can show about `depth` generations of descendants, even below family where the
 * backbone stops. Breadth-first from the focus, it drills any node up to
 * `depth - 1` levels deep whose children are not yet loaded (a backbone family,
 * or a live genus / species), splicing each level in, so the whole window down to
 * level `depth` is populated. Already-loaded nodes are skipped, so a re-center on
 * a node visited before is mostly cache hits (the splice caches per session in
 * the shared pool).
 *
 * Mutates `pool` in place via drillNode and returns ALL the ids it spliced across
 * the window, so the caller can animate the fresh twigs in. A focus whose window
 * is already loaded returns an empty array (a pure cache hit, no network).
 *
 * Network-bound (it calls drillNode), so it is exercised through the mocked
 * getTaxonNode / resolveTaxonNames in tests.
 *
 * @param pool    the growable pool to drill into
 * @param focusId the centered node (level 0)
 * @param depth   how many generations below the focus to populate (the fan depth)
 */
/**
 * Whether re-rooting on a focus would need any live drill within its fan-out
 * window (any node up to `depth - 1` levels below the focus whose children are
 * not yet loaded). Pure, a synchronous peek over the current pool, so the view
 * can decide whether to show a "loading" note before kicking off
 * drillSubtreeToDepth. Returns false for a window already fully loaded (a pure
 * cache hit, the common backbone-navigation case).
 */
export function windowNeedsDrill(
  pool: RadialPool,
  focusId: string,
  depth: number,
): boolean {
  const root = pool.byId.get(String(focusId));
  if (!root) return false;
  const limit = Math.max(0, Math.floor(depth));
  if (limit === 0) return false;

  let frontier: string[] = [String(focusId)];
  for (let level = 0; level < limit && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = pool.byId.get(id);
      if (!node) continue;
      if (!node.childrenLoaded) return true;
      for (const childId of node.childIds) next.push(childId);
    }
    frontier = next;
  }
  return false;
}

export async function drillSubtreeToDepth(
  pool: RadialPool,
  focusId: string,
  depth: number,
  opts: { signal?: AbortSignal } = {},
): Promise<string[]> {
  const root = pool.byId.get(String(focusId));
  if (!root) return [];
  const limit = Math.max(0, Math.floor(depth));
  if (limit === 0) return [];

  const added: string[] = [];
  // Level-by-level so a level's freshly spliced children become the next level's
  // drill candidates. We only drill nodes shallower than the limit, so the window
  // fills exactly to level `depth`.
  let frontier: string[] = [String(focusId)];
  for (let level = 0; level < limit && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = pool.byId.get(id);
      if (!node) continue;
      if (!node.childrenLoaded) {
        const spliced = await drillNode(pool, id, opts);
        for (const childId of spliced) added.push(childId);
      }
      // Recompute children after the drill so freshly spliced ids feed the next
      // level. A node already loaded just hands down its existing children.
      const refreshed = pool.byId.get(id);
      for (const childId of refreshed?.childIds ?? []) next.push(childId);
    }
    frontier = next;
  }
  return added;
}

// --- Focus stack (the re-rooting navigation) --------------------------------
//
// The radial view re-roots on the node the user centers. A FOCUS STACK records
// that drill path so a center-click can walk it back one level. The bottom of
// the stack is always the whole-tree root; the top is the current center. These
// are pure array operations, kept here and unit-tested so the navigation feel is
// driven by tested logic rather than ad-hoc state shuffles in the component.

/** The current center, the top of the focus stack. Falls back to the synthetic
 *  root for an empty stack so the view always has a root to lay out. */
export function currentFocus(stack: string[]): string {
  return stack.length > 0 ? stack[stack.length - 1] : SYNTHETIC_ROOT_ID;
}

/**
 * Push a new center onto the focus stack (a drill-in re-root). Clicking a node
 * that is NOT already the center makes it the new center. Clicking the current
 * center, or a node already somewhere in the stack, is a no-op here (a re-center
 * on the same node should not stack duplicates; a click on the center is a GO
 * BACK, handled by popFocus). Returns a NEW array, never mutating the input.
 *
 * @param stack the current focus stack (bottom is the whole-tree root)
 * @param id    the node the user clicked to center on
 */
export function pushFocus(stack: string[], id: string): string[] {
  if (currentFocus(stack) === id) return stack;
  // A click on an ancestor already in the stack walks back to it rather than
  // re-pushing, so the breadcrumb and the stack stay a simple path with no
  // repeats.
  const at = stack.indexOf(id);
  if (at !== -1) return stack.slice(0, at + 1);
  return [...stack, id];
}

/**
 * Pop the focus stack one level (a center-click GO BACK), re-rooting on the
 * previous focus. A stack at its bottom (length <= 1, the whole-tree root) does
 * not pop, so a center-click on the root view does nothing. Returns a NEW array,
 * never mutating the input.
 */
export function popFocus(stack: string[]): string[] {
  if (stack.length <= 1) return stack;
  return stack.slice(0, -1);
}

/** Jump the focus stack straight to an entry already in it (a breadcrumb click).
 *  Truncates to that entry so the crumbs after it drop off. A no-op when the id
 *  is not in the stack. Returns a NEW array. */
export function focusTo(stack: string[], id: string): string[] {
  const at = stack.indexOf(id);
  if (at === -1) return stack;
  return stack.slice(0, at + 1);
}

/** One step of a resolved lineage, the minimal shape the splice needs. The
 *  search-zoom resolver fills these from live getTaxonNode calls (id + name +
 *  rank), and the splice threads each step under the one above it. */
export interface LineageStep {
  id: string;
  name: string;
  rank: string;
  /** Genome assemblies under the node, when the resolver carried it. Threaded
   *  onto the spliced pool node so a genus-or-below search target reads its real
   *  branch width. */
  assemblies?: number;
}

/**
 * Splice a LINEAGE PATH of below-family nodes into the pool under an ancestor
 * that is already present. Given the in-pool anchor id and the ordered steps
 * from the anchor's first missing child down to the target (root-first), this
 * inserts each missing node as a live pool node and wires the parent / child
 * links so the layout reaches the target. Mutates `pool` in place and returns
 * the ids it actually added (already-present ids are skipped, so a re-splice is
 * a no-op for them).
 *
 * Pure given the resolved steps (no network), so the lineage-to-pool wiring is
 * unit-tested without mocking the live fetch. The network walk that produces the
 * steps lives in resolveLineageToPool.
 *
 * @param pool    the growable pool to mutate
 * @param anchorId an id already in the pool (the nearest present ancestor)
 * @param steps   the ordered descendants from just under the anchor to the
 *                target (root-first), each a LineageStep
 */
export function spliceLineagePath(
  pool: RadialPool,
  anchorId: string,
  steps: LineageStep[],
): string[] {
  const anchor = pool.byId.get(String(anchorId));
  if (!anchor || steps.length === 0) return [];

  const added: string[] = [];
  let parent = anchor;
  for (const step of steps) {
    const stepId = String(step.id);
    if (!pool.byId.has(stepId)) {
      pool.byId.set(stepId, {
        id: stepId,
        name: step.name || `Taxon ${stepId}`,
        rank: step.rank || "",
        speciesCount: LIVE_LEAF_SPECIES,
        assemblyCount: step.assemblies,
        childIds: [],
        // The target keeps childrenLoaded false so a dive can still drill below
        // it; an interior step we just threaded has no loaded children either.
        origin: "live",
        childrenLoaded: false,
      });
      added.push(stepId);
    }
    // Wire the step under its parent without disturbing the parent's other
    // children. The anchor / interior nodes now hold at least this child, so the
    // layout walks down to the target.
    if (!parent.childIds.includes(stepId)) {
      parent.childIds = [...parent.childIds, stepId];
    }
    // An interior lineage node is a real branch we have placed, so its single
    // known child is loaded enough for the path; mark it so a later full dive
    // still re-drills its complete child set (childrenLoaded false leaves that
    // door open). We intentionally leave childrenLoaded false on every threaded
    // node so a subsequent dive loads the FULL sibling set, not just this path.
    parent = pool.byId.get(stepId)!;
  }
  return added;
}

/**
 * Resolve a below-family search target into the pool and return the in-pool
 * anchor plus the spliced path, so the caller can re-layout and zoom to it.
 *
 * Walks the target's live ancestor lineage (getTaxonNode gives ancestorIds
 * root-first), finds the deepest ancestor ALREADY in the pool (a backbone
 * family, usually), names the missing chain in one batch, and splices it under
 * that anchor with spliceLineagePath. Returns the anchor id and the target id so
 * the caller knows what to frame. Returns null when the target has no in-pool
 * ancestor at all (it sits outside our backbone entirely).
 *
 * Bounded: the below-family lineage is shallow (family to species is a few
 * levels), and the missing chain is named in a single resolveTaxonNames call.
 * Network-bound, so it is exercised through mocked getTaxonNode / resolveTaxonNames.
 */
export async function resolveLineageToPool(
  pool: RadialPool,
  taxId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ anchorId: string; targetId: string; added: string[] } | null> {
  const targetId = String(taxId);
  // Already present (it may have been drilled into the pool earlier): nothing to
  // splice, the caller just frames it.
  if (pool.byId.has(targetId)) {
    return { anchorId: targetId, targetId, added: [] };
  }

  const target = await getTaxonNode(targetId, { signal: opts.signal });
  // ancestorIds is root-first and excludes self. The lineage from root to the
  // target is [...ancestorIds, targetId].
  const lineage = [...target.ancestorIds.map(String), targetId];

  // Find the deepest lineage entry already in the pool (the anchor). Everything
  // below it is the missing chain we must splice.
  let anchorIndex = -1;
  for (let i = lineage.length - 1; i >= 0; i -= 1) {
    if (pool.byId.has(lineage[i])) {
      anchorIndex = i;
      break;
    }
  }
  if (anchorIndex === -1) return null; // no in-pool ancestor, off our backbone

  const anchorId = lineage[anchorIndex];
  const missingIds = lineage.slice(anchorIndex + 1);
  if (missingIds.length === 0) {
    return { anchorId, targetId, added: [] };
  }

  // Name the missing chain in one batch. A names failure degrades to id labels
  // so the zoom still lands. The target's own name / rank come from its report.
  let nameMap: Map<string, { taxId: string; name: string; rank: string; assemblies?: number }>;
  try {
    nameMap = await resolveTaxonNames(missingIds, { signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    nameMap = new Map();
  }
  // The target's own name / rank / assembly count are authoritative from its
  // report (getTaxonNode carries the counts array).
  nameMap.set(targetId, {
    taxId: targetId,
    name: target.name,
    rank: target.rank,
    assemblies: target.counts.assemblies,
  });

  const steps: LineageStep[] = missingIds.map((id) => {
    const named = nameMap.get(id);
    return {
      id,
      name: named?.name ?? `Taxon ${id}`,
      rank: named?.rank ?? "",
      assemblies: named?.assemblies,
    };
  });

  const added = spliceLineagePath(pool, anchorId, steps);
  return { anchorId, targetId, added };
}

/**
 * The ancestor PATH from the synthetic root down to a target id, as ids, or null
 * when the target is not reachable in the current pool. Used to know which
 * ancestors a search-to-node zoom must reveal. Walks parentId via a reverse
 * index built once over the pool.
 */
export function pathToNode(pool: RadialPool, taxId: string): string[] | null {
  const target = String(taxId);
  if (!pool.byId.has(target)) return null;

  // Build a child -> parent index from the pool's childIds.
  const parentOf = new Map<string, string>();
  for (const node of pool.byId.values()) {
    for (const childId of node.childIds) {
      if (!parentOf.has(childId)) parentOf.set(childId, node.id);
    }
  }

  const path: string[] = [target];
  let cursor = target;
  const guard = new Set<string>([target]);
  while (parentOf.has(cursor)) {
    const parent = parentOf.get(cursor)!;
    if (guard.has(parent)) break; // cycle guard
    path.unshift(parent);
    guard.add(parent);
    cursor = parent;
  }
  return path;
}
