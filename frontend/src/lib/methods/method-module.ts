/**
 * Method-type MODULE metadata layer (Extension Store Phase U2).
 *
 * SCOPE NOTE (read this before extending). U2 formalizes the METADATA +
 * CURATION half of the `MethodTypeModule` concept from
 * plans/METHOD_LIBRARY_DESIGN.md §3 and plans/EXTENSION_STORE_DESIGN.md §2.
 * It deliberately does NOT move the heavy viewer / editor / create-funnel
 * components into a runtime registry: the cosmetic registry
 * (`method-type-registry.ts`) stays component-free on purpose so per-type
 * bundles keep code-splitting through the existing dispatch switches
 * (`MethodTabs.tsx`, `methods/page.tsx`, `CreateMethodModal.tsx`). The full
 * lazy-component `MethodTypeModule` + dispatch refactor (METHOD doc §3.2 /
 * §3.4) is intentionally left for a later phase; it is a much larger blast
 * radius across the hottest method files.
 *
 * What this module DOES give the store layer:
 *   - a single accessor (`getMethodModule`) that returns a method type's
 *     stable metadata (its cosmetic meta plus the curation-relevant facts:
 *     whether it ships a structured sidecar, whether it can be instantiated
 *     from the data-only template catalog, its source_path scheme) so the
 *     store shell can describe a type uniformly without reaching into four
 *     scattered conventions, and
 *   - a typed `MethodModuleMeta` shape the curation + store-adapter layers
 *     iterate over.
 *
 * Extensions remain code shipped in the reviewed build (local-first, no
 * server, no runtime code download). This layer is pure DATA derived from
 * already-bundled metadata; it executes nothing new.
 */

import {
  METHOD_TYPE_REGISTRY,
  getMethodTypeMeta,
  type MethodTypeId,
  type MethodTypeMeta,
} from "./method-type-registry";
import { isCatalogMethodType } from "./method-catalog";

/**
 * The `source_path` URI scheme prefix a structured method type writes to
 * link its `Method` row to its sidecar protocol record (e.g. PCR rows carry
 * `source_path: "pcr://protocol/<id>"`). Mirrors the conventions documented
 * in local-api.ts and consumed by the structured-record resolver in
 * methods/page.tsx. `null` for the code-only types (markdown / pdf) and for
 * `compound` (which composes other methods via compound-graph.ts rather than
 * owning a leaf sidecar). Kept here as DATA so the store + future template
 * authoring can read the scheme without re-deriving it from create logic.
 */
const SOURCE_PATH_SCHEME: Partial<Record<MethodTypeId, string>> = {
  pcr: "pcr://protocol/",
  lc_gradient: "lc_gradient://protocol/",
  plate: "plate://protocol/",
  cell_culture: "cell_culture://protocol/",
  mass_spec: "mass_spec://protocol/",
  coding_workflow: "coding_workflow://protocol/",
  qpcr_analysis: "qpcr_analysis://protocol/",
};

/**
 * The formalized, store-facing metadata for one method type. A PROJECTION of
 * the cosmetic registry plus the curation facts the store layer needs. This
 * is metadata only: no React components, no API surface, nothing executable
 * beyond what the build already ships.
 */
export interface MethodModuleMeta {
  /** The discriminator value as written to disk. */
  id: MethodTypeId;
  /** The cosmetic registry entry (label, color, icon, description, category,
   *  hiddenFromPicker). The store renders tiles from this. */
  cosmetic: MethodTypeMeta;
  /** True when the type owns a structured protocol record alongside the
   *  Method row (mirrors `cosmetic.hasStructuredProtocol`, surfaced at the
   *  top level so the store adapter does not have to reach into `cosmetic`). */
  hasStructuredProtocol: boolean;
  /** The `source_path://protocol/` scheme this type writes, or null for the
   *  code-only / composite types. */
  sourcePathScheme: string | null;
  /** True when the data-only U1 template catalog can instantiate this type
   *  (i.e. its create shape is pure data). Drives the store's "has a
   *  template" affordance per EXTENSION doc §1.6 / §4.4. */
  hasTemplates: boolean;
  /** True when the type is excluded from the new-method picker (today only
   *  `compound`). The store shows it for completeness but never as a
   *  user-selectable "+ New Method" choice. */
  hiddenFromPicker: boolean;
}

function buildModuleMeta(cosmetic: MethodTypeMeta): MethodModuleMeta {
  return {
    id: cosmetic.id,
    cosmetic,
    hasStructuredProtocol: cosmetic.hasStructuredProtocol,
    sourcePathScheme: SOURCE_PATH_SCHEME[cosmetic.id] ?? null,
    hasTemplates: isCatalogMethodType(cosmetic.id),
    hiddenFromPicker: cosmetic.hiddenFromPicker ?? false,
  };
}

/**
 * The method-type module registry: every shipped type's store-facing
 * metadata, keyed by id. A projection of `METHOD_TYPE_REGISTRY`, so it stays
 * in lockstep automatically as new cosmetic entries land.
 */
export const METHOD_MODULES: Record<MethodTypeId, MethodModuleMeta> =
  Object.fromEntries(
    (Object.values(METHOD_TYPE_REGISTRY) as MethodTypeMeta[]).map((cosmetic) => [
      cosmetic.id,
      buildModuleMeta(cosmetic),
    ]),
  ) as Record<MethodTypeId, MethodModuleMeta>;

/**
 * Look up a method type's module metadata. Null / unknown falls back to
 * markdown, mirroring `getMethodTypeMeta` so legacy records resolve to a
 * usable shape.
 */
export function getMethodModule(
  id: MethodTypeId | null | undefined,
): MethodModuleMeta {
  if (!id) return METHOD_MODULES.markdown;
  return METHOD_MODULES[id] ?? METHOD_MODULES.markdown;
}

/**
 * All module metas in registry order. The store's "Method types" tab
 * iterates this. Pass `includeHidden: false` (the default) to drop
 * `hiddenFromPicker` types (e.g. `compound`) from a user-facing list.
 */
export function listMethodModules(
  options: { includeHidden?: boolean } = {},
): MethodModuleMeta[] {
  const all = Object.values(METHOD_MODULES);
  if (options.includeHidden) return all;
  return all.filter((m) => !m.hiddenFromPicker);
}

// Re-export the cosmetic-meta accessor so callers can reach a type's display
// metadata through the module layer without a second import.
export { getMethodTypeMeta };
