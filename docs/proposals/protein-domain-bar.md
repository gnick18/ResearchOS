# Protein domain bar (CDD-style domain projection in the drawer)

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT. Grant: a CDD-style
protein-domain bar in the protein drawer, design doc first.

## Decisions (Grant, 2026-06-05)

- Block color: PER-FAMILY deterministic palette (each Pfam family a distinct hue).
- Click a block: SELECTS + scrolls to the corresponding DNA feature on the map
  (cross-link protein view -> DNA view). Hover still shows the tooltip.
- Live preview: YES in v1. During the Annotate-domains review, the bar shows the
  CANDIDATE hits (before accepting), visually distinct from accepted domains. So
  the bar renders two states: accepted domains (the features) solid, and
  in-review candidates pending (e.g. dashed / lighter). Clicking an accepted block
  selects its feature; a candidate block has no feature yet (highlight only).

## The gap this fills

Today, annotated domains exist only as `domain`-type FEATURES on the DNA (they
draw as feature arcs on the map and round-trip to GenBank). There is no
protein-native view: nothing shows the protein and its domains in residue
coordinates the way NCBI's Conserved Domain Database graphic does. The protein
drawer (where "Annotate domains" lives) shows protein PROPERTIES but not the
domains themselves. This adds that missing projection.

## Goal

When a coding feature (CDS / gene / mat_peptide / sig_peptide) is selected, the
protein drawer gains a "Domains" section with a horizontal PROTEIN BAR: the
protein in aa coordinates (1..N), with each annotated domain drawn as a colored
block at its residue position, labeled with the family name and showing
name / Pfam accession / aa range / score on hover. It complements the DNA-feature
+ GenBank layer (domains stay exportable); it does not replace it.

## Data: where the domains + their aa ranges come from

The bar shows the sequence's `domain`-type features that overlap the selected CDS,
projected into the protein's aa coordinates. The projection should be EXACT and
cheap, so:

- PRIMARY (recommended): persist the protein aa range on the domain feature at
  annotation time. `domainHitToFeature` already HAS the aa span (the `DomainHit`
  `start`/`end`, 1-based residues) before it maps to DNA; today that aa span is
  discarded into DNA coordinates. Additively store it as a qualifier, e.g.
  `/note="aa_range:4..286"` (or a dedicated qualifier key). The drawer then reads
  the aa range directly, no inverse math, exact. FLAG: this is an additive
  qualifier on the `domain` feature; it round-trips in GenBank `/note` and needs
  no migration (a domain feature lacking it falls back below).
- FALLBACK: for a `domain` feature with no stored aa range (e.g. one imported from
  a GenBank file, or pre-existing), re-derive the aa range by INVERTING the
  DNA->aa mapping `domain-features.ts` already does (`aaSpanToDnaForCds`): walk the
  CDS exons in transcript order (reverse-complemented on the minus strand) and map
  the feature's DNA span back to a residue span. A small pure helper, tested.

## The bar (the component)

`frontend/src/components/sequences/ProteinDomainBar.tsx`, pure presentational:
- A horizontal track spanning protein residue 1..N (N = the translated peptide
  length the drawer already computes). A light ruler with a few ticks (e.g. every
  100 aa, plus the N terminus + the end).
- Each domain a rounded colored block positioned by its aa range, with the family
  name inside (truncated when the block is narrow, full name on hover). Color = the
  domain feature's color (indigo default) or a deterministic per-family palette
  from `feature-colors` so different families read distinctly.
- Hover tooltip: family name, Pfam accession (PFxxxxx), aa range, score / E-value
  (pulled from the feature's qualifiers).
- OVERLAPPING domains (a multi-domain protein where ranges overlap) stack into
  lanes; reuse the interval/lane packing in `lib/sequences/label-layout.ts` (the
  editor already lane-packs labels) rather than reinventing it.
- Click a block -> select + scroll the corresponding `domain` feature on the map
  (cross-link the protein view to the DNA view); the drawer already has the
  select path. v1 may ship hover-only and add click-to-select as a small follow.
- EMPTY state: when the CDS has no domains, a calm line "No domains annotated yet"
  pointing at the existing "Annotate domains" action (which is right there in the
  drawer).

## Placement + wiring

- A "Domains" section in `ProteinPropertiesDrawer.tsx`, between the at-a-glance
  protein stats and the "Annotate domains" action, so the flow reads: properties,
  the domains you have, the action to find more.
- The drawer currently receives the selected `feature` + `seq`. It needs the
  sequence's DOMAIN FEATURES to find the ones overlapping this CDS, so add a prop
  carrying the sequence's features (or just the `domain`-typed ones). A pure
  helper `domainsForCds(cdsFeature, features, aaLength)` returns the display list
  `{ name, accession, aaStart, aaEnd, color, score?, featureIndex }[]` (reading the
  aa-range qualifier, fallback to inverse-map), which the bar renders.
- LIVE vs ACCEPTED: v1 shows ACCEPTED domains (the features on the sequence). The
  annotate review list (before accepting) could PREVIEW candidates on the same bar
  as a follow-up; not in v1.

## File map

- ADD `components/sequences/ProteinDomainBar.tsx` (the bar) + a render test.
- ADD a pure helper (in `domain-features.ts` or a new `domain-projection.ts`):
  `domainsForCds(...)` + the inverse DNA->aa mapping, with unit tests (forward /
  reverse / exon-joined; qualifier read + inverse fallback).
- EDIT `domain-features.ts` `domainHitToFeature`: additively store the aa range
  qualifier. Update the existing tests to assert it.
- EDIT `ProteinPropertiesDrawer.tsx`: the Domains section + the new features prop +
  rendering `ProteinDomainBar`.
- EDIT the drawer's caller (`SequenceEditView.tsx`) to pass the sequence features.

## Tests

- The projection helper: a known CDS + a domain feature -> the expected aa range,
  via both the stored qualifier and the inverse-map fallback; forward, reverse, and
  exon-joined CDS.
- `domainHitToFeature` now carries the aa-range qualifier (extend its test).
- `ProteinDomainBar` render: blocks for N domains at the right positions, the empty
  state, and lane-stacking for overlapping domains.

## Open questions for Grant

1. Color: per-family deterministic palette (each family a distinct hue) vs the
   single domain-feature color (indigo) for all blocks. The CDD look uses distinct
   colors per family; recommend the per-family palette.
2. Click behavior in v1: hover-only, or click-a-block-selects-the-DNA-feature
   (the cross-link). Recommend including the click cross-link if cheap.
3. Live preview on the bar during the annotate review (before accepting): v1, or
   follow-up. Recommend follow-up.

## Risks

- The inverse DNA->aa mapping must exactly invert the forward mapping (strand +
  exon joins); the stored-qualifier primary path avoids it for freshly annotated
  domains, and the fallback is unit-tested against the forward mapping.
- Crowded bars on heavily-multi-domain proteins; lane-stacking + truncation +
  hover handle it.
