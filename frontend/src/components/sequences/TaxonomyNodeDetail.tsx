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
import { SYNTHETIC_ROOT_ID } from "@/lib/sequences/taxonomy-radial-source";
import {
  listTaxonAssemblies,
  type TaxonAssembly,
} from "@/lib/sequences/ncbi-datasets";

// How many assemblies the tip list fetches on its single page. The total may be
// larger (a busy species like E. coli has hundreds of thousands); we show this
// many reference-first and a calm "first N of M" line rather than auto-paging.
const ASSEMBLY_PAGE_SIZE = 12;

// A session cache of a tip's assembly list, keyed by tax id, so re-opening the
// same tip does not re-fetch. Module-scoped, cleared on a full reload, matching
// the calm "fetch once per session" the brief asks for.
const assemblyListCache = new Map<
  string,
  { total: number; assemblies: TaxonAssembly[] }
>();

/** What the import jump prefills, handed up to the page. An accession lands the
 *  import on the accession tab as a genome import (a tip assembly row); without
 *  one the import opens on the gene tab for the organism. */
export interface TaxonomyImportPrefill {
  organism: string;
  /** A specific assembly accession (GCF_... / GCA_...) to import. When set, the
   *  import opens on the accession tab seeded with it. */
  accession?: string;
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
  /** True when the node is a TERMINAL TIP, a node with no further tree to explore
   *  (a species / strain leaf, or a node we drilled and found no live children).
   *  At a tip the detail lists the node's genome assemblies. The tree view
   *  computes this from the pool (the node's loaded children); an unknown / search
   *  node leaves it undefined, treated as not-a-tip. */
  isTerminalTip?: boolean;
}

export interface TaxonomyNodeDetailProps {
  node: TaxonomyDetailNode;
  /** Close the detail (the tree view stays open). */
  onClose: () => void;
  /** Recenter / focus the radial view on this node. */
  onFocus: (taxId: string) => void;
  /** EMBEDDED (offline) mode. When true the detail is READ-ONLY and touches no
   *  network. The species count shows from the backbone with no toggle to the
   *  live assemblies count, the terminal-tip assemblies list never fetches, and
   *  the import jump is hidden. Only the name, rank, species count, provenance
   *  line, and the offline "Center the view here" action remain. Default false
   *  keeps the full modal detail (the live count toggle and assemblies). */
  embedded?: boolean;
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

/** A small DNA double-helix, the genome-assemblies section header glyph. */
function DnaIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <path d="M7 4c0 4 10 6 10 10M17 4c0 4-10 6-10 10" />
      <path d="M7 20c0-4 10-6 10-10M17 20c0-4-10-6-10-10" />
      <line x1="8.5" y1="7" x2="15.5" y2="7" />
      <line x1="8.5" y1="17" x2="15.5" y2="17" />
    </svg>
  );
}

/** A small arrow-into-tray, the per-assembly import affordance. */
function ImportRowIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <path d="M12 3v10" />
      <polyline points="8 9 12 13 16 9" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
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
  embedded = false,
}: TaxonomyNodeDetailProps) {
  // Count badge toggle. "species" is instant from the backbone; "assemblies" is
  // fetched live for the node and held here for the session of this detail.
  const [countMode, setCountMode] = useState<"species" | "assemblies">("species");
  const [assemblies, setAssemblies] = useState<number | undefined>(undefined);
  const [assembliesLoading, setAssembliesLoading] = useState(false);
  const assembliesAbortRef = useRef<AbortController | null>(null);

  // The TIP ASSEMBLIES list, fetched lazily for a terminal tip. `total` is the
  // taxon's whole assembly tally (may exceed the page); `rows` is the first page,
  // reference-first. Cached per session in assemblyListCache so re-opening a tip
  // is instant. A loading / error state keeps the section calm while it fetches.
  const [assemblyList, setAssemblyList] = useState<TaxonAssembly[] | null>(null);
  const [assemblyTotal, setAssemblyTotal] = useState(0);
  const [assemblyListLoading, setAssemblyListLoading] = useState(false);
  const [assemblyListError, setAssemblyListError] = useState(false);
  const assemblyListAbortRef = useRef<AbortController | null>(null);

  // Reset the badge whenever the detail switches to a different node.
  useEffect(() => {
    setCountMode("species");
    setAssemblies(undefined);
    setAssembliesLoading(false);
    return () => assembliesAbortRef.current?.abort();
  }, [node.taxId]);

  // Fetch the tip's genome assemblies, lazily, only for a terminal tip. A cache
  // hit fills instantly; otherwise one browser-direct call lists the first page
  // (reference-first). The synthetic root is never a tip. Aborts on a node switch
  // or unmount so a stale fetch never lands on the wrong tip.
  useEffect(() => {
    // Embedded mode is offline, so a tip never fetches its assemblies list.
    const isTip =
      !embedded && node.isTerminalTip && node.taxId !== SYNTHETIC_ROOT_ID;
    setAssemblyListError(false);
    if (!isTip) {
      setAssemblyList(null);
      setAssemblyTotal(0);
      setAssemblyListLoading(false);
      return;
    }
    const cached = assemblyListCache.get(node.taxId);
    if (cached) {
      setAssemblyList(cached.assemblies);
      setAssemblyTotal(cached.total);
      setAssemblyListLoading(false);
      return;
    }
    assemblyListAbortRef.current?.abort();
    const controller = new AbortController();
    assemblyListAbortRef.current = controller;
    setAssemblyList(null);
    setAssemblyTotal(0);
    setAssemblyListLoading(true);
    listTaxonAssemblies(node.taxId, {
      pageSize: ASSEMBLY_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted) return;
        assemblyListCache.set(node.taxId, res);
        setAssemblyList(res.assemblies);
        setAssemblyTotal(res.total);
      })
      .catch((e) => {
        if ((e as Error)?.name === "AbortError") return;
        setAssemblyListError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAssemblyListLoading(false);
      });
    return () => controller.abort();
  }, [node.taxId, node.isTerminalTip, embedded]);

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

  // The synthetic root is the artificial center that ties the backbone roots
  // (cellular organisms + Viruses) under one point. It is not a real taxon, so
  // its detail reads as the whole tree, no tax id line and no count badge (the
  // count would be a meaningless sum across the backbone roots).
  const isSyntheticRoot = node.taxId === SYNTHETIC_ROOT_ID;

  // Whether to show the genome-assemblies section (a terminal tip, never the
  // synthetic root, never in the offline embed).
  const showAssemblies =
    !embedded && Boolean(node.isTerminalTip) && !isSyntheticRoot;

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
      className="flex w-72 shrink-0 flex-col gap-3 border-l border-border bg-surface-raised px-4 py-4"
      data-testid="taxonomy-node-detail"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-title font-semibold text-foreground">{node.name}</h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full bg-sky-100 dark:bg-sky-500/15 px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
              {isSyntheticRoot ? "Root" : rankLabel(node.rank)}
            </span>
            {isSyntheticRoot ? null : (
              <span className="text-meta text-foreground-muted">taxon {node.taxId}</span>
            )}
          </div>
        </div>
        <Tooltip label="Close details">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="shrink-0 rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {/* Count badge. In the modal it toggles between species (backbone) and
          assemblies (live NCBI). In the offline embed it is a static species
          line, no toggle and no fetch. Hidden for the synthetic root, which has
          no real count of its own. */}
      {isSyntheticRoot ? null : embedded ? (
        <span
          data-testid="taxonomy-detail-species"
          className="inline-flex items-center justify-center rounded-full border border-border bg-surface-raised px-3 py-1.5 text-meta font-medium text-foreground-muted"
        >
          {node.speciesCount === undefined
            ? "species count unavailable"
            : `${node.speciesCount.toLocaleString()} species`}
        </span>
      ) : (
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
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:border-sky-300 hover:text-sky-700"
        >
          {assembliesLoading && countMode === "assemblies" ? (
            <SpinnerIcon className="h-3.5 w-3.5 text-sky-500" />
          ) : null}
          {countText}
        </button>
      </Tooltip>
      )}

      <div className="flex flex-col gap-2">
        {/* Center the radial view on this node. */}
        <button
          type="button"
          onClick={() => onFocus(node.taxId)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:border-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20 hover:text-sky-700"
        >
          <FocusIcon className="h-3.5 w-3.5" />
          Center the view here
        </button>

        {/* Import jump for a single-organism node. */}
        {onImportOrganism && isImportable(node.rank) ? (
          <button
            type="button"
            onClick={() => onImportOrganism({ organism: node.name })}
            className="ros-btn-raise inline-flex items-center gap-1.5 rounded-md bg-brand-action px-3 py-1.5 text-meta font-medium text-white transition-colors hover:bg-brand-action/90"
          >
            <DownloadCloudIcon className="h-3.5 w-3.5" />
            Import from NCBI
          </button>
        ) : null}
      </div>

      {/* GENOME ASSEMBLIES at a terminal tip. A calm header, a loading / error /
          empty state, then the first page of assemblies with the reference
          genomes highlighted and floated to the top, each importable by its
          accession. A "first N of M" line appears when the total exceeds the page.
          Hidden entirely for a non-tip node. */}
      {showAssemblies ? (
        <div
          data-testid="taxonomy-tip-assemblies"
          className="flex min-h-0 flex-col gap-2 border-t border-border pt-3"
        >
          <div className="flex items-center gap-1.5 text-foreground">
            <DnaIcon className="h-4 w-4 text-sky-500" />
            <span className="text-meta font-semibold">Genome assemblies</span>
          </div>

          {assemblyListLoading ? (
            <div className="flex items-center gap-1.5 text-meta text-foreground-muted">
              <SpinnerIcon className="h-3.5 w-3.5 text-sky-500" />
              <span>Loading assemblies from NCBI...</span>
            </div>
          ) : assemblyListError ? (
            <p className="text-meta leading-relaxed text-foreground-muted">
              Could not load assemblies from NCBI. Reconnect and reopen this tip.
            </p>
          ) : assemblyList && assemblyList.length > 0 ? (
            <>
              <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-0.5">
                {assemblyList.map((a) => (
                  <li
                    key={a.accession}
                    className={`rounded-md border px-2.5 py-2 ${
                      a.isReference
                        ? "border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/15"
                        : "border-border bg-surface-raised"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-meta text-foreground">
                        {a.accession}
                      </span>
                      {a.isReference ? (
                        <span className="shrink-0 rounded-full bg-sky-100 dark:bg-sky-500/15 px-1.5 py-0.5 text-meta font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
                          Reference
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-meta text-foreground-muted">
                      {a.assemblyLevel ? `${a.assemblyLevel}, ` : ""}
                      {a.organismName}
                    </p>
                    {onImportOrganism ? (
                      <button
                        type="button"
                        onClick={() =>
                          onImportOrganism({
                            organism: a.organismName,
                            accession: a.accession,
                          })
                        }
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised px-2 py-1 text-meta font-medium text-foreground-muted transition-colors hover:border-sky-300 hover:text-sky-700"
                      >
                        <ImportRowIcon className="h-3.5 w-3.5" />
                        Import this assembly
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {assemblyTotal > assemblyList.length ? (
                <p className="text-meta text-foreground-muted">
                  Showing first {assemblyList.length.toLocaleString()} of{" "}
                  {assemblyTotal.toLocaleString()}.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-meta leading-relaxed text-foreground-muted">
              No genome assemblies on NCBI for this tip yet.
            </p>
          )}
        </div>
      ) : null}

      <p className="mt-auto text-meta leading-relaxed text-foreground-muted">
        {isSyntheticRoot
          ? "The center of the tree, where every domain of life branches out."
          : node.origin === "backbone"
            ? "From the offline taxonomy backbone."
            : "Loaded live from the NCBI taxonomy."}
      </p>
    </div>
  );
}

export { isImportable };
