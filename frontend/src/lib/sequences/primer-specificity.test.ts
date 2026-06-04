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
    // The intended perfect site carries 0 mismatches, full identity, not near.
    expect(intended[0].mismatches).toBe(0);
    expect(intended[0].identity).toBe(1);
    expect(intended[0].near).toBe(false);
    // No off-targets on a clean single-site parent.
    expect(report.offTargets).toHaveLength(0);
    // The scan ran mismatch-tolerant by default and reports its gate.
    expect(report.mismatchTolerant).toBe(true);
    expect(report.minIdentity).toBeCloseTo(0.8);
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
    // An EXACT off-target: 0 mismatches, full identity, not a near hit. This is
    // the most dangerous case and must not regress under mismatch tolerance.
    expect(off.mismatches).toBe(0);
    expect(off.identity).toBe(1);
    expect(off.near).toBe(false);
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

// Mutate one base of `s` at `idx` to a guaranteed-different base.
function mutate(s: string, idx: number): string {
  const to = s[idx] === "A" ? "C" : "A";
  return s.slice(0, idx) + to + s.slice(idx + 1);
}

describe("scanLibrarySpecificity — mismatch-tolerant near off-targets", () => {
  it("reports a 1-mismatch off-target as a NEAR hit with the right count + identity", () => {
    // A second sequence holding the primer with ONE internal mismatch. The exact
    // fast path would miss this; the aligner pass must catch it.
    const near = mutate(PRIMER, 10); // mismatch mid-primer
    const offTarget: LibrarySequence = {
      id: 2,
      name: "pNear1",
      seq: "AAAA" + near + "GGGG",
    };
    const report = scanLibrarySpecificity(PRIMER, [parent(), offTarget], {
      intendedSequenceId: 1,
    });
    // Intended perfect site on the parent is still found and not a near hit.
    const intended = report.hits.find((h) => h.intended);
    expect(intended).toBeDefined();
    expect(intended!.near).toBe(false);
    // The planted 1-mismatch site is reported as a near off-target.
    const off = report.offTargets.find((h) => h.sequenceId === 2);
    expect(off).toBeDefined();
    expect(off!.intended).toBe(false);
    expect(off!.near).toBe(true);
    expect(off!.mismatches).toBe(1);
    expect(off!.identity).toBeCloseTo(0.95, 2); // 19/20
    expect(off!.site.direction).toBe(1);
  });

  it("reports a 2-mismatch off-target on the REVERSE strand with 2 mismatches", () => {
    let near = mutate(PRIMER, 8);
    near = mutate(near, 14);
    const rc = reverseComplement(near);
    const revTarget: LibrarySequence = {
      id: 3,
      name: "pNearRev",
      seq: "CCCC" + rc + "TTTT",
    };
    const report = scanLibrarySpecificity(PRIMER, [revTarget], {
      intendedSequenceId: 1, // parent absent
    });
    expect(report.offTargets).toHaveLength(1);
    const off = report.offTargets[0];
    expect(off.near).toBe(true);
    expect(off.mismatches).toBe(2);
    expect(off.identity).toBeCloseTo(0.9, 2); // 18/20
    expect(off.site.direction).toBe(-1);
  });

  it("does NOT spuriously flag a non-homologous sequence (identity gate)", () => {
    // FILLER_A/FILLER_B share no meaningful homology with the primer; even with
    // tolerance on, the minIdentity gate must keep them off the report.
    const unrelated: LibrarySequence[] = [
      { id: 2, name: "pJunk1", seq: FILLER_A + FILLER_B },
      { id: 3, name: "pJunk2", seq: FILLER_B + FILLER_A },
    ];
    const report = scanLibrarySpecificity(PRIMER, unrelated);
    expect(report.offTargets).toHaveLength(0);
    expect(report.hits).toHaveLength(0);
  });

  it("ranks a PERFECT off-target above a NEAR one (most dangerous first)", () => {
    const perfect: LibrarySequence = { id: 2, name: "pPerfect", seq: "TT" + PRIMER + "AA" };
    const near: LibrarySequence = { id: 3, name: "pNear", seq: "GG" + mutate(PRIMER, 9) + "CC" };
    const report = scanLibrarySpecificity(PRIMER, [near, perfect], {
      // no intended parent: both are off-targets
    });
    expect(report.offTargets).toHaveLength(2);
    // Perfect (0 mismatches) sorts before the near one.
    expect(report.offTargets[0].sequenceId).toBe(2);
    expect(report.offTargets[0].mismatches).toBe(0);
    expect(report.offTargets[0].near).toBe(false);
    expect(report.offTargets[1].sequenceId).toBe(3);
    expect(report.offTargets[1].near).toBe(true);
  });

  it("mismatchTolerant:false restores the legacy exact-only scan (no near hits)", () => {
    const near = mutate(PRIMER, 10);
    const offTarget: LibrarySequence = { id: 2, name: "pNear1", seq: "AAAA" + near + "GGGG" };
    const report = scanLibrarySpecificity(PRIMER, [parent(), offTarget], {
      intendedSequenceId: 1,
      mismatchTolerant: false,
    });
    expect(report.mismatchTolerant).toBe(false);
    // Only the exact intended site survives; the near off-target is invisible.
    expect(report.offTargets).toHaveLength(0);
    expect(report.hits).toHaveLength(1);
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
