// Onboarding tutor — the showcase choreography (pure data).
//
// Each DEEP demo is Beaker driving a real surface with his presenter cursor,
// following the same five-phase spine from the demo scripts:
//   ARRIVE -> SEED -> ACT (cursor move + click) -> REVEAL (morph) -> HANDOFF.
// This module encodes that spine per surface as plain data the showcase player
// walks. It holds NO behavior, just the ordered steps, their dwell times, the
// cursor targets (logical ids the live layer resolves via guide_to_element), and
// the humanized narration line.
//
// Narration is the voice-checked copy from docs/proposals/2026-06-14-onboarding-
// demo-scripts.md. House style: every line names a capability, never interprets
// data. No emojis, no em-dashes, no mid-sentence colons.

import type { Surface } from "./reel-director";

export type StepKind =
  | "arrive" // navigate to the route, page morphs in
  | "seed" // the ephemeral sample object appears
  | "cursor_move" // presenter cursor eases to a target control
  | "click" // presenter cursor clicks the target (click ring)
  | "reveal" // the result animates in via the existing morph
  | "narrate"; // coach bubble shows the handoff line

export interface ChoreoStep {
  kind: StepKind;
  /** Logical control id for cursor_move / click, resolved on the live page. */
  target?: string;
  /** Coach-bubble line for narrate steps. */
  line?: string;
  /** How long this step dwells before the player advances. */
  durationMs: number;
}

export interface SurfaceChoreography {
  surface: Surface;
  /** Where Beaker navigates for the ARRIVE step. */
  route: string;
  /** Ephemeral seed descriptor key (resolved against the seed layer). */
  seedKind: string;
  steps: ChoreoStep[];
}

// Standard dwell times (ms). Tunable, not load-bearing on correctness.
const D = { arrive: 900, seed: 700, move: 800, click: 500, reveal: 1100, narrate: 2600 };

/** Build the common five-phase spine. Each surface supplies its targets + line. */
function spine(opts: {
  surface: Surface;
  route: string;
  seedKind: string;
  target: string;
  line: string;
}): SurfaceChoreography {
  return {
    surface: opts.surface,
    route: opts.route,
    seedKind: opts.seedKind,
    steps: [
      { kind: "arrive", durationMs: D.arrive },
      { kind: "seed", durationMs: D.seed },
      { kind: "cursor_move", target: opts.target, durationMs: D.move },
      { kind: "click", target: opts.target, durationMs: D.click },
      { kind: "reveal", durationMs: D.reveal },
      { kind: "narrate", line: opts.line, durationMs: D.narrate },
    ],
  };
}

export const CHOREOGRAPHIES: Record<Surface, SurfaceChoreography> = {
  datahub: spine({
    surface: "datahub",
    route: "/datahub",
    seedKind: "resistance_table",
    target: "datahub-plot-button",
    line: "Click once and a table becomes a figure you could drop straight into a paper. Your own data works the same way.",
  }),
  phylo: spine({
    surface: "phylo",
    route: "/phylo",
    seedKind: "small_tree",
    target: "phylo-export-tab",
    line: "You can shape a tree and export it at the exact size your figure needs.",
  }),
  methods: spine({
    surface: "methods",
    route: "/methods",
    seedKind: "sample_method",
    target: "method-view-on-phone",
    line: "Once a protocol's written, you can follow it on your phone at the bench, one step at a time.",
  }),
  sequences: spine({
    surface: "sequences",
    route: "/sequences",
    seedKind: "sample_sequence",
    target: "sequence-annotate-button",
    line: "You can annotate a sequence and check a primer's Tm right where you're working.",
  }),
  chemistry: spine({
    surface: "chemistry",
    route: "/chemistry",
    seedKind: "sample_smiles",
    target: "chemistry-render-button",
    line: "Paste a structure and it draws itself, ready for reactions and stoichiometry.",
  }),
  inventory: spine({
    surface: "inventory",
    route: "/supplies",
    seedKind: "low_stock_item",
    target: "inventory-reorder-button",
    line: "When something runs low, you can reorder it in a click and scan the barcode when it lands.",
  }),
  people: spine({
    surface: "people",
    route: "/people",
    seedKind: "sample_roster",
    target: "people-member-card",
    line: "This is where you keep an eye on the lab, who's working on what, and how everyone's growing.",
  }),
};

export function choreographyFor(surface: Surface): SurfaceChoreography {
  return CHOREOGRAPHIES[surface];
}
