#!/usr/bin/env python3
"""
Golden / ground-truth reference generator for the ResearchOS lab calculators.

Every expected value in calculators.golden.test.ts comes from an INDEPENDENT
oracle, never from our own TypeScript calculator. This script documents the
provenance of each one and runs reconciliation checks that confirm the oracle's
convention matches ours BEFORE the value is trusted.

Run from frontend/:
    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install biopython
    /tmp/venv/bin/python scripts/gen-calc-golden.py

Quantities our calculators (src/lib/calculators/calculators.ts + units.ts)
actually compute, and the oracle used for each:

  1. Molarity        n = m / MW, C = n / V, m = C * V * MW
                     ORACLE: deterministic algebra, worked by hand. No library
                     needed (pure arithmetic with exact rationals here).
  2. Dilution        C1 * V1 = C2 * V2 (solve any one variable)
                     ORACLE: deterministic algebra, worked by hand.
  3. Serial dilution C_step = C0 / fold^step ; sampleVol = Vf / fold
                     ORACLE: deterministic algebra, worked by hand.
  4. Tm              OWNED BY A SIBLING BOT (tm-nn.golden.test.ts). NOT covered
                     here on purpose.
  5. DNA/RNA conv.   mass<->mole via a CONVENTIONAL rounded average MW per base
                     (dsDNA 650 g/mol/bp, ssDNA & RNA 330 g/mol/nt) and
                     A260 -> ng/uL via conventional factors (50/33/40).
                     ORACLE: the cited textbook/vendor CONVENTION (hand-worked),
                     cross-checked for sanity against Biopython's EXACT
                     sequence-specific molecular_weight() (see reconciliation).
  6. Buffer/recipe   V_stock = (Cfinal * Vtotal) / Cstock (per component)
                     ORACLE: deterministic algebra, worked by hand.
  7. Unit conversion SI prefix factors (nM/uM/mM/M, uL/mL/L, ng/ug/mg/g,
                     pmol/.../mol). ORACLE: SI prefix definitions (exact).

NOTE ON PROTEIN MW / pI / EXTINCTION COEFFICIENT
  The task brief listed protein molecular weight, isoelectric point, and
  extinction coefficient as candidate quantities to cross-validate against
  Biopython ProtParam. A full read of src/lib/calculators/ (calculators.ts,
  scientific.ts, units.ts) shows ResearchOS DOES NOT IMPLEMENT any protein
  ProtParam-style calculator. A repo-wide grep for
  extinction/isoelectric/protparam/ProteinAnalysis returns nothing. There is no
  code to cross-validate, so Biopython.ProtParam is not used here. This is a
  scope finding, reported in the bot summary (not a bug).
"""

from fractions import Fraction
from Bio.SeqUtils import molecular_weight

PASS = "ok"


def approx(a, b, rel=1e-12):
    if b == 0:
        return abs(a) < rel
    return abs(a - b) / abs(b) < rel


def section(title):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


# ---------------------------------------------------------------------------
# Reconciliation 0: SI unit-prefix factors (exact by definition)
# ---------------------------------------------------------------------------
section("Unit prefixes (SI, exact)")
SI = {
    "nM": Fraction(1, 10**9), "uM": Fraction(1, 10**6),
    "mM": Fraction(1, 10**3), "M": Fraction(1),
    "uL": Fraction(1, 10**6), "mL": Fraction(1, 10**3), "L": Fraction(1),
    "ng": Fraction(1, 10**9), "ug": Fraction(1, 10**6),
    "mg": Fraction(1, 10**3), "g": Fraction(1),
    "pmol": Fraction(1, 10**12), "nmol": Fraction(1, 10**9),
    "umol": Fraction(1, 10**6), "mmol": Fraction(1, 10**3), "mol": Fraction(1),
}
for k, v in SI.items():
    print(f"  {k:>5} = {float(v):g} (base)")
print("  -> these are exact SI prefix definitions; our units.ts must match exactly.")


# ---------------------------------------------------------------------------
# Reconciliation 1: Molarity algebra (worked with exact rationals)
# ---------------------------------------------------------------------------
section("Molarity n=m/MW, C=n/V, m=C*V*MW (exact rationals)")

# Case A: 10 mg NaCl, MW 58.44 g/mol -> moles
mass = Fraction(10, 1000)  # 10 mg = 0.01 g
mw = Fraction(5844, 100)   # 58.44
molesA = mass / mw
print(f"  A) 10 mg NaCl / 58.44   moles = {float(molesA):.12g}")

# Case B: make 1 L of 1 M glucose, MW 180.16 -> mass needed
massB = Fraction(1) * Fraction(1) * Fraction(18016, 100)  # C*V*MW
print(f"  B) 1 L of 1 M glucose (180.16) mass = {float(massB):.12g} g")

# Case C: 100 mL of 1 mM NaCl -> mass = 1e-3 * 0.1 * 58.44
massC = Fraction(1, 1000) * Fraction(1, 10) * Fraction(5844, 100)
print(f"  C) 100 mL of 1 mM NaCl mass = {float(massC):.12g} g")

# Case D: 5 nmol of a 6000 Da peptide in 250 uL -> molar
# moles = 5e-9 mol ; vol = 250e-6 L ; C = moles/vol
molesD = Fraction(5, 10**9)
volD = Fraction(250, 10**6)
concD = molesD / volD          # molar
print(f"  D) 5 nmol in 250 uL  conc = {float(concD):.12g} M = {float(concD*1e6):.6g} uM")

# Case E (brief): 10 ug of a 6000 Da protein in 1 mL -> molarity
massE = Fraction(10, 10**6)    # 10 ug = 1e-5 g
mwE = Fraction(6000)
volE = Fraction(1, 1000)       # 1 mL
molesE = massE / mwE
concE = molesE / volE
print(f"  E) 10 ug / 6000 Da in 1 mL  moles = {float(molesE):.12g} mol")
print(f"       conc = {float(concE):.12g} M = {float(concE*1e6):.9g} uM")


# ---------------------------------------------------------------------------
# Reconciliation 2: Dilution C1V1=C2V2 (worked by hand)
# ---------------------------------------------------------------------------
section("Dilution C1*V1=C2*V2")
# 10 uM from 1 mM stock in 1 mL final
c1 = Fraction(1, 1000)   # 1 mM
c2 = Fraction(10, 10**6)  # 10 uM
v2 = Fraction(1, 1000)   # 1 mL
v1 = c2 * v2 / c1        # liters
print(f"  V1 for 10 uM from 1 mM in 1 mL = {float(v1):.12g} L = {float(v1*1e6):g} uL (expect 10 uL)")
print(f"  diluent = {float((v2-v1)*1e6):g} uL (expect 990 uL)")


# ---------------------------------------------------------------------------
# Reconciliation 3: Serial dilution
# ---------------------------------------------------------------------------
section("Serial dilution C_step = C0 / fold^step")
C0, fold, Vf = Fraction(100), Fraction(10), Fraction(1000)  # 100 uM, 10x, 1000 uL
for step in range(1, 4):
    c = C0 / fold**step
    print(f"  step {step}: conc = {float(c):g} uM  sampleVol = {float(Vf/fold):g} uL  diluent = {float(Vf - Vf/fold):g} uL")


# ---------------------------------------------------------------------------
# Reconciliation 4: DNA / RNA conventional MW + A260
# ---------------------------------------------------------------------------
section("DNA/RNA conventional rounded MW per base (our constants)")
# OUR constants (from calculators.ts): dsDNA 650 g/mol/bp, ssDNA 330, RNA 330.
# These are the standard ROUNDED textbook averages used for quick mass<->mole
# estimates (e.g. NEB / Thermo / Promega oligo tools), NOT exact per-sequence MW.
OUR = {"dsDNA": 650, "ssDNA": 330, "RNA": 330}

# Brief reference: 1 ug of 1000 bp dsDNA = 1.54 pmol with the 650 convention.
mass = Fraction(1, 10**6)      # 1 ug
length = 1000
mwTotal = Fraction(length) * Fraction(OUR["dsDNA"])  # 650000 g/mol
moles = mass / mwTotal
pmol = moles * 10**12
print(f"  1 ug of 1000 bp dsDNA (650/bp) = {float(pmol):.6f} pmol (cited ref ~1.54 pmol)")
assert round(float(pmol), 2) == 1.54, "convention check failed"

# Reconciliation against Biopython EXACT molecular_weight (sanity bound only):
seq = "ATCG" * 250                       # 1000 nt, 50% GC
ds_exact = molecular_weight(seq, seq_type="DNA", double_stranded=True)
ss_exact = molecular_weight(seq, seq_type="DNA", double_stranded=False)
rna_exact = molecular_weight("AUCG" * 250, seq_type="RNA", double_stranded=False)
print("  --- Biopython EXACT (50% GC, 1000 nt), for documented-difference context ---")
print(f"    dsDNA exact = {ds_exact/length:.2f} g/mol/bp  vs our 650  (diff {100*(650-ds_exact/length)/(ds_exact/length):+.1f}%)")
print(f"    ssDNA exact = {ss_exact/length:.2f} g/mol/nt  vs our 330  (diff {100*(330-ss_exact/length)/(ss_exact/length):+.1f}%)")
print(f"    RNA   exact = {rna_exact/length:.2f} g/mol/nt  vs our 330  (diff {100*(330-rna_exact/length)/(rna_exact/length):+.1f}%)")
print("    -> our rounded constants sit a few %% above the exact 50%-GC average,")
print("       which is the intended convention (rounds up; absorbs end-groups /")
print("       counterions / GC-content spread). DOCUMENTED DIFFERENCE, not a bug.")
print("       Biopython is therefore NOT the oracle for our mass<->mole numbers;")
print("       the cited 650/330 convention is. Biopython only bounds the sanity.")

section("A260 -> ng/uL conventional factors (our constants)")
# OUR factors: dsDNA 50, ssDNA 33, RNA 40 ng/uL per A260 unit (1 cm path).
# These are the standard spectrophotometry conventions (Beer-Lambert at the
# nucleic-acid average epsilon), used by every NanoDrop-class instrument.
A260 = {"dsDNA": 50, "ssDNA": 33, "RNA": 40}
for kind, f in A260.items():
    print(f"  {kind}: A260=1.0 -> {f} ng/uL ; A260=0.5 @100x -> {0.5*f*100} ng/uL")
print("  -> cited convention (Sambrook & Russell; NanoDrop tech notes).")


# ---------------------------------------------------------------------------
# Reconciliation 5: Buffer/recipe (per-component C1V1=C2V2)
# ---------------------------------------------------------------------------
section("Buffer recipe V_stock = Cfinal*Vtotal/Cstock")
# 1 L total: A 40 mM from 1 M; B 1 mM from 0.5 M
Vtot = Fraction(1)
A = Fraction(40, 1000) * Vtot / Fraction(1)
B = Fraction(1, 1000) * Vtot / Fraction(1, 2)
print(f"  A = {float(A*1000):g} mL ; B = {float(B*1000):g} mL ; diluent = {float((Vtot-A-B)*1000):g} mL")


section("ALL RECONCILIATION CHECKS COMPLETE")
print("  Every expected value above is from an independent oracle:")
print("   - SI prefixes / algebra: exact, computed with Fraction (hand-worked).")
print("   - DNA/RNA MW + A260: cited textbook/vendor CONVENTION (650/330, 50/33/40),")
print("     with Biopython EXACT MW shown as a sanity bound + documented difference.")
print("   - No value taken from the ResearchOS calculator output.")
print("   - Tm intentionally NOT covered (owned by tm-nn.golden.test.ts).")
print("   - Protein MW/pI/extinction: NOT implemented in the codebase (no code to test).")
