# Taxonomy tree explorer (walk the tree of life in context)

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT. Grant: a tool to
walk the tree of life up and down, to see what is similar to an organism. Explore
the data-source tradeoffs (live vs preloaded) in this doc. Extends the NCBI
taxonomy enrichment (`docs/proposals/ncbi-taxonomy-enrichment.md`).

## Decisions (Grant, 2026-06-05)

- DATA SOURCE: build Option B outright (live API plus a curated offline backbone),
  not Option A first. If the backbone is the endgame, do it now rather than retrofit.
- BACKBONE DEPTH: the deeper backbone, down to FAMILY across all branches (not just
  the skeleton, not just model organisms). Below family (genus / species / strain)
  falls back to the live API.
- SURFACE: a full tool panel, navigation is the focus.
- COUNT BADGE: the user can TOGGLE the node badge between assemblies and species
  (not a single fixed default).
- IMPORT JUMP: yes, a species / strain node offers a direct "import from NCBI"
  action that prefills the annotated import for that organism.

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
- Rank label + a counts badge on each node, toggleable between species-under-node
  (instant, from the backbone) and assemblies (live for the centered node), so the
  user reads scale and rank while walking.
- ENTRY POINTS: a launcher tool (autocomplete search), a cross-link from the
  existing lineage lookup ("explore in tree"), and a cross-link from a sequence's
  organism chip ("explore <organism> in the tree"), so it connects to real work.

## Data source tradeoff (the part to decide)

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

### Decision (Grant): Option B, deeper backbone to family

Grant chose Option B outright with the deeper backbone (to family), reasoning that
if the backbone is the endgame it is better built now than retrofitted. So v1
bundles a curated backbone of all taxa down to family, navigates it instantly and
offline, and falls back to the live API for genus / species / strain and for the
live counts. Full preload of the entire tree (C) stays off the table.

## Curated backbone build (to family)

The backbone is a bundled static dataset, the same shape as our other hosted
reference data (a JSON under `frontend/public/`), produced by a re-runnable build
script so it can be refreshed when NCBI revises taxonomy.

- SOURCE: the NCBI new_taxdump (`nodes.dmp` + `names.dmp`, public FTP). Building
  from the taxdump is the right move, NOT tens of thousands of per-node API calls.
  The script downloads the taxdump, keeps every taxon at rank superkingdom / domain
  through family (with the super/sub rank variants), and re-parents each kept node
  to its nearest kept ancestor so the tree stays connected without the unranked
  intermediate clades. Estimated ~15k to 20k nodes (roughly 10k to 12k families,
  ~2k to 3k orders, the higher ranks far fewer).
- PRECOMPUTE: for each kept node, store `{ taxId, name, rank, parentId,
  childIds }` and the SPECIES-UNDER count (computable from the full taxdump tree
  even though we only bundle to family, since the script sees all descendants).
  Species count is therefore instant and offline.
- SIZE: a compact JSON (short keys, ids as numbers) should land in low single-digit
  MB raw and well under ~1 MB gzipped over the wire; the exact size is measured at
  build and budgeted. If it runs large, split into a skeleton chunk plus a
  lazy-loaded family layer.
- STORAGE + LOAD: served from `public/`, fetched once and cached (Cache API), the
  same pattern as the HMMER curated subset. Loaded lazily when the explorer opens,
  not on app boot.
- REFRESH: the build script is committed and re-runnable; taxonomy revisions are
  infrequent, so a periodic re-run keeps it current. Document the last-built date in
  the bundle.

### Where live fills in

- Below family (genus, species, strain): fetched on demand from the Datasets API
  and merged into the in-session cache, since those are not in the backbone.
- ASSEMBLY counts: the backbone carries species counts (free from the taxdump); the
  assemblies count for the centered node comes live from its `dataset_report`
  (so the toggle shows species instantly, assemblies after a quick fetch). If a
  bundled assemblies count is wanted later, the build can join NCBI's assembly
  summary, but that is heavier and deferred.

## Caching

A simple in-memory (and optionally Cache API) map of `taxId -> TaxonNode` for the
session, so walking back up or revisiting a sibling is instant. Cap the cache and
evict oldest; the data is small per node.

## UI sketch

A full tool PANEL (Grant's choice), a calm centered layout, not a sprawling graph.
The centered node is a card with its name, rank, and the toggleable counts badge. A
single parent card sits above with an up-arrow affordance; a horizontal row of
sibling chips brackets the centered node; a wrapped grid of child chips sits below
with a show-more control past a threshold (the rare wide node). A breadcrumb across
the top. Click anything to recenter. A species / strain node carries a small
"Import from NCBI" action that opens the annotated import prefilled for that
organism (tying the explorer to real work). Inline SVG icons, the `<Tooltip>`
component, semantic type tokens, Escape to close, no em-dash / emoji / mid-sentence
colon.

## Reuse

- The Datasets taxonomy CLIENT (`lib/sequences/ncbi-datasets.ts`), extended with
  `getTaxonNode(taxId)` (parents + children + counts + classification) and
  `suggestTaxa(query)` (autocomplete), plus the existing batch id-to-name resolve.
- The Phase 2 lineage types and the launcher-tool patterns.
- The sequence organism chip and the NCBI import dialog (the cross-link entry point
  and the species-node import jump).
- The hosted-subset load + Cache API pattern from the HMMER curated database, for
  the bundled backbone.

## New build pipeline

- A re-runnable script (under `tools/` or `scripts/`) that downloads the NCBI
  new_taxdump, filters to rank superkingdom/domain through family, re-parents to the
  nearest kept ancestor, precomputes species-under counts, and emits the compact
  backbone JSON into `frontend/public/` plus a manifest with the last-built date.
  Committed alongside its output, like the method-catalog and HMMER subset builds.

## Tests

- `getTaxonNode` parsing against a saved real report (parents, children ids, counts,
  classification).
- `suggestTaxa` parsing against a saved autocomplete response.
- Sibling derivation (a node's siblings are the parent's children minus itself).
- The backbone loader + the local-first / live-fallback merge (a backbone node
  resolves offline, a below-family node triggers the live path).
- The show-more threshold on a wide-fan-out node fixture.
- The build script on a tiny taxdump fixture (filter to family, re-parent, species
  count), so the pipeline is covered without the full dump.
- Render: the centered node with parent / siblings / children, the breadcrumb, the
  count toggle, the species-node import action, and the empty state (a tip with no
  children shows "no child taxa").

## Resolved (Grant, 2026-06-05)

Surface = full panel. Count badge = toggle between species and assemblies. Species
node = yes, an import-from-NCBI jump. Data = Option B, backbone to family.

## Remaining build-time judgment calls (no decision needed now)

- Bundle size threshold: if the to-family JSON runs past the gzip budget, split into
  a skeleton chunk loaded first plus a lazy-loaded family layer. Decided at build
  once the real size is measured.
- Refresh cadence for the backbone (the build script is re-runnable); revisit if a
  user reports a stale or missing recent taxon.
- Whether to later precompute bundled assemblies counts (join NCBI's assembly
  summary in the build) vs the live-per-node fetch shipped in v1.

## Risks

- Online-only in a local-first app (Option A); softened later by the Option B
  backbone if needed.
- A rare wide node (hundreds of direct children); handled by the show-more guard +
  batch resolve in pages.
- NCBI rate limits; interactive navigation is well within them, and the cache cuts
  repeat calls.
