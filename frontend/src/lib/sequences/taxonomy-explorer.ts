// sequence editor master. The UNIFIED node source for the taxonomy tree explorer.
//
// The explorer walks one node at a time, up to its parent, sideways to its
// siblings, and down to its children. Two data sources back it. The curated
// BACKBONE (taxonomy-backbone.ts) covers every taxon at rank family and above,
// instant and offline, with a precomputed species count per node. Below family
// (genus, species, strain) the backbone has nothing, so those resolve LIVE from
// the Datasets API (ncbi-datasets.ts) and merge into an in-session cache.
//
// This module hides that split behind one shape, the ResolvedNode. It prefers
// the backbone whenever a node is present (so common high-rank navigation is
// offline and free), falls back to live, and labels each node with its origin so
// the UI can show or just behave. A family's children are genera (below the
// backbone), so those always come live; their names are resolved in one batch.
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence
// colons.

import {
  loadBackbone,
  getBackboneNode,
  backboneChildren,
  backboneSiblings,
  type LoadedBackbone,
  type BackboneNode,
} from "./taxonomy-backbone";
import {
  getTaxonNode,
  resolveTaxonNames,
  type ExplorerTaxonNode,
} from "./ncbi-datasets";

/** Where a resolved node came from. The UI can label or just behave. */
export type NodeOrigin = "backbone" | "live";

/** A neighbor (parent / sibling / child) reference, named when known. A live
 *  child id starts name-less and gets filled by a batch resolve. */
export interface NeighborRef {
  taxId: string;
  name: string;
  rank: string;
}

/** A node resolved to one shape regardless of source. speciesCount is present
 *  from the backbone (instant); assemblies come from the live count, fetched
 *  lazily for the centered node only. */
export interface ResolvedNode {
  taxId: string;
  name: string;
  rank: string;
  origin: NodeOrigin;
  parentId: string | null;
  /** Direct children as references. From the backbone they are named already;
   *  from live they carry ids that the children resolver names in a batch. */
  childRefs: NeighborRef[];
  /** Species under the node, from the backbone. Undefined on the live path. */
  speciesCount?: number;
  /** Assemblies under the node, from the live count. Undefined until fetched. */
  assembliesCount?: number;
  /** Major rank -> name, for the breadcrumb (live nodes carry this; backbone
   *  nodes leave it empty and the UI builds the crumb from the walked path). */
  classification: Record<string, string>;
}

/** The in-session cache of live-resolved nodes, so walking back up or revisiting
 *  a sibling is instant. The backbone is its own durable cache, so only LIVE
 *  nodes land here. Capped to keep memory bounded. */
const LIVE_CACHE_CAP = 400;
const liveCache = new Map<string, ResolvedNode>();

function cacheLive(node: ResolvedNode): ResolvedNode {
  // Evict the oldest entry when over the cap. Map preserves insertion order, so
  // the first key is the oldest.
  if (liveCache.size >= LIVE_CACHE_CAP) {
    const oldest = liveCache.keys().next().value;
    if (oldest !== undefined) liveCache.delete(oldest);
  }
  liveCache.set(node.taxId, node);
  return node;
}

/** Reset the live cache. For tests; not used by the UI. */
export function __resetExplorerLiveCache(): void {
  liveCache.clear();
}

/** Map a backbone node to the unified ResolvedNode shape. Children are named
 *  already (the backbone resolves its own kept links), so no batch is needed. */
function fromBackbone(backbone: LoadedBackbone, node: BackboneNode): ResolvedNode {
  const childRefs: NeighborRef[] = backboneChildren(backbone, node.taxId).map(
    (c) => ({ taxId: String(c.taxId), name: c.name, rank: c.rank }),
  );
  return {
    taxId: String(node.taxId),
    name: node.name,
    rank: node.rank,
    origin: "backbone",
    parentId: node.parentId === null ? null : String(node.parentId),
    childRefs,
    speciesCount: node.speciesCount,
    classification: {},
  };
}

/** Map a live ExplorerTaxonNode to the unified shape. Children start name-less
 *  (just ids), to be named by resolveChildNames in a batch. */
function fromLive(node: ExplorerTaxonNode): ResolvedNode {
  const childRefs: NeighborRef[] = node.childIds.map((id) => ({
    taxId: id,
    name: "",
    rank: "",
  }));
  return {
    taxId: node.taxId,
    name: node.name,
    rank: node.rank,
    origin: "live",
    parentId: node.parentId,
    childRefs,
    assembliesCount: node.counts.assemblies,
    classification: node.classification,
  };
}

/**
 * Resolve one node by tax id to the unified shape. Prefers the BACKBONE (instant,
 * offline, carries a species count); falls back to the LIVE Datasets API and
 * caches the result for the session. The backbone is loaded once and reused.
 */
export async function resolveExplorerNode(
  taxId: string | number,
  opts?: { signal?: AbortSignal },
): Promise<ResolvedNode> {
  const id = String(taxId).trim();
  const numericId = Number(id);

  // Backbone first (family and above). Loading it is cheap after the first call.
  let backbone: LoadedBackbone | null = null;
  try {
    backbone = await loadBackbone({ signal: opts?.signal });
  } catch {
    // Offline before the backbone has ever downloaded. The live path can still
    // work if the network came back; if not, getTaxonNode surfaces its own error.
    backbone = null;
  }
  if (backbone && Number.isFinite(numericId)) {
    const node = getBackboneNode(backbone, numericId);
    if (node) return fromBackbone(backbone, node);
  }

  // A session-cached live node is instant.
  const cached = liveCache.get(id);
  if (cached) return cached;

  // Below family, or not in the backbone: resolve live and cache.
  const live = await getTaxonNode(id, { signal: opts?.signal });
  return cacheLive(fromLive(live));
}

/**
 * Resolve the SIBLINGS of a node (its parent's other children, the node itself
 * excluded). Prefers the backbone when the parent is a backbone node; otherwise
 * resolves the parent live and names its children in a batch. A root's siblings
 * are the other roots. Returns named references in source order.
 */
export async function resolveSiblings(
  node: ResolvedNode,
  opts?: { signal?: AbortSignal },
): Promise<NeighborRef[]> {
  if (node.parentId === null) {
    // A root's siblings are the other backbone roots.
    let backbone: LoadedBackbone | null = null;
    try {
      backbone = await loadBackbone({ signal: opts?.signal });
    } catch {
      backbone = null;
    }
    if (!backbone) return [];
    const numericId = Number(node.taxId);
    return backboneSiblings(backbone, numericId).map((s) => ({
      taxId: String(s.taxId),
      name: s.name,
      rank: s.rank,
    }));
  }

  // Resolve the parent, then take its children minus this node. The parent
  // resolves through the same backbone-first path, so its children arrive named
  // when the parent is a backbone node, or get named in a batch when live.
  const parent = await resolveExplorerNode(node.parentId, opts);
  const named = await resolveChildNames(parent, opts);
  return named.filter((c) => c.taxId !== node.taxId);
}

/**
 * Name a node's children. Backbone children are already named, so they pass
 * through. Live children carry ids only, so they are resolved in one batch call
 * (a few to a few dozen per node). The returned refs preserve child order.
 */
export async function resolveChildNames(
  node: ResolvedNode,
  opts?: { signal?: AbortSignal },
): Promise<NeighborRef[]> {
  const unnamed = node.childRefs.filter((c) => c.name === "");
  if (unnamed.length === 0) return node.childRefs;

  let nameMap: Map<string, NeighborRef>;
  try {
    nameMap = await resolveTaxonNames(
      unnamed.map((c) => c.taxId),
      opts,
    );
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    // A names failure degrades to ids: show the child with its tax id as a label
    // rather than dropping it, so navigation still works.
    nameMap = new Map();
  }

  return node.childRefs.map((c) => {
    if (c.name !== "") return c;
    const resolved = nameMap.get(c.taxId);
    return resolved
      ? { taxId: c.taxId, name: resolved.name, rank: resolved.rank }
      : { taxId: c.taxId, name: `Taxon ${c.taxId}`, rank: c.rank };
  });
}

/**
 * Fetch the live assemblies count for a node. The backbone carries a species
 * count for free, but assemblies are a live-only tally, so the count badge
 * toggles to assemblies by fetching the node's report once. Returns undefined
 * when the report carries no assembly count. Cached on the resolved node by the
 * caller so a re-toggle does not refetch.
 */
export async function fetchAssembliesCount(
  taxId: string | number,
  opts?: { signal?: AbortSignal },
): Promise<number | undefined> {
  const live = await getTaxonNode(taxId, { signal: opts?.signal });
  return live.counts.assemblies;
}
