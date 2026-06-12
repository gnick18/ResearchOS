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
// literature. Shows 4 features. Beat 4 (literature) is a live network call. ---
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
  // Beat 3: structure search — find caffeine by its purine scaffold (local RDKit,
  // no network). "Search by structure" toggle is an exact-text button.
  { action: "click", target: { textContains: "Search by structure" }, durationMs: 750 },
  { action: "wait", ms: 400 },
  {
    action: "type",
    target: { testid: "chem-structure-query-input" },
    text: "cn1cnc2c1ncnc2",
    cadenceMs: 80,
    clear: true,
  },
  { action: "wait", ms: 1400 },
  // Beat 4: literature + patent search for the compound (live Europe PMC + PubChem;
  // bump the final wait to ~5000 if the API is slow at record time).
  { action: "click", target: { testid: "chem-rail-literature" }, durationMs: 850 },
  { action: "wait", ms: 700 },
  {
    action: "type",
    target: { testid: "lit-search-input" },
    text: "caffeine",
    cadenceMs: 90,
    clear: true,
  },
  { action: "wait", ms: 350 },
  { action: "click", target: { testid: "lit-search-submit" }, durationMs: 600 },
  { action: "wait", ms: 3800 },
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

export const DEMO_CLIPS: Record<string, DemoStep[]> = {
  chemistry,
  datahub: dataHub,
  sequences,
  purchases,
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
];
