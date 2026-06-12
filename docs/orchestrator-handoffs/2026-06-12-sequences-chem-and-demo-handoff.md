# Handoff: sequences (extract + guided NCBI), chemistry literature explorer, and the demo clips (2026-06-12)

Continues the welcome demo-video session (prior handoff:
`2026-06-12-demo-video-system-handoff.md`). That session built the demo engine
and four thin clips. This session expanded the clips, then grew the work into
three real shipped features that the demo will showcase. Everything below is on
**LOCAL main**, gate-verified (tsc 0 + targeted vitest green + icon-guard green),
and where noted, browser-verified by Grant.

## What shipped this session (all on local main)

### 1. Demo clips, rich + with "movie magic" precache
- All four welcome clips expanded from 3 thin beats to 4-5 feature showcases,
  with the data-testids each needs (`scripts.ts`, `engine.ts` gained a
  `rightClick`/contextmenu primitive; testids across chemistry / datahub /
  sequences / purchases components). Commits `057d1923b`, `d549e9cc8`.
- Grant kept the expanded Chemistry clip (the verified one) per his call.
- **Precache during the 5s countdown** (`lib/demo-video/prewarm.ts` +
  `lib/chemistry/fetch-cache.ts`): a record-mode-gated GET cache (passthrough in
  prod, zero behavior change) is warmed with the EXACT calls a clip will make, so
  a live PubChem / Europe PMC search lands instantly on camera. Also warms the
  RDKit wasm + the SeqViz chunk. Commits `e64ef566d`, `b1d2767b3`. Only chemistry
  + sequences have prewarms; datahub / purchases are local. Wired in
  `DemoVideoAutoplay` (enable cache + fire prewarm at play() start, disable on
  unmount).

### 2. Extract to new sequence (BROWSER-VALIDATED)
- Select a feature OR a base range in the sequence editor, pull it out as its own
  library sequence. Pure engine `extractRegion` already existed; this added the
  UI + wiring. Button `data-testid="seq-extract-region-btn"` (Tooltip + Icon
  `cut`), enabled only when a feature/range is selected, in the bottom spine by
  the selection readout. A selected feature extracts BY COORDINATES off its own
  span (not by name, to dodge duplicate-named instances); cuts the LIVE edited
  doc. `page.tsx handleCreateFromRegion` reuses `persistNew` (creates + refreshes
  + opens). Commit `b5d0e6371`.
- **Grant ran the Claude-in-Chrome test (`docs/test-prompts/2026-06-12-extract-locus-chrome-test.md`)
  and all three passed**: feature extract (egfp 720 bp), base-range extract,
  and a Gibson clone of the fragment into pGEX-3X. Preloaded test folder lives at
  `~/Desktop/ResearchOS-Extract-Test` (a copy of `frontend/public/demo-data`).

### 3. Guided NCBI genome import (wizard) + its backend
- **Backend** (`ncbi-datasets.ts`, `ncbi-efetch.ts`, new `ncbi-esearch.ts`), all
  tested, endpoints verified live: `listAssemblySequences`/`parseAssemblySequences`
  (contig list), `parseGenePlacement` (gene -> contig + range), windowed
  `efetchUrl`/`efetchGenbank` + `geneWindow` (gene-plus-flank), and `esearchGenes`
  (free-text gene/protein search via E-utilities esearch+esummary). Commits
  `aca280108`, `99e7757ac`.
- **Wizard GUI** (`GuidedNcbiImport.tsx` + `guided-ncbi-import.ts` helpers;
  `NcbiDownloadDialog` became a thin shell): organism search (suggestTaxa) ->
  reference-badged assemblies -> contigs -> gene-name search -> windowed import.
  Plus an accession escape hatch and whole-genome / whole-chromosome download
  options at each step. Built to the approved mockup
  `docs/mockups/2026-06-12-ncbi-guided-genome-import.html`. Commit `bbbfbe0d4`.
- Worked example throughout: A. fumigatus Af293 / cyp51A on chr4 (NC_007197.1,
  1,777,375..1,781,822). Why windowed not whole-chromosome: full chr4 efetch is
  7.26 MB / 1,267 genes (janks the browser); the gene-plus-1kb window is ~tens of
  KB and instant, still carries the chromosome provenance.
- data-testids for the demo: `ncbi-organism-input`, `ncbi-taxon-row`,
  `ncbi-accession-input`/`-go`, `ncbi-assembly-row`/`ncbi-whole-genome`,
  `ncbi-contig-row`/`ncbi-whole-contig`, `ncbi-gene-input`/`-search`/`-row`,
  `ncbi-flank-input`, `ncbi-import-region`, `ncbi-done`.

### 4. Chemistry literature explorer + starred DOIs
- Upgrade of the flat "Find in literature" list into an explorer popup
  (`LiteratureExplorer.tsx`): left filter rail (research / reviews / patents
  toggles + counts, starred-only, a papers-per-year histogram Google-Scholar
  style with two editable min/max YEAR inputs that re-scale the plot AND results),
  text search + sort, and a STAR per row. Built to the mockup
  `docs/mockups/2026-06-12-literature-explorer.html`. Commit `440977c05`.
- `Paper` gained `pubType` + `isReview` (Europe PMC `pubTypeList.pubType`, already
  fetched via resultType=core). New star/filter icons in the registry.
- **DATA-SHAPE (additive, back-compatible):** `MoleculeMeta.starred_papers?: StarredPaper[]`
  on `molecules/{id}.meta.json`, written via `moleculesApi.setStarredPapers`.
  Older molecules omit it (mirrors the `xlogp` descriptor pattern). Starred papers
  show as a strip when the molecule is reopened.
- data-testids: `lit-explorer-open`, `lit-explorer-star`,
  `lit-explorer-filter-research`, `lit-explorer-year-min`, `lit-explorer-year-max`.

## Status table
| Piece | State |
|---|---|
| Rich demo clips + prewarm | on main, NOT recorded yet (Grant records at foreground) |
| Extract to new sequence | on main, BROWSER-VALIDATED (Chrome, 3/3 pass) |
| NCBI backend (placement/contigs/window/esearch) | on main, tested + endpoints verified live |
| Guided NCBI wizard GUI | on main, gate-verified, NOT browser-verified |
| Literature explorer + starred DOIs | on main, gate-verified, NOT browser-verified |

## REMAINING WORK (next session)
1. **Demo clips for the two new features** (Grant approved making the guided NCBI
   flow the sequences clip; gliotoxin is the niche chemistry example, an A.
   fumigatus toxin that ties to the cyp51A organism). Script the cyp51A wizard
   walk + the gliotoxin lit/star beat, precache the NCBI/PMC calls. The clip
   scripts live in `lib/demo-video/scripts.ts`; add prewarms in `prewarm.ts`.
2. **Browser-test the wizard + the literature explorer** (Chrome-extension prompts,
   like the extract one). They are gate-verified only. The preloaded folder works
   for both (it has molecules + sequences).
3. **Two small follow-ups, both optional:** the Extract button is occluded by the
   DEV dock (3 dev-only buttons) on `/sequences` (absent in prod, hidden in record
   mode) so a layout change was held; and the wizard imports whole-genome with one
   click and no caps/size warning (the 29 MB jank case) -- `checkCaps`/`NCBI_CAPS`
   exist if you want a confirm gate.

## Gotchas / conventions reaffirmed
- **Mouse / pointer / drag testing goes to the Claude-in-Chrome extension**, not
  orchestrator Preview/Playwright (synthetic events miss drag thresholds). Hand
  Grant a self-contained prompt; he does the one-time native folder picker, the
  extension drives the rest. (AGENTS.md, `8c95dcbcc`.)
- **Sub-bots: commit early.** A bot finished the extract-locus work but DIED
  before committing; its changes were salvaged from the worktree (applied as a
  patch, reviewed, committed). Brief every build bot to commit as soon as the gate
  passes, not at the very end.
- **Merge bot branches by patch when the base is stale.** Apply
  `git diff <merge-base> <branch>` onto current main rather than merging a
  stale-anchored branch wholesale (one bot's branch lacked a just-committed engine
  change; a wholesale merge would have reverted it). Where the base is current and
  there is no overlap, `--no-ff` merge is fine.
- **Two data-shape fields landed, both additive + flagged:** the lit explorer's
  `MoleculeMeta.starred_papers`. Back-compatible, no migration.
- **The `?record=1` surface hides the dock + cursor**; the precache is record-mode
  gated, so production fetches are byte-for-byte unchanged.
- The shared main checkout keeps moving under you (other sessions' onboarding /
  splash commits interleaved). Always `git branch --show-current` before
  committing; stage explicit paths.

## Key commit list (this session, oldest -> newest)
`057d1923b` rightClick primitive -> `e64ef566d` + `b1d2767b3` prewarm movie-magic
-> `d549e9cc8` rich clips + testids -> `aca280108` NCBI backend -> `99e7757ac`
esearchGenes -> `b5d0e6371` extract-to-new-sequence -> `ceed0ab9c` Chrome test
prompt -> `bbbfbe0d4` + `4c0e6a27a` guided NCBI wizard -> `440977c05` +
`ddff01a9a` literature explorer. Mockups: `ae06c21d4` (NCBI), `08a1ac141` (lit).
Proposal: `docs/proposals/2026-06-12-guided-ncbi-genome-import.md`.
