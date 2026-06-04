#!/usr/bin/env python3
"""
Generate INDEPENDENT ground-truth expected values for the restriction-digest
golden suite (frontend/src/lib/sequences/digest.golden.test.ts).

WHY THIS EXISTS
---------------
A test that asserts "our digest equals what our digest produced" verifies
nothing. Every expected cut position / fragment length in the golden suite must
come from an INDEPENDENT authority. This script is that authority: it runs
Biopython's Bio.Restriction (a widely-used, independent reference) for each
test sequence + enzyme and prints the reference cut positions + fragment
lengths, already mapped into OUR digest's index convention. Those numbers are
then baked into the TypeScript suite as fixtures.

The committed TypeScript test is PURE (no Python, no network at test time).
This script exists only so the fixtures are reproducible and auditable: re-run
it and confirm the printed numbers match the constants in digest.golden.test.ts.

Run:
    python3 -m venv /tmp/digest-venv && /tmp/digest-venv/bin/pip install biopython
    /tmp/digest-venv/bin/python frontend/scripts/gen-digest-golden.py


THE CUT-POSITION CONVENTION (reconciled by hand, then verified below)
---------------------------------------------------------------------
OUR digest (frontend/src/vendor/seqviz/digest.ts) reports, per cut, an `fcut`
field defined as the TOP-STRAND cut bond position expressed as a 0-BASED count
of bases LEFT of the bond. Concretely, for a recognition site starting at
0-based index `i`, `fcut = i + enzyme.fcut`, where `enzyme.fcut` is the
top-strand cut offset stored in the SeqViz dataset. (Our digest then takes
`fcut % seqLength` so circular wraps fold back into [0, len).)

Worked hand case (EcoRI, G^AATTC, dataset fcut=1):
    seq = AAAGAATTCAAA
              ^ recognition GAATTC starts at 0-based index 3
    top strand cut is  G^AATTC  ->  the bond sits after the G,
    i.e. after 3+1 = 4 bases from the 5' end.
    => OUR fcut for this cut = 4.

Biopython `Enzyme.search(seq, linear=...)` returns cut positions as the 1-BASED
index of the first base to the RIGHT of the top-strand cut. For the same case
it returns [5] (the A at 1-based position 5 is the first base after the cut).

    Therefore the mapping is:   our_fcut == biopython_search_pos - 1

This script asserts that mapping on the EcoRI hand case (and effectively on
every case, since all expected `our_fcut` values are produced by subtracting 1
from Biopython's search positions). If the assertion ever fails the convention
has drifted and the fixtures must NOT be trusted.

NOTE on what we cross-validate: OUR `digestEnzymes` returns one cut entry per
strand match (direction +1 / -1), but `fcut` for a palindromic recognition site
is identical on both strands, so the *set of distinct fcut positions* is what we
compare. Biopython collapses to the set of top-strand cut bonds, which is the
same thing. For NON-palindromic sites Biopython still reports the single
top-strand bond per recognition occurrence (on either strand), and our digest's
distinct-fcut set matches that. Fragment lengths are computed from the sorted
distinct cut positions, exactly as our `fragmentSizes` does.
"""

import json
import sys

try:
    from Bio.Seq import Seq
    from Bio import Restriction
    from Bio.Restriction import EcoRI, PstI, KpnI, SmaI, EcoRV, HinfI, BamHI, DraI, NotI, XhoI, HindIII
except Exception as e:  # pragma: no cover
    print("ERROR: biopython not available:", e, file=sys.stderr)
    print("Run: python3 -m venv /tmp/digest-venv && /tmp/digest-venv/bin/pip install biopython", file=sys.stderr)
    sys.exit(1)


# ── OUR DATASET (mirrored from frontend/src/vendor/seqviz/enzymes.ts) ──────────
# rseq = recognition sequence, fcut = top-strand cut offset (0-based) from the
# start of the recognition site, rcut = bottom-strand cut offset. These are the
# exact values read out of the vendored SeqViz dataset for the enzymes the golden
# suite uses. We re-list them here ONLY to run the dataset cross-check against
# Biopython (a divergence is a reportable finding). The committed TS test imports
# the real dataset; it does not use this table.
OUR_DATASET = {
    "EcoRI":   {"rseq": "GAATTC",   "fcut": 1, "rcut": 5},
    "BamHI":   {"rseq": "GGATCC",   "fcut": 1, "rcut": 5},
    "HindIII": {"rseq": "AAGCTT",   "fcut": 1, "rcut": 5},
    "PstI":    {"rseq": "CTGCAG",   "fcut": 5, "rcut": 1},
    "KpnI":    {"rseq": "GGTACC",   "fcut": 5, "rcut": 1},
    "SmaI":    {"rseq": "CCCGGG",   "fcut": 3, "rcut": 3},
    "EcoRV":   {"rseq": "GATATC",   "fcut": 3, "rcut": 3},
    "HinfI":   {"rseq": "GANTC",    "fcut": 1, "rcut": 4},
    "DraI":    {"rseq": "TTTAAA",   "fcut": 3, "rcut": 3},
    "NotI":    {"rseq": "GCGGCCGC", "fcut": 2, "rcut": 6},
    "XhoI":    {"rseq": "CTCGAG",   "fcut": 1, "rcut": 5},
}

# Biopython enzyme objects, keyed by the same display name.
BIO = {
    "EcoRI": EcoRI, "BamHI": BamHI, "HindIII": HindIII, "PstI": PstI,
    "KpnI": KpnI, "SmaI": SmaI, "EcoRV": EcoRV, "HinfI": HinfI,
    "DraI": DraI, "NotI": NotI, "XhoI": XhoI,
}


def bio_recognition(enz):
    """Biopython's recognition site (string) for an enzyme."""
    return str(enz.site).upper()


def bio_fcut_offset(enz):
    """
    Biopython exposes `.fst5` = the top-strand (5') cut offset relative to the
    START of the recognition site (can be negative or > len for cutters that cut
    outside their site). For the palindromic/standard enzymes used here this is
    the same number our dataset stores as `fcut`. Return None if undefined.
    """
    # fst5 is measured from the 5' end of the recognition sequence; it equals our
    # `fcut` offset for the enzymes in this suite.
    return getattr(enz, "fst5", None)


def cross_check_dataset():
    """
    Compare OUR dataset (recognition + cut offset) against Biopython for every
    enzyme the suite uses. A divergence is a real finding, not something to hide.
    Returns (clean_names, divergences).
    """
    divergences = []
    clean = []
    print("=== DATASET CROSS-CHECK (our dataset vs Bio.Restriction) ===")
    for name, ours in OUR_DATASET.items():
        if name not in BIO:
            print(f"  [skip] {name}: not in Biopython table")
            continue
        enz = BIO[name]
        bio_site = bio_recognition(enz)
        our_site = ours["rseq"].upper()
        bio_off = bio_fcut_offset(enz)
        our_off = ours["fcut"]
        site_ok = bio_site == our_site
        off_ok = (bio_off is not None) and (bio_off == our_off)
        status = "OK" if (site_ok and off_ok) else "DIVERGENT"
        print(f"  {name:8s} our=({our_site},fcut={our_off})  bio=({bio_site},fst5={bio_off})  -> {status}")
        if site_ok and off_ok:
            clean.append(name)
        else:
            divergences.append({
                "name": name, "our_site": our_site, "bio_site": bio_site,
                "our_fcut": our_off, "bio_fst5": bio_off,
            })
    if divergences:
        print("  !! DIVERGENCES FOUND (report these, do not bake them):")
        for d in divergences:
            print("    ", d)
    else:
        print("  All checked enzymes agree on recognition + cut offset.")
    print()
    return clean, divergences


def reconcile_hand_case():
    """
    The EcoRI hand case from the module docstring. Confirms
    our_fcut == biopython_pos - 1 BEFORE we trust Biopython wholesale.
    """
    print("=== CUT-CONVENTION RECONCILIATION (EcoRI hand case) ===")
    seq = "AAAGAATTCAAA"
    site_idx = seq.find("GAATTC")            # 3
    our_fcut_hand = site_idx + OUR_DATASET["EcoRI"]["fcut"]  # 3 + 1 = 4
    bio_pos = EcoRI.search(Seq(seq), linear=True)            # [5]
    assert len(bio_pos) == 1, bio_pos
    mapped = bio_pos[0] - 1
    print(f"  seq={seq}  GAATTC@{site_idx}")
    print(f"  our fcut (hand)      = {our_fcut_hand}")
    print(f"  biopython search     = {bio_pos}  -> mapped (pos-1) = {mapped}")
    assert mapped == our_fcut_hand, (
        f"CONVENTION MISMATCH: biopython {mapped} != our {our_fcut_hand}; "
        "fixtures cannot be trusted."
    )
    print("  OK: our_fcut == biopython_search_pos - 1  (verified)\n")


def cuts_and_fragments(enz, seq, circular):
    """
    Run Biopython for one enzyme on one sequence and return:
      - the SET of cut positions in OUR convention (sorted, 0-based bases-left)
      - the sorted-DESCENDING fragment lengths (matching our fragmentSizes:
        circular -> N cuts give N fragments wrapping the origin; linear -> N cuts
        give N+1 fragments with open ends; 0 cuts -> [len]).
    """
    s = Seq(seq)
    n = len(seq)
    bio_positions = enz.search(s, linear=not circular)   # 1-based, first base right of cut
    our_cuts = sorted({(p - 1) % n for p in bio_positions})

    # Fragment lengths, independently recomputed from the cut set (this mirrors
    # what our fragmentSizes does, but the INPUTS (the cut set) are Biopython's).
    if not our_cuts:
        frags = [n] if n > 0 else []
    elif circular:
        frags = []
        for i in range(len(our_cuts)):
            here = our_cuts[i]
            nxt = our_cuts[(i + 1) % len(our_cuts)]
            size = (n - here + nxt) if i == len(our_cuts) - 1 else (nxt - here)
            frags.append(size)
    else:
        frags = [our_cuts[0]]
        for i in range(1, len(our_cuts)):
            frags.append(our_cuts[i] - our_cuts[i - 1])
        frags.append(n - our_cuts[-1])
    frags = sorted((f for f in frags if f > 0), reverse=True)
    return our_cuts, frags


# ── TEST SEQUENCES ─────────────────────────────────────────────────────────────
# Designed by hand. GC-rich spacers avoid accidental AT-rich sites. Each sequence
# is documented with the sites it is meant to contain.

# (1) Multi-cutter linear sequence: EcoRI (GAATTC) x3, BamHI x1, blunt EcoRV x1,
#     and HindIII (AAGCTT) absent (noncutter check).
MULTI = (
    "GGCC" + "GAATTC" + "GCGC" + "GGATCC" + "GCGC" + "GAATTC"
    + "GCGC" + "GATATC" + "GCGC" + "GAATTC" + "GGCC"
)

# (2) Sticky-overhang trio on one linear sequence: EcoRI (5' overhang),
#     PstI (3' overhang), KpnI (3' overhang), SmaI (blunt).
STICKY = (
    "GCGC" + "GAATTC" + "GCGC" + "CTGCAG" + "GCGC" + "GGTACC"
    + "GCGC" + "CCCGGG" + "GCGC"
)

# (3) Degenerate recognition: HinfI G^ANTC. Three sites with N = A, C, G.
DEGEN = "GCGC" + "GAATC" + "GCGC" + "GACTC" + "GCGC" + "GAGTC" + "GCGC"

# (4) Non-palindromic / minus-strand: HinfI (GANTC, non-palindromic). One site is
#     written on the forward strand, another only appears on the reverse strand
#     (i.e. its reverse complement GANTC -> GANTC; we embed GACTC's revcomp GAGTC
#     deliberately on the bottom strand by placing a forward site that is itself
#     non-palindromic). HinfI GANTC revcomp is GANTC pattern too, so to exercise
#     minus-strand handling we use a forward site plus an explicit revcomp motif.
#     We embed the reverse complement of "GAATC" which is "GATTC".
MINUS = "GCGC" + "GAATC" + "GCGCGC" + "GATTC" + "GCGC"

# (5) Circular plasmid where an EcoRI site SPANS THE ORIGIN, plus one internal
#     EcoRI site and one internal BamHI site. The linear string starts with
#     "AATTC..." and ends with "...G", so on the circle the end<->start junction
#     reads ...G|AATTC..., forming GAATTC across the origin.
#       - EcoRI on the circle: TWO cuts (one internal, one origin-spanning).
#         Treated as LINEAR the same string would give only ONE EcoRI cut, which
#         is exactly the linear-vs-circular distinction we want to exercise.
#       - BamHI on the circle: ONE cut (no origin wrap), N=1 -> 1 fragment = full
#         length (circular single-cutter linearises).
#     Verified empirically against Biopython circular=True below.
CIRCULAR = (
    "AATTC" + "GCGCGC" + "GAATTC" + "GCGC" + "GGATCC" + "GCGCG"
)


SEQUENCES = {
    "MULTI": (MULTI, False),
    "STICKY": (STICKY, False),
    "DEGEN": (DEGEN, False),
    "MINUS": (MINUS, False),
    "CIRCULAR": (CIRCULAR, True),
}

# Which enzymes to evaluate against each sequence (only dataset-clean ones).
CASES = [
    ("MULTI", ["EcoRI", "BamHI", "EcoRV", "HindIII"]),  # HindIII = noncutter
    ("STICKY", ["EcoRI", "PstI", "KpnI", "SmaI"]),
    ("DEGEN", ["HinfI"]),
    ("MINUS", ["HinfI"]),
    ("CIRCULAR", ["EcoRI", "BamHI"]),
]


def assert_origin_span():
    """
    Lock the intent of the CIRCULAR fixture: EcoRI must produce MORE cuts when
    the molecule is treated as circular than as linear (i.e. a real
    origin-spanning site exists). If this ever stops holding, the circular case
    no longer tests origin wrap and must be redesigned.
    """
    print("=== CIRCULAR ORIGIN-SPAN INTENT CHECK ===")
    seq, _ = SEQUENCES["CIRCULAR"]
    lin = EcoRI.search(Seq(seq), linear=True)
    cir = EcoRI.search(Seq(seq), linear=False)
    print(f"  EcoRI linear cuts={len(lin)} {lin}  circular cuts={len(cir)} {cir}")
    assert len(cir) > len(lin), (
        "CIRCULAR fixture no longer has an origin-spanning EcoRI site; redesign it."
    )
    print("  OK: circular digest gains an origin-spanning cut over linear.\n")


def main():
    reconcile_hand_case()
    assert_origin_span()
    clean, divergences = cross_check_dataset()

    print("=== TEST SEQUENCES ===")
    for name, (seq, circ) in SEQUENCES.items():
        print(f"  {name}: len={len(seq)} circular={circ}")
        print(f"    {seq}")
    print()

    print("=== EXPECTED VALUES (Biopython, mapped to our convention) ===")
    fixtures = {}
    for seq_name, enzymes in CASES:
        seq, circ = SEQUENCES[seq_name]
        fixtures[seq_name] = {"seq": seq, "circular": circ, "enzymes": {}}
        for ename in enzymes:
            if ename not in clean:
                print(f"  [SKIP {seq_name}/{ename}] enzyme not dataset-clean")
                continue
            enz = BIO[ename]
            cuts, frags = cuts_and_fragments(enz, seq, circ)
            fixtures[seq_name]["enzymes"][ename] = {"cuts": cuts, "fragments": frags}
            print(f"  {seq_name:9s} {ename:8s} cuts={cuts}  fragments={frags}")
    print()

    print("=== JSON FIXTURE (paste-checkable against the TS constants) ===")
    print(json.dumps(fixtures, indent=2))
    print()

    if divergences:
        print("FINDING: dataset divergences exist (see cross-check above).")
    else:
        print("FINDING: no dataset divergences among the suite enzymes.")


if __name__ == "__main__":
    main()
