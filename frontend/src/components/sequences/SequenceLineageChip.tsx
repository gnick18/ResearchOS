"use client";

// sequence editor master. The calm organism + taxonomy-lineage line shown on an
// enriched sequence (in the editor header strip). Major ranks read inline; a
// click expands the full chain. Self-hides when the sequence has no organism and
// no lineage, so a native / non-enriched sequence shows nothing.
//
// Every listed level is CLICKABLE. The organism name and each inline major-rank
// name open the tree-of-life explorer centered on THAT level (organism, genus,
// family, phylum, and so on), so the user can dive into the tree at any depth of
// their sequence's lineage. The trailing "Explore in tree" link is the catch-all,
// centered on the organism. Each affordance carries a Tooltip and reads as a link.
//
// Inline SVG icons (no emoji), <Tooltip> for the icon-only expand control, site
// typography tokens. No em-dash, no mid-sentence colon.

import { useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { majorRanks, type TaxonomyNode } from "@/lib/sequences/ncbi-datasets";
import type { SequenceTaxonNode } from "@/lib/types";

/** A small caret that points right when collapsed, down when open. */
function CaretIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${open ? "rotate-90" : ""} transition-transform ${className ?? ""}`}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

/** A tiny life-tree glyph marking the organism line. */
function LineageIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 20.5V7" />
      <path d="M10.5 20.5h3" />
      <circle cx="12" cy="4.8" r="1.7" />
      <path d="M12 11 7.6 8.4" />
      <circle cx="6.2" cy="7.6" r="1.7" />
      <path d="M12 11 16.4 8.4" />
      <circle cx="17.8" cy="7.6" r="1.7" />
      <path d="M12 15 8 12.9" />
      <circle cx="6.6" cy="12.1" r="1.7" />
      <path d="M12 15 16 12.9" />
      <circle cx="17.4" cy="12.1" r="1.7" />
    </svg>
  );
}

export interface SequenceLineageChipProps {
  organism?: string;
  taxId?: string;
  lineage?: SequenceTaxonNode[];
  /** Optional cross-link into the taxonomy tree explorer, centered on this
   *  sequence's tax id. The affordance shows only when a tax id and the handler
   *  are both present. */
  onExploreInTree?: (taxId: string) => void;
}

/** Title-case a rank label for display ("phylum" -> "Phylum"). */
function rankLabel(rank: string): string {
  if (!rank) return "";
  return rank.charAt(0).toUpperCase() + rank.slice(1);
}

export default function SequenceLineageChip({
  organism,
  taxId,
  lineage,
  onExploreInTree,
}: SequenceLineageChipProps) {
  const [expanded, setExpanded] = useState(false);

  const full: TaxonomyNode[] = useMemo(
    () => (Array.isArray(lineage) ? lineage : []),
    [lineage],
  );
  const major = useMemo(() => majorRanks(full), [full]);

  // Self-hide when there is nothing to show.
  if (!organism && full.length === 0) return null;

  const hasLineage = full.length > 0;

  // The organism line, the leaf of the trail. The name prefers the explicit
  // organism prop and falls back to the last lineage node; the tax id prefers
  // the explicit prop and falls back to that same last node, so the organism
  // name stays clickable even when only the lineage carries the id.
  const lastNode = full.length > 0 ? full[full.length - 1] : undefined;
  const organismName = organism || lastNode?.name || "";
  const organismTaxId = taxId || lastNode?.taxId || "";

  // The inline major-rank names. The organism line already carries the leaf, so
  // drop any major-rank node that IS the organism (commonly the species slot) to
  // avoid showing the same clickable name twice. A sparse chain (no major ranks)
  // shows just the organism line.
  const inlineNodes = (major.length > 0 ? major : []).filter(
    (node) => !organismTaxId || node.taxId !== organismTaxId,
  );

  return (
    <div className="border-b border-gray-100 bg-gray-50/60 px-3 py-1.5">
      <div className="flex items-start gap-2">
        <LineageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            {organismName ? (
              organismTaxId && onExploreInTree ? (
                <Tooltip label="Open the tree of life centered here">
                  <button
                    type="button"
                    onClick={() => onExploreInTree(organismTaxId)}
                    className="cursor-pointer rounded text-meta font-medium text-gray-700 underline decoration-dotted decoration-gray-300 underline-offset-2 transition-colors hover:text-sky-700 hover:decoration-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  >
                    {organismName}
                  </button>
                </Tooltip>
              ) : (
                <span className="text-meta font-medium text-gray-700">
                  {organismName}
                </span>
              )
            ) : null}
            {taxId ? (
              <span className="text-meta text-gray-400">taxon {taxId}</span>
            ) : null}
          </div>
          {inlineNodes.length > 0 ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-meta text-gray-500">
              {inlineNodes.map((node, i) => (
                <span key={node.taxId} className="inline-flex items-center gap-1">
                  {i > 0 ? (
                    <span className="text-gray-300" aria-hidden="true">
                      ›
                    </span>
                  ) : null}
                  {node.taxId && onExploreInTree ? (
                    <Tooltip label="Open the tree of life centered here">
                      <button
                        type="button"
                        onClick={() => onExploreInTree(node.taxId)}
                        className="cursor-pointer rounded underline decoration-dotted decoration-gray-300 underline-offset-2 transition-colors hover:text-sky-700 hover:decoration-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      >
                        {node.name}
                      </button>
                    </Tooltip>
                  ) : (
                    <span>{node.name}</span>
                  )}
                </span>
              ))}
            </div>
          ) : null}
          {expanded && hasLineage ? (
            <ol className="mt-1.5 space-y-0.5 border-l border-gray-200 pl-2.5">
              {full.map((node) => (
                <li
                  key={node.taxId}
                  className="flex items-baseline gap-2 text-meta"
                >
                  <span className="w-24 shrink-0 text-gray-400">
                    {rankLabel(node.rank) || "rank"}
                  </span>
                  <span className="text-gray-700">{node.name}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {onExploreInTree && organismTaxId ? (
            // The organism name and every listed level above are clickable, so a
            // single "open the whole tree" affordance reads as the catch-all
            // entry, centered on the organism (the leaf of the trail).
            <button
              type="button"
              onClick={() => onExploreInTree(organismTaxId)}
              className="mt-1 inline-flex items-center gap-1 text-meta font-medium text-sky-600 transition-colors hover:text-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              <LineageIcon className="h-3 w-3" />
              Explore in tree
            </button>
          ) : null}
        </div>
        {hasLineage ? (
          <Tooltip label={expanded ? "Hide full lineage" : "Show full lineage"}>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? "Hide full lineage" : "Show full lineage"}
              className="mt-0.5 shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-600"
            >
              <CaretIcon open={expanded} className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
