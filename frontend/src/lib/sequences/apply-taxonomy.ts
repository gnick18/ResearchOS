// sequence editor master. The ONE reusable taxonomy write primitive.
//
// A sequence carries taxonomy in two places, both written together by the
// "Enrich from NCBI" flow (see EnrichFromNcbiDialog -> handleEnriched):
//   - the sidecar fields organism / tax_id / tax_lineage, and
//   - the GenBank source feature's /organism + /db_xref="taxon:<id>".
// This module extracts that dual write into a single function so the enrich
// apply, the single paste, and (later) the bulk apply all share ONE path
// instead of each inventing its own persistence. It rewrites the GenBank via
// setSourceOrganismInGenbank and persists the rewritten .gb plus the three
// sidecar fields through the store-update callback the caller hands in.
//
// Calm by convention: no emojis, no em-dashes, no mid-sentence colons in copy.

import { setSourceOrganismInGenbank } from "./ncbi-datasets";
import type { SequenceTaxonNode } from "../types";

/** A copyable / applyable taxonomy unit. The same shape the clipboard holds and
 *  the enrich apply produces. tax_id and a non-empty lineage are optional (an
 *  organism with neither still labels the source feature's /organism). */
export interface SequenceTaxonomy {
  organism: string;
  tax_id?: string;
  tax_lineage?: SequenceTaxonNode[];
}

/** The minimal store-update the primitive calls. Matches the relevant slice of
 *  sequencesApi.update so the page can pass it straight through, and a test can
 *  pass a mock. Resolves when the write lands (the return value is ignored). */
export type ApplyTaxonomyUpdate = (
  id: number,
  patch: {
    genbank: string;
    organism: string;
    tax_id?: string;
    tax_lineage?: SequenceTaxonNode[];
  },
) => Promise<unknown>;

export interface ApplyTaxonomyResult {
  ok: boolean;
  /** Present on failure, a short reason for logging / a calm error toast. */
  error?: string;
}

/**
 * Apply a taxonomy to one sequence, writing BOTH the GenBank source feature and
 * the sidecar fields through a single store update.
 *
 * Steps:
 *  1. rewrite the source feature's /organism + /db_xref via
 *     setSourceOrganismInGenbank (it inserts a source feature when missing),
 *  2. persist the rewritten .gb plus organism / tax_id / tax_lineage through the
 *     update callback (the SAME path the enrich apply uses),
 *  3. return success or a failure with a reason.
 *
 * @param seqId the sequence id to write.
 * @param currentGenbank the sequence's current GenBank text (the source feature
 *   is rewritten on top of it).
 * @param taxonomy the organism / tax id / lineage to stamp.
 * @param update the store-update callback (sequencesApi.update, or a mock).
 */
export async function applyTaxonomyToSequence(
  seqId: number,
  currentGenbank: string,
  taxonomy: SequenceTaxonomy,
  update: ApplyTaxonomyUpdate,
): Promise<ApplyTaxonomyResult> {
  const organism = (taxonomy.organism || "").trim();
  if (!organism) {
    return { ok: false, error: "No organism to apply." };
  }
  try {
    const rewritten = setSourceOrganismInGenbank(
      currentGenbank || "",
      organism,
      taxonomy.tax_id,
    );
    await update(seqId, {
      genbank: rewritten,
      organism,
      tax_id: taxonomy.tax_id,
      tax_lineage: taxonomy.tax_lineage,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to apply taxonomy.",
    };
  }
}

/** A Copy / Paste taxonomy menu pair, shaped to drop into the editor's Analyze
 *  menu and the list-row context menu (both render EditMenuItem-like rows). Kept
 *  framework-free here so the enablement rule is unit-testable and the editor +
 *  list share ONE definition. The two ids are stable for tests + keys. */
export interface TaxonomyMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  onRun: () => void;
}

/**
 * Build the Copy / Paste taxonomy menu pair.
 *
 * - Copy is enabled only when the target sequence HAS taxonomy (an organism).
 * - Paste is enabled only when the clipboard holds a taxonomy.
 *
 * @param opts.hasTaxonomy whether the target sequence carries an organism.
 * @param opts.clipboardHasTaxonomy whether the taxonomy clipboard is non-empty.
 * @param opts.onCopy run the copy (read the sequence's taxonomy onto the clipboard).
 * @param opts.onPaste run the paste (open the confirm, then apply the clipboard).
 * @param opts.idPrefix namespaces the item ids (e.g. "analyze" vs "row").
 */
export function buildTaxonomyMenuItems(opts: {
  hasTaxonomy: boolean;
  clipboardHasTaxonomy: boolean;
  onCopy: () => void;
  onPaste: () => void;
  idPrefix: string;
}): TaxonomyMenuItem[] {
  return [
    {
      id: `${opts.idPrefix}-copy-taxonomy`,
      label: "Copy taxonomy",
      enabled: opts.hasTaxonomy,
      onRun: opts.onCopy,
    },
    {
      id: `${opts.idPrefix}-paste-taxonomy`,
      label: "Paste taxonomy",
      enabled: opts.clipboardHasTaxonomy,
      onRun: opts.onPaste,
    },
  ];
}
