"use client";

// sequence editor master. The CLICK-DETAIL for the radial tree-of-life view.
//
// Repurposed from the Stage 2 card-stepper. When a user clicks a branch in the
// radial tree (TaxonomyTreeView), this slim side panel shows that node's name,
// rank, and a count badge they toggle between species under the node (instant,
// from the curated backbone) and assemblies (live from NCBI). A species or
// strain node offers a direct import from NCBI, prefilled for that organism.
//
// This is a leaf component (no overlay, no Escape, no backdrop). The tree view
// owns the explorer container, the Escape handling, and the close. Nothing of
// the user's own data leaves; only the public tax id is sent to NCBI's API for
// the live assemblies count.
//
// Inline stroke-only SVG icons (no emoji), <Tooltip> for icon-only controls,
// site typography tokens. No em-dash, no en-dash, no mid-sentence colon.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { fetchAssembliesCount } from "@/lib/sequences/taxonomy-explorer";

/** What the import jump prefills, handed up to the page. */
export interface TaxonomyImportPrefill {
  organism: string;
}

/** The minimal node shape the detail renders. The tree view passes its pool
 *  node fields (name, rank, species count from the backbone). */
export interface TaxonomyDetailNode {
  taxId: string;
  name: string;
  rank: string;
  /** Species under the node, from the backbone. Undefined on a live node. */
  speciesCount?: number;
  /** Where the node came from, shown as a small provenance line. */
  origin: "backbone" | "live";
}

export interface TaxonomyNodeDetailProps {
  node: TaxonomyDetailNode;
  /** Close the detail (the tree view stays open). */
  onClose: () => void;
  /** Recenter / focus the radial view on this node. */
  onFocus: (taxId: string) => void;
  /** Open the NCBI import flow prefilled for an organism (a species / strain
   *  node's import jump). When omitted, the import action is hidden. */
  onImportOrganism?: (prefill: TaxonomyImportPrefill) => void;
}

function svgBase(className?: string) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)} className={`animate-spin ${className ?? ""}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function DownloadCloudIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" />
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  );
}

/** A crosshair, the "center the view here" affordance. */
function FocusIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function rankLabel(rank: string): string {
  if (!rank) return "Taxon";
  return rank.charAt(0).toUpperCase() + rank.slice(1);
}

/** A node is importable from NCBI when it is a single organism (species or
 *  strain / subspecies / isolate), the granularity the import flow handles. */
function isImportable(rank: string): boolean {
  const r = (rank || "").toLowerCase();
  return (
    r === "species" ||
    r === "strain" ||
    r === "subspecies" ||
    r === "isolate" ||
    r === "serotype" ||
    r === "biotype"
  );
}

export default function TaxonomyNodeDetail({
  node,
  onClose,
  onFocus,
  onImportOrganism,
}: TaxonomyNodeDetailProps) {
  // Count badge toggle. "species" is instant from the backbone; "assemblies" is
  // fetched live for the node and held here for the session of this detail.
  const [countMode, setCountMode] = useState<"species" | "assemblies">("species");
  const [assemblies, setAssemblies] = useState<number | undefined>(undefined);
  const [assembliesLoading, setAssembliesLoading] = useState(false);
  const assembliesAbortRef = useRef<AbortController | null>(null);

  // Reset the badge whenever the detail switches to a different node.
  useEffect(() => {
    setCountMode("species");
    setAssemblies(undefined);
    setAssembliesLoading(false);
    return () => assembliesAbortRef.current?.abort();
  }, [node.taxId]);

  const toggleCount = useCallback(() => {
    setCountMode((mode) => {
      const next = mode === "species" ? "assemblies" : "species";
      if (next === "assemblies" && assemblies === undefined) {
        assembliesAbortRef.current?.abort();
        const controller = new AbortController();
        assembliesAbortRef.current = controller;
        setAssembliesLoading(true);
        fetchAssembliesCount(node.taxId, { signal: controller.signal })
          .then((count) => {
            if (controller.signal.aborted) return;
            setAssemblies(count);
          })
          .catch(() => {
            // Leave the count undefined; the badge shows a calm note.
          })
          .finally(() => {
            if (!controller.signal.aborted) setAssembliesLoading(false);
          });
      }
      return next;
    });
  }, [assemblies, node.taxId]);

  const countText = useMemo(() => {
    if (countMode === "species") {
      const n = node.speciesCount;
      return n === undefined
        ? "species count unavailable"
        : `${n.toLocaleString()} species`;
    }
    if (assembliesLoading) return "loading assemblies";
    if (assemblies === undefined) return "assemblies unavailable";
    return `${assemblies.toLocaleString()} assemblies`;
  }, [countMode, node.speciesCount, assemblies, assembliesLoading]);

  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-3 border-l border-gray-100 bg-white px-4 py-4"
      data-testid="taxonomy-node-detail"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-title font-semibold text-gray-900">{node.name}</h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-sky-700">
              {rankLabel(node.rank)}
            </span>
            <span className="text-meta text-gray-400">taxon {node.taxId}</span>
          </div>
        </div>
        <Tooltip label="Close details">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {/* Count badge, toggleable between species and assemblies. */}
      <Tooltip
        label={
          countMode === "species"
            ? "Showing species under this node. Click to show assemblies from NCBI."
            : "Showing assemblies from NCBI. Click to show species under this node."
        }
      >
        <button
          type="button"
          onClick={toggleCount}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-meta font-medium text-gray-600 transition-colors hover:border-sky-300 hover:text-sky-700"
        >
          {assembliesLoading && countMode === "assemblies" ? (
            <SpinnerIcon className="h-3.5 w-3.5 text-sky-500" />
          ) : null}
          {countText}
        </button>
      </Tooltip>

      <div className="flex flex-col gap-2">
        {/* Center the radial view on this node. */}
        <button
          type="button"
          onClick={() => onFocus(node.taxId)}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-meta font-medium text-gray-700 transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
        >
          <FocusIcon className="h-3.5 w-3.5" />
          Center the view here
        </button>

        {/* Import jump for a single-organism node. */}
        {onImportOrganism && isImportable(node.rank) ? (
          <button
            type="button"
            onClick={() => onImportOrganism({ organism: node.name })}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-meta font-medium text-white transition-colors hover:bg-sky-700"
          >
            <DownloadCloudIcon className="h-3.5 w-3.5" />
            Import from NCBI
          </button>
        ) : null}
      </div>

      <p className="mt-auto text-meta leading-relaxed text-gray-400">
        {node.origin === "backbone"
          ? "From the offline taxonomy backbone."
          : "Loaded live from the NCBI taxonomy."}
      </p>
    </div>
  );
}

export { isImportable };
