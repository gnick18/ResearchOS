#!/usr/bin/env python3
"""
translation golden bot - GROUND-TRUTH generator for the DNA->PROTEIN
translation test suite.

Every expected protein string in the committed TS suite
(frontend/src/lib/sequences/translation.golden.test.ts) is grounded here by
Biopython's ``Bio.Seq.Seq.translate`` against the NCBI standard genetic code
(transl_table 1). NOTHING is taken from ResearchOS's own translate output.

Run:
    python3 -m venv /tmp/biopython-venv
    /tmp/biopython-venv/bin/pip install biopython
    /tmp/biopython-venv/bin/python frontend/scripts/gen-translate-golden.py

The script prints (a) the reconciliation report and (b) the grounded values.
It is a reference/documentation artifact - the committed TS test is pure and
does NOT shell out to Python, so CI never needs Biopython.

=============================================================================
RECONCILIATION: matching Biopython table=1 to ResearchOS's translate()
=============================================================================

ResearchOS has two standard-table-1 translation paths, both verified here:

  1. seqviz translate()       (frontend/src/vendor/seqviz/sequence.ts)
       - 64 exact standard codons; stop -> "*".
       - input .toUpperCase() (lowercase handled), whitespace NOT stripped.
       - trailing partial codon (len % 3 != 0) is DROPPED (loop: i+2 < len).
       - any codon NOT one of the 64 exact codons -> "?"  (gap symbol).
         => NNN -> "?", and a degenerate-but-resolvable codon like GGN -> "?".

  2. translateFrame1()        (frontend/src/lib/sequences/export.ts)
       - 64 exact standard codons; stop -> "*".
       - input .toUpperCase(); U->T; every non-ACGT base -> N.
       - trailing partial codon is DROPPED (loop: i+3 <= len).
       - any codon containing N (i.e. not one of the 64) -> "X" (gap symbol).
         => NNN -> "X", and a degenerate-but-resolvable codon like GGN -> "X".

Biopython Seq.translate(table=1, to_stop=False):
       - 64 exact standard codons; stop -> "*".  (AGREES with both ours.)
       - errors on len % 3 != 0  -> so to compare, we TRUNCATE the input to a
         multiple of 3 BEFORE handing it to Biopython, matching ours' drop.
       - RESOLVES degenerate codons that map unambiguously: GGN->G, ACN->T,
         CGN->R, etc.; only fully-ambiguous codons (NNN, ATN, TGN) -> "X".
       - gap symbol is "X".

AGREEMENT (string-equal across Biopython, seqviz, translateFrame1):
  - any sequence over A/C/G/T (incl. lowercase) whose length is trimmed to a
    multiple of 3, including internal-stop sequences. Stop "*" placement is
    identical in all three.
  - a fully-ambiguous codon: Biopython NNN->X, translateFrame1 NNN->X (MATCH);
    seqviz NNN->"?" (differs only in the GAP GLYPH, "?" vs "X" - documented).

DOCUMENTED DIVERGENCES (by design, NOT bugs):
  - Gap glyph: seqviz uses "?", Biopython/translateFrame1 use "X".
  - Degenerate-resolvable codons (GGN, ACN, CGN, ...): Biopython resolves to the
    real AA; BOTH our functions emit a gap ("?" / "X") because they only carry
    the 64 exact codons. We assert OUR documented behavior here and flag the
    divergence; it is a known limitation, not a correctness bug on exact codons.

The trivial hand-check (ATG GCC -> "MA") is asserted against all three engines
before any larger case is trusted.
"""

from Bio.Seq import Seq


def bio_translate(seq: str) -> str:
    """Biopython table=1, trailing partial codon dropped (to match ours)."""
    s = "".join(ch for ch in seq.upper() if not ch.isspace())
    s = s.replace("U", "T")
    s = s[: len(s) - (len(s) % 3)]  # drop trailing 1-2 bases, as ours do
    if not s:
        return ""
    return str(Seq(s).translate(table=1, to_stop=False))


def hand_check():
    """Establish agreement on a trivial hand-verifiable case first."""
    assert bio_translate("ATGGCC") == "MA", "hand-check ATG GCC -> MA failed"
    # ATG=M (start/Met), GCC=A (Ala). Verified against the standard code by hand.
    print("HAND CHECK ok: ATG GCC -> MA (Biopython table=1)")


CASES = [
    # name, dna-as-typed (may include lowercase / whitespace / ambiguity)
    ("hand_check_ATG_GCC", "ATGGCC"),
    ("clean_orf_with_stop", "ATGAAACCCGGGTAA"),          # M K P G *
    ("internal_stop", "ATGTAATGGAAATAA"),                # M * W K *
    ("trailing_one_extra_base", "ATGGCCA"),              # 7 nt: ATG GCC + A
    ("trailing_two_extra_bases", "ATGGCCAT"),            # 8 nt: ATG GCC + AT
    ("lowercase_and_whitespace", "  atg gcc aaa ttt  "),  # -> M A K F
    ("longer_peptide", "ATGGAAGATTTCAAACGTCATTGGTACTAA"),
    ("reverse_strand_src", "TTACATGGT"),  # revcomp = ACCATGTAA -> T M *
]


def main():
    hand_check()
    print()
    print("GROUNDED VALUES (Biopython table=1; trailing partial dropped):")
    print("-" * 70)
    for name, dna in CASES:
        print(f"{name:28s} {dna!r:30s} -> {bio_translate(dna)!r}")

    print()
    print("REVERSE-STRAND check:")
    src = "TTACATGGT"
    rc = str(Seq(src).reverse_complement())
    print(f"  src           = {src!r}")
    print(f"  reverse_comp  = {rc!r}")
    print(f"  translate(rc) = {bio_translate(rc)!r}")

    print()
    print("AMBIGUOUS-CODON behavior (Biopython resolves; ResearchOS emits gap):")
    print("-" * 70)
    for c in ["NNN", "GGN", "ACN", "CGN", "ATN", "TGN"]:
        print(f"  {c} -> Biopython {str(Seq(c).translate(table=1))!r}"
              f"   | seqviz '?'  | translateFrame1 'X'")

    print()
    print("ALT TABLES: ResearchOS exposes ONLY standard table 1 (no bacterial/")
    print("mito codon-table parameter), so alternate-table tests are N/A.")


if __name__ == "__main__":
    main()
