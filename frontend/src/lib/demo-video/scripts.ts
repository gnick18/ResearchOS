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

export const DEMO_CLIPS: Record<string, DemoStep[]> = {
  chemistry,
};

export type DemoClipId = keyof typeof DEMO_CLIPS;
