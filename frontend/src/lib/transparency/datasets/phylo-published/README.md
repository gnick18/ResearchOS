# Published-tree reproduction cases

These cases prove the other half of the phylo transparency story. The ggtree
domain proves our Studio RENDERS a tree the way ggtree does. These cases prove the
Tree Builder's GENERATED pipeline, run on a real paper's input, recovers that
paper's published tree.

The honest claim, stated the same way everywhere else in this app: we never run
anything on a server and maximum-likelihood search is stochastic, so this is not
bit-for-bit identity. A modern best-practice pipeline on the paper's own alignment
recovers the published topology, with any differences confined to weakly supported
branches. We score that with the Robinson-Foulds distance (lib/phylo/rf.ts) and
also report the percent of published clades recovered.

## How a case activates (mirrors the ggtree golden pattern)

Each `<case>/` ships:

- `input.fasta` (and `partitions.nex` for a supermatrix): the paper's VERBATIM
  input sequences or alignment, never AI-extracted, fetched from the cited source.
- `builder-options.json`: the exact `BuilderOptions` the Tree Builder wizard was
  set to, so the generated recipe is reproducible and shown on the page.
- `result.json`: a PENDING placeholder. The gate skips while every case is pending,
  so CI never reds on a tree no one has computed yet.
- `SOURCES.md`: the DOI, accessions, and the published tree this case scores
  against.

The published comparison tree is held in code, in `../phylo-published.ts`, so the
gate stays a pure import with no filesystem read at test time (same reason the
ggtree golden is a committed JSON).

To activate a case, a human runs the recipe offline once:

```
scripts/run-phylo-published-case.sh <case>
```

That generates the recipe from `builder-options.json`, runs it on `input.fasta`,
and rewrites `result.json` with the resulting Newick and `pending: false`. On the
next build `phylo-published.gate.test.ts` picks the case up and the /transparency
section fills in. No TypeScript changes are needed to activate a case whose
published tree is already in code.

## Status

- `hpv58`: READY to activate (input + published tree both committed). Needs the
  offline recipe run only.
- `turtle`: input + partition committed verbatim. The published comparison tree is
  a sourcing TODO (Chiari 2012, see turtle/SOURCES.md), so the case stays inactive
  until that Newick is added to `phylo-published.ts`.
- `firefly_opsin`: both the alignment and the published BEAST tree come from Dryad,
  which blocks scripted download, so a human drops the two files in (see
  firefly_opsin/SOURCES.md).
