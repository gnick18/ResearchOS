#!/usr/bin/env python3
"""
Generate INDEPENDENT ground-truth expected values for the SHARED-REGION (HSP)
finder golden suite (frontend/src/lib/align/local-homology.golden.test.ts).

WHAT IS UNDER TEST
------------------
frontend/src/lib/align/local-homology.ts `findSharedRegions(a, b, opts)` is a
seed-and-chain LOCAL-HOMOLOGY heuristic (BLAST/minimap2 style): index k-mers of
A, seed against both strands of B, chain collinear seeds onto diagonals, then
REFINE each anchor with a BANDED local alignment (it calls the same alignLocal
Smith-Waterman core the rest of the engine uses). It returns ranked HSPs
{ aStart, aEnd, bStart, bEnd, strand, identity, score, alignedA, alignedB, ... }
in 0-based forward coordinates. A reverse HSP (strand -1) carries the
reverse-complemented alignedB and FORWARD-B coordinates of the spanned region.

WHY THIS EXISTS
---------------
A test that asserts "our finder's output equals what our finder produced"
verifies nothing. Every expected coordinate / identity / aligned segment in the
golden suite must come from an INDEPENDENT authority. This script is that
authority: it runs Biopython's Bio.Align.PairwiseAligner in LOCAL (Smith-
Waterman) mode, configured to match our engine's DNA scoring + affine gap model
EXACTLY, over each constructed pair, and prints Biopython's optimal local
alignment (aligned A/B coordinates, aligned segment strings, and % identity).
Those numbers are then baked into the TypeScript suite as fixtures.

The committed TypeScript test is PURE (no Python, no network at test time). This
script exists only so the fixtures are reproducible and auditable: re-run it and
confirm the printed numbers match the constants in the golden test.

Run:
    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install biopython
    /tmp/venv/bin/python frontend/scripts/gen-shared-regions-golden.py

OUR ENGINE'S CONVENTIONS (read from frontend/src/lib/align/)
------------------------------------------------------------
- DNA scoring (dnaScoring): compatible bases +match (default +2), incompatible
  +mismatch (default -1). The fixtures here are PLAIN ACGT only (no IUPAC), so
  "compatible" == "byte-equal", and Biopython's match/mismatch model is exact.
- AFFINE GAP MODEL (Gotoh): a gap of length L costs gapOpen + L*gapExtend (open
  paid ONCE per run, extend paid for EVERY gap cell incl. the first). Defaults
  gapOpen=5, gapExtend=1. findSharedRegions passes these straight into alignLocal.
- The refine is LOCAL (Smith-Waterman): findSharedRegions calls alignLocal over a
  window around each anchor. So Biopython LOCAL mode with matching params is the
  correct oracle for the recovered region.
- Coordinates 0-based half-open. identity = (compatible columns)/(total columns).

RECONCILING OUR GAP MODEL WITH BIOPYTHON (identical derivation as gen-align-golden.py)
-------------------------------------------------------------------------------------
Biopython scores a length-L gap as open_gap_score + (L-1)*extend_gap_score.
Our model scores it as -(gapOpen + L*gapExtend). Setting
    open_gap_score   = -(gapOpen + gapExtend)
    extend_gap_score = -gapExtend
makes Biopython's total = -(gapOpen + L*gapExtend) == ours. QED.
Verified at runtime in reconcile() before any fixture is trusted.

WHY WE ORACLE OVER A REGION WINDOW, NOT THE WHOLE PAIR
------------------------------------------------------
Biopython local alignment over the WHOLE ~10-20kb pair does NOT recover the
planted block: over thousands of bases of random DNA the single optimal local
alignment chains a long run of CHANCE matches spanning the entire sequence
(empirically score ~3000, identity ~0.50 across 10kb) and drowns the real 800bp
block. That is a true property of optimal SW on long random sequence, not a bug.
The MEANINGFUL oracle is "Biopython's optimal local alignment OF THE HOMOLOGOUS
REGION", so for every case we run Biopython local over a WINDOW around the
planted span (padded), exactly as BLAST reports an HSP over its locus. This is
also precisely what our finder does internally (it refines a banded window around
each anchor), so the comparison is apples-to-apples. Window coordinates are
shifted back to whole-sequence coordinates before printing.

COORDINATE / STRAND CONVENTION FOR THE REVERSE CASE
---------------------------------------------------
Our finder, for a strand -1 HSP, reverse-complements B, local-aligns A against
revcomp(B), then maps the revcomp-space span [s, e) back to forward-B coordinates
[len(B) - e, len(B) - s). To reproduce that with Biopython we ALSO align A vs
revcomp(B) in local mode (over the region window), read the optimal aligned span
in revcomp-B space, and map it back to forward-B coordinates with the SAME
formula. The printed bStart/bEnd below are already in FORWARD-B coordinates,
directly comparable to our HSP's bStart/bEnd.

EXPECTED HEURISTIC DIVERGENCES (documented, NOT papered over)
------------------------------------------------------------
Our finder is a HEURISTIC, not guaranteed-optimal global SW over the whole pair:
  * Boundary slop: the banded refine can extend a few bases into a flank on a
    chance match, or trim a base or two at the very edge, so HSP coords may
    differ from Biopython's optimal-local edges by a few bp. The TS test allows a
    small, documented tolerance and asserts the CORE matches.
  * Single best local only: Biopython local returns ONE optimal alignment per
    call. For multi-region pairs we run Biopython ONCE PER REGION WINDOW so each
    region gets its own optimal, then compare to the corresponding HSP.
  * Weak/short HSPs below the finder's minScore are intentionally dropped by the
    finder; we only construct CLEAR homology where the heuristic must agree.
These do NOT excuse a wrong coordinate/identity/strand on a clear region. If the
TS test finds such a disagreement it is reported as a bug, not hidden.

NO expected value in the TS suite comes from our own engine. Every fixture below
is Biopython's, or hand-grounded (the reconciliation gate).
"""

from Bio.Align import PairwiseAligner

# Deterministic pseudo-random DNA generator that MIRRORS the TS test's randomDna
# (same LCG, same 2-bit base extraction). This guarantees the Python-side
# constructed sequences are byte-identical to the ones the TS test builds, so the
# Biopython fixtures line up with what findSharedRegions actually sees. The LCG is
# the classic Numerical Recipes constants; >>> in JS is an unsigned 32-bit shift,
# reproduced here with explicit & 0xFFFFFFFF masking.
BASES = "ACGT"
MASK32 = 0xFFFFFFFF


def random_dna(length, seed):
    state = (seed * 2654435761) & MASK32
    out = []
    for _ in range(length):
        state = (state * 1664525 + 1013904223) & MASK32
        out.append(BASES[(state >> 16) & 3])
    return "".join(out)


def shared_block(length, seed):
    return random_dna(length, seed + 9999)


COMPLEMENT = {"A": "T", "C": "G", "G": "C", "T": "A"}


def revcomp(seq):
    return "".join(COMPLEMENT[c] for c in reversed(seq.upper()))


# ---------------------------------------------------------------------------
# Aligner configured to match our dnaScoring + affine gap model, LOCAL mode.
# ---------------------------------------------------------------------------

def dna_local_aligner(match=2.0, mismatch=-1.0, gap_open=5.0, gap_extend=1.0):
    a = PairwiseAligner()
    a.mode = "local"
    a.match_score = match
    a.mismatch_score = mismatch
    a.open_gap_score = -(gap_open + gap_extend)
    a.extend_gap_score = -gap_extend
    return a


def local_report(aligner, a, b):
    """Run a LOCAL aligner and return a dict describing Biopython's optimum:
    score, the aligned A/B span (0-based half-open) in the coordinate space of
    the strings actually passed, the gapped aligned strings, and % identity
    computed the SAME way our engine does (compatible columns / total columns;
    plain ACGT here, so compatible == equal)."""
    alignments = aligner.align(a, b)
    best = alignments[0]
    aa = str(best[0])
    bb = str(best[1])
    # Aligned coordinate span: best.aligned is ((a_blocks...),(b_blocks...)).
    a_blocks, b_blocks = best.aligned
    a_start = int(a_blocks[0][0])
    a_end = int(a_blocks[-1][1])
    b_start = int(b_blocks[0][0])
    b_end = int(b_blocks[-1][1])
    cols = len(aa)
    matches = sum(1 for i in range(cols) if aa[i] != "-" and bb[i] != "-" and aa[i] == bb[i])
    identity = matches / cols if cols else 0.0
    return {
        "score": best.score,
        "aStart": a_start,
        "aEnd": a_end,
        "bStart": b_start,
        "bEnd": b_end,
        "alignedA": aa,
        "alignedB": bb,
        "identity": identity,
    }


PAD = 0  # window padding around the planted span fed to Biopython


def window_report(aligner, seqA, aLo, aHi, seqB, bLo, bHi):
    """Biopython local-align the WINDOW [aLo-PAD, aHi+PAD) of seqA against the
    WINDOW [bLo-PAD, bHi+PAD) of seqB, then shift the reported aligned span back
    to WHOLE-sequence coordinates. (aLo,aHi)/(bLo,bHi) are the planted span in
    each sequence.

    PAD IS 0 ON PURPOSE. We oracle over EXACTLY the planted span so Biopython's
    optimum IS the pristine homologous region (identity 1.0 for a clean block,
    its true mismatch/indel count for the mutated cases), with NO flank
    contamination. If we padded the window, Biopython's optimal LOCAL alignment
    greedily extends into the random flanks on chance-match runs that net a small
    positive score (empirically: a clean identical 800bp block aligns at score
    1600/identity 1.0 with PAD=0, but at score 1617/identity 0.93/+117 columns
    with PAD=60). That flank-extension is a genuine property of optimal SW, not a
    defect, but it makes a noisy oracle. Our FINDER does the same boundary
    extension on the whole sequence, so the TS test treats Biopython's PAD=0 span
    as the region truth and allows a documented boundary tolerance for the
    finder's extension, asserting the CORE matches exactly."""
    wa0 = max(0, aLo - PAD); wa1 = min(len(seqA), aHi + PAD)
    wb0 = max(0, bLo - PAD); wb1 = min(len(seqB), bHi + PAD)
    rep = local_report(aligner, seqA[wa0:wa1], seqB[wb0:wb1])
    rep["aStart"] += wa0; rep["aEnd"] += wa0
    rep["bStart"] += wb0; rep["bEnd"] += wb0
    return rep


def show(title, rep, extra=None):
    """Compact, parseable print. The aligned strings can be hundreds of bases, so
    print their length + a leading/trailing slice rather than the full block; the
    TS test asserts on coordinates, identity, and a CORE slice it derives the same
    deterministic way, so the full string is not needed verbatim in the fixture."""
    print(f"### {title}")
    for k in ("score", "aStart", "aEnd", "bStart", "bEnd", "identity"):
        print(f"    {k:9s}= {rep[k]}")
    aa = rep["alignedA"]; bb = rep["alignedB"]
    coreA = aa.replace("-", ""); coreB = bb.replace("-", "")
    print(f"    cols     = {len(aa)}  gapCols = {aa.count('-') + bb.count('-')}")
    print(f"    coreA[len={len(coreA)}] head40 = {coreA[:40]}")
    print(f"    coreA           tail40 = {coreA[-40:]}")
    print(f"    coreB[len={len(coreB)}] head40 = {coreB[:40]}")
    if extra:
        for line in extra:
            print(f"    {line}")
    print()


# ---------------------------------------------------------------------------
# STEP 0: CONVENTION-RECONCILIATION GATE
# Hand-trace a trivial embedded-island case and confirm Biopython local
# (configured as above) recovers it EXACTLY, before trusting any larger fixture.
# ---------------------------------------------------------------------------

def reconcile():
    print("=" * 72)
    print("CONVENTION RECONCILIATION (must pass before any fixture is trusted)")
    print("=" * 72)
    ok = True
    al = dna_local_aligner()

    # Hand case: an 8-mer island ACGTACGT embedded in divergent flanks.
    # A = AAAAA + island + AAAAA, B = TTTT + island + TTTT.
    # By hand the optimal LOCAL alignment is the 8-mer island, 8 matches * 2 = 16,
    # at A-span [5,13) and B-span [4,12), 100% identity, ungapped.
    a = "AAAAA" + "ACGTACGT" + "AAAAA"
    b = "TTTT" + "ACGTACGT" + "TTTT"
    rep = local_report(al, a, b)
    hand_ok = (
        rep["score"] == 16
        and rep["aStart"] == 5 and rep["aEnd"] == 13
        and rep["bStart"] == 4 and rep["bEnd"] == 12
        and rep["identity"] == 1.0
        and rep["alignedA"] == "ACGTACGT" and rep["alignedB"] == "ACGTACGT"
    )
    print(f"[island] hand: score=16 A[5,13) B[4,12) id=1.0 ACGTACGT")
    print(f"         biopython: score={rep['score']} A[{rep['aStart']},{rep['aEnd']}) "
          f"B[{rep['bStart']},{rep['bEnd']}) id={rep['identity']} "
          f"{rep['alignedA']}  {'OK' if hand_ok else 'MISMATCH'}")
    ok &= hand_ok

    # Hand case: single point mismatch inside the island. ACGTACGT vs ACGAACGT
    # (index 3 differs). Optimal local keeps the whole 8-mer (dropping the edge to
    # avoid the mismatch loses more than the -1 it costs): 7*2 - 1 = 13, id 7/8.
    a2 = "AAAAA" + "ACGTACGT" + "AAAAA"
    b2 = "TTTT" + "ACGAACGT" + "TTTT"
    rep2 = local_report(al, a2, b2)
    mm_ok = (rep2["score"] == 13 and abs(rep2["identity"] - 7 / 8) < 1e-9)
    print(f"[mismatch] hand: score=13 id=0.875")
    print(f"           biopython: score={rep2['score']} id={rep2['identity']:.6f}  "
          f"{'OK' if mm_ok else 'MISMATCH'}")
    ok &= mm_ok

    print()
    print("RECONCILIATION RESULT:", "ALL OK -- conventions provably agree"
          if ok else "FAILED -- DO NOT trust fixtures")
    print()
    return ok


def main():
    if not reconcile():
        raise SystemExit("Convention reconciliation failed; aborting.")

    print("=" * 72)
    print("GOLDEN FIXTURES (Biopython local-alignment optimum per region)")
    print("=" * 72)
    print()

    al = dna_local_aligner()

    # -- CASE A: single clear homologous region in divergent flanks -----------
    # Mirror the TS construction: block = sharedBlock(800,1); flanks are random
    # DNA with DIFFERENT seeds so the ONLY homology is the planted block. Biopython
    # local over the REGION WINDOW (planted span +/- PAD) finds the block exactly.
    block_a = shared_block(800, 1)
    a_pre = random_dna(5000, 11)
    a_suf = random_dna(5000, 12)
    b_pre = random_dna(4000, 21)
    b_suf = random_dna(6000, 22)
    A = a_pre + block_a + a_suf
    B = b_pre + block_a + b_suf
    repA = window_report(al, A, len(a_pre), len(a_pre) + 800,
                         B, len(b_pre), len(b_pre) + 800)
    show("CASE A: single clear region (block=sharedBlock(800,1))", repA, extra=[
        f"construction: blockA-start={len(a_pre)} blockB-start={len(b_pre)} len=800",
    ])

    # -- CASE B: a few point mismatches in the region -------------------------
    # Clean 600-mer block in A; in B mutate 6 positions (every 100th base) to a
    # different base. Biopython scores the mismatched region; identity is its own.
    clean = shared_block(600, 7)
    mutated = list(clean)
    flip = {"A": "C", "C": "G", "G": "T", "T": "A"}
    mut_positions = [50, 150, 250, 350, 450, 550]
    for p in mut_positions:
        mutated[p] = flip[mutated[p]]
    mutated = "".join(mutated)
    a_pre2 = random_dna(3000, 13)
    a_suf2 = random_dna(3000, 14)
    b_pre2 = random_dna(3500, 23)
    b_suf2 = random_dna(2500, 24)
    A2 = a_pre2 + clean + a_suf2       # A carries the clean block
    B2 = b_pre2 + mutated + b_suf2     # B carries the mutated block
    repB = window_report(al, A2, len(a_pre2), len(a_pre2) + 600,
                         B2, len(b_pre2), len(b_pre2) + 600)
    show("CASE B: region with 6 point mismatches (block=sharedBlock(600,7))", repB, extra=[
        f"construction: blockA-start={len(a_pre2)} blockB-start={len(b_pre2)} len=600",
        f"mutated positions (within block): {mut_positions}",
    ])

    # -- CASE C: reverse-complement region ------------------------------------
    # A carries the forward block; B carries revcomp(block). Our finder reports a
    # strand -1 HSP. To match it we align A vs revcomp(B) (so the planted region
    # is forward again) over the region window, then map the revcomp-B span back
    # to FORWARD-B coords with len(B)-e / len(B)-s.
    block_c = shared_block(700, 4)
    a_pre3 = random_dna(4000, 51)
    a_suf3 = random_dna(4000, 52)
    b_pre3 = random_dna(3000, 61)
    b_suf3 = random_dna(5000, 62)
    A3 = a_pre3 + block_c + a_suf3
    B3 = b_pre3 + revcomp(block_c) + b_suf3
    rcB3 = revcomp(B3)
    # The planted revcomp block sits at forward-B [len(b_pre3), len(b_pre3)+700);
    # in revcomp-B space that maps to [len(B3)-end, len(B3)-start).
    fb_lo = len(b_pre3); fb_hi = len(b_pre3) + 700
    rc_lo = len(B3) - fb_hi; rc_hi = len(B3) - fb_lo
    repC = window_report(al, A3, len(a_pre3), len(a_pre3) + 700, rcB3, rc_lo, rc_hi)
    # Map the reported revcomp-B span back to forward-B coordinates.
    fwd_b_start = len(B3) - repC["bEnd"]
    fwd_b_end = len(B3) - repC["bStart"]
    repC_fwd = dict(repC)
    repC_fwd["bStart"] = fwd_b_start
    repC_fwd["bEnd"] = fwd_b_end
    show("CASE C: reverse-complement region (block=sharedBlock(700,4)) [forward-B coords]",
         repC_fwd, extra=[
             f"construction: blockA-start={len(a_pre3)} forward-B block-start={len(b_pre3)} len=700",
             f"aligned in revcomp-B space at [{repC['bStart']},{repC['bEnd']}); "
             f"mapped to forward-B [{fwd_b_start},{fwd_b_end}) via len(B)-e/len(B)-s",
             f"strand expected = -1",
         ])

    # -- CASE D (optional): small indel inside the region ---------------------
    # Clean 500-mer block in A; in B delete a 3-base run near the middle so the
    # region carries a single small gap. Biopython places the gap; the gapped
    # alignment + identity are Biopython's.
    clean_d = shared_block(500, 8)
    del_at = 250
    block_d_b = clean_d[:del_at] + clean_d[del_at + 3:]  # 3-base deletion in B
    a_pre4 = random_dna(2500, 15)
    a_suf4 = random_dna(2500, 16)
    b_pre4 = random_dna(2000, 25)
    b_suf4 = random_dna(3000, 26)
    A4 = a_pre4 + clean_d + a_suf4
    B4 = b_pre4 + block_d_b + b_suf4
    repD = window_report(al, A4, len(a_pre4), len(a_pre4) + 500,
                         B4, len(b_pre4), len(b_pre4) + 497)
    show("CASE D: region with a 3-base indel (block=sharedBlock(500,8), del@250)", repD, extra=[
        f"construction: blockA-start={len(a_pre4)} blockB-start={len(b_pre4)} A-len=500 B-len=497",
    ])

    # -- CASE E: two distinct regions, each Biopython-scored on its OWN window --
    # Mirror the TS multi-region construction. Biopython local returns ONE optimum
    # per call, so we run it once per region's window, getting an independent
    # optimum per region (BLAST reports one HSP per locus, same idea).
    big = shared_block(1200, 2)
    small = shared_block(500, 3)
    a_s1 = random_dna(3000, 31); a_s2 = random_dna(3000, 32); a_s3 = random_dna(3000, 33)
    b_s1 = random_dna(2000, 41); b_s2 = random_dna(4000, 42); b_s3 = random_dna(2500, 43)
    A5 = a_s1 + big + a_s2 + small + a_s3
    B5 = b_s1 + big + b_s2 + small + b_s3
    a_big_start = len(a_s1); a_small_start = len(a_s1) + len(big) + len(a_s2)
    b_big_start = len(b_s1); b_small_start = len(b_s1) + len(big) + len(b_s2)
    repBig = window_report(al, A5, a_big_start, a_big_start + len(big),
                           B5, b_big_start, b_big_start + len(big))
    repSmall = window_report(al, A5, a_small_start, a_small_start + len(small),
                             B5, b_small_start, b_small_start + len(small))
    show("CASE E-big: larger of two regions (block=sharedBlock(1200,2)) [whole-seq coords]",
         repBig, extra=[f"construction: A-start={a_big_start} B-start={b_big_start} len=1200"])
    show("CASE E-small: smaller of two regions (block=sharedBlock(500,3)) [whole-seq coords]",
         repSmall, extra=[f"construction: A-start={a_small_start} B-start={b_small_start} len=500"])

    print("Done. Bake these score/coord/identity/segment values into")
    print("local-homology.golden.test.ts and cite 'Biopython 1.87 PairwiseAligner")
    print("(local), gen-shared-regions-golden.py' as the source.")


if __name__ == "__main__":
    main()
