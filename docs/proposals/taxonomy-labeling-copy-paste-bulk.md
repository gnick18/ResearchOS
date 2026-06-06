# Easy taxonomy labeling: copy / paste + bulk apply

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT. Grant: label
existing sequences' taxonomy easily. Copy/paste a sequence's taxonomy to another
(separate from sequence copy/paste), and search a taxonomy then apply it to many
selected sequences in a collection. Seamless. Extends the NCBI taxonomy enrichment
(`docs/proposals/ncbi-taxonomy-enrichment.md`).

## Decisions (Grant, 2026-06-05)

- COPY/PASTE ENTRY: "Copy taxonomy" and "Paste taxonomy" live in the editor's
  Analyze menu AND on a right-click context menu of a sequence row in the list.
- BULK SOURCE: a "Set taxonomy" dialog over a multi-selection offers BOTH pasting
  the copied taxonomy AND searching / picking an organism, then applies to all
  selected.
- BULK SAFETY: preview + confirm before any bulk write (show the organism +
  lineage and the list of sequences it will touch).

## What a sequence's taxonomy IS (existing data model)

A sequence carries taxonomy in two places, both already written by the "Enrich from
NCBI" flow:
- SIDECAR (`SequenceMeta`): `organism`, `tax_id`, `tax_lineage` (a
  `SequenceTaxonNode[]` root-to-organism path).
- GENBANK: the `source` feature's `/organism` + `/db_xref="taxon:<id>"`
  qualifiers, so it round-trips on export (written by `setSourceOrganismInGenbank`).

So "taxonomy" as a copyable unit is `{ organism, tax_id, tax_lineage }`.

## The apply primitive (reuse + extract)

There is already a write path (the enrich apply, `EnrichFromNcbiDialog` ->
`onEnriched`/`handleEnriched`): rewrite the GenBank `source` feature via
`setSourceOrganismInGenbank`, and persist the sidecar `organism` / `tax_id` /
`tax_lineage`. Extract this into ONE reusable function,
`applyTaxonomyToSequence(seqId, taxonomy)`, that:
1. reads the sequence's current GenBank,
2. `setSourceOrganismInGenbank(genbank, organism, taxId)`,
3. persists the rewritten `.gb` + the sidecar tax fields through the store update,
4. returns success / failure.
Both single paste and bulk apply call this. The bulk version loops it over the
selection with progress + a per-sequence result.

## The taxonomy clipboard

A lightweight app-level store holding ONE copied taxonomy
`{ organism, tax_id, tax_lineage, copiedFromName? }`, SEPARATE from the OS clipboard
and the sequence (bases) clipboard. A small React context (or a module store)
persisted to `localStorage` so a copy survives navigation and a page reload.
"Copy taxonomy" fills it; "Paste taxonomy" and the bulk dialog read it.

## Flow 1: copy / paste a single sequence's taxonomy

- COPY TAXONOMY (Analyze menu + list row right-click): reads the sequence's
  `{ organism, tax_id, tax_lineage }` into the clipboard. Enabled only when the
  sequence HAS taxonomy. A calm toast "Copied the taxonomy of <organism>."
- PASTE TAXONOMY (Analyze menu + list row right-click): applies the clipboard
  taxonomy to this sequence via `applyTaxonomyToSequence`. Enabled only when the
  clipboard holds a taxonomy. A small inline confirm is enough for a single
  sequence (it shows the organism being pasted); a toast on success. Refresh the
  open editor / the lineage chip so the change shows immediately.

## Flow 2: bulk apply to a selection ("Set taxonomy")

- The collection list ALREADY has per-row checkboxes + a bulk action bar (bulk
  delete / send). Add a "Set taxonomy" action to that bar, shown when one or more
  rows are selected.
- It opens the SET-TAXONOMY DIALOG with two source tabs / modes:
  - PASTE COPIED: use the taxonomy currently on the clipboard (shows the organism +
    lineage; disabled with a hint when the clipboard is empty).
  - SEARCH: a `suggestTaxa` autocomplete (reuse the lookup) to find an organism;
    selecting one resolves its `{ organism, tax_id, lineage }` via `resolveTaxonomy`.
- PREVIEW + CONFIRM: the dialog shows the chosen organism + its major-rank lineage,
  and the LIST of the N selected sequences it will touch (names), with a confirm
  button. No write happens before confirm.
- APPLY: on confirm, loop `applyTaxonomyToSequence` over the selection with a
  progress indicator; on finish show a result ("Labeled 15 of 15", or which
  failed). Refresh the list + any open editor.

## Flow 3: search-and-apply (a path of Flow 2)

Searching an organism and applying to many IS the SEARCH mode of the Set-taxonomy
dialog above. The standalone "Look up an organism" lookup and the tree explorer can
also offer an "Apply to selected sequences" action when a selection exists, opening
the same confirm step, so a user who is exploring can label their selection without
backtracking. (Secondary entry, after the bulk bar path.)

## Reuse

- The enrich apply path (`setSourceOrganismInGenbank` + the sidecar tax write) ->
  the extracted `applyTaxonomyToSequence`.
- The list multi-select + bulk action bar (the bulk delete / send infra in
  `app/sequences/page.tsx`).
- The taxonomy lookup (`suggestTaxa` / `resolveTaxonomy`) for the search source.
- The lineage display (major ranks) for the preview.

## Staging

- STAGE 1: the reusable `applyTaxonomyToSequence` primitive, the taxonomy clipboard
  (context + localStorage), and single COPY / PASTE taxonomy (Analyze menu + list
  row right-click), with toasts and editor refresh.
- STAGE 2: the bulk "Set taxonomy" dialog (paste + search sources, preview +
  confirm, bulk apply with progress + result) wired to the list's bulk bar, plus
  the secondary "apply to selected" entry from the lookup / tree.

## Risks

- BULK MUTATION: applying to many sequences rewrites each `.gb` + sidecar. Mitigated
  by the preview + confirm, per-sequence error handling (report partial failures),
  and the fact that re-applying is idempotent (it overwrites the same fields).
- A wrong paste onto one sequence: low stakes (re-copy + re-paste, or enrich again);
  the single paste shows the organism before applying.
- CLIPBOARD STALENESS: a copied taxonomy persisted in localStorage could outlive its
  source; that is fine since it is just `{ organism, tax_id, lineage }`, self
  contained, not a reference.

## Open questions for Grant

1. Single paste confirm: a one-line inline confirm (shows the organism) vs apply
   immediately with a toast + undo. Recommend the inline confirm (cheap, clear).
2. The "apply to selected" secondary entry from the lookup / tree explorer: in v1
   (Stage 2) or a follow-up? Recommend the bulk-bar path first, this as a small add.
3. Should COPY also be offered from the tree explorer / lookup (copy a searched
   organism's taxonomy to the clipboard without a source sequence)? Recommend yes,
   it makes the clipboard the single hub, but it is a small add after Stage 1.
