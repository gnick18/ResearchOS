// Markdown embed hybrid, captions + numbering polish (2026-06-11).
//
// Opt-in figure / table numbering for a single document. A document turns it on
// with a one-line directive anywhere in its body:
//
//   <!-- ros:number-figures -->
//
// This is per-document by design (it lives in the doc, no global setting, no
// extra persistence) so an experiment's results doc can be numbered while its
// lab notes are not. When on, every block embed that is a figure gets a
// "Figure N" label and every Data Hub table gets a "Table N" label, numbered
// independently in document order.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { parseObjectEmbed } from "@/lib/references";

/** The opt-in directive. Tolerant of surrounding whitespace. */
export const FIGURE_DIRECTIVE = /<!--\s*ros:number-figures\s*-->/i;

/** A block embed counts as a Table when it is a Data Hub table preview, else a
 *  Figure (a map, structure, plot, result, and so on). */
function kindForEmbed(type: string, view: string): "Figure" | "Table" {
  if (type === "datahub" && (view === "table" || view === "summary")) return "Table";
  return "Figure";
}

export interface FigureNumberPlan {
  /** Whether the document opted into numbering. */
  enabled: boolean;
  /** The label ("Figure 1", "Table 2") for the Nth block OBJECT embed in document
   *  order, or undefined when numbering is off or the index is out of range. */
  labelAt: (index: number) => string | undefined;
}

/**
 * Scan a document's markdown for the numbering directive and, when present,
 * assign Figure / Table labels to the block object embeds in document order. A
 * block object embed is a line that is exactly one object-embed link
 * (`[caption](/deeplink#ros=view)`). Inline mentions and images are not numbered.
 */
export function buildFigureNumberPlan(content: string): FigureNumberPlan {
  if (!content || !FIGURE_DIRECTIVE.test(content)) {
    return { enabled: false, labelAt: () => undefined };
  }
  const labels: string[] = [];
  let figures = 0;
  let tables = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const m = /^\[.*\]\((\S+)\)$/.exec(trimmed);
    if (!m) continue;
    const descriptor = parseObjectEmbed(m[1]);
    if (!descriptor || !descriptor.isEmbed) continue;
    const kind = kindForEmbed(descriptor.type, descriptor.view);
    labels.push(kind === "Table" ? `Table ${++tables}` : `Figure ${++figures}`);
  }
  return { enabled: true, labelAt: (i) => labels[i] };
}
