"use client";

// sequence editor master. The COMPACT taxonomy affordance that lives at the
// right edge of the editor's bottom coordinate bar (where there is otherwise
// dead white space), instead of the old full-width lineage strip that ate a
// whole row at the top. Collapsed it is just a tree glyph + the organism
// binomial; a click opens an upward popover with the full clickable lineage
// (every rank opens the tree of life centered there) plus the catch-all
// "Explore in tree". Self-hides when the sequence carries no organism / lineage.
//
// Inline SVG icons (no emoji), <Tooltip> for the trigger, site typography
// tokens, dark-mode aware. No em-dash, no mid-sentence colon.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import type { SequenceTaxonNode } from "@/lib/types";

/** A tiny life-tree glyph (three nodes joined), matching the lineage chip. */
function TreeGlyph({ className }: { className?: string }) {
  return (
    <svg
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

/** A small caret that points up when the popover is open, down when closed. */
function CaretIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${open ? "" : "rotate-180"} transition-transform ${className ?? ""}`}
    >
      <polyline points="6 15 12 9 18 15" />
    </svg>
  );
}

/** Title-case a rank label for display ("phylum" -> "Phylum"). */
function rankLabel(rank: string): string {
  if (!rank) return "";
  return rank.charAt(0).toUpperCase() + rank.slice(1);
}

export interface SequenceLineageFooterProps {
  organism?: string;
  taxId?: string;
  lineage?: SequenceTaxonNode[];
  /** Opens the tree-of-life explorer centered on a tax id. The clickable ranks
   *  and the catch-all link show only when this handler is present. */
  onExploreInTree?: (taxId: string) => void;
}

export default function SequenceLineageFooter({
  organism,
  taxId,
  lineage,
  onExploreInTree,
}: SequenceLineageFooterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const full: SequenceTaxonNode[] = useMemo(
    () => (Array.isArray(lineage) ? lineage : []),
    [lineage],
  );

  // The organism leaf prefers the explicit props, falling back to the last
  // lineage node, so the name + tax id stay populated when only the lineage
  // carries them.
  const lastNode = full.length > 0 ? full[full.length - 1] : undefined;
  const organismName = organism || lastNode?.name || "";
  const organismTaxId = taxId || lastNode?.taxId || "";

  // Close the popover on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Self-hide when there is nothing to show.
  if (!organismName && full.length === 0) return null;

  const canExplore = !!onExploreInTree;

  return (
    <div ref={rootRef} className="relative ml-auto flex shrink-0 items-center">
      <Tooltip label="Taxonomy and lineage">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex max-w-[16rem] items-center gap-1.5 rounded px-1.5 py-0.5 text-meta text-foreground-muted transition-colors hover:bg-surface-sunken/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 dark:text-foreground-muted dark:hover:bg-surface-sunken dark:hover:text-foreground"
        >
          <TreeGlyph className="h-3.5 w-3.5 shrink-0 text-sky-500" />
          <span className="truncate italic">{organismName}</span>
          <CaretIcon open={open} className="h-3 w-3 shrink-0 text-foreground-muted" />
        </button>
      </Tooltip>

      {open ? (
        <div
          id={panelId}
          className="absolute bottom-full right-0 z-30 mb-1.5 w-72 rounded-lg border border-border bg-surface-raised p-3 shadow-lg dark:border-border dark:bg-surface"
        >
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="truncate text-body font-medium italic text-foreground dark:text-foreground">
              {organismName}
            </span>
            {taxId ? (
              <span className="shrink-0 text-meta text-foreground-muted dark:text-foreground-muted">
                taxon {taxId}
              </span>
            ) : null}
          </div>

          {full.length > 0 ? (
            <ol className="space-y-0.5 border-l border-border pl-2.5 dark:border-border">
              {full.map((node) => (
                <li key={node.taxId} className="flex items-baseline gap-2 text-meta">
                  <span className="w-20 shrink-0 text-foreground-muted dark:text-foreground-muted">
                    {rankLabel(node.rank) || "rank"}
                  </span>
                  {node.taxId && canExplore ? (
                    <button
                      type="button"
                      onClick={() => {
                        onExploreInTree?.(node.taxId);
                        setOpen(false);
                      }}
                      className="truncate rounded text-left text-foreground underline decoration-dotted decoration-gray-300 underline-offset-2 transition-colors hover:text-sky-700 hover:decoration-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 dark:text-foreground dark:hover:text-sky-300"
                    >
                      {node.name}
                    </button>
                  ) : (
                    <span className="truncate text-foreground dark:text-foreground">
                      {node.name}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          ) : null}

          {canExplore && organismTaxId ? (
            <button
              type="button"
              onClick={() => {
                onExploreInTree?.(organismTaxId);
                setOpen(false);
              }}
              className="mt-2.5 inline-flex items-center gap-1 text-meta font-medium text-sky-600 transition-colors hover:text-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 dark:text-sky-400 dark:hover:text-sky-300"
            >
              <TreeGlyph className="h-3 w-3" />
              Explore in tree
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
