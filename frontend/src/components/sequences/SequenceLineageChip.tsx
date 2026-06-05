"use client";

// sequence editor master. The calm organism + taxonomy-lineage line shown on an
// enriched sequence (in the editor header strip). Major ranks read inline; a
// click expands the full chain. Self-hides when the sequence has no organism and
// no lineage, so a native / non-enriched sequence shows nothing.
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
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M8.5 6.8 15.5 11M8.5 17.2 15.5 13" />
    </svg>
  );
}

export interface SequenceLineageChipProps {
  organism?: string;
  taxId?: string;
  lineage?: SequenceTaxonNode[];
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
  // The inline major-rank names, organism last. When there are no major ranks
  // (a sparse chain), fall back to just the organism name.
  const inlineNodes = major.length > 0 ? major : [];

  return (
    <div className="border-b border-gray-100 bg-gray-50/60 px-3 py-1.5">
      <div className="flex items-start gap-2">
        <LineageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-meta font-medium text-gray-700">
              {organism || (full.length > 0 ? full[full.length - 1].name : "")}
            </span>
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
                  <span>{node.name}</span>
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
