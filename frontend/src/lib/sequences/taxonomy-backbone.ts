// sequence editor master. CURATED TAXONOMY BACKBONE download-once + cache layer.
//
// The tree explorer walks the tree of life down to FAMILY instantly and offline.
// To do that it needs the curated backbone (every taxon from the NCBI taxdump at
// rank family and above, re-parented to skip unranked clades, with a precomputed
// species-under count per node) in browser memory. We host it as a static asset
// under public/ and download it ONCE; the Cache API keeps it durably so later
// opens of the explorer are instant with no network. Deeper nodes (genus,
// species, strain) fall back to the live Datasets API in the UI, not here.
//
// The bundled file uses SHORT keys to save bytes over the wire
//   { i, n, r, p, c, s }  ->  { taxId, name, rank, parentId, childIds, speciesCount }
// loadBackbone maps them to the typed full-word shape once on load and caches the
// indexed result in memory for the session.
//
// Mirrors the HMMER curated-database cache pattern (hmmer-db-cache.ts). Nothing of
// the user's is sent; the backbone is a one-way static download, so there is no
// consent gate on this path. Voice in comments, no em-dashes, no en-dashes, no
// emojis, no mid-sentence colons.

/** Where the backbone + its manifest are served from (frontend/public). */
const BACKBONE_URL = "/taxonomy-backbone/backbone.json";
const MANIFEST_URL = "/taxonomy-backbone/manifest.json";

/** The durable Cache API bucket the downloaded backbone lives in. */
const CACHE_NAME = "researchos-taxonomy-backbone";

/** A single kept node in the backbone, typed with full-word fields. */
export interface BackboneNode {
  /** NCBI tax id. */
  taxId: number;
  /** Scientific name. */
  name: string;
  /** NCBI rank (family and above, e.g. family, order, class, phylum, domain). */
  rank: string;
  /** Nearest KEPT ancestor's tax id, or null when this is a backbone root. */
  parentId: number | null;
  /** Tax ids of this node's kept children (re-parented links). */
  childIds: number[];
  /** Count of descendant nodes with rank "species", over the full taxdump tree. */
  speciesCount: number;
}

/** The manifest sibling json (provenance + per-rank tallies) the UI can read
 *  without indexing the whole backbone. Matches manifest.json. */
export interface BackboneManifest {
  builtAt: string;
  taxdumpLastModified: string;
  nodeCount: number;
  rankCounts: Record<string, number>;
  schemaVersion: number;
}

/** The loaded + indexed backbone, ready for instant lookups. */
export interface LoadedBackbone {
  /** taxId -> node. */
  byId: Map<number, BackboneNode>;
  /** The backbone roots (nodes with no kept ancestor), in file order. */
  roots: BackboneNode[];
}

/** A failure surfaced to the UI from the backbone layer. */
export class TaxonomyBackboneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxonomyBackboneError";
  }
}

/** The compact on-wire node shape (short keys). Internal to this module. */
interface CompactNode {
  i: number;
  n: string;
  r: string;
  p: number | null;
  c: number[];
  s: number;
}

/** In-memory session cache so the explorer indexes the backbone only once. */
let memoryCache: LoadedBackbone | null = null;
let inFlight: Promise<LoadedBackbone> | null = null;

/** Guard the Cache API for SSR / test environments where it is absent. */
async function openBackboneCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // A storage-blocked context (private mode, disabled storage) is not fatal;
    // we just lose the durable cache and re-download next time.
    return null;
  }
}

function ensureFetch(): void {
  if (typeof fetch === "undefined") {
    throw new TaxonomyBackboneError(
      "This environment cannot download the taxonomy backbone (no fetch).",
    );
  }
}

/** Map the short-key compact node to the typed full-word shape. */
function toNode(c: CompactNode): BackboneNode {
  return {
    taxId: c.i,
    name: c.n,
    rank: c.r,
    parentId: c.p,
    childIds: c.c,
    speciesCount: c.s,
  };
}

/** Build the indexed LoadedBackbone from the raw compact array. */
function index(compact: CompactNode[]): LoadedBackbone {
  const byId = new Map<number, BackboneNode>();
  const roots: BackboneNode[] = [];
  for (const c of compact) {
    const node = toNode(c);
    byId.set(node.taxId, node);
    if (node.parentId === null) roots.push(node);
  }
  return { byId, roots };
}

/**
 * Load the curated backbone, indexed for instant lookups. First checks the
 * in-memory session cache, then the durable Cache API, then the network. On a
 * network miss the bytes are stored in the Cache API so later opens are offline.
 *
 * If the backbone is not cached AND the fetch fails (typically offline), throws
 * a clear typed error rather than a raw network exception.
 */
export async function loadBackbone(opts: { signal?: AbortSignal } = {}): Promise<LoadedBackbone> {
  const { signal } = opts;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (memoryCache) return memoryCache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const cache = await openBackboneCache();

    // Durable cache hit: index and return, no network.
    if (cache) {
      try {
        const cached = await cache.match(BACKBONE_URL);
        if (cached) {
          const compact = (await cached.json()) as CompactNode[];
          memoryCache = index(compact);
          return memoryCache;
        }
      } catch {
        // A flaky cache read just falls through to the network path.
      }
    }

    ensureFetch();

    let response: Response;
    try {
      response = await fetch(BACKBONE_URL, { signal });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      throw new TaxonomyBackboneError(
        "The taxonomy backbone needs to download once while online. Reconnect and try again.",
      );
    }
    if (!response.ok) {
      throw new TaxonomyBackboneError(
        `The taxonomy backbone could not be downloaded (status ${response.status}).`,
      );
    }

    const forCache = cache ? response.clone() : null;
    const compact = (await response.json()) as CompactNode[];
    if (cache && forCache) {
      try {
        await cache.put(BACKBONE_URL, forCache);
      } catch {
        // Quota / storage errors just mean the next run re-downloads.
      }
    }

    memoryCache = index(compact);
    return memoryCache;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Fetch (and cache) the small sibling manifest so the UI can show provenance and
 * per-rank tallies without indexing the backbone. Cache-first like the backbone.
 */
export async function loadBackboneManifest(
  opts: { signal?: AbortSignal } = {},
): Promise<BackboneManifest> {
  const { signal } = opts;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const cache = await openBackboneCache();
  if (cache) {
    try {
      const cached = await cache.match(MANIFEST_URL);
      if (cached) return (await cached.json()) as BackboneManifest;
    } catch {
      // Fall through to the network on a flaky cache read.
    }
  }

  ensureFetch();

  let response: Response;
  try {
    response = await fetch(MANIFEST_URL, { signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new TaxonomyBackboneError(
      "The taxonomy backbone needs to download once while online. Reconnect and try again.",
    );
  }
  if (!response.ok) {
    throw new TaxonomyBackboneError(
      `The taxonomy backbone manifest could not be downloaded (status ${response.status}).`,
    );
  }

  const forCache = cache ? response.clone() : null;
  const manifest = (await response.json()) as BackboneManifest;
  if (cache && forCache) {
    try {
      await cache.put(MANIFEST_URL, forCache);
    } catch {
      // Non-fatal.
    }
  }
  return manifest;
}

/** Resolve one node by tax id from a loaded backbone, or undefined when it is
 *  below family (and so not in the backbone). */
export function getBackboneNode(
  backbone: LoadedBackbone,
  taxId: number,
): BackboneNode | undefined {
  return backbone.byId.get(taxId);
}

/** The kept children of a node, resolved to nodes. Unknown ids are skipped. */
export function backboneChildren(
  backbone: LoadedBackbone,
  taxId: number,
): BackboneNode[] {
  const node = backbone.byId.get(taxId);
  if (!node) return [];
  const out: BackboneNode[] = [];
  for (const childId of node.childIds) {
    const child = backbone.byId.get(childId);
    if (child) out.push(child);
  }
  return out;
}

/** The siblings of a node (its parent's other kept children), excluding itself.
 *  A root node's siblings are the other roots. */
export function backboneSiblings(
  backbone: LoadedBackbone,
  taxId: number,
): BackboneNode[] {
  const node = backbone.byId.get(taxId);
  if (!node) return [];
  if (node.parentId === null) {
    return backbone.roots.filter((r) => r.taxId !== taxId);
  }
  return backboneChildren(backbone, node.parentId).filter(
    (sib) => sib.taxId !== taxId,
  );
}

/** The backbone roots (nodes with no kept ancestor, e.g. cellular organisms and
 *  Viruses). */
export function backboneRoots(backbone: LoadedBackbone): BackboneNode[] {
  return backbone.roots;
}

/** Reset the in-memory session cache. For tests; not used by the UI. */
export function __resetBackboneMemoryCache(): void {
  memoryCache = null;
  inFlight = null;
}
