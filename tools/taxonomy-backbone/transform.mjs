// sequence editor master: taxonomy backbone pure transform (stage 1).
//
// This module holds the network-free core of the backbone build so the test
// can exercise it on a tiny synthetic taxdump without downloading the real
// 152 MB dump. The build runner (build-backbone.mjs) feeds it the parsed
// nodes.dmp / names.dmp text and writes the emitted JSON.
//
// The shape we emit uses SHORT keys to save bytes over the wire. The frontend
// loader maps them back to full-word fields. See README for the schema.
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence colons.

/**
 * The rank allowlist, family and above. A node is KEPT only when its rank is in
 * this set. Anything below family (subfamily, tribe, genus, species, and lower)
 * is dropped from the backbone and falls back to the live API in the UI.
 */
export const KEEP_RANKS = new Set([
  "superkingdom",
  "realm",
  "acellular root",
  "cellular root",
  "domain",
  "kingdom",
  "subkingdom",
  "superphylum",
  "phylum",
  "subphylum",
  "superclass",
  "class",
  "subclass",
  "infraclass",
  "cohort",
  "subcohort",
  "superorder",
  "order",
  "suborder",
  "infraorder",
  "parvorder",
  "superfamily",
  "family",
]);

/** The schema version stamped into the manifest and the loader's expectation. */
export const SCHEMA_VERSION = 1;

/** The NCBI dmp field separator is the literal three-char string tab pipe tab. */
const FIELD_SEP = "\t|\t";

/**
 * Parse a nodes.dmp body into a Map of taxId -> { parentId, rank }.
 * Each row is fields joined by the tab-pipe-tab separator and terminated by a
 * trailing tab-pipe. We only read the first three fields (tax_id, parent, rank)
 * and ignore the rest.
 *
 * @param {string} text - the full nodes.dmp file contents
 * @returns {Map<number, { parentId: number, rank: string }>}
 */
export function parseNodes(text) {
  const nodes = new Map();
  const lines = text.split("\n");
  for (const raw of lines) {
    if (!raw) continue;
    // Drop the trailing "\t|" terminator, then split on the field separator.
    const line = raw.endsWith("\t|") ? raw.slice(0, -2) : raw;
    const fields = line.split(FIELD_SEP);
    if (fields.length < 3) continue;
    const taxId = Number(fields[0].trim());
    const parentId = Number(fields[1].trim());
    const rank = fields[2].trim();
    if (!Number.isFinite(taxId)) continue;
    nodes.set(taxId, { parentId, rank });
  }
  return nodes;
}

/**
 * Parse a names.dmp body into a Map of taxId -> scientific name. Only rows whose
 * name_class is exactly "scientific name" are kept; the rest (synonyms, common
 * names, authorities) are ignored.
 *
 * @param {string} text - the full names.dmp file contents
 * @returns {Map<number, string>}
 */
export function parseNames(text) {
  const names = new Map();
  const lines = text.split("\n");
  for (const raw of lines) {
    if (!raw) continue;
    const line = raw.endsWith("\t|") ? raw.slice(0, -2) : raw;
    const fields = line.split(FIELD_SEP);
    if (fields.length < 4) continue;
    const nameClass = fields[3].trim();
    if (nameClass !== "scientific name") continue;
    const taxId = Number(fields[0].trim());
    const nameTxt = fields[1].trim();
    if (!Number.isFinite(taxId)) continue;
    names.set(taxId, nameTxt);
  }
  return names;
}

/**
 * Compute, for every taxId in the full tree, the number of descendant nodes
 * whose rank is exactly "species" (the node itself counts when it is a species,
 * which a family is not, so this is purely the descendant tally for kept nodes).
 *
 * Done iteratively with a memoized child-adjacency post-order so the ~2.5M-node
 * tree never hits a recursion limit. Returns a Map of taxId -> species count.
 *
 * @param {Map<number, { parentId: number, rank: string }>} nodes
 * @returns {Map<number, number>}
 */
export function computeSpeciesCounts(nodes) {
  // Build a child-adjacency list. The taxdump root is tax_id 1 whose parent is
  // itself; we skip that self-edge so it does not create a cycle.
  const children = new Map();
  for (const [taxId, { parentId }] of nodes) {
    if (parentId === taxId) continue;
    let bucket = children.get(parentId);
    if (!bucket) {
      bucket = [];
      children.set(parentId, bucket);
    }
    bucket.push(taxId);
  }

  // own[taxId] = 1 when the node itself is a species, else 0.
  const counts = new Map();

  // Iterative post-order over each root (a node whose parent is itself or is
  // absent from the map). Two-color stack so a node is finalized only after all
  // its children are finalized.
  for (const [taxId, { parentId }] of nodes) {
    const isRoot = parentId === taxId || !nodes.has(parentId);
    if (!isRoot) continue;

    const stack = [{ id: taxId, visited: false }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (!frame.visited) {
        frame.visited = true;
        const kids = children.get(frame.id);
        if (kids) {
          for (const kid of kids) stack.push({ id: kid, visited: false });
        }
      } else {
        stack.pop();
        const self = nodes.get(frame.id);
        let total = self && self.rank === "species" ? 1 : 0;
        const kids = children.get(frame.id);
        if (kids) {
          for (const kid of kids) total += counts.get(kid) ?? 0;
        }
        counts.set(frame.id, total);
      }
    }
  }
  return counts;
}

/**
 * Walk up the ORIGINAL parent chain from a node until a kept ancestor is found.
 * Returns that kept ancestor's taxId, or null when the node has no kept ancestor
 * (it becomes a backbone root). Guards against the self-parent root and cycles.
 *
 * @param {number} taxId
 * @param {Map<number, { parentId: number, rank: string }>} nodes
 * @param {Set<number>} keptIds
 * @returns {number | null}
 */
function nearestKeptAncestor(taxId, nodes, keptIds) {
  const seen = new Set([taxId]);
  let cur = nodes.get(taxId);
  while (cur) {
    const parentId = cur.parentId;
    if (parentId === undefined || parentId === null) return null;
    // Self-parent (the taxdump root) means no further ancestors.
    if (seen.has(parentId)) return null;
    if (keptIds.has(parentId)) return parentId;
    seen.add(parentId);
    cur = nodes.get(parentId);
  }
  return null;
}

/**
 * The core build transform. Given the parsed nodes + names maps, it filters to
 * the keep-rank allowlist, re-parents each kept node to its nearest kept
 * ancestor, derives childIds from those re-parented links, attaches the
 * species-under count, and returns the compact backbone plus rank tallies.
 *
 * Output nodes use the short-key shape:
 *   { i: taxId, n: name, r: rank, p: parentId|null, c: [childIds], s: speciesCount }
 *
 * @param {Map<number, { parentId: number, rank: string }>} nodes
 * @param {Map<number, string>} names
 * @returns {{ nodes: Array, rankCounts: Record<string, number> }}
 */
export function buildBackbone(nodes, names) {
  // 1. The kept set.
  const keptIds = new Set();
  for (const [taxId, { rank }] of nodes) {
    if (KEEP_RANKS.has(rank)) keptIds.add(taxId);
  }

  // 2. Species counts over the FULL tree (computed once, read per kept node).
  const speciesCounts = computeSpeciesCounts(nodes);

  // 3. Re-parent each kept node to its nearest kept ancestor.
  const parentOf = new Map();
  for (const taxId of keptIds) {
    parentOf.set(taxId, nearestKeptAncestor(taxId, nodes, keptIds));
  }

  // 4. Derive childIds from the re-parented links.
  const childrenOf = new Map();
  for (const taxId of keptIds) {
    const p = parentOf.get(taxId);
    if (p === null) continue;
    let bucket = childrenOf.get(p);
    if (!bucket) {
      bucket = [];
      childrenOf.set(p, bucket);
    }
    bucket.push(taxId);
  }

  // 5. Emit the compact node list, sorted by taxId for a stable, diffable file.
  const sortedIds = [...keptIds].sort((a, b) => a - b);
  const outNodes = [];
  const rankCounts = {};
  for (const taxId of sortedIds) {
    const meta = nodes.get(taxId);
    const rank = meta.rank;
    rankCounts[rank] = (rankCounts[rank] ?? 0) + 1;
    const kids = (childrenOf.get(taxId) ?? []).slice().sort((a, b) => a - b);
    outNodes.push({
      i: taxId,
      n: names.get(taxId) ?? String(taxId),
      r: rank,
      p: parentOf.get(taxId),
      c: kids,
      s: speciesCounts.get(taxId) ?? 0,
    });
  }

  return { nodes: outNodes, rankCounts };
}
