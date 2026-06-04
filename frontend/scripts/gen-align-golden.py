#!/usr/bin/env python3
"""
Generate INDEPENDENT ground-truth expected values for the pairwise alignment
golden suite (frontend/src/lib/align/golden.test.ts).

WHY THIS EXISTS
---------------
A test that asserts "our engine's output equals what our engine produced"
verifies nothing. Every expected score/alignment in the golden suite must come
from an INDEPENDENT authority. This script is one of the two authorities used:
it runs Biopython's Bio.Align.PairwiseAligner (an independent, widely-used
reference implementation) with parameters configured to MATCH our engine's
scoring + gap model exactly, and prints the reference optimal score and the
reference optimal aligned strings. Those numbers are then baked into the
TypeScript suite as fixtures. The other authority is canonical published worked
examples (Needleman-Wunsch 1970 / Smith-Waterman 1981 textbook cases), grounded
by hand in the test file's comments.

The committed TypeScript test is PURE (no Python, no network at test time). This
script exists only so the fixtures are reproducible and auditable: re-run it and
confirm the printed numbers match the constants in golden.test.ts.

Run:
    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install biopython
    /tmp/venv/bin/python frontend/scripts/gen-align-golden.py

OUR ENGINE'S CONVENTIONS (read from frontend/src/lib/align/)
------------------------------------------------------------
- DNA scoring (dnaScoring): compatible bases score +match (default +2),
  incompatible score +mismatch (default -1). IUPAC-degeneracy aware: a column is
  a match when the two base sets intersect (N vs anything, R = A|G, etc.).
- Protein scoring (proteinScoring): canonical BLOSUM62 integer log-odds.
- AFFINE GAP MODEL (Gotoh): a gap of length L costs  gapOpen + L*gapExtend
  (the open penalty is paid ONCE per gap run; the extend penalty is paid for
  EVERY gap cell, including the first). Defaults gapOpen=5, gapExtend=1, so a
  length-L gap subtracts (5 + L) from the score.
- Coordinates are 0-based half-open. Global = end-to-end. Local = Smith-Waterman.
  semiGlobal = the SECOND arg (query b) is end-to-end; the FIRST arg (target a)
  pays NO penalty for leading/trailing gaps (free end gaps on the target).

RECONCILING OUR MODEL WITH BIOPYTHON'S GAP MODEL
------------------------------------------------
Biopython's PairwiseAligner scores a gap of length L as:
    open_gap_score + (L-1)*extend_gap_score
(the open score applies to the first gap cell, extend to each subsequent cell).

Our model scores a length-L gap as  -(gapOpen + L*gapExtend).

To make Biopython reproduce OUR totals, set:
    open_gap_score   = -(gapOpen + gapExtend)     # first gap cell
    extend_gap_score = -gapExtend                 # each subsequent gap cell
Then Biopython's gap cost
    = -(gapOpen+gapExtend) + (L-1)*(-gapExtend)
    = -(gapOpen + gapExtend + (L-1)*gapExtend)
    = -(gapOpen + L*gapExtend)                    # == our model. QED.

This identity is verified at runtime below on a hand-computed trivial case
BEFORE any fixture is trusted (the convention-reconciliation gate).
"""

from Bio.Align import PairwiseAligner, substitution_matrices


# ---------------------------------------------------------------------------
# Scoring construction helpers (mirror our engine's parameters)
# ---------------------------------------------------------------------------

def dna_aligner(mode, match=2.0, mismatch=-1.0, gap_open=5.0, gap_extend=1.0):
    """A PairwiseAligner configured to match our dnaScoring + affine gap model.

    mode: "global" | "local". (semi-global is built separately, below, because
    Biopython expresses free end gaps via target_end_gap_score, not a mode.)
    Exact-base DNA only here (no IUPAC); IUPAC cases are hand-grounded in TS.
    """
    a = PairwiseAligner()
    a.mode = mode
    a.match_score = match
    a.mismatch_score = mismatch
    # Convert our (gapOpen + L*gapExtend) model into Biopython's open/extend.
    a.open_gap_score = -(gap_open + gap_extend)
    a.extend_gap_score = -gap_extend
    return a


def dna_semiglobal_aligner(match=2.0, mismatch=-1.0, gap_open=5.0, gap_extend=1.0):
    """Semi-global matching our alignSemiGlobal(a, b): target `a` (the LONG, 1st
    seq) pays NO penalty for leading/trailing gaps; query `b` (2nd seq) is
    aligned end-to-end.

    SUBTLE GAP-SIDE NOTE (verified empirically against our engine): when a short
    query is placed inside a longer target, the target's overhanging flanks
    correspond to GAPS IN THE QUERY (`b`) at the alignment ends, not gaps in the
    target. In Biopython's accounting those query-side end gaps are "deletions",
    freed by end_deletion_score = 0 (older alias: query_end_gap_score). Freeing
    those reproduces our engine's score (e.g. +16 for an exact 8-mer primer into
    a 17-mer template, == 8 matches * 2). Using the target/insertion knob instead
    gives a different number and does NOT match our engine, so the side matters.

    We therefore call aligner.align(a, b) with a=target (1st), b=query (2nd) and
    set end_deletion_score = 0 (free end gaps in the query/2nd sequence).
    """
    a = PairwiseAligner()
    a.mode = "global"
    a.match_score = match
    a.mismatch_score = mismatch
    a.open_gap_score = -(gap_open + gap_extend)
    a.extend_gap_score = -gap_extend
    # Free the query-side (2nd sequence) leading/trailing gaps. In Biopython 1.87
    # this is end_deletion_score; older releases named it query_end_gap_score.
    a.end_deletion_score = 0.0
    return a


def protein_aligner(mode, gap_open=11.0, gap_extend=1.0):
    """BLOSUM62 protein aligner matching our proteinScoring + affine gaps.

    Uses Biopython's bundled BLOSUM62 substitution matrix (same canonical
    integer log-odds our engine hard-codes). Gap penalties via our model.
    """
    a = PairwiseAligner()
    a.mode = mode
    a.substitution_matrix = substitution_matrices.load("BLOSUM62")
    a.open_gap_score = -(gap_open + gap_extend)
    a.extend_gap_score = -gap_extend
    return a


def report(aligner, a, b):
    """Run an aligner and return (score, alignedA, alignedB) for the optimum."""
    alignments = aligner.align(a, b)
    best = alignments[0]
    # best[0] / best[1] are the gapped strings for seqA / seqB.
    return best.score, str(best[0]), str(best[1])


def show(title, aligner, a, b):
    score, aa, bb = report(aligner, a, b)
    print(f"### {title}")
    print(f"    a   = {a!r}")
    print(f"    b   = {b!r}")
    print(f"    score   = {score}")
    print(f"    alignedA= {aa!r}")
    print(f"    alignedB= {bb!r}")
    print()
    return score, aa, bb


# ---------------------------------------------------------------------------
# STEP 0: CONVENTION-RECONCILIATION GATE
# Hand-compute trivial cases, confirm Biopython (configured as above) agrees,
# BEFORE trusting any larger fixture.
# ---------------------------------------------------------------------------

def reconcile():
    print("=" * 72)
    print("CONVENTION RECONCILIATION (must pass before any fixture is trusted)")
    print("=" * 72)
    ok = True

    # Case 1: two identical 5-mers, global. By hand: 5 matches * 2 = +10.
    s, _, _ = report(dna_aligner("global"), "ACGTA", "ACGTA")
    print(f"[1] identical 5-mer global: hand=10  biopython={s}  "
          f"{'OK' if s == 10 else 'MISMATCH'}")
    ok &= (s == 10)

    # Case 2: one mismatch, global, no gap. ACGTA vs ACCTA: pos2 G->C.
    # By hand: 4 matches*2 + 1 mismatch*(-1) = 8 - 1 = +7.
    s, _, _ = report(dna_aligner("global"), "ACGTA", "ACCTA")
    print(f"[2] single mismatch global: hand=7   biopython={s}  "
          f"{'OK' if s == 7 else 'MISMATCH'}")
    ok &= (s == 7)

    # Case 3: a single-base gap, global. ACGT vs ACT (the G is deleted).
    # By hand: best is 3 matches*2 - gap(L=1)=(5+1*1)=6  ->  6 - 6 = 0.
    # (Alternative all-mismatch path scores worse.)
    s, _, _ = report(dna_aligner("global"), "ACGT", "ACT")
    print(f"[3] single-base gap global: hand=0   biopython={s}  "
          f"{'OK' if s == 0 else 'MISMATCH'}")
    ok &= (s == 0)

    # Case 4: affine LENGTH-3 gap costs open once + 3*extend, NOT 3 opens.
    # AAACCC vs AACCC has one base deleted -> length-1 gap = 5+1 = 6 cost.
    # Build a clean length-3 gap: target AAA, query AAA + GGG insert region.
    # Use "AAAGGGAAA" vs "AAAAAA": the GGG (3 bases) is a single length-3 gap.
    # By hand: 6 matches*2 - (5 + 3*1) = 12 - 8 = +4.
    s, aa, bb = report(dna_aligner("global"), "AAAGGGAAA", "AAAAAA")
    print(f"[4] length-3 affine gap global: hand=4   biopython={s}  "
          f"{'OK' if s == 4 else 'MISMATCH'}")
    print(f"    aligned: {aa} / {bb}")
    ok &= (s == 4)

    print()
    print("RECONCILIATION RESULT:", "ALL OK -- conventions provably agree"
          if ok else "FAILED -- DO NOT trust fixtures")
    print()
    return ok


def main():
    if not reconcile():
        raise SystemExit("Convention reconciliation failed; aborting.")

    print("=" * 72)
    print("GOLDEN FIXTURES (Biopython optimal score + alignment)")
    print("=" * 72)
    print()

    # --- GLOBAL (Needleman-Wunsch), Biopython-validated DNA -----------------
    show("GLOBAL dna A (mismatch + gap mix)",
         dna_aligner("global"), "GATTACA", "GCATGCU".replace("U", "T"))
    show("GLOBAL dna B (two indels)",
         dna_aligner("global"), "ACGTGTCATTG", "ACGTCATTG")
    show("GLOBAL dna C (longer, mixed)",
         dna_aligner("global"), "TGGCCAGGCTGGTCTCGAACT", "TGGCCAGGTGGTCTCGAACT")

    # --- LOCAL (Smith-Waterman), Biopython-validated ------------------------
    show("LOCAL dna A (embedded island)",
         dna_aligner("local"), "AAAAACGTACGTAAAAA", "TTTTACGTACGTTTTT")
    show("LOCAL dna B (Smith-Waterman 1981-style, GGTTGACTA / TGTTACGG)",
         dna_aligner("local"), "GGTTGACTA", "TGTTACGG")

    # --- SEMI-GLOBAL: short query into a longer target, target end gaps free.
    show("SEMIGLOBAL primer-into-template (exact)",
         dna_semiglobal_aligner(), "AAAAACGTACGTGGGGG", "ACGTACGT")
    show("SEMIGLOBAL primer-into-template (one mismatch)",
         dna_semiglobal_aligner(), "AAAAACGTTCGTGGGGG", "ACGTACGT")

    # --- AFFINE: one long gap should beat several short gaps ----------------
    # With gapOpen high vs gapExtend low, the optimum places ONE long gap.
    show("AFFINE one-long-gap-vs-many (gapOpen=10, gapExtend=1)",
         dna_aligner("global", gap_open=10.0, gap_extend=1.0),
         "ACGTACGTACGT", "ACGTGT")

    # --- PROTEIN BLOSUM62 ---------------------------------------------------
    show("PROTEIN global BLOSUM62 A",
         protein_aligner("global"), "HEAGAWGHEE", "PAWHEAE")
    show("PROTEIN local BLOSUM62 A (classic Durbin example)",
         protein_aligner("local", gap_open=11.0, gap_extend=1.0),
         "HEAGAWGHEE", "PAWHEAE")
    show("PROTEIN global BLOSUM62 B (conservative substitutions)",
         protein_aligner("global"), "MKLVING", "MKIVLNG")

    print("Done. Bake these score/alignment values into golden.test.ts and cite")
    print("'Biopython 1.87 PairwiseAligner, gen-align-golden.py' as the source.")


if __name__ == "__main__":
    main()
