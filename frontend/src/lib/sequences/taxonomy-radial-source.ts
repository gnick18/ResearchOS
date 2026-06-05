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

  // Name the children in one batch. A names failure degrades to id labels so
  // navigation still works.
  let nameMap: Map<string, { taxId: string; name: string; rank: string }>;
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
