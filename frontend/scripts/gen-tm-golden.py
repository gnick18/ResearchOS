#!/usr/bin/env python3
"""
Generate INDEPENDENT ground-truth expected values for the nearest-neighbor Tm
golden suite (frontend/src/lib/calculators/tm-nn.golden.test.ts).

WHY THIS EXISTS
---------------
A test that asserts "our calculator equals what our calculator produced" proves
nothing. Every expected Tm baked into the golden suite must come from an
INDEPENDENT authority, never from our own nearestNeighborTm output. This script
runs two independent reference implementations over a shared oligo set and
prints their Tm values plus a reconciliation gate, so every fixture in the
TypeScript test is reproducible and auditable. The committed TS test is PURE
(no Python, no network at test time, CI-safe).

THE TWO ORACLES
---------------
TIER 1 (primary, TIGHT, <= 0.1 C, ideally <= 0.05 C):
    Biopython Bio.SeqUtils.MeltingTemp.Tm_NN configured to EXACTLY match our
    calculator: nn_table = DNA_NN3 (Allawi & SantaLucia 1997), saltcorr = 5
    (SantaLucia 1998 entropy salt correction), and the strand-concentration
    convention dnac1 = dnac2 = oligo/2 (so Biopython's internal
    k = dnac1 - dnac2/2 = oligo/4, matching our oligoNanomolar/4). Because our
    code is a faithful line-by-line port of Tm_NN for the perfect-complement
    case, the two MUST agree to floating-point precision. Any case that does
    NOT is a PORT BUG, not a tolerance to relax.

TIER 2 (ecosystem cross-check, LOOSER + explained, +/- 3 C):
    primer3-py primer3.calc_tm (the oligotm engine, tm_method='santalucia',
    salt_corrections_method='santalucia'). primer3 uses the SantaLucia 1998
    UNIFIED NN table (NOT DNA_NN3 = Allawi 1997) and its own salt model, so a
    SYSTEMATIC offset of a couple degrees is EXPECTED and is not a bug. The TS
    test asserts only loose agreement and records the mean/max delta.

PUBLISHED ANCHORS
-----------------
A handful of Tm values from SantaLucia & Hicks (2004) Annu Rev Biophys Biomol
Struct 33:415-440 worked discussion and the long-standing Biopython module
docstring (myseq) are carried as canonical hand-grounded anchors.

SELF-COMPLEMENTARY CONVENTION
-----------------------------
Biopython's Tm_NN does NOT auto-detect palindromes; selfcomp defaults False and
must be passed True. When selfcomp=True it adds the nn_table['sym'] term and
uses k = dnac1 (i.e. oligo/2). Our calculator's selfComplementary flag does the
identical thing. The palindrome case below is generated with selfcomp=True and
the TS test passes selfComplementary: true to match.

Run:
    python3 -m venv .venv-tm
    .venv-tm/bin/pip install biopython primer3-py
    .venv-tm/bin/python frontend/scripts/gen-tm-golden.py

Re-run any time and confirm the printed numbers still match the constants in
tm-nn.golden.test.ts.
"""

from __future__ import annotations

from Bio.SeqUtils import MeltingTemp as mt
import primer3


# ---------------------------------------------------------------------------
# Reconciliation gate: reproduce the 3 reference values already pinned in
# tm-nn.test.ts. If these do not come back exactly, the Biopython config below
# does NOT match our calculator and every downstream fixture is suspect.
# ---------------------------------------------------------------------------
MYSEQ = "CGTTCCAAAGATGTGGGCATGAGCTTAC"
RECON_EXPECTED = {
    ("Na=50",): 60.32,
    ("Na=50", "Tris=10"): 60.79,
    ("Na=50", "Tris=10", "Mg=1.5"): 67.39,
}


def biopython_tm(seq, *, oligo_nm, na=50, k=0, tris=0, mg=0, dntps=0, selfcomp=False):
    """Biopython Tm_NN configured to MATCH nearestNeighborTm exactly.

    dnac1 = dnac2 = oligo/2 so Biopython's k = dnac1 - dnac2/2 = oligo/4
    (the non-selfcomp convention). For selfcomp Biopython uses k = dnac1 =
    oligo/2 internally, again matching our calculator.
    """
    half = oligo_nm / 2.0
    return mt.Tm_NN(
        seq,
        nn_table=mt.DNA_NN3,
        dnac1=half,
        dnac2=half,
        selfcomp=selfcomp,
        Na=na,
        K=k,
        Tris=tris,
        Mg=mg,
        dNTPs=dntps,
        saltcorr=5,
    )


def primer3_tm(seq, *, oligo_nm, na=50, k=0, tris=0, mg=0, dntps=0):
    """primer3 oligotm cross-check.

    primer3's mv_conc is a single monovalent value; fold K+ and Tris/2 into it
    to approximate our von Ahsen monovalent equivalent (primer3 has no separate
    K/Tris inputs). dna_conc is the total oligo concentration (primer3 applies
    the SantaLucia /4 strand convention internally, same family as ours).
    NOTE: different NN table (SantaLucia 1998 unified) + different salt model =
    a systematic offset of a couple degrees is EXPECTED here, not a bug.
    """
    mv = na + k + tris / 2.0
    return primer3.calc_tm(
        seq,
        mv_conc=mv,
        dv_conc=mg,
        dntp_conc=dntps,
        dna_conc=oligo_nm,
        tm_method="santalucia",
        salt_corrections_method="santalucia",
    )


def run_recon_gate():
    print("=" * 72)
    print("RECONCILIATION GATE  (must reproduce the 3 values pinned in tm-nn.test.ts)")
    print("=" * 72)
    ok = True
    cases = [
        (("Na=50",), dict(na=50)),
        (("Na=50", "Tris=10"), dict(na=50, tris=10)),
        (("Na=50", "Tris=10", "Mg=1.5"), dict(na=50, tris=10, mg=1.5)),
    ]
    for label, kw in cases:
        got = biopython_tm(MYSEQ, oligo_nm=50, **kw)
        exp = RECON_EXPECTED[label]
        match = abs(round(got, 2) - exp) < 1e-9
        ok = ok and match
        print(f"  {', '.join(label):28s}  Biopython={got:8.4f}  expect={exp:6.2f}  {'OK' if match else 'MISMATCH!!'}")
    print(f"\n  GATE: {'PASS - Biopython config matches our calculator' if ok else 'FAIL - config does NOT match, fixtures invalid'}\n")
    return ok


# ---------------------------------------------------------------------------
# Shared oligo set (each grounded independently by both oracles).
# fields: id, seq, gc-class, note, selfcomp
# ---------------------------------------------------------------------------
OLIGOS = [
    # id,                  seq,                                        note
    ("short15_mid",        "ACGTACGTACGTACG",   False, "15-mer ~50% GC"),
    ("short15_lowgc",      "AATAAATTTAATTTAA",  False, "16-mer very low GC, AT termini"),
    ("short16_highgc",     "GCGCGGCCGGCGCGGC",  False, "16-mer very high GC, GC termini"),
    ("mid20_mid",          "ATCGATCGATCGATCGATCG", False, "20-mer 50% GC, A/G termini"),
    ("mid25_realistic",    "GCATGAGCTTACGTTCCAAAGATGT", False, "25-mer realistic primer"),
    ("ref28_biopython",    MYSEQ,               False, "28-mer Biopython docstring reference"),
    ("long35_mid",         "ATGCATGCATGCATGCATGCATGCATGCATGCATG", False, "35-mer 50% GC"),
    ("long40_highgc",      "GCGCGCATGCGCGCGCATGCGCGCGCATGCGCGCGCATGC", False, "40-mer high GC"),
    ("at_terminal",        "ATTGCATGCATGCATTA", False, "AT termini both ends"),
    ("gc_terminal",        "GCATGCATGCATGCATGC", False, "GC termini both ends"),
]

# Self-complementary / palindromic oligos -> selfComplementary=True (sym term).
PALINDROMES = [
    ("palindrome_ecorv",   "GGATATCC", "8-mer palindrome (RV-like), self-comp"),
    ("palindrome_gc8",     "GGGGCCCC", "8-mer GC palindrome, self-comp"),
    ("palindrome_16",      "GAATTCATGAATTCAT", "non-palindrome control near same len"),
]
# keep only the true palindromes for the selfcomp path
def _rc(s):
    c = {"A": "T", "T": "A", "G": "C", "C": "G"}
    return "".join(c[x] for x in reversed(s))

TRUE_PALINDROMES = [
    ("palindrome_ecorv", "GGATATCC", "8-mer palindrome (EcoRV-like), self-comp"),
    ("palindrome_gc8",   "GGGGCCCC", "8-mer all-GC palindrome, self-comp"),
    ("palindrome_at12",  "AATTGGCCAATT", "12-mer palindrome, mixed, self-comp"),
]

# Parameter-variation cases on a fixed oligo (where convention bugs hide).
PARAM_OLIGO = MYSEQ
PARAM_CASES = [
    ("default_oligo250",      dict(oligo_nm=250, na=50), "default: Na=50, oligo=250nM"),
    ("na50_oligo50",          dict(oligo_nm=50,  na=50), "Na=50, oligo=50nM"),
    ("na50_tris10",           dict(oligo_nm=50,  na=50, tris=10), "Na=50 + Tris=10"),
    ("na50_tris10_mg15",      dict(oligo_nm=50,  na=50, tris=10, mg=1.5), "Na=50 + Tris=10 + Mg=1.5"),
    ("na50_k50",              dict(oligo_nm=50,  na=50, k=50), "Na=50 + K=50"),
    ("na50_mg15_dntp06",      dict(oligo_nm=50,  na=50, mg=1.5, dntps=0.6), "Na=50 + Mg=1.5 + dNTP=0.6 (PCR)"),
    ("high_oligo_2000",       dict(oligo_nm=2000, na=50), "high oligo conc 2 uM"),
    ("low_oligo_10",          dict(oligo_nm=10,   na=50), "low oligo conc 10 nM"),
]


def fmt_ts_num(x):
    return f"{x:.4f}"


def main():
    gate_ok = run_recon_gate()

    print("=" * 72)
    print("TIER 1 / TIER 2 oligo set  (Biopython DNA_NN3  vs  primer3 santalucia)")
    print("oligo conc = 250 nM total, Na = 50 mM, unless noted")
    print("=" * 72)
    print(f"{'id':22s} {'len':>3} {'bio_Tm':>9} {'p3_Tm':>9} {'delta':>7}  note")
    deltas = []
    for oid, seq, _gc, note in OLIGOS:
        bio = biopython_tm(seq, oligo_nm=250, na=50)
        p3 = primer3_tm(seq, oligo_nm=250, na=50)
        d = bio - p3
        deltas.append(d)
        print(f"{oid:22s} {len(seq):>3} {bio:9.4f} {p3:9.4f} {d:7.3f}  {note}")

    print("\n-- self-complementary (selfComplementary=True; primer3 has no selfcomp flag) --")
    for oid, seq, note in TRUE_PALINDROMES:
        assert seq == _rc(seq), f"{oid} {seq} is NOT a palindrome"
        bio = biopython_tm(seq, oligo_nm=250, na=50, selfcomp=True)
        # primer3 has no selfcomp option; report its default for context only
        p3 = primer3_tm(seq, oligo_nm=250, na=50)
        print(f"{oid:22s} {len(seq):>3} {bio:9.4f} {p3:9.4f} {'--':>7}  {note} (p3 not selfcomp-aware)")

    print("\n-- parameter-variation cases on", PARAM_OLIGO, "--")
    for cid, kw, note in PARAM_CASES:
        bio = biopython_tm(PARAM_OLIGO, **kw)
        p3 = primer3_tm(PARAM_OLIGO, **kw)
        d = bio - p3
        deltas.append(d)
        print(f"{cid:22s} {len(PARAM_OLIGO):>3} {bio:9.4f} {p3:9.4f} {d:7.3f}  {note}")

    mean_d = sum(deltas) / len(deltas)
    max_abs = max(abs(d) for d in deltas)
    print("\nTIER-2 (primer3) delta summary over non-selfcomp cases:")
    print(f"  mean(bio - primer3) = {mean_d:+.3f} C   max|delta| = {max_abs:.3f} C")
    print("  EXPECTED: a systematic offset (different NN table + salt model), NOT a bug.")

    # ----- machine-readable block for copying into the TS fixtures -----
    print("\n" + "=" * 72)
    print("FIXTURE VALUES (copy into tm-nn.golden.test.ts)")
    print("=" * 72)
    print("// --- Tier 1: Biopython Tm_NN, DNA_NN3, saltcorr=5, dnac1=dnac2=oligo/2 ---")
    for oid, seq, _gc, note in OLIGOS:
        bio = biopython_tm(seq, oligo_nm=250, na=50)
        print(f'  {{ id: "{oid}", seq: "{seq}", oligoNanomolar: 250, na: 50, bioTm: {fmt_ts_num(bio)} }},  // {note}')
    for oid, seq, note in TRUE_PALINDROMES:
        bio = biopython_tm(seq, oligo_nm=250, na=50, selfcomp=True)
        print(f'  {{ id: "{oid}", seq: "{seq}", oligoNanomolar: 250, na: 50, selfComplementary: true, bioTm: {fmt_ts_num(bio)} }},  // {note}')
    print("  // param-variation:")
    for cid, kw, note in PARAM_CASES:
        bio = biopython_tm(PARAM_OLIGO, **kw)
        opts = ", ".join(f"{k}: {v}" for k, v in kw.items())
        print(f'  {{ id: "{cid}", seq: PARAM_SEQ, {opts}, bioTm: {fmt_ts_num(bio)} }},  // {note}')
    print("\n// --- Tier 2: primer3 calc_tm, santalucia/santalucia ---")
    for oid, seq, _gc, note in OLIGOS:
        p3 = primer3_tm(seq, oligo_nm=250, na=50)
        print(f'  {{ id: "{oid}", p3Tm: {fmt_ts_num(p3)} }},')
    for cid, kw, note in PARAM_CASES:
        p3 = primer3_tm(PARAM_OLIGO, **kw)
        print(f'  {{ id: "{cid}", p3Tm: {fmt_ts_num(p3)} }},')

    if not gate_ok:
        raise SystemExit("RECONCILIATION GATE FAILED")


if __name__ == "__main__":
    main()
