/**
 * Compound (combination / kit) TEMPLATE detail helpers (Extension Store
 * Phase D, store-detail bot, 2026-05-30).
 *
 * A combination template is encoded as a method with `method_type: "compound"`
 * and a `components` graph bundling sub-methods of other types (the locked IA
 * in EXTENSION_STORE_REDESIGN_PROPOSAL.md: "LC + MS = an LC-MS kit"). The
 * detail pane reads the component types OFF the components graph rather than
 * from any parallel `method_types[]` array, and gates "Use template" until ALL
 * of those component types are enabled.
 *
 * This module is the pure, framework-free half: given a compound `Method` and
 * the methods it can resolve its components against, it returns the ordered
 * component list (each with its resolved leaf `method_type` + display label)
 * and the DISTINCT set of types the kit depends on. The renderer
 * (`CompoundTemplateDetail` in MethodLibraryDetail.tsx) consumes both.
 *
 * NOTE on scope: shipping a compound entry in the static catalog would require
 * extending the catalog payload union in method-catalog.ts to accept a compound
 * entry (a DATA-SHAPE touch flagged in the brief), NOT done here. These helpers
 * + the renderer cover the rendering path against a compound METHOD fixture so
 * the surface is ready when a compound catalog entry lands (aligned with the
 * unmerged lc-ms-method-templates branch shape).
 */

import type { CompoundComponent, Method } from "@/lib/types";
import type { MethodTypeId } from "@/lib/methods/method-type-registry";
import type {
  CompoundTemplateComponent,
  MethodCatalogManifestEntry,
} from "@/lib/methods/method-catalog";

/** One resolved component of a compound, ready to render as a bundled step. */
export interface ResolvedCompoundComponent {
  /** The child method id in its owner's namespace. */
  method_id: number;
  /** Resolved owner used for the lookup (component owner, or the compound's). */
  owner: string;
  /** Insertion order within the compound (the renderer sorts by this). */
  ordering: number;
  /** Display label: the component's `label` override, else the child's name. */
  label: string;
  /** The child method's type, read off the resolved leaf. `null` when the
   *  reference is an orphan (the child method no longer exists). */
  method_type: MethodTypeId | null;
}

/** Compose the `owner:id` lookup key used to disambiguate per-user id
 *  collisions, matching compound-graph.ts. */
function methodKey(method_id: number, owner: string): string {
  return `${owner}:${method_id}`;
}

/**
 * Resolve a compound's `components` graph against a methods list into an
 * ordered, render-ready component list. Each entry carries the leaf child's
 * `method_type` (read off the components graph, NOT a parallel array). Orphan
 * references (a child that no longer exists) resolve with `method_type: null`
 * so the renderer can surface them rather than crashing.
 *
 * Sorted by `ordering` (stable insertion order), mirroring the compound
 * renderer's fan-out order.
 */
export function resolveCompoundComponents(
  compound: Pick<Method, "owner" | "components">,
  allMethods: Method[],
): ResolvedCompoundComponent[] {
  const map = new Map<string, Method>();
  for (const m of allMethods) map.set(methodKey(m.id, m.owner), m);

  const components: CompoundComponent[] = compound.components ?? [];
  return [...components]
    .sort((a, b) => a.ordering - b.ordering)
    .map((c) => {
      const owner = c.owner ?? compound.owner ?? "";
      const child = map.get(methodKey(c.method_id, owner));
      return {
        method_id: c.method_id,
        owner,
        ordering: c.ordering,
        label: c.label ?? child?.name ?? `Method ${c.method_id}`,
        method_type: (child?.method_type as MethodTypeId | undefined) ?? null,
      };
    });
}

/**
 * The DISTINCT component types a compound depends on, in first-seen (ordering)
 * order. Orphan components (null type) are dropped. This is the set the detail
 * pane shows as type badges and gates "Use template" on (ALL must be enabled).
 */
export function distinctComponentTypes(
  resolved: ResolvedCompoundComponent[],
): MethodTypeId[] {
  const seen = new Set<MethodTypeId>();
  const order: MethodTypeId[] = [];
  for (const c of resolved) {
    if (c.method_type === null) continue;
    if (!seen.has(c.method_type)) {
      seen.add(c.method_type);
      order.push(c.method_type);
    }
  }
  return order;
}

/**
 * Which of a compound's component types are NOT yet enabled. Empty array means
 * the kit is fully unlocked and "Use template" is allowed. The renderer uses
 * the length to gate the action and the list to name what still needs enabling.
 */
export function missingComponentTypes(
  componentTypes: MethodTypeId[],
  enabledIds: Set<MethodTypeId>,
): MethodTypeId[] {
  return componentTypes.filter((t) => !enabledIds.has(t));
}

/**
 * Resolve a CATALOG compound template's `components` (each a `{slug, ordering,
 * label?}` reference to another catalog template) into the same render-ready
 * shape `resolveCompoundComponents` produces for a live compound Method, so the
 * `CompoundTemplateDetail` renderer is fed identically whether it is showing a
 * browsed catalog kit or an instantiated one.
 *
 * At browse time no method ids exist (the children have not been instantiated),
 * so each component carries only its catalog slug. We look the child up in the
 * manifest by slug to read its `method_type` (the gating set) and a display
 * title. The `method_id` is SYNTHETIC: we use `ordering` purely so the
 * renderer's `key` and step numbering stay stable; it is never persisted and
 * never points at a real method. `owner` is empty for the same reason.
 *
 * Sorted by `ordering` (sample-flow order, e.g. LC -> MS) to match both the
 * live resolver and the loader's instantiation order. An unknown slug (no
 * manifest entry) resolves with `method_type: null` so the renderer surfaces it
 * as a missing component rather than crashing, mirroring the orphan handling in
 * `resolveCompoundComponents`.
 */
export function resolveCatalogCompoundComponents(
  components: CompoundTemplateComponent[],
  manifestBySlug: Map<string, MethodCatalogManifestEntry>,
): ResolvedCompoundComponent[] {
  return [...components]
    .sort((a, b) => a.ordering - b.ordering)
    .map((c) => {
      const entry = manifestBySlug.get(c.slug);
      return {
        method_id: c.ordering,
        owner: "",
        ordering: c.ordering,
        label: c.label ?? entry?.title ?? c.slug,
        method_type: (entry?.method_type as MethodTypeId | undefined) ?? null,
      };
    });
}
