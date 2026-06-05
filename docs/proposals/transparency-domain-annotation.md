# Transparency: protein domain annotation (on-device HMMER vs native HMMER)

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT. Grant locked the
oracle (native HMMER, same Pfam set) and asked for a design doc first.

## Goal + the claim

Add protein domain annotation to the public `/transparency` page, validating that
the ON-DEVICE WASM HMMER engine returns the SAME Pfam domains as the reference
HMMER implementation. Take ~50 diverse proteins, annotate them with native HMMER
(the oracle) against a fixed Pfam HMM set, run our in-browser engine against the
SAME set, and show that the calls match. The honest, specific claim: "the domain
search that runs in your browser is the same HMMER, and it returns the same
domains as the reference tool." This validates the WASM PORT (the thing a user
would reasonably doubt), apples-to-apples, no DB or coordinate noise.

Scope note: this validates OUR on-device engine. The EBI InterProScan path is a
separate online service (EBI's engine, full Pfam) and is not what this dataset
checks; the claim here is specifically on-device-engine fidelity.

## How it fits the existing transparency system

The system (`frontend/src/lib/transparency/`) is built for exactly this: per its
own comment, "a domain = write a `datasets/<x>.ts`, a `build<X>Domain()` in
`run.ts`, and register it in `buildTransparencyReport()`." The vitest gate
(`report.test.ts`) enforces it and the `/transparency` page renders the report.
Existing subjects: Tm, alignment, digest, translation, protein parameters,
calculators, cloning, each comparing our result to a pinned oracle (Biopython /
primer3 / pydna) with a `Tolerance` (tight = faithful-port parity, loose =
expected ecosystem offset).

Domains differ from the existing subjects in TWO ways, both handled below:
1. The comparison is a SET of domains per protein (family + coordinates), not a
   scalar. The report already supports a richer-than-scalar payload via
   `CaseResult.visual`; we use it to carry the per-protein domain lists.
2. Our engine is ASYNC WASM, not a sync pure function. The existing
   `buildXDomain()` recomputes our value synchronously (e.g. `analyzeProtein(seq)`)
   on every page render. We cannot run the WASM hmmsearch synchronously on render.

## The async-WASM adaptation (the one real design point)

`buildTransparencyReport()` stays SYNCHRONOUS. So:

- `datasets/domains.ts` pins BOTH the native-HMMER golden domains AND our
  WASM-engine domains for each of the 50 proteins (both produced by the generator,
  exactly as `tm.ts` pins the Biopython values). `buildDomainsDomain()` then just
  COMPARES the two pinned sets, synchronously, and builds the report.
- A SEPARATE async gate test (`domains.gate.test.ts`) loads the WASM engine in
  Node, re-runs it on the 50 proteins against the committed HMM subset, and asserts
  it still reproduces the pinned our-engine domains. THIS is the "recomputed on
  every commit" guarantee for domains: if the engine regresses, this test fails.
  (The other subjects get that guarantee from the sync recompute inside
  `buildXDomain`; domains get it from this async re-run instead.)

So the page shows pinned data (fast), the gate enforces both that our pinned
domains match native HMMER AND that the live engine still reproduces them.

## The oracle: native HMMER, same Pfam set (tight parity)

- Native HMMER (the Eddy/Rivas lab reference, installed locally) is the oracle.
- Both native and WASM run `hmmsearch` against the SAME curated Pfam HMM subset, so
  the comparison isolates the WASM port and nothing else.
- Tolerance is TIGHT: the family accession must match EXACTLY, and the envelope
  coordinates should match to the residue (WASM HMMER is the same algorithm, so it
  should be byte-identical; allow at most +/- 1 residue as a guard). E-value /
  score within a small epsilon. Any real difference is a port bug, not a number to
  relax. (This mirrors the Biopython Tm "faithful port" tight tolerance.)

## The dataset

- ~50 PROTEINS, public (UniProt), curated for DIVERSITY: protein kinases, zinc
  fingers, 7TM GPCRs, immunoglobulin domains, helicases, RRM, homeodomains, WD40,
  etc., plus a few MULTI-DOMAIN proteins and a few NEGATIVE CONTROLS (proteins with
  no Pfam-A domain in the subset, to prove the engine does not hallucinate hits).
  Commit their FASTA as a fixture.
- A CURATED PFAM HMM SUBSET covering those families (tens of HMMs, a few hundred KB
  to a few MB), committed so both native and WASM run the identical database. This
  doubles as the seed for the future hosted curated-subset on-device default.
- Provenance: Pfam HMMs are CC0; the proteins are public UniProt. Carry the
  accessions + Pfam versions in the dataset for honesty.

## The generator (committed, run manually like gen-tm-golden.py)

`frontend/scripts/gen-domains-golden.mjs` (or .py):
1. Read the committed proteins FASTA + the committed HMM subset.
2. Run NATIVE `hmmsearch --domtblout` (the oracle) -> parse -> golden domains per
   protein (family accession, name, env from/to, score, i-Evalue).
3. Run OUR WASM engine (the same `hmmsearch.js` we ship, loaded in Node) the same
   way -> our domains per protein.
4. Write both into `datasets/domains.ts` as pinned data. Do not hand-edit; re-run
   to refresh. The script asserts native HMMER is on PATH and fails loudly if not.

## The comparison + page

- `buildDomainsDomain()` in `run.ts`: for each protein, match our domains to the
  golden by family + overlapping env coords; a protein PASSES if every golden
  domain is reproduced (right family, coords within tolerance) and no spurious
  extra domains appear. Emit a `CaseResult` per protein with a `visual` carrying
  the side-by-side domain list and a scalar concordance (matched / expected).
- The `/transparency` page renders the new "Protein domain annotation" subject
  automatically (it renders the whole report). Add a small visual for the
  per-protein domain lists (native vs on-device) if the existing renderer needs
  it; otherwise the standard case table suffices. Expected headline: 100 percent
  concordance across the 50 proteins.

## File map

- ADD `frontend/scripts/gen-domains-golden.mjs` (the generator).
- ADD `frontend/src/lib/transparency/datasets/domains.ts` (pinned golden + our
  domains + the protein/HMM provenance).
- ADD the committed fixtures: the 50-protein FASTA + the Pfam HMM subset (under a
  fixtures dir, e.g. `frontend/src/lib/transparency/datasets/__fixtures__/`).
- EDIT `frontend/src/lib/transparency/run.ts`: add `buildDomainsDomain()` and
  register it in `buildTransparencyReport()`.
- ADD `frontend/src/lib/transparency/domains.gate.test.ts` (the async engine re-run
  gate) OR extend `report.test.ts`.
- The `/transparency` page picks it up with no change (renders the report); add a
  visual only if the domain-list payload needs one.
- Reuse the shipped engine (`frontend/public/hmmer/hmmsearch.js` + the worker/Node
  loader) and the existing `parseDomtblout`.

## Phasing

1. Dataset + generator + `buildDomainsDomain` + the gate (the validation core).
2. The page visual for per-protein domain lists, if needed beyond the standard
   case table. Likely one pass.

## Open questions for Grant

1. The exact 50-protein curation list (I will propose a diverse set; you can edit).
   How many negative controls?
2. Coordinate tolerance: require exact env coords (0 residues), or allow +/- 1 as a
   guard against a benign off-by-one?
3. Despite choosing native-HMMER-only, do you want a handful ALSO cross-checked
   against EBI InterProScan as an independent footnote on the page, or keep it
   purely native-HMMER for a clean single-oracle claim?

## Risks

- The generator needs native HMMER + the HMM subset locally (you have HMMER); it is
  run manually and the output committed, like the other golden generators.
- Large HMM subset bloating the repo; keep it curated to the families the 50
  proteins need (a few MB at most).
- A genuine native-vs-WASM mismatch would (correctly) fail the gate; that is the
  point. If one appears, it is a real port bug to fix, not a tolerance to loosen.
