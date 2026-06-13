/**
 * Welcome-video clip scripts (the "prompt of exactly what to do" per clip).
 *
 * Each clip is a deterministic {@link DemoStep} list the demo engine plays with
 * its animated cursor. Targets are selectors / data-testids, so playback is
 * pixel-perfect and reproducible: re-run `/demo?record=1&demo=<id>` any time to
 * re-record. Tune pacing here (durationMs on moves, cadenceMs on typing,
 * times/intervalMs on scrolls).
 *
 * These are RICH feature showcases (4-5 features per page), not the old thin
 * 3-beat clips. Every target was source-verified; a few beats depend on live
 * state (PubChem / Europe PMC network, RDKit wasm timing) and are flagged in
 * comments so pacing can be bumped at recording time.
 *
 * Filenames they map to (welcome page slots):
 *   chemistry -> chemistry-workbench.mp4
 *   datahub   -> data-hub-stats.mp4
 *   sequences -> sequence-editor.mp4
 *   purchases -> purchases-inventory.mp4
 */
import type { DemoStep } from "./engine";

const NAV = (href: string): string => `a[href="${href}"]`;

// --- Chemistry Workbench: PubChem import -> properties -> structure search ->
// literature EXPLORER (filter rail + per-year histogram + star). Beat 4 opens the
// explorer from the molecule's Papers & patents and is a live network call. ---
const chemistry: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/chemistry"), durationMs: 850 },
  { action: "wait", ms: 1400 },
  // Beat 1: PubChem search for a familiar compound.
  { action: "click", target: { testid: "chem-rail-pubchem" }, durationMs: 800 },
  { action: "wait", ms: 600 },
  {
    action: "type",
    target: 'input[placeholder^="Compound name"]',
    text: "caffeine",
    cadenceMs: 95,
  },
  { action: "wait", ms: 400 },
  { action: "click", target: { testid: "pubchem-search-submit" }, durationMs: 600 },
  // PubChem fetch + candidate structures render (live network).
  { action: "wait", ms: 2400 },
  { action: "moveTo", target: { testid: "pubchem-import-btn" }, durationMs: 900 },
  { action: "wait", ms: 600 },
  { action: "click", target: { testid: "pubchem-import-btn" }, durationMs: 350 },
  // Molecule detail loads; RDKit wasm computes properties (~2s on modern HW).
  { action: "wait", ms: 2600 },
  // Beat 2: glide over the computed properties (cLogP, TPSA, Lipinski).
  { action: "moveTo", target: { testid: "mol-detail-props" }, durationMs: 900 },
  { action: "wait", ms: 1200 },
  // Beat 3: substructure search of the local library (local RDKit, no network).
  // Query a benzene ring; it matches Resveratrol in the demo library. NOTE: do
  // NOT query an aromatic purine for caffeine here -- caffeine is a xanthine
  // (its six-membered ring carbons are carbonyls, not aromatic), so a fully
  // aromatic purine substructure correctly matches nothing. "Search by
  // structure" toggle is an exact-text button.
  { action: "click", target: { textContains: "Search by structure" }, durationMs: 750 },
  { action: "wait", ms: 400 },
  {
    action: "type",
    target: { testid: "chem-structure-query-input" },
    text: "c1ccccc1",
    cadenceMs: 90,
    clear: true,
  },
  { action: "wait", ms: 1400 },
  // Beat 4: the LITERATURE EXPLORER (the filter rail + per-year histogram + star),
  // reached from caffeine's molecule detail. The hub "Find in literature" rail is
  // the flat quick-list; the explorer (the cool toggles) opens via "View all" on a
  // molecule's Papers & patents, so we drive it there. caffeine's detail is still
  // the main pane after the rail substructure search above. Live Europe PMC +
  // PubChem; bump the waits if the API is slow at record time.
  { action: "click", target: { textContains: "Find papers and patents" }, durationMs: 800 },
  { action: "wait", ms: 3200 },
  { action: "moveTo", target: { testid: "lit-explorer-open" }, durationMs: 800 },
  { action: "click", target: { testid: "lit-explorer-open" }, durationMs: 350 },
  { action: "wait", ms: 1300 },
  // Narrow the year range (rescales the histogram + the list).
  {
    action: "type",
    target: { testid: "lit-explorer-year-min" },
    text: "2015",
    cadenceMs: 110,
    clear: true,
  },
  { action: "wait", ms: 1000 },
  // Toggle the Research type filter off then on.
  { action: "click", target: { testid: "lit-explorer-filter-research" }, durationMs: 600 },
  { action: "wait", ms: 900 },
  { action: "click", target: { testid: "lit-explorer-filter-research" }, durationMs: 400 },
  { action: "wait", ms: 700 },
  // Star a paper (persists to caffeine's starred_papers).
  { action: "moveTo", target: { testid: "lit-explorer-star" }, durationMs: 700 },
  { action: "click", target: { testid: "lit-explorer-star" }, durationMs: 350 },
  { action: "wait", ms: 1800 },
];

const RAIL = '[data-testid="datahub-rail"]';

// --- Data Hub: table -> t-test -> bar plot -> graph-style tweaks -> guided
// analysis. The graph-style toggles read as "publication-figure control". Guided
// analysis is LAST so its wizard dialog never blocks an earlier beat. ---
const dataHub: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/datahub"), durationMs: 850 },
  { action: "wait", ms: 1600 },
  // Open the two-group table (Control vs FakeYeast strains, replicates).
  {
    action: "click",
    target: { textContains: "Heat-shock survival by strain", within: RAIL },
    durationMs: 850,
  },
  { action: "wait", ms: 1700 },
  // Show the validated t-test result.
  {
    action: "click",
    target: { textContains: "Unpaired t-test", within: RAIL },
    durationMs: 750,
  },
  { action: "wait", ms: 1800 },
  // Show the publication-ready bar plot (shortest "Heat-shock…" match is the
  // graph row, not the longer table row that also carries the COLUMN tag).
  {
    action: "click",
    target: { textContains: "Heat-shock survival by strain", within: RAIL },
    durationMs: 750,
  },
  { action: "wait", ms: 1600 },
  // Graph-style beats: tweak the figure the way you would for a paper.
  { action: "moveTo", target: { testid: "datahub-charttype-columnScatter" }, durationMs: 600 },
  { action: "click", target: { testid: "datahub-charttype-columnScatter" }, durationMs: 350 },
  { action: "wait", ms: 800 },
  { action: "click", target: { testid: "datahub-charttype-columnBar" }, durationMs: 350 },
  { action: "wait", ms: 600 },
  // Error bars SEM -> SD.
  { action: "click", target: { testid: "datahub-errorbars-sd" }, durationMs: 400 },
  { action: "wait", ms: 800 },
  // Overlay the individual data points.
  { action: "click", target: { testid: "datahub-points-on" }, durationMs: 400 },
  { action: "wait", ms: 900 },
  // Closing flourish: open the guided-analysis wizard (last beat — if the dialog
  // stays up the clip is already done, nothing to unblock).
  { action: "moveTo", target: { testid: "datahub-guided-analysis-button" }, durationMs: 700 },
  { action: "click", target: { testid: "datahub-guided-analysis-button" }, durationMs: 400 },
  { action: "wait", ms: 1600 },
];

// --- Sequence editor: open pEGFP-N1 (4,733 bp) -> spin the map -> enzyme sites
// -> translation -> flip to Sequence view -> Tm/GC drag -> Gibson assembly.
// pEGFP-N1 is fixture id 1 (demo-data/users/alex/sequences/1.gb). ---
const sequences: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/sequences"), durationMs: 850 },
  { action: "wait", ms: 2200 },
  // Open the detailed plasmid from the library list.
  { action: "moveTo", target: { testid: "seq-list-row-1" }, durationMs: 700 },
  { action: "click", target: { testid: "seq-list-row-1" }, durationMs: 400 },
  { action: "wait", ms: 1800 },
  // Beat 1: spin the circular plasmid map (scroll-to-rotate) — the striking beat.
  { action: "moveTo", target: { testid: "la-vz-viewer-circular" }, durationMs: 800 },
  {
    action: "scroll",
    target: { testid: "la-vz-viewer-circular" },
    deltaY: 120,
    times: 12,
    intervalMs: 110,
  },
  { action: "wait", ms: 600 },
  // Beat 2: toggle restriction / Enzyme sites onto the ring.
  { action: "moveTo", target: `[aria-label="Enzyme sites"]`, durationMs: 700 },
  { action: "click", target: `[aria-label="Enzyme sites"]`, durationMs: 350 },
  { action: "wait", ms: 1200 },
  // Beat 3: show the amino-acid Translation track under the CDS features.
  { action: "moveTo", target: `[aria-label="Translation"]`, durationMs: 600 },
  { action: "click", target: `[aria-label="Translation"]`, durationMs: 350 },
  { action: "wait", ms: 900 },
  // Beat 4: flip to Sequence view so the linear base-letter canvas loads.
  { action: "moveTo", target: { testid: "seq-tab-sequence" }, durationMs: 600 },
  { action: "click", target: { testid: "seq-tab-sequence" }, durationMs: 350 },
  { action: "wait", ms: 1400 },
  // Beat 5: drag-highlight a stretch on the linear canvas -> the Tm / GC badge
  // pops. fy 0.03 = the top base-letter row (NOT the feature row ~0.12, which
  // select-alls); ~0.10->0.62 of the width is ~18 bp, short enough that Tm shows.
  {
    action: "drag",
    target: { testid: "la-vz-viewer-linear" },
    fromFrac: [0.1, 0.03],
    toFrac: [0.62, 0.03],
    durationMs: 750,
    steps: 18,
  },
  { action: "wait", ms: 1800 },
  // Beat 6: open the Gibson / cloning assembly workspace.
  { action: "moveTo", target: { text: "Assemble" }, durationMs: 800 },
  { action: "click", target: { text: "Assemble" }, durationMs: 350 },
  { action: "wait", ms: 1800 },
];

// --- Purchases + Inventory: order list -> filter chips -> expand an order's
// line items -> spending dashboard -> New Purchase. Row selector is an
// attribute-prefix match so it hits the first row regardless of owner id. ---
const purchases: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/purchases"), durationMs: 850 },
  { action: "wait", ms: 2000 },
  // Beat 1: filter the list by stage (Needs ordering), then reset.
  {
    action: "click",
    target: `[data-tour-target="purchases-order-status-needs_ordering"]`,
    durationMs: 700,
  },
  { action: "wait", ms: 900 },
  {
    action: "click",
    target: `[data-tour-target="purchases-order-status-any"]`,
    durationMs: 600,
  },
  { action: "wait", ms: 600 },
  // Beat 2: filter by category (Project purchases), then reset.
  {
    action: "click",
    target: `[data-tour-target="purchases-filter-project"]`,
    durationMs: 700,
  },
  { action: "wait", ms: 700 },
  {
    action: "click",
    target: `[data-tour-target="purchases-filter-all"]`,
    durationMs: 600,
  },
  { action: "wait", ms: 600 },
  // Beat 3: expand an order to reveal its line items (first row in the list).
  { action: "moveTo", target: `[data-testid^="purchase-row-"]`, durationMs: 700 },
  { action: "click", target: `[data-testid^="purchase-row-"]`, durationMs: 400 },
  { action: "wait", ms: 1400 },
  // Beat 4: bring the spending dashboard (funding rollup + breakdown) into view.
  { action: "moveTo", target: { testid: "purchases-spending-dashboard" }, durationMs: 800 },
  { action: "wait", ms: 1200 },
  // Beat 5: log a new purchase.
  {
    action: "moveTo",
    target: '[data-tour-target="purchases-new-button"]',
    durationMs: 800,
  },
  { action: "wait", ms: 400 },
  {
    action: "click",
    target: '[data-tour-target="purchases-new-button"]',
    durationMs: 350,
  },
  { action: "wait", ms: 1800 },
];

// --- Guided NCBI genome import (the wizard) -> the cyp51A walk. An ALTERNATE
// sequences clip showcasing the new feature: type an organism, pick its
// reference genome, browse chromosomes, search a gene by NAME, grab a window.
// Worked example: Aspergillus fumigatus / cyp51A. Every step is a live NCBI
// round trip (taxonomy, assemblies, contigs, gene search, efetch); the prewarm
// warms the whole chain during the countdown so each lands instantly. If the API
// is slow at record time, bump the waits (the engine also polls each target up
// to 8s, so a slow step self-paces). LIVE-STATE beats are flagged inline. ---
const sequencesNcbi: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/sequences"), durationMs: 850 },
  { action: "wait", ms: 1800 },
  // Open the guided "Download from NCBI" wizard (header action; the demo fixture
  // has a collection, so the header button is present, not the launcher card).
  { action: "click", target: { textContains: "Download from NCBI" }, durationMs: 800 },
  { action: "wait", ms: 900 },
  // Step 1: type an organism, NCBI Taxonomy autocompletes (live, debounced 280ms).
  {
    action: "type",
    target: { testid: "ncbi-organism-input" },
    text: "Aspergillus fumigatus",
    cadenceMs: 70,
  },
  // Suggestions return; pick the first taxon row (the species match).
  { action: "wait", ms: 1600 },
  { action: "moveTo", target: { testid: "ncbi-taxon-row" }, durationMs: 700 },
  { action: "click", target: { testid: "ncbi-taxon-row" }, durationMs: 350 },
  // Step 2: assemblies list (live). The reference genome is badged. Click the
  // first row's browse button (the testid is on the row div, so target the inner
  // button) to walk into its chromosomes.
  { action: "wait", ms: 1800 },
  {
    action: "click",
    target: `[data-testid="ncbi-assembly-row"] button`,
    durationMs: 800,
  },
  // Step 3: chromosomes for that assembly (live). Rather than guess a contig,
  // jump straight to the by-name gene search (the wizard lands you on the right
  // chromosome from the gene's placement).
  { action: "wait", ms: 1800 },
  {
    action: "click",
    target: { textContains: "Search a gene instead" },
    durationMs: 800,
  },
  { action: "wait", ms: 700 },
  // Step 4: search the gene by NAME (no accession needed), scoped to the organism.
  {
    action: "type",
    target: { testid: "ncbi-gene-input" },
    text: "cyp51A",
    cadenceMs: 90,
  },
  { action: "wait", ms: 350 },
  { action: "click", target: { testid: "ncbi-gene-search" }, durationMs: 600 },
  // Hits return (live esearch). Click the first hit. LIVE-STATE: the first hit
  // must carry a chromosome placement (placed rows are enabled); cyp51A in this
  // organism does. If a record without placement sorts first at record time,
  // re-take (backtick) or click a placed row.
  { action: "wait", ms: 1900 },
  { action: "moveTo", target: { testid: "ncbi-gene-row" }, durationMs: 700 },
  { action: "click", target: { testid: "ncbi-gene-row" }, durationMs: 350 },
  // Step 5: the window. Dwell on the strand bar (gene + promoter/terminator
  // flank). Leave the flank at its 1kb default so the warmed efetch URL matches.
  { action: "wait", ms: 1400 },
  { action: "moveTo", target: { testid: "ncbi-flank-input" }, durationMs: 700 },
  { action: "wait", ms: 1200 },
  // Import only that slice (live efetch of the gene-plus-flank window, tens of KB,
  // instant; warmed during the countdown).
  { action: "moveTo", target: { testid: "ncbi-import-region" }, durationMs: 700 },
  { action: "click", target: { testid: "ncbi-import-region" }, durationMs: 350 },
  // Done screen: the annotated region is now in the library.
  { action: "wait", ms: 2200 },
  { action: "moveTo", target: { testid: "ncbi-done" }, durationMs: 700 },
  { action: "wait", ms: 1400 },
];

// --- Chemistry literature explorer -> the gliotoxin walk. An ALTERNATE
// chemistry clip showcasing the new explorer (filters + per-year histogram +
// star a DOI). gliotoxin is the niche example: an Aspergillus fumigatus toxin,
// tying to the cyp51A organism in the sequences clip. Import the compound, open
// its Papers & patents, launch the explorer, filter, and star a paper. Beats 1
// and 4 are live Europe PMC / PubChem calls (warmed during the countdown). ---
const chemistryGliotoxin: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/chemistry"), durationMs: 850 },
  { action: "wait", ms: 1400 },
  // Import the compound from PubChem (live network).
  { action: "click", target: { testid: "chem-rail-pubchem" }, durationMs: 800 },
  { action: "wait", ms: 600 },
  {
    action: "type",
    target: 'input[placeholder^="Compound name"]',
    text: "gliotoxin",
    cadenceMs: 90,
  },
  { action: "wait", ms: 400 },
  { action: "click", target: { testid: "pubchem-search-submit" }, durationMs: 600 },
  { action: "wait", ms: 2400 },
  { action: "moveTo", target: { testid: "pubchem-import-btn" }, durationMs: 900 },
  { action: "click", target: { testid: "pubchem-import-btn" }, durationMs: 350 },
  // Molecule detail loads (RDKit computes properties; warmed wasm).
  { action: "wait", ms: 2600 },
  { action: "moveTo", target: { testid: "mol-detail-props" }, durationMs: 900 },
  { action: "wait", ms: 900 },
  // Expand the literature panel (lazy mount), then open the full explorer.
  {
    action: "click",
    target: { textContains: "Find papers and patents" },
    durationMs: 800,
  },
  // Europe PMC + PubChem fetch (live, warmed). The "View all" button appears once
  // the panel has its items.
  { action: "wait", ms: 3000 },
  { action: "moveTo", target: { testid: "lit-explorer-open" }, durationMs: 800 },
  { action: "click", target: { testid: "lit-explorer-open" }, durationMs: 350 },
  { action: "wait", ms: 1200 },
  // Inside the explorer: narrow the year range (rescales the histogram + list).
  {
    action: "type",
    target: { testid: "lit-explorer-year-min" },
    text: "2015",
    cadenceMs: 110,
    clear: true,
  },
  { action: "wait", ms: 1000 },
  // Toggle the Research type filter off then on (reviews + patents stand out).
  { action: "click", target: { testid: "lit-explorer-filter-research" }, durationMs: 600 },
  { action: "wait", ms: 900 },
  { action: "click", target: { testid: "lit-explorer-filter-research" }, durationMs: 400 },
  { action: "wait", ms: 700 },
  // Star a paper (persists to the molecule's starred_papers sidecar).
  { action: "moveTo", target: { testid: "lit-explorer-star" }, durationMs: 700 },
  { action: "click", target: { testid: "lit-explorer-star" }, durationMs: 350 },
  { action: "wait", ms: 1600 },
];

// --- Check-ins (the 1:1 / mentorship surface, "built for academic labs"):
// the relationship rail -> the lab mentorship tree -> a trainee's IDP -> the
// group check-in task board -> the presenter rotation -> the career-stage
// templates. Recorded as MIRA (the lab head) via demoViewAs, so the tree shows
// the whole lab and the IDP is reviewed from the mentor side. All data is the
// in-memory demo fixture (no network), so pacing is forgiving and the engine's
// per-target wait covers any mount lag. Space-row beats target the space's
// distinctive label; if a label match opens the wrong row at record time,
// re-take (backtick). ---
const PANEL = '[data-testid="workbench-oneonone-panel"]';
const checkins: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/workbench"), durationMs: 850 },
  { action: "wait", ms: 1500 },
  // Beat 1: open the Check-ins tab. The rail groups spaces by relationship
  // (your mentees, skip-level, groups).
  { action: "moveTo", target: `[data-tour-target="workbench-oneonone-tab"]`, durationMs: 700 },
  { action: "click", target: `[data-tour-target="workbench-oneonone-tab"]`, durationMs: 350 },
  { action: "wait", ms: 1600 },
  // Beat 2: the lab mentorship tree. As Mira it shows the branch + depth
  // (Mira -> Alex, Morgan, Remy; Alex -> Remy).
  { action: "moveTo", target: { testid: "oneonone-view-tree-rail" }, durationMs: 700 },
  { action: "click", target: { testid: "oneonone-view-tree-rail" }, durationMs: 350 },
  { action: "wait", ms: 1800 },
  { action: "moveTo", target: { testid: "mentorship-tree" }, durationMs: 800 },
  { action: "wait", ms: 1800 },
  { action: "click", target: { testid: "oneonone-tree-close" }, durationMs: 500 },
  { action: "wait", ms: 900 },
  // Beat 3: open Alex's check-in, then the IDP (individual development plan).
  // The IDP tab only shows on a mentoring pair; "Alex" is the pair's label.
  { action: "click", target: { textContains: "Alex", within: PANEL }, durationMs: 800 },
  { action: "wait", ms: 1300 },
  { action: "click", target: { textContains: "IDP", within: PANEL }, durationMs: 700 },
  { action: "wait", ms: 1500 },
  { action: "moveTo", target: { testid: "idp-form" }, durationMs: 800 },
  { action: "wait", ms: 2000 },
  // Beat 4: open the group check-in, then its per-assignee task board.
  { action: "click", target: { textContains: "FakeYeast group meeting", within: PANEL }, durationMs: 800 },
  { action: "wait", ms: 1300 },
  { action: "click", target: { textContains: "Task board", within: PANEL }, durationMs: 700 },
  { action: "wait", ms: 1400 },
  { action: "moveTo", target: { testid: "oneonone-board-scope-everyone" }, durationMs: 700 },
  { action: "wait", ms: 1400 },
  // Beat 5: the presenter rotation (data presentation + journal club tracks).
  { action: "click", target: { textContains: "Rotation", within: PANEL }, durationMs: 700 },
  { action: "wait", ms: 1300 },
  { action: "moveTo", target: { testid: "rotation-area" }, durationMs: 800 },
  { action: "wait", ms: 1800 },
  // Beat 6: closing flourish — start a check-in to reveal the career-stage
  // template gallery (undergrad / grad / postdoc / staff / thesis committee).
  // Ends with the gallery open, nothing to unblock.
  { action: "moveTo", target: { testid: "oneonone-start-rail" }, durationMs: 700 },
  { action: "click", target: { testid: "oneonone-start-rail" }, durationMs: 350 },
  { action: "wait", ms: 1200 },
  { action: "moveTo", target: { testid: "oneonone-template-gallery" }, durationMs: 800 },
  { action: "wait", ms: 1800 },
];

export const DEMO_CLIPS: Record<string, DemoStep[]> = {
  chemistry,
  datahub: dataHub,
  sequences,
  purchases,
  sequencesNcbi,
  chemistryGliotoxin,
  checkins,
};

export type DemoClipId = keyof typeof DEMO_CLIPS;

/** Display metadata for the demo-video studio launcher (dev/demo-videos). */
export interface DemoClipMeta {
  id: string;
  label: string;
  /** Welcome-page mp4 slot this clip records into. */
  file: string;
  /** One-line "no <tool>" hook. */
  hook: string;
  summary: string;
  /** Optional demo "view as" persona for the recording surface (the `/demo`
   *  route's internal `?demoViewAs=` override). Defaults to alex when absent.
   *  Used by the check-ins clip to record the lab-head (Mira) view. */
  viewAs?: string;
}

export const DEMO_CLIP_META: DemoClipMeta[] = [
  {
    id: "chemistry",
    label: "Chemistry Workbench",
    file: "chemistry-workbench.mp4",
    hook: "no ChemDraw / SciFinder license",
    summary:
      "Import caffeine from PubChem, read its computed properties, search by structure, then pull the literature.",
  },
  {
    id: "datahub",
    label: "Data Hub (stats + figure)",
    file: "data-hub-stats.mp4",
    hook: "no Prism license",
    summary:
      "Open the two-group table, show the validated t-test and bar plot, tweak the figure style, open guided analysis.",
  },
  {
    id: "sequences",
    label: "Sequence editor",
    file: "sequence-editor.mp4",
    hook: "no SnapGene",
    summary:
      "Open pEGFP-N1, spin the map, show enzyme sites + protein translation, pop the Tm/GC badge, open Gibson assembly.",
  },
  {
    id: "purchases",
    label: "Purchases + Inventory",
    file: "purchases-inventory.mp4",
    hook: "no Quartzy",
    summary:
      "Filter the order list, expand an order's line items, show the spending rollup, then log a new purchase.",
  },
  {
    id: "sequencesNcbi",
    label: "Guided NCBI import (alt)",
    file: "sequence-editor.mp4",
    hook: "no accession hunting",
    summary:
      "Alternate sequences clip: the guided NCBI wizard. Type an organism, pick its reference genome, browse chromosomes, search cyp51A by name, grab a 1kb window.",
  },
  {
    id: "chemistryGliotoxin",
    label: "Literature explorer (alt)",
    file: "chemistry-workbench.mp4",
    hook: "no SciFinder license",
    summary:
      "Alternate chemistry clip: import gliotoxin, open its Papers & patents, launch the explorer, narrow the year range, filter by type, and star a paper.",
  },
  {
    id: "checkins",
    label: "Check-ins (built for labs)",
    file: "checkins-mentorship.mp4",
    hook: "built for academic labs",
    summary:
      "Recorded as the lab head: the relationship rail, the lab mentorship tree, a trainee's IDP, the group task board, the presenter rotation, and the career-stage templates.",
    viewAs: "mira",
  },
];
