# Transparency of Tests page

Status: v1 built (all four launch domains live), 2026-06-04. Owner: transparency-page arc.

Seven domains live, presented as tabs (one panel at a time):

  Tm            vs Biopython Tm_NN + primer3      agreement scatter
  Alignment     vs Biopython PairwiseAligner      alignment columns + homology map
  Digest        vs Biopython Bio.Restriction      gel-style fragment ladder
  Translation   vs Biopython Seq.translate        codon-to-amino-acid track
  Protein       vs Biopython ProtParam            per-property comparison table
  Lab calc      vs exact algebra + cited consts   mixed-unit comparison table
  Cloning       vs pydna + published att sites    sequence-match card

All comparisons enforced by the vitest gate (`report.test.ts`). The intro copy is
generalized to cover the three oracle kinds (peer software, published sequence,
exact algebra). The page is tabbed via a client `TransparencyTabs` that takes the
server-computed report as plain data. Remaining optional: primer design domain, a
Python oracle-refresh CI job.

## Goal

A public `/transparency` page that shows, tool by tool, how ResearchOS's built-in
bioinformatic calculations line up against the established third-party reference
implementations scientists already trust (Biopython, primer3). Every comparison
on the page is backed by a real test that runs on every push, so the page can
never quietly drift away from the truth. If our math stops matching the
reference, CI goes red and the discrepancy is visible.

This is a trust surface. ResearchOS is positioned as the honest, NIH-compliant,
own-your-data alternative, and "here is our work, checked against the tools you
already believe" is the strongest possible version of that story.

## Why this is mostly already done

The hard part (independent ground-truth values from real third-party tools)
already exists as the `*.golden.test.ts` suites, each backed by a committed
Python generator that derives its numbers from the actual reference tool:

- Primer Tm: `lib/calculators/tm-nn.ts` vs Biopython `Tm_NN` (tight, 0.05 C) and
  primer3-py (loose, expected NN-table offset). Generator `gen-tm-golden.py`.
- Pairwise + long/local alignment: `lib/align/` vs Biopython. Generators
  `gen-align-golden.py`, `gen-shared-regions-golden.py`.
- Restriction digest: `lib/sequences/enzyme-filters.ts` vs Biopython Restriction.
  Generator `gen-digest-golden.py`.
- Translation / ORF: `lib/sequences/export.ts` + vendored seqviz vs Biopython.
  Generator `gen-translate-golden.py`.

The transparency layer reuses these pinned oracle values; it does not re-derive
them.

## Architecture (decided 2026-06-04)

Page location: top-level public `/transparency` (linked from `/welcome`), like
`/open-source`. Added to `EXCLUDED_PREFIXES` in `check-wiki-coverage.mjs`.

CI coupling: build-time TS + the existing vitest gate. No Python in the CI hot
path, no JSON artifact, no `.mjs`-imports-TS friction.

Because every impl is pure and deterministic, one function is the single source
of truth:

```
lib/transparency/
  types.ts        TransparencyReport, DomainReport, ComparisonCase, CaseResult,
                  OracleRef, Status ("pass" | "warn" | "fail")
  oracles.ts      OracleRef metadata: tool name, version, citation, the
                  gen-script that produced the pinned values, what tolerance
                  means and why a tier-2 offset is expected (not a bug)
  datasets/
    tm.ts         showcase cases + pinned Biopython/primer3 expected values
    alignment.ts  (follow-up)
    digest.ts     (follow-up)
    translation.ts(follow-up)
  run.ts          per-domain runner: calls the public impl on each case, computes
                  delta vs the oracle, assigns a Status against the tolerance;
                  buildTransparencyReport() aggregates every domain
  report.test.ts  vitest GATE: every case Status must be "pass" within its
                  tolerance; structural assertions on the report shape
```

- The `/transparency` server component calls `buildTransparencyReport()` at build
  time, so the deployed page always reflects live code.
- `report.test.ts` calls the same function and asserts every case is in
  tolerance. That test is the "true test" Grant asked for: a push that makes our
  math drift from the third-party oracle turns CI red.

No collision with the active sequence-editor session: `lib/transparency/` is a
new tree that imports only the public functions (`nearestNeighborTm`,
`alignLocal`/`findSharedRegions`, `digestEnzymes`/`fragmentSizes`, `translate`).
It never edits the sequence arc's golden test files.

## Visuals (one per domain, follow-ups after the foundation)

- Tm: scatter / paired bars of ours vs Biopython vs primer3 across the oligo set,
  plus a residual strip showing each delta against the tolerance band.
- Alignment: the actual rendered alignment (match/mismatch/gap columns with an
  identity bar), short pairwise and one long/local-homology example.
- Digest: a fragment-size ladder (gel-style bands) ours vs Biopython.
- Translation: an aligned codon-to-amino-acid track ours vs Biopython.

Shared chrome: an overall "N/N comparisons passing" banner, per-domain status
pill, and an oracle-citation block (tool, version, the published parameter set,
"reproduce it yourself" pointer to the gen-script).

## Build order

1. Foundation: types + oracles + run harness + Tm dataset + the gate test +
   the page shell rendering the Tm domain. (this commit)
2. Tm visual (scatter + residual strip).
3. Alignment domain + visual.
4. Digest domain + visual.
5. Translation domain + visual.
6. `/welcome` link-in + final voice pass.

House style throughout: concept-first, no em-dashes, no emojis (inline SVG only),
no mid-sentence colons, BeakerBot if a mascot appears.
