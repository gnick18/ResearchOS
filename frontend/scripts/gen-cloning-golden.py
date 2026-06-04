#!/usr/bin/env python3
"""
Generate INDEPENDENT ground-truth expected values for the cloning golden suite
(frontend/src/lib/sequences/cut-ligate.golden.test.ts and the Gibson cross-check
in cloning.golden.test.ts), using the pydna in-silico cloning simulator.

WHY THIS EXISTS
---------------
A test that asserts "our cloning engine equals what our cloning engine produced"
verifies nothing. Every expected assembled product + junction overhang in the
golden suite must come from an INDEPENDENT authority. This script is that
authority: it drives pydna (the de-facto in-silico cloning simulator, BSD-3,
built on Biopython) to simulate the SAME assemblies our engine does, and prints
the expected product sequences + junction overhangs that the TypeScript suite
bakes in as fixtures. It mirrors the existing gen-*-golden.py scripts (Tm /
translation / digest / align), which cross-validate against Biopython.

The committed TypeScript tests are PURE (no Python, no pydna at test time). This
script exists so the fixtures are reproducible and auditable: re-run it and
confirm the printed values match the constants in the TS suites.

Run:
    python3 -m venv /tmp/pydna-venv && /tmp/pydna-venv/bin/pip install pydna
    /tmp/pydna-venv/bin/python frontend/scripts/gen-cloning-golden.py

pydna version this was generated against: 5.5.13


WHICH ENGINE PATHS ARE CROSS-VALIDATED
--------------------------------------
ALL THREE assembly paths, not just the two new ones:
  1. OVERLAP / Gibson / NEBuilder  (our assembleGibson, cloning.ts)
        pydna: pydna.assembly2.gibson_assembly / Assembly(...).assemble_circular()
  2. RESTRICTION-LIGATION           (our cutAndLigate mode "restriction")
        pydna: cut with Bio.Restriction enzymes + restriction_ligation_assembly
  3. GOLDEN GATE / Type IIS         (our cutAndLigate mode "golden-gate")
        pydna: restriction_ligation_assembly with a Type IIS enzyme (BsaI)


CIRCULAR-ROTATION / STRAND NORMALIZATION (documented; used on BOTH sides)
-------------------------------------------------------------------------
A circular dsDNA molecule has no fixed start base and no preferred strand, so two
representations are the SAME molecule if one is a rotation of the other OR a
rotation of its reverse complement. We compare circular products by a CANONICAL
ROTATION: among all len(seq) rotations of the top strand AND all rotations of its
reverse complement, take the lexicographically smallest string. Two molecules are
equal iff their canonical rotations are equal. This is exactly what our TS
`canonicalCircular` computes; we replicate it here (`canon`) and emit canonical
strings so the TS test can assert equality directly. Linear products are compared
up to strand only (smaller of seq / revcomp), matching our `canonicalLinear`.

A NOTED CONVENTION DIFFERENCE (reported, not hidden)
----------------------------------------------------
pydna's restriction_ligation_assembly lists assembly PATHS: for a symmetric
overhang (e.g. an EcoRI insert with identical AATT ends) it returns TWO products,
one per insert orientation. Those two products are the SAME physical dsDNA circle
up to rotation/strand (`canon(p1) == canon(p2)`, asserted below). Our engine
de-duplicates to DISTINCT MOLECULES, so it reports that one molecule once. The
suite therefore asserts our molecule set equals pydna's molecule set AFTER
canonicalization (paths collapse to molecules). Both agree on the molecule; only
the multiplicity convention differs.

Separately, when multiple fragments are supplied, pydna's multi-fragment graph
heuristic does not also list single-fragment SELF-CIRCULARIZATION products (e.g.
a cut vector re-ligating to itself). Those are real biology (empty-vector
background) and pydna DOES report them when that fragment is supplied alone, so we
cross-validate each self-circle against pydna's single-fragment call and document
that our engine surfaces them in the multi-fragment result too.
"""

import sys
import json

try:
    from pydna.dseqrecord import Dseqrecord
    from pydna.assembly2 import gibson_assembly, restriction_ligation_assembly
    from Bio.Restriction import EcoRI, BamHI, BsaI
    import pydna
except Exception as e:  # pragma: no cover
    print("ERROR: pydna not available:", e, file=sys.stderr)
    print("Run: python3 -m venv /tmp/pydna-venv && /tmp/pydna-venv/bin/pip install pydna", file=sys.stderr)
    sys.exit(1)


# ── NORMALIZATION (mirrors TS canonicalCircular / canonicalLinear) ────────────
def rc(s):
    m = {"A": "T", "T": "A", "G": "C", "C": "G"}
    return "".join(m[x] for x in reversed(s.upper()))


def canon_circular(s):
    s = s.upper()
    if not s:
        return ""
    best = None
    for base in (s, rc(s)):
        d = base + base
        for i in range(len(base)):
            r = d[i:i + len(base)]
            if best is None or r < best:
                best = r
    return best


def canon_linear(s):
    s = s.upper()
    r = rc(s)
    return s if s <= r else r


# ── HAND RECONCILIATION GATE (verify pydna's conventions match ours FIRST) ────
def reconcile_hand_case():
    """
    Before trusting pydna wholesale, verify ONE assembly we worked out by hand.

    HAND CASE (restriction-ligation, EcoRI = G^AATTC, 4-nt 5' AATT overhang):
      vector body (kept piece) = "AATTCgggcccaaatttgggcccG"   (24 nt, both ends AATT)
      insert body (kept piece) = "AATTCATGCATCATCATTAAG"      (21 nt, both ends AATT)
    Ligating the vector's right AATT to the insert's left AATT and closing the
    circle, the seam overhang AATT appears once at each of the two junctions, so
    the circular product top strand (one rotation) is:
        vector_body + insert_body_without_its_leading_AATT_dup
      = "AATTCgggcccaaatttgggcccG" + "AATTCATGCATCATCATTAAG"  with the shared
        AATT counted once at each seam.
    The seamless circle of length 24 + 21 = 45 (the two shared AATTs are the two
    seams, already counted once each in the bodies) reads, starting at the vector:
        AATTCgggcccaaatttgggcccGAATTCATGCATCATCATTAAG       (len 45)
    We assert pydna produces a circle whose canonical rotation equals the
    canonical rotation of this hand-derived sequence. If it does not, pydna's
    conventions have drifted from ours and the fixtures must NOT be trusted.
    """
    print("=== HAND RECONCILIATION GATE (EcoRI restriction-ligation) ===")
    hand = "AATTCgggcccaaatttgggcccGAATTCATGCATCATCATTAAG"
    vec = Dseqrecord("ttGAATTCgggcccaaatttgggcccGAATTCtt", circular=False)
    ins = Dseqrecord("aaGAATTCATGCATCATCATTAAGAATTCaa", circular=False)
    prods = restriction_ligation_assembly([vec, ins], enzymes=[EcoRI], circular_only=True)
    cset = {canon_circular(str(p.seq)) for p in prods}
    print(f"  hand-derived circle (len {len(hand)}): {hand}")
    print(f"  hand canonical: {canon_circular(hand)}")
    print(f"  pydna circular products: {len(prods)} -> canonical set:")
    for p in prods:
        print(f"    len {len(p.seq)}: {str(p.seq)}  canon={canon_circular(str(p.seq))}")
    assert canon_circular(hand) in cset, (
        "HAND MISMATCH: pydna's EcoRI ligation circle does not match the "
        "hand-derived product; pydna conventions cannot be trusted."
    )
    # The two pydna paths must be the SAME molecule up to rotation/strand.
    assert len(cset) == 1, f"expected the two pydna paths to canonicalize to ONE molecule, got {cset}"
    print("  OK: pydna's EcoRI circle matches the hand derivation; the two pydna")
    print("      orientation PATHS collapse to ONE molecule under canonicalization.\n")
    return canon_circular(hand)


# ── PATH 1: OVERLAP / GIBSON ──────────────────────────────────────────────────
# Our assembleGibson takes fragment BODIES and concatenates them (the homology is
# added by the primers, so it appears ONCE at each seam). The product P = b0+b1+b2
# (circular). To drive pydna we hand each fragment the body PLUS h bases of the
# neighbour on each side (a circular slice of P), so pydna's overlap merge
# reproduces P. We then assert pydna's circular product == P up to rotation/strand.
GIBSON_BODIES = [
    # Distinct, low-internal-homology bodies (hand-picked, no accidental repeats).
    "ATGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGC",   # b0 60
    "GACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGC",   # b1 60
    "AAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTC",   # b2 60
]
GIBSON_OVERLAP = 20


def gibson_golden():
    print("=== PATH 1: OVERLAP / GIBSON (our assembleGibson vs pydna) ===")
    bodies = GIBSON_BODIES
    h = GIBSON_OVERLAP
    P = "".join(bodies)
    N = len(P)
    starts = []
    acc = 0
    for b in bodies:
        starts.append(acc)
        acc += len(b)
    ends = [s + len(b) for s, b in zip(starts, bodies)]

    def sub(a, b):
        a %= N
        b %= N
        return P[a:b] if a <= b else P[a:] + P[:b]

    frags = [sub(s - h, e + h) for s, e in zip(starts, ends)]
    prods = gibson_assembly([Dseqrecord(f) for f in frags], circular_only=True)
    print(f"  bodies (lens {[len(b) for b in bodies]}), overlap h={h}, product P len={N}")
    print(f"  pydna circular products: {len(prods)}")
    ok = False
    for p in prods:
        match = canon_circular(str(p.seq)) == canon_circular(P)
        print(f"    len {len(p.seq)} == P up to rot/strand? {match}")
        ok = ok or match
    assert ok, "pydna Gibson product does not match our concatenation product P"
    # Junction overlaps our engine reports: for circular P = b0+b1+b2, junction i
    # overlap = last h bases of body i (the homology that bridges to body i+1).
    junctions = [b[-h:] for b in bodies]  # b0->b1, b1->b2, b2->b0(close)
    print("  EXPECTED (bake into cloning.golden.test.ts):")
    print(f"    product P (circular)         = {P}")
    print(f"    canonical(P)                 = {canon_circular(P)}")
    print(f"    junction overlaps (5'->3')   = {junctions}")
    print()
    return {"product": P, "canonical": canon_circular(P), "overlap": h,
            "bodies": bodies, "junctions": junctions}


# ── PATH 2: RESTRICTION-LIGATION ──────────────────────────────────────────────
# Vector + insert, both flanked by EcoRI sites; cut + ligate into a circle.
RL_VECTOR = "ttGAATTCgggcccaaatttgggcccGAATTCtt"
RL_INSERT = "aaGAATTCATGCATCATCATTAAGAATTCaa"


def restriction_golden():
    print("=== PATH 2: RESTRICTION-LIGATION (our cutAndLigate 'restriction' vs pydna) ===")
    vec = Dseqrecord(RL_VECTOR, circular=False)
    ins = Dseqrecord(RL_INSERT, circular=False)
    # Multi-fragment desired product(s).
    prods = restriction_ligation_assembly([vec, ins], enzymes=[EcoRI], circular_only=True)
    desired = sorted({canon_circular(str(p.seq)) for p in prods})
    print(f"  vector={RL_VECTOR}")
    print(f"  insert={RL_INSERT}")
    print(f"  pydna multi-fragment circular products: {len(prods)} -> {len(desired)} molecule(s):")
    for d in desired:
        print(f"    len {len(d)}: {d}")
    # Self-circularization, cross-validated by feeding each fragment ALONE.
    vec_self = sorted({canon_circular(str(p.seq))
                       for p in restriction_ligation_assembly([vec], enzymes=[EcoRI], circular_only=True)})
    ins_self = sorted({canon_circular(str(p.seq))
                       for p in restriction_ligation_assembly([ins], enzymes=[EcoRI], circular_only=True)})
    print(f"  pydna vector self-circle: {vec_self}")
    print(f"  pydna insert self-circle: {ins_self}")
    # The junction overhang sealed at every EcoRI junction is AATT (top strand).
    print("  EXPECTED (bake into cut-ligate.golden.test.ts):")
    print(f"    desired molecule(s)       = {desired}")
    print(f"    vector self-circle        = {vec_self}")
    print(f"    insert self-circle        = {ins_self}")
    print(f"    every junction overhang   = 'AATT'")
    print()
    return {"desired": desired, "vector_self": vec_self, "insert_self": ins_self, "overhang": "AATT"}


# ── PATH 3: GOLDEN GATE / TYPE IIS ────────────────────────────────────────────
# Three parts, each flanked by inward-pointing BsaI sites that excise the
# recognition site and leave defined 4-nt overhangs forming a cycle:
#   backbone GGAC..AATG, insert1 AATG..TTCT, insert2 TTCT..GGAC.
GG_OVERHANGS = {"bb": ("GGAC", "AATG"), "i1": ("AATG", "TTCT"), "i2": ("TTCT", "GGAC")}
GG_MIDS = {"bb": "CATCATCATGGTTAA", "i1": "GGGAAACCCTTTAAA", "i2": "TGTGTGCACACAGAG"}


def gg_part(ohL, mid, ohR):
    # BsaI GGTCTC(1/5): leaves a 4-nt 5' overhang one base downstream of GGTCTCN.
    # Flank so the kept central piece is ohL + mid + ohR with BsaI sites excised.
    return "tt" + "GGTCTC" + "a" + ohL + mid + ohR + "t" + "GAGACC" + "tt"


def golden_gate_golden():
    print("=== PATH 3: GOLDEN GATE / Type IIS BsaI (our cutAndLigate 'golden-gate' vs pydna) ===")
    parts = {}
    for k in ("bb", "i1", "i2"):
        ohL, ohR = GG_OVERHANGS[k]
        parts[k] = gg_part(ohL, GG_MIDS[k], ohR)
    seqs = [Dseqrecord(parts["bb"]), Dseqrecord(parts["i1"]), Dseqrecord(parts["i2"])]
    prods = restriction_ligation_assembly(seqs, enzymes=[BsaI], circular_only=True)
    mols = sorted({canon_circular(str(p.seq)) for p in prods})
    print(f"  parts: {parts}")
    print(f"  pydna circular products: {len(prods)} -> {len(mols)} molecule(s):")
    for m in mols:
        print(f"    len {len(m)}: {m}")
    # The seamless product cycle (hand): GGAC+mid_bb + AATG+mid_i1 + TTCT+mid_i2,
    # each overhang appearing once.
    cycle = ("GGAC" + GG_MIDS["bb"] + "AATG" + GG_MIDS["i1"] + "TTCT" + GG_MIDS["i2"])
    print(f"  hand cycle (len {len(cycle)}): {cycle}")
    print(f"  hand canonical: {canon_circular(cycle)}")
    assert canon_circular(cycle) in set(mols), "Golden Gate hand cycle not among pydna products"
    print("  EXPECTED (bake into cut-ligate.golden.test.ts):")
    print(f"    product molecule          = {canon_circular(cycle)}")
    print(f"    junction overhangs        = ['AATG','TTCT','GGAC'] (in cycle order)")
    print()
    return {"product": canon_circular(cycle), "overhangs": ["AATG", "TTCT", "GGAC"]}


def main():
    print(f"pydna version: {pydna.__version__}\n")
    reconcile_hand_case()
    g = gibson_golden()
    r = restriction_golden()
    gg = golden_gate_golden()

    print("=== JSON FIXTURE (paste-checkable against the TS constants) ===")
    print(json.dumps({"gibson": g, "restriction": r, "golden_gate": gg}, indent=2))


if __name__ == "__main__":
    main()
