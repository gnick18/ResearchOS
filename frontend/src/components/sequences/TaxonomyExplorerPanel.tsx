"use client";

// sequence editor master. The TAXONOMY TREE EXPLORER panel. Walk the tree of
// life up to a parent, sideways to siblings, and down to children, centered on
// one node at a time. An autocomplete search jumps to any organism. The centered
// node shows a count badge the user toggles between species under the node
// (instant, from the curated backbone) and assemblies (live from NCBI). A
// breadcrumb across the top traces a root down to the centered node, each crumb
// clickable. A species or strain node offers a direct import from NCBI, prefilled
// for that organism.
//
// Data comes through the unified node source (taxonomy-explorer.ts), which prefers
// the offline backbone (family and above) and falls back to the live Datasets API
// (genus, species, strain). Nothing of the user's own data leaves; only the
// public tax ids the explorer walks are sent to NCBI's public taxonomy API.
//
// Inline stroke-only SVG icons (no emoji), <Tooltip> for icon-only controls,
// useEscapeToClose, site typography tokens. No em-dash, no en-dash, no
// mid-sentence colon.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  resolveExplorerNode,
  resolveSiblings,
  resolveChildNames,
  fetchAssembliesCount,
  type ResolvedNode,
  type NeighborRef,
} from "@/lib/sequences/taxonomy-explorer";
import {
  suggestTaxa,
  NcbiDatasetsError,
  type TaxonSuggestion,
} from "@/lib/sequences/ncbi-datasets";

// The default landing node when the panel opens with no organism: Eukaryota, a
// recognizable domain a user can immediately walk down from.
const DEFAULT_CENTER = "2759";

// Show at most this many child chips before a "Show more" reveals the rest, for
// the rare wide-fan-out node.
const CHILD_THRESHOLD = 40;

// --- Inline SVG icons (no emoji) --------------------------------------------

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

function TreeIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
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

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** Up-chevron for the parent (walk up) affordance. */
function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <polyline points="6 15 12 9 18 15" />
    </svg>
  );
}

/** Down-chevron, marking the children row. */
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** Cloud with a down-arrow, the "import from NCBI" action. */
function DownloadCloudIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" />
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  );
}

// --- Helpers ----------------------------------------------------------------

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
    r === "no rank" ||
    r === "serotype" ||
    r === "biotype"
  );
}

/** What the import jump prefills, handed up to the page. */
export interface TaxonomyImportPrefill {
  organism: string;
}

export interface TaxonomyExplorerPanelProps {
  open: boolean;
  onClose: () => void;
  /** Optional tax id to center on when the panel opens (a cross-link entry). */
  initialTaxId?: string;
  /** Open the NCBI import flow prefilled for an organism (a species / strain
   *  node's import jump). When omitted, the import action is hidden. */
  onImportOrganism?: (prefill: TaxonomyImportPrefill) => void;
}

/** A crumb in the breadcrumb path (a root down to the centered node). */
interface Crumb {
  taxId: string;
  name: string;
  rank: string;
}

export default function TaxonomyExplorerPanel({
  open,
  onClose,
  initialTaxId,
  onImportOrganism,
}: TaxonomyExplorerPanelProps) {
  const [centerId, setCenterId] = useState<string>(initialTaxId || DEFAULT_CENTER);
  const [node, setNode] = useState<ResolvedNode | null>(null);
  const [parent, setParent] = useState<ResolvedNode | null>(null);
  const [siblings, setSiblings] = useState<NeighborRef[]>([]);
  const [children, setChildren] = useState<NeighborRef[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Count badge toggle. "species" is instant from the backbone; "assemblies" is
  // fetched live for the centered node and cached on the node.
  const [countMode, setCountMode] = useState<"species" | "assemblies">("species");
  const [assemblies, setAssemblies] = useState<number | undefined>(undefined);
  const [assembliesLoading, setAssembliesLoading] = useState(false);

  // Show-more state for a wide child fan-out.
  const [showAllChildren, setShowAllChildren] = useState(false);

  // Autocomplete search.
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<TaxonSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const loadAbortRef = useRef<AbortController | null>(null);
  const assembliesAbortRef = useRef<AbortController | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);

  const handleClose = useCallback(() => {
    loadAbortRef.current?.abort();
    assembliesAbortRef.current?.abort();
    suggestAbortRef.current?.abort();
    setQuery("");
    setSuggestions([]);
    setSuggestOpen(false);
    onClose();
  }, [onClose]);

  useEscapeToClose(handleClose, open);

  // Re-center the explorer on a tax id. Cancels any in-flight load.
  const recenter = useCallback((taxId: string) => {
    setCenterId(taxId);
  }, []);

  // Load the centered node and its neighbors whenever the center changes (and
  // the panel is open). Resolves the node first (so the card paints fast), then
  // its parent, siblings, and named children. Builds the breadcrumb from the
  // node's live classification when present, else from the walked-up chain.
  useEffect(() => {
    if (!open) return;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const { signal } = controller;

    setLoading(true);
    setError(null);
    setNode(null);
    setParent(null);
    setSiblings([]);
    setChildren([]);
    setShowAllChildren(false);
    // Reset the count badge to species (instant) on every recenter; assemblies
    // refetch on demand for the new node.
    setCountMode("species");
    setAssemblies(undefined);

    (async () => {
      try {
        const centered = await resolveExplorerNode(centerId, { signal });
        if (signal.aborted) return;
        setNode(centered);

        // Parent (for the up card + the breadcrumb tail), siblings, and named
        // children resolve in parallel; each degrades on its own.
        const [parentNode, sibs, namedChildren] = await Promise.all([
          centered.parentId
            ? resolveExplorerNode(centered.parentId, { signal }).catch(() => null)
            : Promise.resolve(null),
          resolveSiblings(centered, { signal }).catch(() => []),
          resolveChildNames(centered, { signal }).catch(() => centered.childRefs),
        ]);
        if (signal.aborted) return;
        setParent(parentNode);
        setSiblings(sibs);
        setChildren(namedChildren);
        setCrumbs(buildCrumbs(centered, parentNode));
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setError(
          e instanceof NcbiDatasetsError
            ? e.message
            : "Could not load that part of the tree. Check your connection and try again.",
        );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [centerId, open]);

  // Reset the center to the requested initial node each time the panel opens.
  useEffect(() => {
    if (open) {
      setCenterId(initialTaxId || DEFAULT_CENTER);
    }
  }, [open, initialTaxId]);

  // Autocomplete: debounce the query, then suggest. An empty query clears.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const t = setTimeout(() => {
      suggestAbortRef.current?.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      suggestTaxa(q, { signal: controller.signal })
        .then((s) => {
          if (controller.signal.aborted) return;
          setSuggestions(s);
          setSuggestOpen(s.length > 0);
        })
        .catch(() => {
          // A suggest failure just shows no options; navigation still works.
        });
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const pickSuggestion = useCallback(
    (s: TaxonSuggestion) => {
      setQuery("");
      setSuggestions([]);
      setSuggestOpen(false);
      recenter(s.taxId);
    },
    [recenter],
  );

  // Toggle the count badge. Switching to assemblies fetches the live count once
  // (cached on the node for the session by the explorer module).
  const toggleCount = useCallback(() => {
    setCountMode((mode) => {
      const next = mode === "species" ? "assemblies" : "species";
      if (next === "assemblies" && assemblies === undefined && node) {
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
            // Leave the count undefined; the badge shows a calm dash.
          })
          .finally(() => {
            if (!controller.signal.aborted) setAssembliesLoading(false);
          });
      }
      return next;
    });
  }, [assemblies, node]);

  const visibleChildren = useMemo(
    () => (showAllChildren ? children : children.slice(0, CHILD_THRESHOLD)),
    [children, showAllChildren],
  );

  // The count badge text for the current toggle.
  const countText = useMemo(() => {
    if (countMode === "species") {
      const n = node?.speciesCount;
      return n === undefined ? "species count unavailable" : `${n.toLocaleString()} species`;
    }
    if (assembliesLoading) return "loading assemblies";
    if (assemblies === undefined) return "assemblies unavailable";
    return `${assemblies.toLocaleString()} assemblies`;
  }, [countMode, node, assemblies, assembliesLoading]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="taxonomy-explorer-panel"
      role="dialog"
      aria-label="Explore the tree of life"
    >
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <TreeIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">
              Explore the tree of life
            </h2>
            <p className="text-meta text-foreground-muted">
              Walk up and down the taxonomy to see related organisms.
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        {/* Search */}
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted">
              <SearchIcon className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={query}
              placeholder="Jump to an organism, e.g. Drosophila or Homo sapiens"
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSuggestOpen(suggestions.length > 0)}
              onBlur={() => {
                // Delay so a click on a suggestion registers before close.
                window.setTimeout(() => setSuggestOpen(false), 120);
              }}
              className="w-full rounded-md border border-border py-2 pl-9 pr-3 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
            {suggestOpen && suggestions.length > 0 ? (
              <ul
                role="listbox"
                className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-surface-raised py-1 shadow-lg"
              >
                {suggestions.map((s) => (
                  <li key={s.taxId}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickSuggestion(s)}
                      className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-sky-50 dark:hover:bg-sky-500/20"
                    >
                      <span className="truncate text-body text-foreground">{s.name}</span>
                      <span className="shrink-0 text-meta uppercase tracking-wide text-foreground-muted">
                        {rankLabel(s.rank)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        {/* Breadcrumb */}
        {crumbs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border px-5 py-2.5 text-meta text-foreground-muted">
            {crumbs.map((c, i) => (
              <span key={c.taxId} className="inline-flex items-center gap-1">
                {i > 0 ? (
                  <span className="text-foreground-muted" aria-hidden="true">
                    ›
                  </span>
                ) : null}
                {c.taxId === centerId ? (
                  <span className="font-medium text-foreground">{c.name}</span>
                ) : /^\d+$/.test(c.taxId) ? (
                  <button
                    type="button"
                    onClick={() => recenter(c.taxId)}
                    className="rounded px-1 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/20 hover:text-sky-700"
                  >
                    {c.name}
                  </button>
                ) : (
                  // A label-only ancestor crumb (named by classification but with
                  // no tax id to recenter on).
                  <span className="px-1 text-foreground-muted">{c.name}</span>
                )}
              </span>
            ))}
          </div>
        ) : null}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/15 px-3 py-2.5">
              <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-meta leading-relaxed text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          ) : null}

          {loading && !node ? (
            <div className="flex items-center justify-center gap-2 py-16 text-meta text-foreground-muted">
              <SpinnerIcon className="h-4 w-4 text-sky-500" />
              <span>Loading the tree...</span>
            </div>
          ) : null}

          {node ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-4">
              {/* Parent card (walk up) */}
              {parent ? (
                <Tooltip label={`Go up to ${parent.name}`}>
                  <button
                    type="button"
                    onClick={() => recenter(parent.taxId)}
                    className="group flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-surface-sunken/70 px-4 py-2.5 text-left transition-colors hover:border-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20"
                  >
                    <ChevronUpIcon className="h-4 w-4 shrink-0 text-foreground-muted group-hover:text-sky-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-foreground">
                        {parent.name}
                      </span>
                      <span className="text-meta uppercase tracking-wide text-foreground-muted">
                        {rankLabel(parent.rank)}
                      </span>
                    </span>
                  </button>
                </Tooltip>
              ) : (
                <p className="text-meta text-foreground-muted">This is a root of the tree.</p>
              )}

              {/* Centered node card */}
              <div className="w-full max-w-md rounded-xl border-2 border-sky-200 dark:border-sky-500/30 bg-sky-50/40 px-5 py-4 text-center shadow-sm">
                <h3 className="text-heading font-semibold text-foreground">{node.name}</h3>
                <div className="mt-1 flex items-center justify-center gap-2">
                  <span className="rounded-full bg-sky-100 dark:bg-sky-500/15 px-2.5 py-0.5 text-meta font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
                    {rankLabel(node.rank)}
                  </span>
                  <span className="text-meta text-foreground-muted">taxon {node.taxId}</span>
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
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1 text-meta font-medium text-foreground-muted transition-colors hover:border-sky-300 hover:text-sky-700"
                  >
                    {assembliesLoading && countMode === "assemblies" ? (
                      <SpinnerIcon className="h-3.5 w-3.5 text-sky-500" />
                    ) : null}
                    {countText}
                  </button>
                </Tooltip>

                {/* Import jump for a single-organism node. */}
                {onImportOrganism && isImportable(node.rank) ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => onImportOrganism({ organism: node.name })}
                      className="ros-btn-raise inline-flex items-center gap-1.5 rounded-md bg-brand-action px-3 py-1.5 text-meta font-medium text-white transition-colors hover:bg-brand-action/90"
                    >
                      <DownloadCloudIcon className="h-3.5 w-3.5" />
                      Import from NCBI
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Sibling chips bracketing the centered node. */}
              {siblings.length > 0 ? (
                <div className="w-full">
                  <p className="mb-1.5 text-center text-meta uppercase tracking-wide text-foreground-muted">
                    Siblings
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {siblings.map((s) => (
                      <button
                        key={s.taxId}
                        type="button"
                        onClick={() => recenter(s.taxId)}
                        className="rounded-full border border-border bg-surface-raised px-3 py-1 text-meta text-foreground-muted transition-colors hover:border-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20 hover:text-sky-700"
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Children grid below. */}
              <div className="w-full">
                <p className="mb-1.5 flex items-center justify-center gap-1 text-meta uppercase tracking-wide text-foreground-muted">
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                  Children
                </p>
                {children.length > 0 ? (
                  <>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {visibleChildren.map((c) => (
                        <button
                          key={c.taxId}
                          type="button"
                          onClick={() => recenter(c.taxId)}
                          className="rounded-md border border-border bg-surface-raised px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:border-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20 hover:text-sky-700"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                    {children.length > CHILD_THRESHOLD ? (
                      <div className="mt-2 text-center">
                        <button
                          type="button"
                          onClick={() => setShowAllChildren((v) => !v)}
                          className="text-meta font-medium text-sky-600 dark:text-sky-300 transition-colors hover:text-sky-700"
                        >
                          {showAllChildren
                            ? "Show fewer"
                            : `Show all ${children.length} children`}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-center text-meta text-foreground-muted">No child taxa.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Build the breadcrumb from a root down to the centered node. The live report's
 * classification carries named major ranks (domain, kingdom, phylum, ...), which
 * gives a stable, ordered crumb without extra fetches. When the centered node is
 * a backbone node (no classification), the parent's classification plus the node
 * itself still produce a useful crumb. The centered node is always the last
 * crumb. Pure, so a render test can assert the path.
 */
export function buildCrumbs(
  node: ResolvedNode,
  parent: ResolvedNode | null,
): Crumb[] {
  // Canonical major-rank order, root -> leaf.
  const order = [
    "domain",
    "superkingdom",
    "kingdom",
    "phylum",
    "class",
    "order",
    "family",
    "genus",
  ];
  // Prefer the centered node's own classification, else the parent's.
  const classification =
    Object.keys(node.classification).length > 0
      ? node.classification
      : parent?.classification ?? {};

  const crumbs: Crumb[] = [];
  for (const rank of order) {
    const name = classification[rank];
    if (!name) continue;
    // The classification carries names but not ids here, so a crumb built from
    // a higher rank is label-only unless it is the node itself. We still make it
    // clickable by tagging the rank; the explorer recenters by id, so only
    // crumbs we have an id for are clickable. The node + parent ids are known.
    if (parent && rank === parent.rank) {
      crumbs.push({ taxId: parent.taxId, name: parent.name, rank: parent.rank });
    } else if (rank === node.rank) {
      crumbs.push({ taxId: node.taxId, name: node.name, rank: node.rank });
    } else {
      // A label-only ancestor crumb (no id to recenter on). Use the rank as a
      // stable key prefix so React keys stay unique.
      crumbs.push({ taxId: `rank:${rank}`, name, rank });
    }
  }

  // Ensure the centered node is present as the final crumb.
  if (!crumbs.some((c) => c.taxId === node.taxId)) {
    crumbs.push({ taxId: node.taxId, name: node.name, rank: node.rank });
  }
  return crumbs;
}
