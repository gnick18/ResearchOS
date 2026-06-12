/**
 * datahub/derived.ts
 *
 * The recompute path for DERIVED tables (the live link). A document whose meta
 * carries derivedFrom is a derived table: its columns/rows are COMPUTED from the
 * source table's CURRENT content, not authored. This module turns a derived
 * document's stored content (which holds the derivedFrom link plus a last-computed
 * snapshot) into FRESH content by re-running the transform against the source.
 *
 * Live-link policy (the data-shape decision): the recompute runs IN MEMORY ON
 * OPEN. We always re-fetch the source by id and re-run the transform rather than
 * trusting the persisted snapshot, so a derived table can never go stale relative
 * to its source. The persisted snapshot (the columns/rows already on disk) is only
 * a fallback projection for the catalog list / getContent and for the case where
 * the source is gone. There is no cache-timestamp reconciliation to get wrong.
 *
 * Missing source (deleted / renamed away): we do NOT crash. recomputeDerived
 * returns the derived document with EMPTY columns/rows plus a `sourceMissing`
 * flag, so the grid can render a clear "source table is no longer available"
 * empty state instead of stale or partial data.
 *
 * This module is deliberately resolver-injected (it takes a getSourceContent
 * function) so it stays pure and unit-testable without touching the file system;
 * the page / loader passes dataHubApi.getContent.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { executePipeline } from "./transform/engine";
import { resolveRecipe } from "./transform/recipe";

/** Resolve a source table's current content by id, or null when it is gone. */
export type SourceContentResolver = (
  sourceTableId: string,
) => Promise<DataHubDocContent | null>;

export interface RecomputeResult {
  /** The derived content to render (fresh computed columns/rows when live). */
  content: DataHubDocContent;
  /** True when derivedFrom pointed at a source that could not be resolved. */
  sourceMissing: boolean;
  /** True when this document is actually derived (had a derivedFrom link). */
  isDerived: boolean;
}

/**
 * Recompute a derived document's content from its source(s).
 *
 * When the document is NOT derived (no derivedFrom), it is returned unchanged
 * with isDerived false, so a normal entered table flows through untouched and
 * byte-identical (the recompute path is a no-op for it). When it IS derived, the
 * stored link is normalized to a { sources, recipe } pair (resolveRecipe reads
 * BOTH the legacy single-op shape and the phase-2 recipe shape), EVERY source is
 * resolved by id into a sources map, and the recipe runs through the pipeline
 * engine. The primary source is sources[0]; join / union ops reference the rest.
 *
 * A legacy single-op link maps to a one-op recipe whose folded TransformOp
 * delegates to the same transforms.ts function the legacy path used, so an
 * existing derived table recomputes BYTE-IDENTICALLY to before phase 2.
 *
 * Missing ANY source (deleted / renamed away) yields the existing clean empty
 * state plus sourceMissing true rather than stale or partial data. The derived
 * document's own meta (id, name, derivedFrom, project links) is always preserved;
 * only its columns/rows (and the recomputed archetype, which transpose can flip)
 * come from the recompute.
 */
export async function recomputeDerived(
  derivedContent: DataHubDocContent,
  getSourceContent: SourceContentResolver,
): Promise<RecomputeResult> {
  const link = derivedContent.meta.derivedFrom;
  if (!link) {
    return { content: derivedContent, sourceMissing: false, isDerived: false };
  }

  const resolved = resolveRecipe(link);
  if (!resolved) {
    // A corrupt / partial link (no recipe and no legacy source id). Treat it as a
    // not-actually-derived table rather than crashing the open.
    return { content: derivedContent, sourceMissing: false, isDerived: false };
  }

  // Resolve every source id into the sources map. A missing source short-circuits
  // to the clean empty state, exactly as the single-source path did before.
  const sources = new Map<string, DataHubDocContent>();
  for (const id of resolved.sources) {
    if (sources.has(id)) continue;
    const content = await getSourceContent(id);
    if (!content) {
      return {
        content: { ...derivedContent, columns: [], rows: [] },
        sourceMissing: true,
        isDerived: true,
      };
    }
    sources.set(id, content);
  }

  const primary = sources.get(resolved.sources[0])!;
  const result = executePipeline(primary, { ops: resolved.recipe }, sources);
  if ("error" in result) {
    // A recipe that fails to execute (a referenced column went away under it)
    // surfaces the same clean empty state as a missing source, so the grid shows
    // an empty derived table instead of stale data or a thrown error.
    return {
      content: { ...derivedContent, columns: [], rows: [] },
      sourceMissing: true,
      isDerived: true,
    };
  }

  const computed = result.content;
  // Keep the derived document's own meta (id / name / links / derivedFrom); take
  // only the computed table body and the computed table_type (transpose can flip
  // the archetype). Analyses / plots stay on the derived document.
  return {
    content: {
      ...derivedContent,
      meta: {
        ...derivedContent.meta,
        table_type: computed.meta.table_type,
      },
      columns: computed.columns,
      rows: computed.rows,
    },
    sourceMissing: false,
    isDerived: true,
  };
}
