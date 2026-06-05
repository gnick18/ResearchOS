# Taxonomy tree explorer (walk the tree of life in context)

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT. Grant: a tool to
walk the tree of life up and down, to see what is similar to an organism. Explore
the data-source tradeoffs (live vs preloaded) in this doc. Extends the NCBI
taxonomy enrichment (`docs/proposals/ncbi-taxonomy-enrichment.md`).

## The gap

The taxonomy tool we shipped (Phase 2) does a LINEAR LINEAGE only, an organism and
its ancestor chain (root to organism), walking UP. It cannot walk DOWN to children
or SIDEWAYS to siblings, so it cannot answer "what is similar to my organism." This
proposal adds an interactive tree explorer.

## Verified API facts (live 2026-06-05, all browser-direct, no proxy)

Every taxon report from the Datasets API carries what a tree needs, and the
endpoints reflect our origin (CORS-open, `access-control-allow-origin:
https://research-os.app`):

- `GET /datasets/v2/taxonomy/taxon/{id}/dataset_report` returns, per node,
  `current_scientific_name`, `rank`, `parents` (the ancestor lineage, walk UP),
  `children` (direct child tax IDs, walk DOWN), `classification` (the named major
  ranks), and `counts` (assemblies / genes / protein-coding / RNA tallies under
  the node). Siblings are the parent's `children`.
- A COMMA-SEPARATED id list resolves many nodes in one call, so a node's children
  (or siblings) get their names + ranks in a single request. This is the same
  batch pattern the Phase 2 lineage resolver already uses.
- `GET /datasets/v2/taxonomy/taxon_suggest/{query}` is a CORS-open autocomplete,
  returning `sci_name` + `tax_id` + `rank` for type-ahead organism search.
- Direct-child fan-out is BOUNDED because NCBI has intermediate ranks. Measured
  direct children: Drosophila (genus) 9, Bacteria (domain) 15, Diptera (order) 4,
  Metazoa (kingdom) 4. So each level shows a handful to a few dozen nodes, not
  thousands. A rare wide node (a genus with hundreds of species directly) needs a
  show-more guard, not a redesign.

## Node data model

`TaxonNode = { taxId, name, rank, parentId, childIds: string[], classification:
{ rank: name }, counts: { assemblies?, genes?, ... } }`. Children and siblings are
resolved from ids to `{ taxId, name, rank }` on demand (batch).

## Navigation model

- CENTER on a node. Show its PARENT above, its SIBLINGS beside it (the parent's
  other children, the current node highlighted), and its CHILDREN below.
- CLICK any node to recenter on it, which re-fetches that node and its neighbors.
- A BREADCRUMB of the path from a root rank (domain) down to the centered node,
  built from `parents` + `classification`, each crumb clickable to jump up.
- Rank label + a counts badge on each node ("1 species", "2,564 assemblies") so the
  user reads scale and rank while walking.
- ENTRY POINTS: a launcher tool (autocomplete search), a cross-link from the
  existing lineage lookup ("explore in tree"), and a cross-link from a sequence's
  organism chip ("explore <organism> in the tree"), so it connects to real work.

## Data source: the tradeoff (the part to decide)

Three ways to feed the explorer. All use the SAME public NCBI taxonomy data; they
differ in WHERE the data sits.

### Option A: live API on-demand (fetch nodes as the user navigates)

- Pro: the WHOLE tree is reachable (~2.5M taxa), always current, nothing to bundle
  or keep fresh, smallest app footprint.
- Pro: reuses the Phase 2 client + batch resolver almost entirely; least new code.
- Pro: autocomplete search is already live (`taxon_suggest`), no local index.
- Con: needs a connection while exploring (ResearchOS is otherwise local-first, so
  this is the one online-only tool).
- Con: each recenter is one or two network calls (the node, then a batch for
  children + siblings); a session cache hides repeat visits but first visits wait.
- Con: depends on NCBI uptime and rate limits (generous for interactive use, but a
  hard dependency).

### Option B: live API plus a small curated offline backbone

A preloaded backbone (superkingdoms to phyla, plus the common model organisms and
their lineages) ships with the app; deeper or rarer nodes fall back to the live
API.

- Pro: instant, offline starting points for the common cases (E. coli, yeast,
  human, fly, mouse, Arabidopsis), and a usable skeleton with no connection.
- Pro: softens the online-only feel for the organisms most labs actually use.
- Con: PARTIAL offline (deep navigation still needs the API), so the offline story
  is "some of the tree," which can confuse expectations.
- Con: a curated file to BUILD and KEEP FRESH (taxonomy is revised), the same
  maintenance burden the HMMER curated subset carries.
- Con: more code (a bundled index + a merge of local + live) for a modest gain over
  Option A, given the live API is fast and CORS-open.

### Option C: full preload (bundle the entire tree)

- Pro: fully offline, instant everywhere.
- Con: NOT viable for a browser app. The NCBI taxdump is ~2.5M taxa, tens of MB
  zipped and hundreds uncompressed; bundling or caching all of it is too heavy, and
  it goes stale. Ruled out.

### Recommendation

Option A (live on-demand) for v1, with a session cache of visited nodes. It is the
least code, always current, covers the whole tree, and the live API is fast and
CORS-open. If the online-only feel becomes a real complaint, add the Option B
backbone later as an additive enhancement (the explorer would not have to change
shape, only its node source). Full preload (C) is off the table.

## Caching

A simple in-memory (and optionally Cache API) map of `taxId -> TaxonNode` for the
session, so walking back up or revisiting a sibling is instant. Cap the cache and
evict oldest; the data is small per node.

## UI sketch

A calm, centered layout, not a sprawling graph. The centered node is a card with
its name, rank, and counts. A single parent card sits above with an up-arrow
affordance; a horizontal row of sibling chips brackets the centered node; a wrapped
grid of child chips sits below with a show-more control past a threshold (the rare
wide node). A breadcrumb across the top. Click anything to recenter. Inline SVG
icons, the `<Tooltip>` component, semantic type tokens, Escape to close if it opens
as a dialog, no em-dash / emoji / mid-sentence colon. Could be a full tool panel
rather than a dialog, given the navigation is the point.

## Reuse

- The Datasets taxonomy CLIENT (`lib/sequences/ncbi-datasets.ts`), extended with
  `getTaxonNode(taxId)` (parents + children + counts + classification) and
  `suggestTaxa(query)` (autocomplete), plus the existing batch id-to-name resolve.
- The Phase 2 lineage types and the launcher-tool + dialog patterns.
- The sequence organism chip (the cross-link entry point).

## Tests

- `getTaxonNode` parsing against a saved real report (parents, children ids, counts,
  classification).
- `suggestTaxa` parsing against a saved autocomplete response.
- Sibling derivation (a node's siblings are the parent's children minus itself).
- The show-more threshold on a wide-fan-out node fixture.
- Render: the centered node with parent / siblings / children, the breadcrumb, the
  empty state (a tip with no children shows "no child taxa").

## Open questions for Grant

1. Surface: a full-screen tool panel (navigation is the focus) vs a dialog like the
   lineage lookup. Recommend a panel.
2. Counts badge: which count to show by default (assemblies, or species under the
   node, or genomes), with the rest on hover. Recommend assemblies, since that maps
   to "what can I actually pull from NCBI."
3. Should clicking a species node offer a direct "import from NCBI" jump (tie the
   explorer back to the annotated import)? Recommend yes, a small action on a
   species/strain node.
4. The Option B backbone: confirm v1 is live-only (Option A), with the curated
   backbone deferred unless the online-only feel is a problem.

## Risks

- Online-only in a local-first app (Option A); softened later by the Option B
  backbone if needed.
- A rare wide node (hundreds of direct children); handled by the show-more guard +
  batch resolve in pages.
- NCBI rate limits; interactive navigation is well within them, and the cache cuts
  repeat calls.
