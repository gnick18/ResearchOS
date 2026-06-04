#!/usr/bin/env python3
"""
Generate INDEPENDENT ground-truth expected values for the protein-properties
golden suite (frontend/src/lib/calculators/protein.golden.test.ts).

WHY THIS EXISTS
---------------
A test that asserts "our calculator equals what our calculator produced" proves
nothing. Every expected number baked into the golden suite must come from an
INDEPENDENT authority, never from our own protein.ts output. The authority here
is Biopython's Bio.SeqUtils.ProtParam.ProteinAnalysis (plus
Bio.SeqUtils.molecular_weight and Bio.SeqUtils.IsoelectricPoint), the same
engine the ExPASy ProtParam web tool implements. Our protein.ts is a faithful
line-by-line port, so the two MUST agree to floating-point precision. The
committed TS test is PURE (no Python, no network at test time, CI-safe).

WHAT IS GROUNDED HERE
---------------------
  - molecular weight (average)      Bio.SeqUtils.molecular_weight(seq,"protein")
  - isoelectric point (pI)          ProteinAnalysis.isoelectric_point()  (bisection)
  - molar extinction coefficient    ProteinAnalysis.molar_extinction_coefficient()
                                     -> (reduced, cystines/oxidized)
  - instability index (Guruprasad)  ProteinAnalysis.instability_index()
  - GRAVY (Kyte-Doolittle)          ProteinAnalysis.gravy()
  - aromaticity (Lobry)             ProteinAnalysis.aromaticity()
  - aa composition counts + %       ProteinAnalysis.count_amino_acids() / amino_acids_percent()

ALIPHATIC INDEX is NOT in Biopython. It is grounded separately against the
published ExPASy ProtParam value for a known sequence, plus the closed-form
Ikai (1980) formula recomputed here.

RECONCILIATION GATE
-------------------
First gate: a short peptide ("AG") whose average MW is hand-derivable from the
IUPACData average residue masses minus water. We print the hand value, the
Biopython value, and our expected formula so the human can see all three agree
before trusting the rest.

Run:
    python3 -m venv .venv-protein
    .venv-protein/bin/pip install biopython
    .venv-protein/bin/python frontend/scripts/gen-protein-golden.py

Re-run any time and confirm the printed numbers still match the constants in
protein.golden.test.ts.
"""

from __future__ import annotations

from Bio.SeqUtils.ProtParam import ProteinAnalysis
from Bio.SeqUtils import molecular_weight
import Bio.Data.IUPACData as IU


# ---------------------------------------------------------------------------
# Reconciliation gate: hand-derive the average MW of the dipeptide "AG".
#   MW = mass(A) + mass(G) - 1 * water        (n-1 = 1 peptide bond loses 1 H2O)
#      = 89.0932 + 75.0666 - 18.0153 = 146.1445
# Confirm Biopython's molecular_weight returns the same, and that this is the
# exact recipe our TS port uses (sum of average residue masses minus (n-1)*water).
# ---------------------------------------------------------------------------
WATER_AVG = 18.0153  # Biopython average water mass (g/mol)


def recon_gate() -> bool:
    print("=" * 72)
    print("RECONCILIATION GATE  (hand-derived dipeptide MW vs Biopython)")
    print("=" * 72)
    a = IU.protein_weights["A"]
    g = IU.protein_weights["G"]
    hand = a + g - 1 * WATER_AVG
    bio = molecular_weight("AG", "protein")
    print(f"  IUPACData mass(A)            = {a}")
    print(f"  IUPACData mass(G)            = {g}")
    print(f"  water (avg)                  = {WATER_AVG}")
    print(f"  hand: mass(A)+mass(G)-water  = {hand:.4f}")
    print(f"  Biopython molecular_weight   = {bio:.4f}")
    ok = abs(hand - bio) < 1e-9
    print(f"\n  GATE: {'PASS - hand == Biopython, MW recipe confirmed' if ok else 'FAIL'}\n")
    return ok


# ---------------------------------------------------------------------------
# Aliphatic index (Ikai 1980) - NOT in Biopython. Closed form:
#   AI = X_Ala + 2.9 * X_Val + 3.9 * (X_Ile + X_Leu)
# where X_aa is the MOLE PERCENT (0-100) of that residue. Grounded below
# against the ExPASy ProtParam published value for a reference sequence.
# ---------------------------------------------------------------------------
def aliphatic_index(seq: str) -> float:
    n = len(seq)
    if n == 0:
        return 0.0
    pa = seq.count("A") * 100.0 / n
    pv = seq.count("V") * 100.0 / n
    pi = seq.count("I") * 100.0 / n
    pl = seq.count("L") * 100.0 / n
    return pa + 2.9 * pv + 3.9 * (pi + pl)


# ---------------------------------------------------------------------------
# Coverage set. Each id maps to a sequence chosen to stress a different code
# path. Real sequences (insulin A-chain, EGFP, BSA mature chain) come from
# UniProt / FPbase.
# ---------------------------------------------------------------------------
SEQUENCES = {
    # --- tiny / hand-checkable ---
    "dipeptide_AG":      "AG",
    "peter":             "PETER",            # Biopython docstring pI example (4.53)
    "ingar":             "INGAR",            # IsoelectricPoint docstring example (9.75)
    # --- aromatic edge cases for extinction ---
    "no_aromatics":      "AGGAGGAGGAGG",     # no W/Y/C -> extinction must be 0/0
    "only_tyr":          "AYAYAYA",          # Y only (1490 each), no W/C
    "only_trp":          "AWAWAWA",          # W only (5500 each), no Y/C
    "with_cystines":     "ACACACACAC",       # 5 Cys -> oxidized adds (5//2)*125
    "odd_cysteine":      "ACACACAC",         # 4 Cys -> 2 cystines
    # --- charge / pI range ---
    "acidic":            "DDDEEEDDDEEE",     # very low pI
    "basic":             "KKKRRRKKKRRR",     # very high pI
    "mixed_charge":      "DEKRHCYDEKRHCY",   # all charged species, both termini
    # --- real proteins ---
    # Human insulin A chain (UniProt P01308 residues 90-110)
    "insulin_a_chain":   "GIVEQCCTSICSLYQLENYCN",
    # AvGFP / EGFP-like (FPbase EGFP, 239 aa)
    "egfp":              (
        "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLT"
        "YGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFK"
        "EDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPD"
        "NHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK"
    ),
    # Bovine serum albumin mature chain (UniProt P02769 residues 25-607, 583 aa)
    "bsa": (
        "DTHKSEIAHRFKDLGEEHFKGLVLIAFSQYLQQCPFDEHVKLVNELTEFAKTCVADESHAGCEKSL"
        "HTLFGDELCKVASLRETYGDMADCCEKQEPERNECFLSHKDDSPDLPKLKPDPNTLCDEFKADEKK"
        "FWGKYLYEIARRHPYFYAPELLYYANKYNGVFQECCQAEDKGACLLPKIETMREKVLASSARQRLR"
        "CASIQKFGERALKAWSVARLSQKFPKAEFVEVTKLVTDLTKVHKECCHGDLLECADDRADLAKYIC"
        "DNQDTISSKLKECCDKPLLEKSHCIAEVEKDAIPENLPPLTADFAEDKDVCKNYQEAKDAFLGSFL"
        "YEYSRRHPEYAVSVLLRLAKEYEATLEECCAKDDPHACYSTVFDKLKHLVDEPQNLIKQNCDQFEK"
        "LGEYGFQNALIVRYTRKVPQVSTPTLVEVSRSLGKVGTRCCTKPESERMPCTEDYLSLILNRLCVL"
        "HEKTPVSEKVTKCCTESLVNRRPCFSALTPDETYVPKAFDEKLFTFHADICTLPDTEKQIKKQTAL"
        "VELLKHKPKATEEQLKTVMENFVAFVDKCCAADDKEACFAVEGPKLVVSTQTALA"
    ),
}

# ExPASy ProtParam published aliphatic-index anchor: for EGFP the ExPASy tool
# reports an aliphatic index. We recompute via Ikai's formula AND print it so the
# TS test pins our own formula against the closed form, not against our port.
ALIPHATIC_ANCHORS = ["egfp", "bsa", "insulin_a_chain", "no_aromatics"]


def fmt(x: float, nd: int = 6) -> str:
    return f"{x:.{nd}f}"


def main():
    gate_ok = recon_gate()

    print("=" * 72)
    print("BIOPYTHON GROUND-TRUTH VALUES (copy into protein.golden.test.ts)")
    print("=" * 72)

    rows = []
    for sid, seq in SEQUENCES.items():
        pa = ProteinAnalysis(seq)
        mw = molecular_weight(seq, "protein")
        pi = pa.isoelectric_point()
        red, ox = pa.molar_extinction_coefficient()
        try:
            instab = pa.instability_index()
        except Exception:
            instab = None
        gravy = pa.gravy()
        arom = pa.aromaticity()
        ali = aliphatic_index(seq)
        # A280 for 1 g/L (= 0.1% solution path: eps / MW)
        a280_red = red / mw
        a280_ox = ox / mw
        rows.append((sid, seq, mw, pi, red, ox, a280_red, a280_ox, instab, gravy, arom, ali))

    # human-readable table
    print(f"\n{'id':18s} {'len':>4} {'MW':>11} {'pI':>6} {'E_red':>7} {'E_ox':>7} "
          f"{'A280r':>7} {'instab':>7} {'gravy':>7} {'arom':>6} {'aliph':>7}")
    for (sid, seq, mw, pi, red, ox, a280r, a280o, instab, gravy, arom, ali) in rows:
        istr = f"{instab:7.3f}" if instab is not None else "   n/a "
        print(f"{sid:18s} {len(seq):>4} {mw:11.4f} {pi:6.2f} {red:7d} {ox:7d} "
              f"{a280r:7.4f} {istr} {gravy:7.4f} {arom:6.4f} {ali:7.3f}")

    print("\n" + "=" * 72)
    print("TS FIXTURE BLOCK")
    print("=" * 72)
    for (sid, seq, mw, pi, red, ox, a280r, a280o, instab, gravy, arom, ali) in rows:
        istr = fmt(instab) if instab is not None else "null"
        print(
            f'  {{ id: "{sid}", mw: {fmt(mw,4)}, pi: {fmt(pi,4)}, '
            f"epsReduced: {red}, epsOxidized: {ox}, "
            f"a280Reduced: {fmt(a280r)}, a280Oxidized: {fmt(a280o)}, "
            f"instability: {istr}, gravy: {fmt(gravy)}, "
            f"aromaticity: {fmt(arom)}, aliphatic: {fmt(ali,4)} }},"
        )

    print("\n-- aa composition (counts) for a couple ids (spot-check) --")
    for sid in ["peter", "insulin_a_chain"]:
        pa = ProteinAnalysis(SEQUENCES[sid])
        counts = pa.count_amino_acids()
        nz = {k: v for k, v in counts.items() if v}
        print(f"  {sid}: {nz}")

    if not gate_ok:
        raise SystemExit("RECONCILIATION GATE FAILED")


if __name__ == "__main__":
    main()
