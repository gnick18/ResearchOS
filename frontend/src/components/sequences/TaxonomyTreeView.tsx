"use client";

// sequence editor master. The RADIAL TREE OF LIFE view, the primary taxonomy
// explorer surface (oseiskar style, reimplemented in d3 over OUR backbone).
//
// RE-ROOTING navigation. A FOCUS STACK drives the view, and the fan is always
// re-rooted on the current center. Clicking a node that is not the center makes
// it the new center (pushed onto the stack) and the fan re-forms around it;
// clicking the CURRENT center pops the stack and walks back one level, down to
// the whole-tree root at the bottom. From any center we draw about three
// generations of descendants (FAN_DEPTH), so the user focuses one clade at a
// time instead of facing the whole tree; a child click reveals its next three
// levels. A breadcrumb across the top shows the focus path, each crumb clickable.
//
// Branches fan out from the center. DEPTH maps to radius, each subtree owns an
// ANGULAR width proportional to a log-damped species count, and a branch is
// drawn with STROKE thickness from the same damped weight, so diverse clades are
// fat branches and sparse families are thin twigs. d3-zoom drives smooth pan and
// zoom; LEVEL-OF-DETAIL culling keeps only the branches whose on-screen arc is
// above a pixel threshold at the current zoom, so a dense fan never all draws at
// once. Labels read HORIZONTAL (normal left-to-right copy, never rotated to the
// branch), sit just outward of their node on a white pill, grow biggest at the
// center and shrink each level outward (and hide past the fan depth), so the
// centered clade reads first. Hovering a node (its marker or branch) shows a
// calm floating card with the name, rank, and species count, read from the
// already-loaded node so the hover never fetches anything.
//
// d3 here is the small modular packages (d3-hierarchy is unused at runtime, the
// layout is our pure module; d3-selection / d3-zoom / d3-shape drive the SVG
// from a ref). They are vanilla DOM utilities, no React renderer, so React 19 is
// a non-issue. Clicking a branch opens the slim TaxonomyNodeDetail. The search
// box animates a zoom to a chosen organism, drilling live below family first.
// Escape closes the whole explorer (useEscapeToClose on this container).
//
// Inline stroke-only SVG icons for chrome (no emoji), <Tooltip> for icon-only
// controls, site typography tokens. No em-dash, no en-dash, no mid-sentence
// colon.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
// Side-effect import: registers selection.transition() so the zoom animations
// (flyToBounds, nudgeZoom, resetView) work. d3-zoom pulls it in transitively, but
// we import it directly so the method exists and the dep is explicit.
import "d3-transition";
import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  layoutRadialTree,
  subtreeToDepth,
  labelScaleForLevel,
  visibleNodesAtZoom,
  isLabelVisibleAtZoom,
  polarToCartesian,
  viewportRectFromTransform,
  viewportCenterPoint,
  thicknessLegend,
  pinnedNodeMark,
  type RadialLaidOutNode,
  type PinnedLineage,
} from "@/lib/sequences/taxonomy-radial-layout";
import {
  loadRadialPool,
  drillSubtreeToDepth,
  windowNeedsDrill,
  findPoolNode,
  resolveLineageToPool,
  pathToNode,
  currentFocus,
  pushFocus,
  popFocus,
  focusTo,
  SYNTHETIC_ROOT_ID,
  type RadialPool,
} from "@/lib/sequences/taxonomy-radial-source";
import {
  suggestTaxa,
  isGenusOrBelow,
  type TaxonSuggestion,
} from "@/lib/sequences/ncbi-datasets";
import TaxonomyNodeDetail, {
  isImportable as isImportableRank,
  type TaxonomyImportPrefill,
  type TaxonomyDetailNode,
} from "./TaxonomyNodeDetail";

// The pixel thresholds for the level-of-detail and label culling. A branch is
// drawn when its on-screen arc clears NODE_MIN_PX at the current zoom; a label
// needs the wider LABEL_MIN_PX. These are tuned for the calm look and can be
// nudged after a live pass.
const NODE_MIN_PX = 6;
const LABEL_MIN_PX = 46;

// The hard ceiling on drawn nodes, the safety net for a pathological zoom. The
// viewport cull bounds the count on its own; this only fires if a degenerate
// case slips past it. Kept near the default-zoom node count so the cap never
// trims a normal view.
const NODE_HARD_CAP = 2500;

// The SVG drawing box. The view is centered, and d3-zoom transforms a single
// inner group, so the numbers here are layout units, not screen pixels.
const VIEW_SIZE = 1000;

// FAN-OUT DEPTH, the decluttering mechanism. From the centered node we draw this
// many generations of descendants (center is level 0, then 1, 2, 3). Deeper
// nodes are not laid out; the user clicks a child to re-center and reveal its
// next three levels. Labels also fade out at this depth (labelScaleForLevel).
const FAN_DEPTH = 3;

// The re-root animation length, the glide as a clicked node becomes the new
// center and the fan re-forms around it. Kept in the 500 to 650ms band so it
// reads as a settle, not a teleport. d3 transitions are interruptible, so a
// quick second click cancels the first mid-flight.
const REROOT_MS = 560;

// The insertion-tween length, the grow-in of freshly drilled twigs. New nodes
// interpolate from their parent's position (zero thickness) out to their laid-out
// spot over this window, so a drill blooms rather than snapping. Driven by
// requestAnimationFrame (no extra d3 dep), eased so it settles softly.
const INSERT_MS = 520;

// A soft ease for the insertion tween (ease-out cubic), so the twigs decelerate
// into place. Pure, kept local since d3-ease is not a direct dependency.
function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

// Rank-aware branch coloring (calm, low-saturation). Unknown ranks fall to a
// neutral slate. Optional per the brief, kept gentle so the shape reads first.
const RANK_COLORS: Record<string, string> = {
  "cellular root": "#64748b",
  "acellular root": "#64748b",
  domain: "#0ea5e9",
  superkingdom: "#0ea5e9",
  kingdom: "#6366f1",
  phylum: "#8b5cf6",
  class: "#a855f7",
  order: "#ec4899",
  family: "#f59e0b",
  genus: "#10b981",
  species: "#22c55e",
};
const DEFAULT_BRANCH = "#94a3b8";

function branchColor(rank: string): string {
  return RANK_COLORS[(rank || "").toLowerCase()] ?? DEFAULT_BRANCH;
}

// The PINNED-LINEAGE accent, a warm amber clearly apart from the cool rank
// palette, so the trail toward the user's open sequence reads as a glow no
// matter which rank colors it crosses. The organism leaf gets the deepest tone
// and a ring; the ancestors on the path get the lighter tone and a heavier
// stroke. Used only when a `pinned` lineage is set.
const PINNED_PATH_COLOR = "#f59e0b";
const PINNED_ORGANISM_COLOR = "#d97706";

// --- Inline SVG icons (chrome only) -----------------------------------------

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

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9h14v-9" />
    </svg>
  );
}

// A small chevron, the breadcrumb separator between focus crumbs.
function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

// A small "i" info glyph, the toggle for the not-a-phylogeny note in the legend.
function InfoIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function rankLabel(rank: string): string {
  if (!rank) return "Taxon";
  return rank.charAt(0).toUpperCase() + rank.slice(1);
}

// The species-count line for the hover tooltip, formatted like the detail
// panel's badge (grouped thousands plus the word "species"). A missing or
// non-finite count degrades to a calm "species count unavailable" so the card
// never shows a bare number or NaN.
export function formatSpeciesCount(count: number | undefined): string {
  if (count === undefined || !Number.isFinite(count)) {
    return "species count unavailable";
  }
  return `${count.toLocaleString()} species`;
}

// The hovered node, the minimal shape the floating card reads. Carried in React
// state with the cursor position so the card can follow the pointer.
interface HoverInfo {
  id: string;
  name: string;
  rank: string;
  speciesCount: number;
  /** Cursor position in pixels, relative to the canvas container. */
  x: number;
  y: number;
}

export interface TaxonomyTreeViewProps {
  open: boolean;
  /** Close the explorer. Required for the modal; unused in embedded mode (the
   *  inline embed has no close affordance and never calls it). */
  onClose?: () => void;
  /** EMBEDDED (offline) mode. When true the explorer renders INLINE inside its
   *  parent (no fixed overlay, no dialog chrome, no close button) and touches NO
   *  network at all. The search box, the live drill below family, the import
   *  jump, the tip assemblies fetch, and the assemblies-count toggle are all
   *  gated off, so the view runs entirely on the bundled backbone. Everything
   *  offline stays: re-root navigation, the breadcrumb, zoom / pan, the hover
   *  card, horizontal labels, and the thickness legend with its disclaimer.
   *  Default false keeps the full-screen modal exactly as before. */
  embedded?: boolean;
  /** Optional tax id to center on when the view opens (a cross-link entry). */
  initialTaxId?: string;
  /** The open sequence's lineage, set when the explorer is opened FROM a
   *  sequence. When present, the trail toward that organism is highlighted and a
   *  jump-back chip shows. Absent (the launcher entry) means nothing highlights
   *  and no chip shows, exactly as the standalone explorer. */
  pinned?: PinnedLineage;
  /** Open the NCBI import flow prefilled for an organism (a species / strain
   *  node's import jump). When omitted, the import action is hidden. */
  onImportOrganism?: (prefill: TaxonomyImportPrefill) => void;
}

export default function TaxonomyTreeView({
  open,
  onClose,
  embedded = false,
  initialTaxId,
  pinned,
  onImportOrganism,
}: TaxonomyTreeViewProps) {
  const [pool, setPool] = useState<RadialPool | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The embedded welcome canvas is wide but short, so at scale 1 the radial fan
  // is height-limited and floats in a sea of horizontal whitespace. Start the
  // embedded tree zoomed in so it fills the card; the full modal stays at 1.
  const baseScale = embedded ? 1.5 : 1;

  // The FOCUS STACK, the re-rooting drill path. The bottom is always the whole
  // tree root; the top is the current center the fan is rooted on. Clicking a
  // non-center node pushes it; clicking the center pops it; the home control
  // clears it back to the root. currentFocus reads the top.
  const [focusStack, setFocusStack] = useState<string[]>([SYNTHETIC_ROOT_ID]);
  const focusId = currentFocus(focusStack);

  // The current d3-zoom transform, kept in React state so the level-of-detail,
  // viewport culling, and label culling recompute as the user pans / zooms. The
  // scale (k) drives the size cull; the translation (x, y) plus the scale give
  // the visible rectangle for the viewport cull. Set by the zoom handler.
  const [zoomTransform, setZoomTransform] = useState({ k: baseScale, x: VIEW_SIZE / 2, y: VIEW_SIZE / 2 });
  const zoomScale = zoomTransform.k;

  // The selected node (drives the click-detail). Null hides the detail.
  const [selected, setSelected] = useState<TaxonomyDetailNode | null>(null);

  // Search autocomplete.
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<TaxonSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);

  // A transient note (e.g. "drilling Drosophilidae...") shown under the search.
  const [note, setNote] = useState<string | null>(null);

  // The node currently under the cursor, driving the floating hover card. Null
  // hides the card. It reads only fields already on the laid-out node (name,
  // rank, species count), so hovering never fetches anything.
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Whether the not-a-phylogeny note inside the legend is open. Collapsed by
  // default so the legend stays calm; the info button toggles it.
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  // The canvas container, the positioning context for the floating hover card.
  // The card is an absolute div inside it, so we read the container rect to clamp
  // the cursor-relative position within the visible canvas.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  // A monotonic token so a re-layout from a late drill does not clobber a newer
  // focus. Bumped on every focus / drill that mutates the pool.
  const [layoutVersion, setLayoutVersion] = useState(0);

  // The insertion tween. `ids` are the freshly spliced node ids growing in, and
  // `t` runs 0 to 1 over INSERT_MS, driven by requestAnimationFrame. While t < 1,
  // the render interpolates each of these nodes (and its link) from the parent
  // position out to the laid-out spot, so only the new twigs animate and the
  // existing tree stays put. An empty set means nothing is tweening.
  const [insertIds, setInsertIds] = useState<Set<string>>(() => new Set());
  const [insertT, setInsertT] = useState(1);
  const insertRafRef = useRef<number | null>(null);

  const handleClose = useCallback(() => {
    suggestAbortRef.current?.abort();
    setQuery("");
    setSuggestions([]);
    setSuggestOpen(false);
    setSelected(null);
    setNote(null);
    setHover(null);
    onClose?.();
  }, [onClose]);

  // Escape closes the modal. In embedded mode there is no modal to close, so the
  // page keeps its own Escape behavior and the inline tree never swallows it.
  useEscapeToClose(handleClose, open && !embedded);

  // Load the backbone pool once when the view opens. The backbone is a one-time,
  // cached, deduped global load, so we do NOT abort it on cleanup: under React
  // Strict Mode (dev) the mount effect runs twice, and aborting the first run
  // would kill the shared in-flight fetch the second run dedupes onto, leaving the
  // pool empty (this bit the embedded welcome tree, which mounts with open=true).
  // A `cancelled` flag just skips state writes from a stale run instead.
  useEffect(() => {
    if (!open) return;
    if (pool) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadRadialPool({})
      .then((p) => {
        if (cancelled) return;
        setPool(p);
      })
      .catch((e) => {
        if (cancelled || (e as Error)?.name === "AbortError") return;
        setError(
          "The taxonomy tree needs to download once while online. Reconnect and try again.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pool]);

  // Reset the focus stack to the requested initial node each time the view opens.
  // An initial cross-link entry seeds the stack as root then the target, so a
  // center-click can still walk back to the whole tree.
  useEffect(() => {
    if (!open) return;
    const target = initialTaxId && initialTaxId.trim() ? initialTaxId : null;
    setFocusStack(
      target && target !== SYNTHETIC_ROOT_ID
        ? [SYNTHETIC_ROOT_ID, target]
        : [SYNTHETIC_ROOT_ID],
    );
    setSelected(null);
  }, [open, initialTaxId]);

  // The active BRANCH-WIDTH METRIC. When the current CENTER's rank is genus or
  // below (genus, species, strain, and the other sub-genus ranks), the fan's
  // thickness encodes the per-node GENOME-ASSEMBLY count, so a deep-drill view
  // reads "how many sequenced genomes" instead of "how many species". At family
  // and above it stays the default species count. Read from the focus node's rank.
  const widthMetric: "species" | "assemblies" = useMemo(() => {
    if (!pool) return "species";
    const focusRank = pool.byId.get(focusId)?.rank ?? "";
    return isGenusOrBelow(focusRank) ? "assemblies" : "species";
  }, [pool, focusId]);

  // The laid-out tree for the current center, RE-ROOTED and limited to FAN_DEPTH
  // generations of descendants so only the focused clade and a few levels under
  // it draw. Recomputed when the pool, the center, the width metric, or the layout
  // version (a drill splice) changes. Pure + memoized (subtreeToDepth, then a
  // metric pass that sets each node's thicknessValue when the view is
  // assembly-width, then layoutRadialTree). The metric pass only sets the width
  // input; angular width always stays on species, so only the drawn width swaps.
  const laidOut: RadialLaidOutNode[] = useMemo(() => {
    if (!pool) return [];
    const rootId = pool.byId.has(focusId) ? focusId : SYNTHETIC_ROOT_ID;
    const pruned = subtreeToDepth(pool.byId, rootId, FAN_DEPTH);
    if (widthMetric === "assemblies") {
      // Drive thickness off each node's assembly count (0 when absent, a thin
      // line) by tagging the pruned input nodes. The pruned map is fresh, so this
      // never mutates the pool. The pool node's assemblyCount carries the live
      // drill's per-node tally.
      for (const node of pruned.values()) {
        const poolNode = pool.byId.get(node.id);
        node.thicknessValue = poolNode?.assemblyCount ?? 0;
      }
    }
    return layoutRadialTree(pruned, rootId);
    // layoutVersion is a dependency so a splice re-lays out the subtree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, focusId, layoutVersion, widthMetric]);

  // The slice of the tree on screen, in layout coordinates, from the current
  // zoom transform. The SVG viewBox is the [0, VIEW_SIZE] square, so we invert
  // that box through the transform. This is what bounds the drawn count at high
  // zoom, since zooming in shrinks the visible tree-space rectangle.
  const viewport = useMemo(
    () =>
      viewportRectFromTransform(
        zoomTransform.k,
        zoomTransform.x,
        zoomTransform.y,
        VIEW_SIZE,
      ),
    [zoomTransform],
  );

  // The visible subset at the current zoom (size cull + viewport cull + a hard
  // cap). The viewport keeps the count bounded however far the user zooms in.
  const visible = useMemo(
    () =>
      visibleNodesAtZoom(laidOut, zoomScale, NODE_MIN_PX, {
        viewport,
        hardCap: NODE_HARD_CAP,
      }),
    [laidOut, zoomScale, viewport],
  );

  // The ADAPTIVE thickness legend, recomputed every render from the METRIC counts
  // of the nodes CURRENTLY on screen (their thicknessValue, the species count by
  // default and the assembly count on a genus-or-below view), through the SAME
  // thickness mapping the layout uses (thicknessLegend reuses it, never a second
  // scale). The unit label tracks the metric, so the card reads "~2,000,000
  // species" on the whole tree and "~N assemblies" once the center is a genus or
  // below. An empty legend (nothing visible yet) hides the card's scale rows.
  const legendUnit = widthMetric === "assemblies" ? "assemblies" : "species";
  const legend = useMemo(
    () => thicknessLegend(visible.map((n) => n.thicknessValue), { unit: legendUnit }),
    [visible, legendUnit],
  );

  // Wire d3-zoom to the svg once it is mounted. The zoom transforms the inner
  // group; the handler mirrors the scale into React state so culling reacts.
  useEffect(() => {
    if (!open) return;
    const svgEl = svgRef.current;
    const gEl = gRef.current;
    if (!svgEl || !gEl) return;

    const svg = select(svgEl);
    const g = select(gEl);
    const behavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 400])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
        setZoomTransform({ k: event.transform.k, x: event.transform.x, y: event.transform.y });
      });
    zoomRef.current = behavior;
    svg.call(behavior);
    // Start centered with the root near the middle.
    const initial = zoomIdentity.translate(VIEW_SIZE / 2, VIEW_SIZE / 2).scale(baseScale);
    svg.call(behavior.transform, initial);
    setZoomTransform({ k: baseScale, x: VIEW_SIZE / 2, y: VIEW_SIZE / 2 });

    return () => {
      svg.on(".zoom", null);
      zoomRef.current = null;
    };
  }, [open, pool]);

  // RE-ROOT animation. After the center changes, the fan re-lays-out with the new
  // center at the origin, so the view just needs to ease back to the centered
  // identity for the freshly rooted fan to settle into the middle. The clicked
  // node glides to center as the fan re-forms around it. Interruptible, since a
  // quick second click retargets the same d3 transition mid-flight.
  const recenterView = useCallback(() => {
    const svgEl = svgRef.current;
    const behavior = zoomRef.current;
    if (!svgEl || !behavior) return;
    const centered = zoomIdentity.translate(VIEW_SIZE / 2, VIEW_SIZE / 2).scale(baseScale);
    select(svgEl).transition().duration(REROOT_MS).call(behavior.transform, centered);
  }, []);

  // Manual zoom buttons (chrome). Scale around the CURRENT viewport center (the
  // middle of what is on screen), not the fixed tree origin, so after a pan the
  // plus button zooms into whatever the user has centered. The point passed to
  // scaleBy is in the SVG coordinate system, where the viewport center is the
  // constant middle of the square viewBox.
  const nudgeZoom = useCallback((factor: number) => {
    const svgEl = svgRef.current;
    const behavior = zoomRef.current;
    if (!svgEl || !behavior) return;
    const center = viewportCenterPoint(VIEW_SIZE);
    select(svgEl)
      .transition()
      .duration(220)
      .call(behavior.scaleBy, factor, center);
  }, []);

  // The home / reset control. Clears the focus stack back to the whole-tree root
  // (the bottom of the stack) and eases the zoom back to centered, so a deep
  // drill-in unwinds in one gesture. Also drops the detail, which was tracking
  // the old center.
  const resetView = useCallback(() => {
    setFocusStack([SYNTHETIC_ROOT_ID]);
    setSelected(null);
    const svgEl = svgRef.current;
    const behavior = zoomRef.current;
    if (!svgEl || !behavior) return;
    const initial = zoomIdentity.translate(VIEW_SIZE / 2, VIEW_SIZE / 2).scale(baseScale);
    select(svgEl).transition().duration(450).call(behavior.transform, initial);
  }, []);

  // Start the insertion tween for a batch of freshly spliced ids. They grow from
  // their parent's position out to their laid-out spot over INSERT_MS, eased,
  // driven by requestAnimationFrame (no extra d3 dep). Only these ids move, so
  // the rest of the tree stays put. A new batch cancels any in-flight tween.
  const startInsertTween = useCallback((ids: string[]) => {
    if (insertRafRef.current !== null) {
      cancelAnimationFrame(insertRafRef.current);
      insertRafRef.current = null;
    }
    if (ids.length === 0) {
      setInsertIds(new Set());
      setInsertT(1);
      return;
    }
    setInsertIds(new Set(ids));
    setInsertT(0);
    const start = performance.now();
    const step = (now: number) => {
      const raw = (now - start) / INSERT_MS;
      const t = easeOutCubic(raw);
      if (raw >= 1) {
        setInsertT(1);
        setInsertIds(new Set());
        insertRafRef.current = null;
        return;
      }
      setInsertT(t);
      insertRafRef.current = requestAnimationFrame(step);
    };
    insertRafRef.current = requestAnimationFrame(step);
  }, []);

  // Cancel any running insertion tween when the view closes / unmounts.
  useEffect(() => {
    return () => {
      if (insertRafRef.current !== null) {
        cancelAnimationFrame(insertRafRef.current);
        insertRafRef.current = null;
      }
    };
  }, []);

  // Build the click-detail node from a pool node. The detail always reflects the
  // CURRENT CENTER, so this runs on every re-root. A backbone node carries its
  // species count; a live node leaves it undefined (its real counts come live in
  // the detail's own assemblies fetch).
  const detailFromPool = useCallback(
    (taxId: string): TaxonomyDetailNode | null => {
      if (!pool) return null;
      const poolNode = findPoolNode(pool, taxId);
      if (!poolNode) return null;
      // A TERMINAL TIP has no further tree to explore: a single-organism leaf, or
      // a node whose children are loaded and empty (a drill that found nothing
      // below). The synthetic root is never a tip. At a tip the detail lists the
      // node's genome assemblies.
      const isTip =
        taxId !== SYNTHETIC_ROOT_ID &&
        (isImportableRank(poolNode.rank) ||
          (poolNode.childrenLoaded && poolNode.childIds.length === 0));
      return {
        taxId: poolNode.id,
        name: poolNode.name,
        rank: poolNode.rank,
        speciesCount:
          poolNode.origin === "backbone" ? poolNode.speciesCount : undefined,
        origin: poolNode.origin,
        isTerminalTip: isTip,
      };
    },
    [pool],
  );

  // RE-ROOT the fan on a node and load the descendants its fan-out window needs.
  // Sets the detail to the new center, eases the view back to centered, and
  // drills any node within FAN_DEPTH below the center whose children are not yet
  // loaded (below family, lazy and cached), then re-lays out and blooms the fresh
  // twigs. The focus stack is set by the caller (a push, a pop, or a jump), so
  // this is the shared re-root body. A leaf with no children just sits at center
  // showing its detail.
  const centerOn = useCallback(
    (taxId: string) => {
      if (!pool) return;
      const detail = detailFromPool(taxId);
      if (detail) setSelected(detail);
      recenterView();

      const centerNode = findPoolNode(pool, taxId);
      if (!centerNode) return;
      // EMBEDDED mode is offline, so it never drills below family. Re-rooting on
      // a backbone-leaf family just centers on it (no backbone children, so it
      // sits centered with no fan), and no NCBI call ever fires from a click.
      if (embedded) return;
      // Only show the loading note when the fan-out window actually needs a live
      // drill (below family), so backbone navigation, a pure cache hit, does not
      // flash a note.
      const needsDrill = windowNeedsDrill(pool, taxId, FAN_DEPTH);
      if (!needsDrill) return;
      setNote(`Loading taxa under ${centerNode.name}...`);
      drillSubtreeToDepth(pool, taxId, FAN_DEPTH)
        .then((splicedIds) => {
          if (splicedIds.length > 0) {
            setLayoutVersion((v) => v + 1);
            startInsertTween(splicedIds);
          }
          setNote(null);
        })
        .catch(() => {
          setNote(null);
        });
    },
    [pool, embedded, detailFromPool, recenterView, startInsertTween],
  );

  // The primary navigation gesture. Clicking the CURRENT CENTER goes BACK (pop
  // the focus stack to the previous center, or nothing at the root). Clicking any
  // OTHER node re-roots on it (push). Either way the detail updates to the new
  // center and the fan re-forms around it.
  const onNodeClick = useCallback(
    (n: RadialLaidOutNode) => {
      if (!pool) return;
      if (n.id === focusId) {
        // Center-click: walk back one level. A no-op at the root (stack length 1).
        const back = popFocus(focusStack);
        if (back === focusStack) return;
        setFocusStack(back);
        centerOn(currentFocus(back));
        return;
      }
      // A descendant click: re-root on it.
      const next = pushFocus(focusStack, n.id);
      setFocusStack(next);
      centerOn(n.id);
    },
    [pool, focusId, focusStack, centerOn],
  );

  // Recenter the fan on a node from outside the click flow (the detail's center
  // control, a search pick). Pushes it onto the stack (or walks back to it if it
  // is already an ancestor) and re-roots.
  const focusNode = useCallback(
    (taxId: string) => {
      if (!pool) return;
      const next = pushFocus(focusStack, taxId);
      setFocusStack(next);
      centerOn(taxId);
    },
    [pool, focusStack, centerOn],
  );

  // Jump back to the pinned organism, the way the user returns to their open
  // sequence after exploring far away. Reuses the same re-root path as a search
  // pick: rebuild the focus stack from the organism's in-pool lineage when it
  // resolves (so a center-click still walks back up), otherwise seed the stack
  // with root then the organism, then re-root onto it. A no-op when nothing is
  // pinned or the organism has no tax id.
  const jumpToPinnedOrganism = useCallback(() => {
    if (!pool || !pinned?.organismTaxId) return;
    const taxId = pinned.organismTaxId;
    const path = pathToNode(pool, taxId);
    setFocusStack(
      path && path.length > 0 ? path : [SYNTHETIC_ROOT_ID, taxId],
    );
    centerOn(taxId);
  }, [pool, pinned, centerOn]);

  // Search autocomplete (debounced).
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
          // A suggest failure just shows no options; the tree still navigates.
        });
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  // Pick a search result: RE-ROOT the view onto it so it becomes the center. The
  // focus stack is rebuilt from its lineage (root down to the target), so a
  // center-click still walks back up the chain. When the target is below family
  // (not yet in the pool), resolve its lineage from the nearest in-pool ancestor
  // and splice that chain in first, so search lands on the result even deep below
  // the backbone.
  const pickSuggestion = useCallback(
    async (s: TaxonSuggestion) => {
      setQuery("");
      setSuggestions([]);
      setSuggestOpen(false);
      if (!pool) return;

      // Already in the pool: re-root straight onto it, with its lineage as the
      // stack so center-click can walk back.
      const present = findPoolNode(pool, s.taxId);
      if (present) {
        const path = pathToNode(pool, s.taxId);
        setFocusStack(path && path.length > 0 ? path : [SYNTHETIC_ROOT_ID, s.taxId]);
        centerOn(s.taxId);
        return;
      }

      // Below family or off our backbone: resolve the lineage and splice the
      // chain down from the nearest in-pool ancestor, then re-root onto it.
      setNote(`Locating ${s.name}...`);
      suggestAbortRef.current?.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      try {
        const resolved = await resolveLineageToPool(pool, s.taxId, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (resolved) {
          // The spliced chain is now in the pool, so its full path resolves. Set
          // the stack to it and re-root onto the target.
          setLayoutVersion((v) => v + 1);
          startInsertTween(resolved.added);
          const path = pathToNode(pool, s.taxId);
          setFocusStack(path && path.length > 0 ? path : [SYNTHETIC_ROOT_ID, s.taxId]);
          centerOn(s.taxId);
        } else {
          // Off our backbone entirely (no in-pool ancestor): just open the detail
          // so the user can still import / inspect it, the tree stays where it is.
          setSelected({
            taxId: s.taxId,
            name: s.name,
            rank: s.rank,
            speciesCount: findPoolNode(pool, s.taxId)?.speciesCount,
            origin: findPoolNode(pool, s.taxId)?.origin ?? "live",
            // Off our backbone with no further tree shown, so treat it as a tip
            // and let the detail list its genome assemblies.
            isTerminalTip: true,
          });
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          // A resolve failure still opens the detail and leaves the tree where it
          // was.
          setSelected({
            taxId: s.taxId,
            name: s.name,
            rank: s.rank,
            origin: "live",
            isTerminalTip: true,
          });
        }
      } finally {
        if (!controller.signal.aborted) setNote(null);
      }
    },
    [pool, centerOn, startInsertTween],
  );

  // The links + nodes to draw, derived from the visible set. Links connect a
  // node to its parent IF the parent is also visible.
  const visibleById = useMemo(
    () => new Map(visible.map((n) => [n.id, n])),
    [visible],
  );

  const links = useMemo(() => {
    const out: Array<{ source: RadialLaidOutNode; target: RadialLaidOutNode }> = [];
    for (const n of visible) {
      if (n.parentId && visibleById.has(n.parentId)) {
        out.push({ source: visibleById.get(n.parentId)!, target: n });
      }
    }
    return out;
  }, [visible, visibleById]);

  // The DRAWN cartesian position of a node, accounting for the insertion tween.
  // A freshly spliced node (in insertIds) is interpolated from its parent's spot
  // out toward its laid-out spot by insertT, so it grows in from the branch it
  // joined; its size scales by the same factor so it blooms from zero thickness.
  // A settled node (the common case, insertIds empty) returns its true position
  // and a grow factor of 1, so the rest of the tree is untouched.
  const drawNode = useCallback(
    (n: RadialLaidOutNode): { x: number; y: number; grow: number } => {
      const here = polarToCartesian(n.angle, n.radius);
      if (insertIds.size === 0 || !insertIds.has(n.id) || insertT >= 1) {
        return { x: here.x, y: here.y, grow: 1 };
      }
      const parent = n.parentId ? visibleById.get(n.parentId) : undefined;
      const from = parent
        ? polarToCartesian(parent.angle, parent.radius)
        : here;
      return {
        x: from.x + (here.x - from.x) * insertT,
        y: from.y + (here.y - from.y) * insertT,
        grow: insertT,
      };
    },
    [insertIds, insertT, visibleById],
  );

  // Show / move the floating hover card for a node. The card position is the
  // cursor point relative to the canvas container (the card is an absolute div
  // inside it), so we subtract the container's top-left from the page pointer.
  // The clamp to keep it on screen happens at render from the card's measured
  // size, since the size is not known here. Reads only fields on the laid-out
  // node, so no network is touched on hover.
  const onNodeHover = useCallback(
    (n: RadialLaidOutNode, e: ReactPointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const x = rect ? e.clientX - rect.left : e.clientX;
      const y = rect ? e.clientY - rect.top : e.clientY;
      setHover({
        id: n.id,
        name: n.name,
        rank: n.rank,
        speciesCount: n.speciesCount,
        x,
        y,
      });
    },
    [],
  );

  const clearHover = useCallback(() => setHover(null), []);

  if (!open) return null;

  const focusName =
    pool && pool.byId.get(focusId)?.name
      ? pool.byId.get(focusId)!.name
      : "Tree of life";

  // The BREADCRUMB of the focus path, one crumb per stack entry from the root to
  // the current center, each clickable to jump straight to that focus. Names come
  // from the pool; an unresolved id degrades to a short label so the crumb still
  // shows. The last crumb is the current center, rendered as plain text.
  const crumbs = focusStack.map((id) => ({
    id,
    name: pool?.byId.get(id)?.name ?? (id === SYNTHETIC_ROOT_ID ? "Tree of life" : id),
  }));

  // Jump the focus stack to a breadcrumb entry and re-root there.
  const onCrumbClick = (id: string) => {
    if (id === focusId) return;
    setFocusStack((stack) => focusTo(stack, id));
    centerOn(id);
  };

  // The shell. The MODAL wraps the panel in a fixed overlay with dialog
  // semantics; the EMBEDDED shell is a plain relative box that fills its parent
  // (the welcome-page card sizes it), with no overlay and no dialog role. The
  // panel inside is the same in both, except the modal panel takes the dialog's
  // sizing and the embedded panel fills the shell.
  const panel = (
    <div
      className={
        embedded
          ? "relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-surface-raised"
          : "relative flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-surface-raised ros-popup-card-shadow"
      }
    >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <TreeIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">
              Explore the tree of life
            </h2>
            <p className="text-meta text-foreground-muted">
              Branch thickness shows how many species each clade holds. Click a
              branch to center on it, click the center again to step back.
            </p>
          </div>
          {/* Close lives only on the modal. The embedded embed has no close. */}
          {embedded ? null : (
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
          )}
        </div>

        {/* Search. Hidden in embedded mode, since it calls suggestTaxa (live). */}
        {embedded ? null : (
        <div className="border-b border-border px-5 py-2.5">
          <div className="relative max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted">
              <SearchIcon className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={query}
              placeholder="Find an organism, e.g. Drosophila or Homo sapiens"
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSuggestOpen(suggestions.length > 0)}
              onBlur={() => window.setTimeout(() => setSuggestOpen(false), 120)}
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
          {note ? <p className="mt-1.5 text-meta text-foreground-muted">{note}</p> : null}
        </div>
        )}

        {/* Breadcrumb of the focus path. Shows only past the root so the whole
            tree view stays calm; each crumb but the last jumps straight to that
            focus. The last crumb is the current center, plain text. */}
        {crumbs.length > 1 ? (
          <nav
            aria-label="Focus path"
            data-testid="taxonomy-breadcrumb"
            className="flex items-center gap-1 overflow-x-auto border-b border-border px-5 py-2"
          >
            {crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <span key={c.id} className="flex shrink-0 items-center gap-1">
                  {i > 0 ? (
                    <ChevronRightIcon className="h-3.5 w-3.5 text-foreground-muted" />
                  ) : null}
                  {isLast ? (
                    <span className="rounded-full bg-sky-50 dark:bg-sky-500/15 px-2.5 py-1 text-meta font-medium text-sky-700 dark:text-sky-300">
                      {c.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onCrumbClick(c.id)}
                      className="rounded-full px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                    >
                      {c.name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        ) : null}

        {/* Body: the radial canvas + the click-detail */}
        <div className="relative flex min-h-0 flex-1">
          <div ref={canvasRef} className="relative min-h-0 flex-1 bg-surface-sunken">
            {error ? (
              <div className="absolute inset-x-0 top-4 z-10 mx-auto flex max-w-md items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/15 px-3 py-2.5">
                <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                <p className="text-meta leading-relaxed text-rose-700 dark:text-rose-300">{error}</p>
              </div>
            ) : null}

            {loading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-meta text-foreground-muted">
                <SpinnerIcon className="h-4 w-4 text-sky-500" />
                <span>Loading the tree of life...</span>
              </div>
            ) : null}

            {/* The JUMP-BACK CHIP, a calm amber pill in the top-left, shown only
                when the explorer was opened from a sequence (pinned set). It
                re-roots the view onto that sequence's organism, the way the user
                returns to their own branch after exploring far away. The chip
                persists across re-roots, since it is about the sequence, not the
                current view. It stops its own pointer events from reaching the
                tree so a pan started elsewhere still works. */}
            {pinned && !embedded ? (
              <div
                className="absolute left-4 top-4 z-10 max-w-[16rem]"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Tooltip label="Center the tree on your sequence">
                  <button
                    type="button"
                    data-testid="taxonomy-jump-back-chip"
                    onClick={jumpToPinnedOrganism}
                    className="flex max-w-full items-center gap-1.5 rounded-full border border-amber-300 dark:border-amber-500/30 bg-amber-50/95 px-3 py-1.5 text-amber-800 dark:text-amber-300 shadow-sm backdrop-blur-sm transition-colors hover:border-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-amber-600"
                      aria-hidden="true"
                    />
                    <span className="truncate text-meta font-medium">
                      Your sequence: {pinned.organismName || "this organism"}
                    </span>
                  </button>
                </Tooltip>
              </div>
            ) : null}

            {/* The radial SVG. d3-zoom transforms the inner group. */}
            <svg
              ref={svgRef}
              data-testid="taxonomy-tree-svg"
              viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
              className="h-full w-full cursor-grab active:cursor-grabbing"
              role="img"
              aria-label={`Radial tree of life, focused on ${focusName}`}
            >
              <g ref={gRef}>
                {/* Links (branches). A link to a tweening node draws from the
                    parent toward the node's growing position, so a new twig
                    extends out of the branch it joined. */}
                {links.map((l) => {
                  const a = drawNode(l.source);
                  const b = drawNode(l.target);
                  // A branch on the pinned trail glows amber and reads a touch
                  // heavier + more opaque, so the path toward the user's sequence
                  // stands out whenever any of it is on screen. Off-trail branches
                  // keep their calm rank color.
                  const mark = pinnedNodeMark(pinned, l.target.id);
                  const onPinned = mark !== "none";
                  return (
                    <line
                      key={`link-${l.target.id}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={onPinned ? PINNED_PATH_COLOR : branchColor(l.target.rank)}
                      strokeWidth={
                        l.target.thickness * b.grow * (onPinned ? 1.6 : 1)
                      }
                      strokeLinecap="round"
                      strokeOpacity={onPinned ? 0.9 : 0.55}
                      style={{ cursor: "pointer" }}
                      onPointerEnter={(e) => onNodeHover(l.target, e)}
                      onPointerMove={(e) => onNodeHover(l.target, e)}
                      onPointerLeave={clearHover}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNodeClick(l.target);
                      }}
                    />
                  );
                })}

                {/* Node markers + labels */}
                {visible.map((n) => {
                  const p = drawNode(n);
                  // LABEL SIZE BY DISTANCE FROM CENTER. The depth in the re-rooted
                  // fan is the level out from the current center, so the center and
                  // its immediate children read biggest and each level outward is
                  // quieter; past the fan depth the scale is 0 and the label hides.
                  const levelScale = labelScaleForLevel(n.depth, FAN_DEPTH);
                  const showLabel =
                    levelScale > 0 && isLabelVisibleAtZoom(n, zoomScale, LABEL_MIN_PX);
                  const markerR = Math.max(1.5, n.thickness / 2) * p.grow;

                  // The pinned mark for this node. "organism" is the sequence's
                  // own organism (the strongest mark, an amber fill plus an outer
                  // ring), "path" is any ancestor on the trail toward it (an amber
                  // ring on the marker), "none" is everything else (untouched).
                  const mark = pinnedNodeMark(pinned, n.id);
                  const isOrganism = mark === "organism";
                  const onPinned = mark !== "none";
                  // The marker fill and stroke. An organism reads filled amber;
                  // a path node keeps its rank fill but gains an amber ring; an
                  // off-trail node keeps its rank fill and the thin white outline
                  // (a heavier outline only when it is the click-selected center).
                  const markerFill = isOrganism
                    ? PINNED_ORGANISM_COLOR
                    : branchColor(n.rank);
                  const markerStroke = onPinned
                    ? PINNED_PATH_COLOR
                    : "#ffffff";
                  const markerStrokeW = isOrganism
                    ? 2.5
                    : mark === "path"
                      ? 2
                      : selected?.taxId === n.id
                        ? 2
                        : 0.5;

                  // HORIZONTAL labels. The text reads left to right like normal
                  // copy, never rotated to the branch angle. We still place the
                  // pill just OUTWARD of the node along the node's own angle, so a
                  // label sits next to its dot rather than on top of it, but the
                  // pill and the text stay axis aligned (a normal horizontal
                  // rounded pill). The offset direction is the radially OUTWARD unit
                  // vector at this node's angle. The layout shifts angle 0 to point
                  // up (polarToCartesian subtracts a quarter turn), so we use the
                  // same shift here to get the true outward direction on screen.
                  const a = n.angle - Math.PI / 2;
                  const ux = Math.cos(a);
                  const uy = Math.sin(a);
                  // Nodes on the LEFT half (cos < 0) anchor their text to the right
                  // edge so the words run leftward, away from the center; nodes on
                  // the right half anchor to the left edge and run rightward. Either
                  // way the text splays outward and the marker stays clear.
                  const leftHalf = ux < 0;
                  const labelAnchor = leftHalf ? "end" : "start";
                  // Push the label start past the marker by the radius plus a small
                  // gap, along the node's angle.
                  const gap = markerR + 6;
                  const anchorX = p.x + ux * gap;
                  const anchorY = p.y + uy * gap;

                  // The readable label pill, the white backing that lets the text
                  // read over any branch color. We size it to the text from the
                  // string length and the live font-size (jsdom cannot measure, so
                  // a generous char-width factor avoids clipping long names), then
                  // pad it and round the ends fully so it is a pill, not a box. The
                  // pill is axis aligned (no rotation) and sits behind the
                  // horizontal text, growing in the text direction from the anchor.
                  // The level scale shrinks the font as the label sits farther from
                  // the center, keeping the white pill backing intact.
                  const fontSize = (11 / Math.max(zoomScale, 1) + 3) * levelScale;
                  // Per-character width factor (em). 0.62 is wide enough that even
                  // all-cap names do not spill past the pill.
                  const textW = Math.max(1, n.name.length) * fontSize * 0.62;
                  const padX = 5;
                  const padY = 2.5;
                  const pillH = fontSize + padY * 2;
                  const pillW = textW + padX * 2;
                  // The pill is centered vertically on the text baseline and grows
                  // in the text direction from the anchor. A right-anchored
                  // (left-half) label grows back toward negative x.
                  const pillX = leftHalf ? anchorX - pillW : anchorX;
                  const pillY = anchorY - pillH / 2;
                  return (
                    <g key={`node-${n.id}`}>
                      {/* The organism's outer ring, the strongest mark, drawn
                          behind the marker so the user's own organism reads as a
                          haloed dot wherever it is on screen. */}
                      {isOrganism ? (
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={markerR + 4}
                          fill="none"
                          stroke={PINNED_ORGANISM_COLOR}
                          strokeWidth={2}
                          strokeOpacity={0.85}
                          style={{ pointerEvents: "none" }}
                        />
                      ) : null}
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={markerR}
                        fill={markerFill}
                        stroke={markerStroke}
                        strokeWidth={markerStrokeW}
                        style={{ cursor: "pointer" }}
                        onPointerEnter={(e) => onNodeHover(n, e)}
                        onPointerMove={(e) => onNodeHover(n, e)}
                        onPointerLeave={clearHover}
                        onClick={(e) => {
                          e.stopPropagation();
                          onNodeClick(n);
                        }}
                      />
                      {showLabel ? (
                        // The pill behind plus the horizontal text in front, both
                        // axis aligned (no rotation), so the label always reads like
                        // normal copy next to its node. The label is clickable and
                        // hoverable just like the node dot, so clicking the name
                        // re-roots on that node and hovering it shows the same card.
                        <g
                          style={{ cursor: "pointer", userSelect: "none" }}
                          onPointerEnter={(e) => onNodeHover(n, e)}
                          onPointerMove={(e) => onNodeHover(n, e)}
                          onPointerLeave={clearHover}
                          onClick={(e) => {
                            e.stopPropagation();
                            onNodeClick(n);
                          }}
                        >
                          <rect
                            x={pillX}
                            y={pillY}
                            width={pillW}
                            height={pillH}
                            rx={pillH / 2}
                            ry={pillH / 2}
                            style={{ fill: "var(--surface-raised)", stroke: "var(--border-subtle)" }}
                            fillOpacity={0.92}
                            strokeWidth={1}
                          />
                          <text
                            x={anchorX}
                            y={anchorY}
                            textAnchor={labelAnchor}
                            dominantBaseline="middle"
                            fontSize={fontSize}
                            style={{ fill: "var(--foreground)" }}
                          >
                            {n.name}
                          </text>
                        </g>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* The floating HOVER card, the node under the cursor. It reads only
                fields already on the laid-out node (no fetch on hover), follows
                the pointer with a small offset, and is clamped to stay inside the
                canvas. pointer-events none so it never blocks the click-to-re-root
                or a hover on a node beneath it. */}
            {hover ? (
              (() => {
                const OFFSET = 12;
                // Estimate the card footprint so the clamp keeps it on screen. The
                // width tracks the longer of the name and the count line; the
                // height is the three stacked lines plus padding. These are upper
                // bounds, so the card never runs off the right or bottom edge.
                const rect = canvasRef.current?.getBoundingClientRect();
                const countLine = formatSpeciesCount(hover.speciesCount);
                const longest = Math.max(
                  hover.name.length,
                  countLine.length,
                  rankLabel(hover.rank).length,
                );
                const estW = Math.min(280, 24 + longest * 7);
                const estH = 78;
                const maxX = rect ? rect.width - estW - 6 : Number.POSITIVE_INFINITY;
                const maxY = rect ? rect.height - estH - 6 : Number.POSITIVE_INFINITY;
                const left = Math.max(6, Math.min(hover.x + OFFSET, maxX));
                const top = Math.max(6, Math.min(hover.y + OFFSET, maxY));
                return (
                  <div
                    data-testid="taxonomy-hover-card"
                    className="pointer-events-none absolute z-20 max-w-[280px] rounded-lg border border-border bg-surface-raised px-3 py-2 shadow-lg"
                    style={{ left, top }}
                  >
                    <p className="text-body font-semibold leading-snug text-foreground">
                      {hover.name}
                    </p>
                    <p className="text-meta uppercase tracking-wide text-foreground-muted">
                      {rankLabel(hover.rank)}
                    </p>
                    <p className="text-meta text-foreground-muted">{countLine}</p>
                  </div>
                );
              })()
            ) : null}

            {/* The adaptive THICKNESS KEY, a calm scale-bar in the bottom-left
                (zoom chrome sits bottom-right). It reads what branch thickness
                means right now, with reference lines whose labels track the
                species counts currently on screen, so it re-reads as the user
                drills. A small info button toggles the not-a-phylogeny note. The
                card stops pointer events from reaching the tree only inside its
                own box, so a pan / zoom drag started anywhere else still works. */}
            {legend.length > 0 ? (
              <div
                data-testid="taxonomy-thickness-legend"
                className="absolute bottom-4 left-4 z-10 max-w-[15rem] rounded-lg border border-border bg-surface-raised/95 px-3 py-2.5 shadow-sm backdrop-blur-sm"
                onPointerDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-meta font-semibold text-foreground">
                      Branch thickness
                    </p>
                    <p className="text-meta leading-snug text-foreground-muted">
                      {widthMetric === "assemblies"
                        ? "More genome assemblies, thicker branch."
                        : "More species, thicker branch."}
                    </p>
                  </div>
                  <Tooltip label="What this layout is, and is not">
                    <button
                      type="button"
                      onClick={() => setDisclaimerOpen((v) => !v)}
                      aria-expanded={disclaimerOpen}
                      aria-label="What this layout is, and is not"
                      className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted"
                    >
                      <InfoIcon className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                </div>

                <ul className="mt-2 flex flex-col gap-1.5">
                  {legend.map((entry) => (
                    <li
                      key={entry.value}
                      className="flex items-center gap-2.5"
                    >
                      <svg
                        width={36}
                        height={16}
                        viewBox="0 0 36 16"
                        aria-hidden="true"
                        className="shrink-0 text-foreground-muted"
                      >
                        <line
                          x1={2}
                          y1={8}
                          x2={34}
                          y2={8}
                          stroke="currentColor"
                          strokeWidth={Math.max(1, Math.min(14, entry.thickness))}
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="text-meta tabular-nums text-foreground-muted">
                        ~{entry.value.toLocaleString()} {entry.unit}
                      </span>
                    </li>
                  ))}
                </ul>

                {disclaimerOpen ? (
                  <p
                    data-testid="taxonomy-not-phylogeny-note"
                    className="mt-2.5 border-t border-border pt-2 text-meta leading-snug text-foreground-muted"
                  >
                    Not a phylogenetic tree. Branch length, angle, and distance
                    carry no evolutionary meaning. The layout only helps you browse
                    how many species each group holds.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Zoom chrome */}
            <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
              <Tooltip label="Zoom in">
                <button
                  type="button"
                  onClick={() => nudgeZoom(1.6)}
                  aria-label="Zoom in"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-raised text-foreground-muted shadow-sm transition-colors hover:border-sky-300 hover:text-sky-700"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </Tooltip>
              <Tooltip label="Zoom out">
                <button
                  type="button"
                  onClick={() => nudgeZoom(1 / 1.6)}
                  aria-label="Zoom out"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-raised text-foreground-muted shadow-sm transition-colors hover:border-sky-300 hover:text-sky-700"
                >
                  <MinusIcon className="h-4 w-4" />
                </button>
              </Tooltip>
              <Tooltip label="Reset the view">
                <button
                  type="button"
                  onClick={resetView}
                  aria-label="Reset the view"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-raised text-foreground-muted shadow-sm transition-colors hover:border-sky-300 hover:text-sky-700"
                >
                  <HomeIcon className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* The click-detail, shown when a node is selected. In embedded mode
              it renders READ-ONLY (name, rank, species count, and the offline
              re-root action), with the import jump, the assemblies-count toggle,
              and the tip assemblies fetch all gated off, so it never fetches. */}
          {selected ? (
            <TaxonomyNodeDetail
              node={selected}
              embedded={embedded}
              onClose={() => setSelected(null)}
              onFocus={(taxId) => focusNode(taxId)}
              onImportOrganism={embedded ? undefined : onImportOrganism}
            />
          ) : null}
        </div>
      </div>
  );

  // Embedded: render the panel inline, filling the parent. Modal: wrap it in the
  // fixed overlay with dialog semantics, exactly as before.
  if (embedded) {
    return (
      <div
        className="relative h-full w-full"
        data-testid="taxonomy-tree-view"
        data-embedded="true"
      >
        {panel}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="taxonomy-tree-view"
      role="dialog"
      aria-label="Explore the tree of life"
    >
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      {panel}
    </div>
  );
}
