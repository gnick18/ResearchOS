// specificity bot — tests for the local-library specificity scan + the NCBI
// Primer-BLAST handoff payload builder.

import { describe, it, expect } from "vitest";
import { reverseComplement } from "./primer";
import {
  scanLibrarySpecificity,
  buildPrimerBlastHandoff,
  PRIMER_BLAST_ENDPOINT,
  PRIMER_BLAST_BASE,
  type LibrarySequence,
} from "./primer-specificity";

// A 20-mer primer and a parent sequence that contains it exactly once.
const PRIMER = "ATGCGTACCGGTTAACGGCA"; // 20 nt
const FILLER_A = "TTTTAAAACCCCGGGGTTTTAAAACCCCGGGG"; // no overlap with PRIMER
const FILLER_B = "GAGAGAGAGATATATATATCTCTCTCTCTGTGTGTGTGT";

function parent(): LibrarySequence {
  // primer sits at offset 30 on the forward strand
  return {
    id: 1,
    name: "pParent",
    seq: FILLER_A.slice(0, 30) + PRIMER + FILLER_B,
    circular: true,
  };
}

describe("scanLibrarySpecificity — local-library scan", () => {
  it("finds the intended full-length site on the parent sequence", () => {
    const report = scanLibrarySpecificity(PRIMER, [parent()], {
      intendedSequenceId: 1,
    });
    expect(report.scanned).toBe(1);
    expect(report.skipped).toBe(0);
    const intended = report.hits.filter((h) => h.intended);
    expect(intended).toHaveLength(1);
    expect(intended[0].sequenceId).toBe(1);
    expect(intended[0].site.fullMatch).toBe(true);
    expect(intended[0].site.start).toBe(30);
    expect(intended[0].site.end).toBe(30 + PRIMER.length);
    expect(intended[0].site.direction).toBe(1);
    // No off-targets on a clean single-site parent.
    expect(report.offTargets).toHaveLength(0);
  });

  it("flags an off-target site planted in ANOTHER library sequence", () => {
    // A second sequence that also contains the full primer (forward strand).
    const offTarget: LibrarySequence = {
      id: 2,
      name: "pOther",
      seq: "AAAA" + PRIMER + "GGGG",
    };
    const report = scanLibrarySpecificity(PRIMER, [parent(), offTarget], {
      intendedSequenceId: 1,
    });
    expect(report.scanned).toBe(2);
    expect(report.offTargets).toHaveLength(1);
    const off = report.offTargets[0];
    expect(off.sequenceId).toBe(2);
    expect(off.sequenceName).toBe("pOther");
    expect(off.intended).toBe(false);
    expect(off.site.start).toBe(4);
    // Intended row sorts first.
    expect(report.hits[0].intended).toBe(true);
    expect(report.hits[0].sequenceId).toBe(1);
  });

  it("detects an off-target on the REVERSE strand of another sequence", () => {
    const rc = reverseComplement(PRIMER);
    const revTarget: LibrarySequence = {
      id: 3,
      name: "pRev",
      seq: "CCCC" + rc + "TTTT",
    };
    const report = scanLibrarySpecificity(PRIMER, [revTarget], {
      intendedSequenceId: 1, // parent not in the library this time
    });
    expect(report.offTargets).toHaveLength(1);
    expect(report.offTargets[0].site.direction).toBe(-1);
  });

  it("reports a clean primer with no off-targets", () => {
    const lib: LibrarySequence[] = [
      parent(),
      { id: 2, name: "pClean1", seq: FILLER_A + FILLER_B },
      { id: 3, name: "pClean2", seq: FILLER_B + FILLER_A },
    ];
    const report = scanLibrarySpecificity(PRIMER, lib, { intendedSequenceId: 1 });
    expect(report.scanned).toBe(3);
    expect(report.offTargets).toHaveLength(0);
    // Exactly the single intended hit.
    expect(report.hits).toHaveLength(1);
    expect(report.hits[0].intended).toBe(true);
  });

  it("with no intended parent, every site is reported as an extra site", () => {
    const report = scanLibrarySpecificity(PRIMER, [parent()]); // no intendedSequenceId
    expect(report.hits).toHaveLength(1);
    expect(report.hits[0].intended).toBe(false);
    expect(report.offTargets).toHaveLength(1);
  });

  it("treats a SECOND full-length match on the parent as an extra site", () => {
    const doubled: LibrarySequence = {
      id: 1,
      name: "pDouble",
      seq: "AA" + PRIMER + "GGGGGG" + PRIMER + "TT",
    };
    const report = scanLibrarySpecificity(PRIMER, [doubled], {
      intendedSequenceId: 1,
    });
    expect(report.hits.filter((h) => h.intended)).toHaveLength(1);
    expect(report.offTargets).toHaveLength(1);
  });

  it("caps the number of sequences scanned and reports the overflow", () => {
    const many: LibrarySequence[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `s${i}`,
      seq: FILLER_A + FILLER_B,
    }));
    const report = scanLibrarySpecificity(PRIMER, many, { maxSequences: 4 });
    expect(report.scanned).toBe(4);
    expect(report.skipped).toBe(6);
  });

  it("scans the intended parent first even when it is last in the list", () => {
    const lib: LibrarySequence[] = [
      { id: 2, name: "a", seq: FILLER_A + FILLER_B },
      { id: 3, name: "b", seq: FILLER_B + FILLER_A },
      parent(), // id 1, intended, placed last
    ];
    const report = scanLibrarySpecificity(PRIMER, lib, {
      intendedSequenceId: 1,
      maxSequences: 1, // only the first-scanned (the parent) survives the cap
    });
    expect(report.scanned).toBe(1);
    expect(report.hits[0].sequenceId).toBe(1);
    expect(report.hits[0].intended).toBe(true);
  });
});

describe("buildPrimerBlastHandoff — NCBI handoff payload", () => {
  it("prefills template + both primers and targets the CGI endpoint", () => {
    const h = buildPrimerBlastHandoff({
      template: "ATGCATGCATGC",
      forwardPrimer: "ATGCATGC",
      reversePrimer: "GCATGCAT",
    });
    expect(h.prefilled).toBe(true);
    expect(h.action).toBe(PRIMER_BLAST_ENDPOINT);
    expect(h.fields.INPUT_SEQUENCE).toBe("ATGCATGCATGC");
    expect(h.fields.PRIMER_LEFT_INPUT).toBe("ATGCATGC");
    expect(h.fields.PRIMER_RIGHT_INPUT).toBe("GCATGCAT");
    expect(h.fields.SEARCHMODE).toBe("1");
  });

  it("sanitizes the primer/template (strips non-ACGT, uppercases)", () => {
    const h = buildPrimerBlastHandoff({
      template: "atg c-atgc\n123",
      forwardPrimer: "  atgc gtac  ",
    });
    expect(h.fields.INPUT_SEQUENCE).toBe("ATGCATGC");
    expect(h.fields.PRIMER_LEFT_INPUT).toBe("ATGCGTAC");
  });

  it("works with only a forward primer (no template)", () => {
    const h = buildPrimerBlastHandoff({ forwardPrimer: "ATGCATGC" });
    expect(h.prefilled).toBe(true);
    expect(h.action).toBe(PRIMER_BLAST_ENDPOINT);
    expect(h.fields.PRIMER_LEFT_INPUT).toBe("ATGCATGC");
    expect(h.fields.INPUT_SEQUENCE).toBeUndefined();
    expect(h.fields.SEARCHMODE).toBe("1");
  });

  it("degrades gracefully to the base page when nothing is supplied", () => {
    const h = buildPrimerBlastHandoff({});
    expect(h.prefilled).toBe(false);
    expect(h.action).toBe(PRIMER_BLAST_BASE);
    expect(Object.keys(h.fields)).toHaveLength(0);
  });

  it("does NOT set SEARCHMODE when only a template is supplied", () => {
    const h = buildPrimerBlastHandoff({ template: "ATGCATGCATGC" });
    expect(h.prefilled).toBe(true);
    expect(h.fields.SEARCHMODE).toBeUndefined();
  });
});
