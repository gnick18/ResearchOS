/**
 * Welcome-video clip scripts (the "prompt of exactly what to do" per clip).
 *
 * Each clip is a deterministic {@link DemoStep} list the demo engine plays with
 * its animated cursor. Targets are selectors / data-testids, so playback is
 * pixel-perfect and reproducible: re-run `/demo/<page>?record=1&demo=<id>` any
 * time to re-record. Tune pacing here (durationMs on moves, cadenceMs on typing,
 * times/intervalMs on scrolls).
 *
 * Filenames they map to (welcome page slots):
 *   chemistry -> chemistry-workbench.mp4
 *   dataHub   -> data-hub-stats.mp4
 *   sequences -> sequence-editor.mp4
 *   purchases -> purchases-inventory.mp4
 */
import type { DemoStep } from "./engine";

const NAV = (href: string): string => `a[href="${href}"]`;

const chemistry: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/chemistry"), durationMs: 850 },
  { action: "wait", ms: 1400 },
  // Open the PubChem search.
  { action: "click", target: { testid: "chem-rail-pubchem" }, durationMs: 800 },
  { action: "wait", ms: 600 },
  // Type a familiar compound.
  {
    action: "type",
    target: 'input[placeholder^="Compound name"]',
    text: "caffeine",
    cadenceMs: 95,
  },
  { action: "wait", ms: 450 },
  { action: "click", target: { testid: "pubchem-search-submit" }, durationMs: 600 },
  // PubChem fetch + render the candidate structures.
  { action: "wait", ms: 2400 },
  // Let the viewer read the real structures, then import caffeine.
  { action: "moveTo", target: { testid: "pubchem-import-btn" }, durationMs: 900 },
  { action: "wait", ms: 700 },
  { action: "click", target: { testid: "pubchem-import-btn" }, durationMs: 350 },
  // Land on the imported molecule.
  { action: "wait", ms: 2400 },
];

const RAIL = '[data-testid="datahub-rail"]';

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
  { action: "wait", ms: 1900 },
  // Show the validated t-test result.
  {
    action: "click",
    target: { textContains: "Unpaired t-test", within: RAIL },
    durationMs: 750,
  },
  { action: "wait", ms: 2000 },
  // Show the publication-ready bar plot (shortest "Heat-shock…" match is the
  // graph row, not the longer table row that also carries the COLUMN tag).
  {
    action: "click",
    target: { textContains: "Heat-shock survival by strain", within: RAIL },
    durationMs: 750,
  },
  { action: "wait", ms: 2800 },
];

const sequences: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/sequences"), durationMs: 850 },
  { action: "wait", ms: 2200 },
  // Spin the circular plasmid map (scroll-to-rotate) — the striking beat.
  { action: "moveTo", target: { testid: "la-vz-viewer-circular" }, durationMs: 900 },
  {
    action: "scroll",
    target: { testid: "la-vz-viewer-circular" },
    deltaY: 120,
    times: 16,
    intervalMs: 110,
  },
  { action: "wait", ms: 700 },
  // Highlight a stretch of the sequence -> the Tm / GC badge pops. fy 0.03
  // lands on the top base-letter row (NOT the feature annotation row ~0.12,
  // which selects the whole molecule); ~0.10->0.62 of the width is ~18 bp, a
  // short-enough range that the Tm shows.
  {
    action: "drag",
    target: { testid: "la-vz-viewer-linear" },
    fromFrac: [0.1, 0.03],
    toFrac: [0.62, 0.03],
    durationMs: 750,
    steps: 18,
  },
  { action: "wait", ms: 2400 },
];

const purchases: DemoStep[] = [
  { action: "wait", ms: 900 },
  { action: "click", target: NAV("/purchases"), durationMs: 850 },
  { action: "wait", ms: 2000 },
  // Log a new purchase.
  {
    action: "moveTo",
    target: '[data-tour-target="purchases-new-button"]',
    durationMs: 800,
  },
  { action: "wait", ms: 400 },
  {
    action: "click",
    target: '[data-tour-target="purchases-new-button"]',
    durationMs: 300,
  },
  { action: "wait", ms: 2600 },
];

export const DEMO_CLIPS: Record<string, DemoStep[]> = {
  chemistry,
  datahub: dataHub,
  sequences,
  purchases,
};

export type DemoClipId = keyof typeof DEMO_CLIPS;
