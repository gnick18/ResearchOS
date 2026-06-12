// sequences / ncbi-wizard. Pure helpers for the guided NCBI genome import flow.
//
// The wizard component (GuidedNcbiImport.tsx) owns the UI and the network calls.
// The handful of pure derivations it needs (the resolved efetch window around a
// gene, the human bp label, the step model) live here so they are unit-tested
// with no DOM and no network. Everything below is deterministic.

import type { GenePlacement } from "./ncbi-datasets";
import type { GeneSearchHit } from "./ncbi-esearch";
import { geneWindow } from "./ncbi-efetch";

/** The five guided steps, in order. The wizard renders one at a time and the
 *  rail highlights the active one. "done" (the import-complete state) is not a
 *  numbered step; it is a terminal screen. */
export const WIZARD_STEP_LABELS = [
  "Organism",
  "Reference",
  "Contigs",
  "Gene",
  "Window",
] as const;

export type WizardStep =
  | "organism"
  | "assemblies"
  | "contigs"
  | "gene"
  | "window"
  | "done";

/** The numbered steps in rail order. "done" is terminal and not in the rail. */
export const WIZARD_STEPS: WizardStep[] = [
  "organism",
  "assemblies",
  "contigs",
  "gene",
  "window",
];

/** The 1-based rail index of a step (1..5), or 0 for the terminal done screen. */
export function stepIndex(step: WizardStep): number {
  const i = WIZARD_STEPS.indexOf(step);
  return i < 0 ? 0 : i + 1;
}

/** Human bp label. Whole numbers under 10 kb read as plain bp with a thousands
 *  separator; larger reads as kb / Mb so a window size is scannable at a glance. */
export function formatBp(bp: number): string {
  if (!Number.isFinite(bp)) return "";
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(2)} Mb`;
  if (bp >= 10_000) return `${(bp / 1_000).toFixed(1)} kb`;
  return `${Math.round(bp).toLocaleString("en-US")} bp`;
}

/** A gene placement plus a chosen flank, resolved to the concrete efetch window.
 *  The contig length clamps the upper bound so the window never runs past the
 *  end of the chromosome. */
export interface ResolvedWindow {
  /** 1-based inclusive start on the contig. */
  start: number;
  /** 1-based inclusive stop on the contig (clamped to the contig length). */
  stop: number;
  /** Inclusive span in bp (stop - start + 1). */
  span: number;
}

/** Resolve the [begin - flank, end + flank] window around a placement, clamped
 *  to the contig length when known. A negative flank is treated as 0 so the
 *  region never inverts. */
export function resolveWindow(
  placement: Pick<GenePlacement, "begin" | "end">,
  flankBp: number,
  contigLengthBp?: number,
): ResolvedWindow {
  const flank = Math.max(0, Math.floor(flankBp) || 0);
  const { start, stop } = geneWindow(placement, flank, contigLengthBp);
  return { start, stop, span: stop - start + 1 };
}

/** Whether a gene search hit carries enough placement to window it directly. A
 *  hit without a contig accession or coordinates can still be shown, but it
 *  routes the user to the contig browse / accession path instead of the window
 *  step. */
export function hitHasPlacement(
  hit: Pick<GeneSearchHit, "contigAccession" | "begin" | "end">,
): hit is GeneSearchHit & {
  contigAccession: string;
  begin: number;
  end: number;
} {
  return (
    typeof hit.contigAccession === "string" &&
    hit.contigAccession.length > 0 &&
    typeof hit.begin === "number" &&
    typeof hit.end === "number"
  );
}

/** Turn a gene search hit with placement into the GenePlacement shape the window
 *  step renders. Caller must have checked hitHasPlacement first. */
export function placementFromHit(
  hit: GeneSearchHit & { contigAccession: string; begin: number; end: number },
): GenePlacement {
  return {
    symbol: hit.symbol,
    geneId: hit.geneId,
    contigAccession: hit.contigAccession,
    contigName: hit.chrName,
    begin: hit.begin,
    end: hit.end,
    orientation: hit.orientation ?? "plus",
  };
}

/** The NCBI Gene web search URL used as the empty-result fallback. Scoped to the
 *  organism so the user lands on a sensible result page. */
export function ncbiGeneSearchUrl(organism: string): string {
  const term = (organism || "").trim();
  return `https://www.ncbi.nlm.nih.gov/gene/?term=${encodeURIComponent(term)}`;
}
