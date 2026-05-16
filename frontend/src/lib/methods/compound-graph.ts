/**
 * Compound-method graph utilities — cycle detection, depth limit, and
 * per-component orphan detection for the v2 composition primitive.
 *
 * Used by:
 *  - `CompoundMethodTabContent` (renderer): runs once per render before
 *    fanning out; cycle or depth violation renders an inline error band
 *    instead of recursing.
 *  - `CompoundMethodBuilder` (builder save path): hard-blocks save when
 *    the in-progress component list would introduce a cycle or push past
 *    the depth cap.
 *
 * Lives separate from the renderer/builder so both paths share one
 * algorithm + one constant. No React imports here; pure data.
 */

import type { CompoundComponent, Method } from "@/lib/types";

/**
 * Maximum number of nested compounds along any single chain. 4 covers
 * realistic lab kit-of-kits patterns (experiment kit → daily-prep sub-kit
 * → assay sub-kit → plate template hits depth 4) while keeping the
 * sticky chip-strip TOC navigable. Five-deep starts to feel disorienting;
 * see proposal §2.6.2 for the picked-over-3/5/6 rationale.
 *
 * "Depth" here counts compounds in the chain, NOT leaves. A chain of 4
 * compounds whose tail compound contains a non-compound leaf renders
 * cleanly; a chain of 5 nested compounds is rejected.
 */
export const MAX_COMPOUND_DEPTH = 4;

export interface CompoundValidationOk {
  ok: true;
}

export interface CompoundValidationError {
  ok: false;
  reason: "cycle" | "depth_exceeded" | "orphan_reference";
  details: CompoundValidationDetails;
}

export type CompoundValidationResult = CompoundValidationOk | CompoundValidationError;

/**
 * Structured payload accompanying a validation failure. The renderer + the
 * builder both consume these — the renderer to produce inline error band
 * copy, the builder to produce a toast / inline message on the offending
 * row.
 */
export interface CompoundValidationDetails {
  /** For "cycle": the ordered chain of compound ids that form the cycle. */
  cyclePath?: Array<{ method_id: number; owner: string }>;
  /** For "depth_exceeded": the path that reached the depth cap. */
  depthPath?: Array<{ method_id: number; owner: string }>;
  /** For "orphan_reference": the broken (method_id, owner) reference. */
  orphan?: { method_id: number; owner: string };
}

/** Compose the lookup key used to disambiguate per-user id collisions
 *  (alex's method 7 and morgan's method 7 are different rows). Matches the
 *  shape used by the renderer's `resolveChild` helper. */
function methodKey(method_id: number, owner: string): string {
  return `${owner}:${method_id}`;
}

/**
 * Build a Map of methods keyed by `owner:id` for fast lookup during the
 * recursive walk. The renderer/builder call this once per validation pass.
 */
function buildMethodMap(allMethods: Method[]): Map<string, Method> {
  const map = new Map<string, Method>();
  for (const m of allMethods) {
    map.set(methodKey(m.id, m.owner), m);
  }
  return map;
}

/**
 * Validate a compound's component graph. Catches:
 *  - cycles (compound A references B which references A)
 *  - depth violations (chain of compounds exceeds MAX_COMPOUND_DEPTH)
 *  - orphan references (top-level component points at a method_id that no
 *    longer exists in the methods map)
 *
 * `currentMethodId` is the (id, owner) of the compound being validated;
 * required so the cycle check can treat the in-progress component list
 * as if it were stored on disk for the root. When validating a compound
 * that's already persisted (renderer use), the in-memory `Method.components`
 * already match disk, so passing `null` (read-time validation against
 * disk state) is fine — the renderer threads its own (id, owner) anyway.
 *
 * Returns the first problem found. The builder UI reports issues one at
 * a time anyway (it surfaces a toast / inline message); finding more than
 * the first is unnecessary work.
 */
export function validateCompoundComponents(
  components: CompoundComponent[],
  allMethods: Method[],
  currentMethodId: { id: number; owner: string } | null,
): CompoundValidationResult {
  const methodMap = buildMethodMap(allMethods);

  // First pass: orphan detection at the top level. Walking into a
  // compound whose components carry orphans gives the renderer a place
  // to surface "Component deleted" placeholders; the validator just
  // signals that an orphan exists. The renderer's per-component check
  // catches the orphan inline; this top-level pass is the builder's
  // save-time guard.
  for (const c of components) {
    const childOwner = c.owner ?? currentMethodId?.owner ?? "";
    const key = methodKey(c.method_id, childOwner);
    if (!methodMap.has(key)) {
      return {
        ok: false,
        reason: "orphan_reference",
        details: { orphan: { method_id: c.method_id, owner: childOwner } },
      };
    }
  }

  // DFS for cycles + depth. The root compound (currentMethodId) is treated
  // as if it had the in-progress `components` regardless of what disk
  // says — important for save-time validation before the new array has
  // landed in the methods list.
  const rootOwner = currentMethodId?.owner ?? "";
  const rootKey = currentMethodId ? methodKey(currentMethodId.id, rootOwner) : null;

  /**
   * `path` accumulates compound keys visited along the current branch.
   * `depth` counts compounds (not leaves) visited BEFORE the current node.
   * Reaching a non-compound child terminates the branch — leaves don't
   * count toward the depth cap.
   */
  const dfs = (
    childId: number,
    childOwnerArg: string,
    path: string[],
    depth: number,
    rootOverrideComponents: CompoundComponent[] | null,
  ): CompoundValidationResult => {
    const key = methodKey(childId, childOwnerArg);
    // Cycle check: re-entering a compound already on this branch's path.
    if (path.includes(key)) {
      const cyclePath = [...path, key].map((k) => {
        const [owner, idStr] = k.split(":");
        return { method_id: parseInt(idStr, 10), owner };
      });
      return {
        ok: false,
        reason: "cycle",
        details: { cyclePath },
      };
    }
    // Resolve the method. For the root, use the in-progress components
    // instead of the on-disk record (the in-progress array is what we're
    // validating). For every other node, use the methods map.
    const isRoot = rootOverrideComponents !== null && key === rootKey;
    let method: Method | undefined;
    let nodeComponents: CompoundComponent[] | undefined;
    if (isRoot) {
      method = methodMap.get(key);
      nodeComponents = rootOverrideComponents ?? undefined;
    } else {
      method = methodMap.get(key);
      nodeComponents = method?.components;
    }
    // Non-compound or missing leaf: branch terminates without descent.
    // (Orphans were caught at the top-level pass; deeper orphans
    // surface in the renderer as inline placeholders.)
    if (!method || method.method_type !== "compound") {
      return { ok: true };
    }
    // Compound node: check depth before descending. `depth` is the count
    // BEFORE the current node — so a node at depth=MAX is the last
    // compound allowed. depth >= MAX means descending would push past
    // the cap.
    if (depth >= MAX_COMPOUND_DEPTH) {
      const depthPath = [...path, key].map((k) => {
        const [owner, idStr] = k.split(":");
        return { method_id: parseInt(idStr, 10), owner };
      });
      return {
        ok: false,
        reason: "depth_exceeded",
        details: { depthPath },
      };
    }
    for (const c of nodeComponents ?? []) {
      const grandChildOwner = c.owner ?? childOwnerArg;
      const result = dfs(
        c.method_id,
        grandChildOwner,
        [...path, key],
        depth + 1,
        // Once we've descended below the root, never override again — disk
        // is the source of truth for non-root compounds.
        null,
      );
      if (!result.ok) return result;
    }
    return { ok: true };
  };

  if (currentMethodId) {
    return dfs(currentMethodId.id, rootOwner, [], 0, components);
  }

  // No root context — validate components individually against disk state.
  // Used by the renderer when it wants to surface graph problems without
  // a "root" notion (the renderer always passes a root, so this path is
  // primarily for ad-hoc consistency sweeps).
  for (const c of components) {
    const childOwner = c.owner ?? "";
    const result = dfs(c.method_id, childOwner, [], 1, null);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/**
 * Compute the maximum nesting depth reachable from a compound, given the
 * current methods list. The builder's soft warning ("This compound is N
 * levels deep; consider flattening") consumes this; the renderer uses it
 * for the depth-marker chip on the TOC. Bounded by MAX_COMPOUND_DEPTH +
 * 1 — anything deeper has already been rejected by validate.
 */
export function computeCompoundDepth(
  components: CompoundComponent[],
  allMethods: Method[],
  rootOwner: string,
): number {
  const methodMap = buildMethodMap(allMethods);
  const seen = new Set<string>();
  // Returns the number of compounds reachable from `c` along the deepest
  // chain (counting `c` itself if it's a compound). A leaf returns 0.
  // A compound with no compound descendants returns 1. A chain of N nested
  // compounds rooted at `c` returns N.
  function walk(c: CompoundComponent, ownerCtx: string): number {
    if (seen.size > MAX_COMPOUND_DEPTH + 2) return MAX_COMPOUND_DEPTH + 1;
    const childOwner = c.owner ?? ownerCtx;
    const key = methodKey(c.method_id, childOwner);
    if (seen.has(key)) return 0; // cycle short-circuit; reported by validate, not depth
    const m = methodMap.get(key);
    const isCompound = m?.method_type === "compound";
    if (!isCompound) return 0; // leaf or missing — doesn't extend the chain
    seen.add(key);
    let maxGrand = 0;
    for (const grand of m.components ?? []) {
      const d = walk(grand, childOwner);
      if (d > maxGrand) maxGrand = d;
    }
    seen.delete(key);
    return 1 + maxGrand;
  }
  let maxChild = 0;
  for (const c of components) {
    const d = walk(c, rootOwner);
    if (d > maxChild) maxChild = d;
  }
  return 1 + maxChild; // root compound is always depth 1; nested children extend it
}
