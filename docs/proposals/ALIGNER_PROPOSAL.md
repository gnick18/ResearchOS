# Built-in Sequence Aligner: Design Proposal

Status: draft for review (Grant). Created 2026-06-03.

A small, dependency-free pairwise sequence aligner as a foundational primitive in
ResearchOS. The immediate driver is matching SnapGene's live primer alignment
(which tolerates mismatches and auto-detects strand/direction), but the real
value is reuse: specificity, cloning-junction checks, mutagenesis visualization,
a compare/align feature, and homology-based annotation all want the same engine.

Everything here runs client-side (no backend), consistent with the rest of the app.

## 1. Goal and principles

- Client-side only, pure, deterministic, heavily unit-tested. No external service.
- One engine, reused everywhere alignment is needed, rather than ad hoc matching
  scattered per feature.
- Fast enough on real sequences (kb plasmids to hundreds-of-kb contigs) via
  seeding; correctness first, speed via the standard BLAST-style seed-and-extend.

## 2. Where we are today

`frontend/src/lib/sequences/primer.ts` `findBindingSites` already aligns a primer
to the open sequence by EXACT and 3'-anchored partial matching on BOTH strands.
So the editor already detects a primer's binding site, strand (hence direction),
and annealed-base count, and the Add-Primer / Edit-Primer / Check / specificity
surfaces already use it. For a clean primer (including one with a non-annealing
5' tail) we already do what SnapGene shows.

The gap: `findBindingSites` is substring + 3'-anchored search. It cannot align a
primer that has INTERNAL MISMATCHES (or small indels) and show where they fall.
That is the one piece of SnapGene's live alignment we do not match, and it is
exactly what a real local aligner provides.

## 3. The engine

A pure module, e.g. `frontend/src/lib/align/`:

- `alignLocal(a, b, opts)` — Smith-Waterman local alignment (best-scoring
  subalignment), with affine gap penalties (gapOpen + gapExtend).
- `alignGlobal(a, b, opts)` — Needleman-Wunsch global alignment (end-to-end).
- Optional `alignSemiGlobal` (glocal: a short query end-to-end against a region of
  a long target without end-gap penalties) — the natural fit for "align this whole
  primer/oligo into the template."
- Scoring is pluggable: a DNA scoring scheme (match / mismatch, IUPAC-degenerate-
  aware from the start, see decision below) and a protein scheme (BLOSUM62). Same
  DP core, different substitution scoring, so one engine covers DNA and protein.
- Returns a structured result: score, aligned ranges in a and b, percent identity,
  and an op list (match / mismatch / insertion / deletion) suitable for rendering
  the alignment (and for a CIGAR-like string).

This is a few hundred lines of well-understood DP code. No dependency; pure JS/TS
is fine at the sizes below. A WASM port is a possible later optimization, not
needed for the MVP.

## 4. Speed: seed-and-extend for large targets

A naive O(query x target) alignment of a 20-40 bp primer against a 456 kb contig
(x2 strands) is millions of cells: workable but not instant, and wasteful since
real primers match nearly exactly. The standard fix, which we can build cheaply:

1. SEED: find short exact k-mer matches of the query in the target (reuse / extend
   the existing exact-match search; a simple k-mer index of the target makes this
   fast and is reusable).
2. EXTEND: run `alignLocal` / `alignSemiGlobal` only in a window around each seed.
3. Rank the resulting alignments by score; report the best (and any near-ties).

This keeps primer-to-large-template alignment fast while staying mismatch-tolerant.
For small targets (a typical plasmid) we can align directly without seeding.

## 5. Reuse map (the real payoff)

Build first (drives the engine + the immediate SnapGene parity):
- PRIMER ALIGNMENT, mismatch-tolerant. Upgrade primer binding to use the aligner
  (seed-and-extend), so a primer with internal mismatches still aligns, shows the
  mismatches, and auto-reports strand/direction. Feeds the Add/Edit/Check primer
  visualizations we already have.

Build later (each reuses the same engine):
- SPECIFICITY. The local-library off-target scan becomes mismatch-tolerant (catches
  near-binding sites, mirroring Primer-BLAST's Needleman-Wunsch refinement).
- CLONING JUNCTIONS. Verify assembled junctions / overlaps align as expected.
- SITE-DIRECTED MUTAGENESIS. Visualize a mutagenic primer with its intended
  mismatch against the template.
- COMPARE / ALIGN TWO SEQUENCES. A new feature: align an imported sequence to a
  reference and show identity + the alignment (and/or a dotplot). Very
  SnapGene/Benchling, and only possible once the engine exists.
- HOMOLOGY-BASED ANNOTATION. Auto-annotate a new sequence by aligning known
  features/primers to it.
- ENHANCED FIND (Cmd+F). SnapGene's search family: Find DNA sequence, Find
  protein sequence, Find enzyme / feature / primer (by name), and Find similar
  DNA sequences. The key aligner-powered behavior: when an EXACT match is not
  found, offer to find a CLOSE match (allow some gaps / mismatches) via local
  alignment, and highlight the best hit(s). Extends the existing exact-only
  `SequenceFindBox` (Cmd+F) into the full search surface; "Find similar" is just
  local alignment of the query against the sequence.

## 6. Feasibility and risks

- Performance: seed-and-extend handles large targets; direct DP is fine for
  plasmid-scale. A whole-genome all-vs-all is out of scope (that is the NCBI
  Primer-BLAST handoff's job, already built).
- Protein scoring: ship BLOSUM62 as the default matrix; PAM/other matrices are a
  trivial later addition.
- Correctness is the crux: the DP + traceback must be exact. Unit-test against
  hand-worked alignments (known score + ops) for local, global, semi-global,
  affine gaps, both DNA and protein, and reverse-strand DNA.

## 7. MVP recommendation

Build first: the pure `align/` engine (local + global + semi-global, IUPAC-aware
DNA scoring, affine gaps) with thorough tests, the k-mer seed-and-extend wrapper
for short-query-vs-large-target, and the wiring that makes primer binding
mismatch-tolerant (so the primer dialogs match SnapGene, including mismatches +
auto-direction).

Build later, in priority order: protein scoring (BLOSUM62); the mismatch-tolerant
specificity upgrade; the Compare/Align-two-sequences view; mutagenesis primer
visualization; homology-based annotation.

## 8. Decisions (locked 2026-06-03, Grant)

- DNA scoring: IUPAC-DEGENERATE-AWARE FROM THE START (build the endgame, not a
  match/mismatch stopgap). A degenerate position scores as a match when the target
  base is in its IUPAC set (N matches anything; R = A/G; Y = C/T; etc.). SnapGene
  supports IUPAC ambiguity codes in both Find and primer design, so this is the
  correct target behavior. Plain match/mismatch is just the degenerate case where
  every code is a single base.
- Compare/Align-two-sequences: DEFERRED. The MVP is the engine + the mismatch-
  tolerant primer-binding upgrade. Compare/Align (identity + alignment view /
  dotplot) comes later, once the engine is proven.
- Pure JS now; a WASM port only if a real performance ceiling appears.
- BUILD STATUS: Grant gave the go 2026-06-03. STAGED build. STAGE 1 (engine)
  MERGED @ 0cf21c13: frontend/src/lib/align/ (scoring.ts IUPAC-aware dnaScoring +
  reverseComplement; core.ts Gotoh affine-gap DP for alignLocal/alignGlobal/
  alignSemiGlobal; seed.ts buildKmerIndex + seedAndExtend both-strands; types.ts
  AlignmentResult {score,aStart/aEnd,bStart/bEnd,identity,alignedA/B,ops,cigar};
  index.ts barrel). 34 tests, tsc clean. Protein/BLOSUM62 = clean seam, deferred.
  STAGE 2 (mismatch-tolerant primer binding + show mismatches in the primer
  dialogs) = next, touches lib/sequences/primer.ts + primer dialogs; must NOT
  regress exact/clean-primer behavior or existing primer tests.
