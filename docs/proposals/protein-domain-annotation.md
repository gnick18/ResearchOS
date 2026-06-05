# Protein domain annotation (client-side compute, we host the DB)

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT for Grant's
sign-off. Architecture locked by Grant: the compute runs on the USER's machine
(in-browser WebAssembly); we only HOST the engine + the reference database as
static files. No annotation compute on our server, and the user's protein never
leaves their machine.

## Goal

Click a CDS feature in the sequence editor, annotate its protein for known
domains, and add any hits back onto the sequence as features (so they draw on
the map and round-trip to GenBank). Fully on the user's device, matching the
"everything stays on your machine" promise.

## How domain annotation actually works (so we pick the right tool)

Pfam is not a lookup table. Each of its ~21,000 families is a profile Hidden
Markov Model, and annotation means running HMMER (`hmmscan`) to align a protein
against those HMMs. The hard part is COMPUTE (the HMM search), not STORAGE. So
this is not "put Pfam in a database and query it"; it is "run the HMM search."
Pfam retired its own site around 2023 and now lives inside InterPro at EBI.

## The architecture (Grant's model): we host, the browser computes

- WE HOST, as static CDN assets:
  - the HMMER engine compiled to WebAssembly, and
  - the Pfam HMM reference library (a curated subset for v1, see Data below).
- THE BROWSER:
  - downloads those once, caches them durably (Cache API / IndexedDB), and
  - runs `hmmscan` locally in a WebWorker against the user's translated CDS.
- The user's protein sequence never leaves the machine. Our only cost is static
  bandwidth, paid once per user because the engine + DB are cached. We are a CDN
  for reference data, not a compute service. This is the most on-brand option and
  the only one that is privacy-clean by default.

### Why not the alternatives

- A Vercel database holding Pfam: wrong tool. You cannot "query" domains from a
  document/SQL store; you must run the HMM search. And the HMM library is GB-scale,
  which does not fit a Vercel Function cold-start either.
- A server (Vercel Function / dedicated container) running HMMER: real infra to
  run and pay for per query, AND it sends the user's protein off-device. Only an
  opt-in fallback (see below), not the default.

## The feasibility gate (Phase 0 spike): in-browser HMMER

The single make-or-break question, to answer empirically before building, exactly
like the SeqViz + React 19 spike for the editor.

- THE PATTERN IS PROVEN. biowasm / aioli already runs C genomics tools (samtools,
  minimap2, bcftools) entirely in-browser via WebAssembly + a WebWorker + a
  virtual filesystem. That is the exact shape we would use.
  - https://github.com/biowasm/aioli
  - https://github.com/biowasm/biowasm
- HMMER specifically: it is a C tool of the same class, but a ready-made HMMER
  WASM module was NOT confirmed in biowasm's catalog as of this writing. pyhmmer
  (Cython bindings to HMMER3) proves the engine embeds cleanly and is the
  reference implementation, but there is no confirmed browser / Pyodide build.
  - https://github.com/althonos/pyhmmer
- THE SPIKE: find or build an HMMER (`hmmscan`) WASM module using the biowasm
  toolchain (Emscripten), run it in a WebWorker against a small Pfam subset on one
  real protein (e.g. the demo EGFP / a kinase), and MEASURE the wall-clock time
  and the memory footprint. Gate questions:
  1. Does `hmmscan` run correctly in-browser and return the expected domains?
  2. Is the time for one protein against the subset acceptable (target: a few
     seconds, tolerable up to ~10-20 s for a one-off click with a progress
     indicator)? HMMER's MSV/SSV prefilter is SIMD-optimized; confirm the WASM
     build uses WASM SIMD or budget for the slowdown.
  3. Memory: the subset HMM library + WASM heap stay within a browser tab budget.
- IF THE SPIKE FAILS (no workable WASM HMMER, or perf is unusable): fall back to
  an opt-in EBI InterProScan / HMMER-web handoff (off-device, full Pfam, modeled
  on our existing NCBI Primer-BLAST handoff with a privacy notice). Still useful,
  just not on-device.

## Data: what we host, how big, how cached

- Full Pfam-A HMM library is multi-GB uncompressed (over a GB compressed), too
  large to ship to a browser as a default.
- V1 hosts a CURATED SUBSET of common domains (kinases, zinc fingers, common folds,
  the families a molecular biologist meets daily), targeting tens of MB. This is
  the practical, fast, cache-once payload.
- The browser fetches the subset once, stores it in the Cache API or IndexedDB,
  and reuses it on every later annotation. First use shows a one-time download
  progress bar; later uses are instant (no network).
- Full Pfam-A as an OPTIONAL later download for power users who accept the size,
  or defer to the EBI handoff for full coverage. Decide at Phase 2.

## License (clean to host)

- HMMER is open source (BSD-3-Clause), so we can redistribute the WASM build.
- Pfam / InterPro data is CC0, so we can host the HMM library.
- AVOID PROSITE patterns for the bundled set: PROSITE's data license is
  non-commercial, which is a redistribution snag we do not want. Prefer the
  CC0 Pfam/InterPro-derived subset.
- Add both to the "Built on open source" credits + THIRD_PARTY_NOTICES per the
  project's attribution discipline.

## Feature mapping (already half-built)

The "add hits as features" half reuses existing machinery.

- `lib/sequences/feature-detect.ts` already aligns a curated reference library
  against translated ORFs and maps protein hits back to DNA coordinates (honoring
  strand and the aa-to-codon mapping). Domain hits are the same shape: a span on
  the protein -> a span on the CDS's DNA.
- The CDS protein drawer (`components/sequences/ProteinPropertiesDrawer.tsx`,
  landed 2026-06-04) already translates the selected coding feature honoring
  strand + exon joins. That translated peptide is exactly the `hmmscan` input.
- A domain hit becomes a feature: type `domain` (or GenBank `Region`), name = the
  Pfam family (e.g. "Pkinase"), qualifiers carrying `/db_xref="Pfam:PF00069"`,
  `/note` with the family description, and the bit score / E-value. Coordinates are
  the DNA span of the domain on the CDS.
- Mirror the Detect Features UX: present the found domains in a review list, let
  the user accept or reject each, and add accepted ones in a single undoable edit
  (do not silently mutate).

## Entry point + UX

- The natural trigger is the CDS protein drawer: an "Annotate domains" action
  next to the protein properties. (Selecting a coding feature already opens that
  drawer.)
- First use downloads the engine + subset with a progress bar and a one-line
  explainer ("Domain models download once and run on your computer. Your sequence
  is never uploaded."). Later uses run straight from cache.
- Results open the Detect-Features-style review list; accepted domains land as
  features and immediately draw on the map.
- A clear, calm note that this is the curated common-domain set, with a pointer to
  the optional full-Pfam / EBI path for exhaustive coverage.

## Phased plan

0. SPIKE (gate). HMMER in WASM: find or build the module, run `hmmscan` in a
   WebWorker against a small subset on a real protein, measure correctness +
   speed + memory. No further phase starts until this is green. If it fails, the
   arc pivots to the opt-in EBI handoff.
1. ON-DEVICE ANNOTATOR (the build). Host the WASM engine + a curated CC0 domain
   subset; the cached download + WebWorker run; map hits to features; wire the
   "Annotate domains" action into the CDS drawer with the Detect-Features review.
2. COVERAGE (optional). Offer full Pfam-A as an explicit larger download, and/or
   the opt-in EBI InterProScan handoff for exhaustive coverage, clearly flagged
   as leaving the machine.

## Open questions for Grant

1. Subset scope for v1: how big a curated domain set (and which families) is the
   right "common molecular-biology domains" payload? Tens of MB is the budget.
2. Full Pfam: optional in-browser download (heavy) vs the EBI handoff vs not at
   all for v1?
3. Feature type: GenBank `Region` vs a custom `domain` type for domain features,
   and what qualifiers to carry (Pfam accession, score, E-value).

## Risks

- HMMER-WASM availability / perf is the real risk; Phase 0 retires it before any
  commitment.
- Browser memory for the HMM subset + WASM heap on low-end machines; keep the
  subset modest, stream where possible.
- Bandwidth for the one-time download; mitigated by Cache API persistence and a
  modest subset.
- Scope creep toward "be InterPro." V1 is a curated common-domain on-device
  annotator, not a full InterProScan replacement.

## Sources

- biowasm / aioli (C genomics tools in the browser via WASM): https://github.com/biowasm/aioli , https://github.com/biowasm/biowasm
- pyhmmer (HMMER3 bindings, reference implementation): https://github.com/althonos/pyhmmer , https://pyhmmer.readthedocs.io/
- HMMER (BSD-3): http://hmmer.org/
- Pfam / InterPro (CC0 data, EBI): https://www.ebi.ac.uk/interpro/
