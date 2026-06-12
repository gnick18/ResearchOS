/**
 * datahub/transform/recipe.ts
 *
 * The bridge between a derived table's stored link (DerivedFrom) and the pipeline
 * engine. A derived table now stores a PIPELINE recipe (phase 2), but a document
 * written before phase 2 carries the LEGACY single-op fields (sourceTableId /
 * transform / params). resolveRecipe normalizes EITHER shape to one
 * { sources, recipe } pair the engine can run.
 *
 * The legacy mapping is the crux of byte-compat. A legacy single transform maps
 * to a ONE-op recipe whose single TransformOp is the matching folded column
 * transform (added in chunk 1). Because the folded op delegates to the SAME pure
 * function in transforms.ts that the legacy runTransform path called, the
 * recomputed table is byte-identical to what the legacy path produced.
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import type { DerivedFrom, TransformKind } from "@/lib/datahub/model/types";
import type {
  TransformParams,
  NormalizeParams,
  TransposeParams,
  RemoveBaselineParams,
  FractionOfTotalParams,
} from "@/lib/datahub/transforms";
import type { TransformOp } from "./pipeline";

/** A normalized recipe link, the single shape the engine and recompute run on. */
export interface ResolvedRecipe {
  /** Ordered source table ids. sources[0] is the primary the recipe runs over. */
  sources: string[];
  /** Ordered pipeline ops. */
  recipe: TransformOp[];
}

/**
 * Map ONE legacy TransformKind plus its stored params to the matching folded
 * TransformOp. The folded op kinds (chunk 1) use hyphenated names distinct from
 * the legacy camelCase TransformKind, so this is the one place the two name
 * spaces meet. The stored params are an open record; each folded op owns the
 * matching transforms.ts param shape, so we cast through the function's param
 * type exactly as the legacy runTransform dispatch did.
 */
export function legacyOpToTransformOp(
  transform: TransformKind,
  params: Record<string, unknown>,
): TransformOp {
  switch (transform) {
    case "transform":
      return { kind: "column-transform", params: params as unknown as TransformParams };
    case "normalize":
      return { kind: "normalize", params: params as unknown as NormalizeParams };
    case "transpose":
      return { kind: "transpose", params: params as unknown as TransposeParams };
    case "removeBaseline":
      return { kind: "remove-baseline", params: params as unknown as RemoveBaselineParams };
    case "fractionOfTotal":
      return { kind: "fraction-of-total", params: params as unknown as FractionOfTotalParams };
    default: {
      // Exhaustiveness guard. A new TransformKind without a case here is a type
      // error. At runtime an unknown kind falls back to a no-op column transform
      // (linear y*1+0), matching how runTransform treated an unknown kind as a
      // structural no-op rather than a crash.
      const _exhaustive: never = transform;
      void _exhaustive;
      return { kind: "column-transform", params: { func: "linear", k: 1, b: 0 } };
    }
  }
}

/**
 * Normalize a DerivedFrom (legacy single-op OR a phase-2 recipe) to one
 * { sources, recipe } pair.
 *
 * Preference order:
 *   1. A present, well-formed recipe link (sources + recipe arrays) is used
 *      as-is. This is the phase-2 shape, including a multi-source join / union.
 *   2. Otherwise the legacy single-op fields build a one-op recipe with
 *      sources = [sourceTableId]. This is the back-compat read.
 *
 * Returns null only when neither shape is usable (no recipe and no legacy source
 * id), so the caller can treat it as a not-actually-derived / corrupt link.
 */
export function resolveRecipe(link: DerivedFrom): ResolvedRecipe | null {
  // Phase-2 recipe shape takes precedence when both keys are present arrays.
  if (Array.isArray(link.sources) && Array.isArray(link.recipe) && link.sources.length > 0) {
    return { sources: link.sources, recipe: link.recipe };
  }

  // Legacy single-op shape.
  if (typeof link.sourceTableId === "string" && link.sourceTableId !== "" && link.transform) {
    return {
      sources: [link.sourceTableId],
      recipe: [legacyOpToTransformOp(link.transform, link.params ?? {})],
    };
  }

  return null;
}

/**
 * True when a DerivedFrom is the phase-2 recipe shape (so the serializer writes
 * the new keys) rather than the legacy single-op shape (so the serializer keeps
 * writing the legacy keys and the doc stays byte-stable on disk).
 */
export function isRecipeLink(link: DerivedFrom): boolean {
  return Array.isArray(link.sources) && Array.isArray(link.recipe);
}
