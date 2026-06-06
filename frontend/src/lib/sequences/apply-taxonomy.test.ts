// sequence editor master. Unit tests for the taxonomy write primitive. Given a
// sequence + a taxonomy, the GenBank must gain the source /organism + the
// db_xref="taxon:<id>" qualifier AND the sidecar organism / tax_id / tax_lineage
// must be patched, all through ONE store update (here a mock). Covers the happy
// path, the no-organism guard, a store failure, and that the lineage carries
// through verbatim.

import { describe, expect, it, vi } from "vitest";
import {
  applyTaxonomyToSequence,
  type ApplyTaxonomyUpdate,
} from "./apply-taxonomy";
import type { SequenceTaxonNode } from "../types";

const GENBANK = [
  "LOCUS       seq1                  20 bp    DNA     linear   UNA 01-JAN-2026",
  "FEATURES             Location/Qualifiers",
  "     source          1..20",
  "ORIGIN",
  "        1 aaaaccccgg ggttttacgt",
  "//",
].join("\n");

const LINEAGE: SequenceTaxonNode[] = [
  { taxId: "2759", name: "Eukaryota", rank: "superkingdom" },
  { taxId: "9606", name: "Homo sapiens", rank: "species" },
];

describe("applyTaxonomyToSequence", () => {
  it("rewrites the GenBank source feature and patches the sidecar via one update", async () => {
    const update = vi.fn<ApplyTaxonomyUpdate>().mockResolvedValue(null);
    const res = await applyTaxonomyToSequence(
      7,
      GENBANK,
      { organism: "Homo sapiens", tax_id: "9606", tax_lineage: LINEAGE },
      update,
    );

    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const [id, patch] = update.mock.calls[0];
    expect(id).toBe(7);
    // The GenBank gained the source organism + the taxon db_xref.
    expect(patch.genbank).toContain('/organism="Homo sapiens"');
    expect(patch.genbank).toContain('/db_xref="taxon:9606"');
    // The sidecar fields are set, lineage verbatim.
    expect(patch.organism).toBe("Homo sapiens");
    expect(patch.tax_id).toBe("9606");
    expect(patch.tax_lineage).toEqual(LINEAGE);
  });

  it("trims the organism and works without a tax id or lineage", async () => {
    const update = vi.fn<ApplyTaxonomyUpdate>().mockResolvedValue(null);
    const res = await applyTaxonomyToSequence(
      1,
      GENBANK,
      { organism: "  Escherichia coli  " },
      update,
    );

    expect(res.ok).toBe(true);
    const [, patch] = update.mock.calls[0];
    expect(patch.organism).toBe("Escherichia coli");
    expect(patch.genbank).toContain('/organism="Escherichia coli"');
    // No tax id => no db_xref written.
    expect(patch.genbank).not.toContain("db_xref");
    expect(patch.tax_id).toBeUndefined();
    expect(patch.tax_lineage).toBeUndefined();
  });

  it("fails without writing when the organism is empty", async () => {
    const update = vi.fn<ApplyTaxonomyUpdate>().mockResolvedValue(null);
    const res = await applyTaxonomyToSequence(1, GENBANK, { organism: "   " }, update);

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a failure when the store update throws", async () => {
    const update = vi
      .fn<ApplyTaxonomyUpdate>()
      .mockRejectedValue(new Error("disk is full"));
    const res = await applyTaxonomyToSequence(
      1,
      GENBANK,
      { organism: "Homo sapiens", tax_id: "9606" },
      update,
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe("disk is full");
  });
});
