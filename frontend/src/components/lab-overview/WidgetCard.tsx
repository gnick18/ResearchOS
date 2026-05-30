"use client";

import {
  Component,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import Tooltip from "@/components/Tooltip";
import type { WidgetDefinition } from "./widgets/types";

/**
 * Widget selector redesign (widget-selector bot, 2026-05-29): the rich
 * card used by the "+ Add widget" palette, replacing the old title +
 * checkbox row. Built to the shared rich-selector pattern in
 * `plans/SELECTOR_REDESIGN.md` §2.
 *
 * Anatomy (top to bottom):
 *   - HERO: a live `SnapshotTile` mini-preview (Grant's locked decision).
 *     The real widget tile rendered as a non-interactive hero so the user
 *     sees "you have 3 overdue tasks", not just an icon. Lazily mounted
 *     (IntersectionObserver) so a dozen palette cards don't fire a dozen
 *     live queries at once; guarded by an error boundary so a throwing
 *     tile falls back to the static glyph + description rather than
 *     tearing down the palette.
 *   - NAME (`widget.title`).
 *   - DESCRIPTION (`widget.description`).
 *   - FOOTER: the Add / Added affordance (the card's only interactive
 *     element) on the right.
 *
 * Forward-compat (U3 widget store): the card takes an optional `badgeSlot`
 * render region (curation / enable-disable badges) and a `disabled` flag.
 * The store can extend the card with those without a rewrite. This build
 * does NOT populate them (no curation here).
 */

// ── Static fallback glyphs, keyed by toolId ─────────────────────────────
// Self-contained inline SVGs (house style: no emoji, no icon lib). Keyed
// by the widget's `toolId` so every variant of a Tool family shares one
// glyph. Falls back to a generic widget glyph for an unmapped tool.
const TOOL_GLYPHS: Record<string, ReactNode> = {
  announcements: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 0 1-5.8-1.6" />
    </svg>
  ),
  comments: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  metrics: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 3 3 5-5" />
    </svg>
  ),
  "trainee-notes": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  ),
  "weekly-goals": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  ),
  notes: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3v5h5" />
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M8 13h8M8 17h6" />
    </svg>
  ),
  experiments: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6M10 3v6.5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-8.5V3" />
    </svg>
  ),
  "lab-activity": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  ),
  purchases: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1.5" />
      <circle cx="18" cy="21" r="1.5" />
      <path d="M3 4h2l2.4 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L23 7H6" />
    </svg>
  ),
  "recent-activity": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  "pi-actions": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  "member-workload": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  "todays-announcements": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 0 1-5.8-1.6" />
    </svg>
  ),
  calendar: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  "daily-tasks": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L20 6" />
      <path d="M4 4h7M4 9h5M4 14h7M4 19h9" />
    </svg>
  ),
  "projects-overview": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  "single-project": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
};

const GENERIC_GLYPH: ReactNode = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

function glyphFor(toolId: string): ReactNode {
  return TOOL_GLYPHS[toolId] ?? GENERIC_GLYPH;
}

// ── Action affordance copy, per surface ─────────────────────────────────
// The SAME card is rendered in two places with two different meanings for
// its one button, so the copy must follow the surface or it lies to a
// screen reader (widget-card-copy bot, 2026-05-30):
//   - "canvas": the canvas "+ Add widget" palette (SnapshotCanvas), where
//     the button genuinely PLACES / REMOVES the widget on the canvas.
//   - "palette": the widget STORE (WidgetStoreModal), where the button does
//     NOT touch the canvas. It toggles whether the widget is ENABLED in the
//     user's "Add widget" palette. The wording mirrors WidgetStoreDetail's
//     "In your Add widget palette" / "Hidden from your palette" so the card
//     and the store's detail pane tell one story.
// `on` = the widget is already present on this surface (mounted on the
// canvas / enabled in the palette).
type ActionKind = "canvas" | "palette";
interface ActionCopy {
  onLabel: string;
  offLabel: string;
  onTooltip: string;
  offTooltip: string;
  onAria: (title: string) => string;
  offAria: (title: string) => string;
}
const ACTION_COPY: Record<ActionKind, ActionCopy> = {
  canvas: {
    onLabel: "Added",
    offLabel: "Add",
    onTooltip: "Remove from canvas",
    offTooltip: "Add to canvas",
    onAria: (t) => `Remove ${t} from canvas`,
    offAria: (t) => `Add ${t} to canvas`,
  },
  palette: {
    onLabel: "In palette",
    offLabel: "Add to palette",
    onTooltip: "Remove from your Add widget palette",
    offTooltip: "Add to your Add widget palette",
    onAria: (t) => `Remove ${t} from your Add widget palette`,
    offAria: (t) => `Add ${t} to your Add widget palette`,
  },
};

// ── Preview error boundary ──────────────────────────────────────────────
// A live `SnapshotTile` runs real data hooks; a malformed sidecar, a null
// profile, or a render bug must not take down the whole palette. This
// boundary catches a throw and renders `fallback` (the static glyph +
// description) in place of the live preview. It is intentionally tiny and
// local to the card so the rest of the dialog keeps working.
interface PreviewBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}
interface PreviewBoundaryState {
  failed: boolean;
}
// Exported (Extension Store Phase D, store-detail bot, 2026-05-30) so the
// widget STORE detail pane reuses the SAME error boundary the card uses for
// its hero preview, instead of forking a second one.
export class WidgetPreviewBoundary extends Component<
  PreviewBoundaryProps,
  PreviewBoundaryState
> {
  constructor(props: PreviewBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError(): PreviewBoundaryState {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    // Quiet: a failed preview is an expected degradation, not an app
    // error. We log at warn level for diagnostics but do NOT escalate to
    // the global error reporter (that is for real crashes).
    console.warn("[WidgetCard] live preview failed, using static fallback", error);
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

// ── Lazy-mount hook ─────────────────────────────────────────────────────
// Returns whether the element has entered the viewport at least once.
// Once true it stays true (we don't unmount a preview that scrolled out;
// the cost is already paid and React Query caches the result). Falls back
// to "mount immediately" when IntersectionObserver is unavailable (older
// jsdom / SSR), so the static path still shows.
export function useInViewport<T extends Element>(ref: React.RefObject<T | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: "120px", threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return seen;
}

// ── Static fallback / placeholder hero ──────────────────────────────────
// Shown (a) before the card scrolls into view, (b) while a throwing tile
// is replaced by the boundary. Glyph + a clamped description so the card
// is informative even with no live tile.
export function StaticHero({ widget }: { widget: WidgetDefinition }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-2 px-3 text-center">
      <span aria-hidden="true" className="text-gray-400">
        {glyphFor(widget.toolId)}
      </span>
      {widget.description && (
        <p className="text-[11px] leading-snug text-gray-400 line-clamp-3">
          {widget.description}
        </p>
      )}
    </div>
  );
}

// ── Lazy-mount skeleton ─────────────────────────────────────────────────
// Shown in the preview box BEFORE the live tile mounts (Extension Store
// polish, store-polish bot, 2026-05-30). Replaces the bland literal
// "Loading..." flash the store showed on first open with a subtle neutral
// shimmer: no text, no spinner, just animated gray blocks sized to the box.
// House style: inline markup only, no emoji. (The error-boundary fallback
// stays StaticHero, which is informative when a tile actually throws.)
export function PreviewSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-full w-full animate-pulse p-3 flex flex-col gap-2"
    >
      <div className="h-2.5 w-1/2 rounded bg-gray-200" />
      <div className="h-2 w-3/4 rounded bg-gray-100" />
      <div className="mt-1 flex-1 rounded-lg bg-gray-100" />
    </div>
  );
}

export interface WidgetCardProps {
  widget: WidgetDefinition;
  /** Is this widget already mounted on the current surface? Drives the
   *  Add / Added affordance + the selected ring. */
  isMounted: boolean;
  /** Toggle the widget on the surface (single-add semantics, unchanged). */
  onToggle: () => void;
  /** Tour anchor stamped on the card root (e.g.
   *  `home-widget-catalog-item-<id>`). Preserves the §6.2b walkthrough
   *  selectors that previously lived on the catalog row. */
  tourTarget?: string;
  /**
   * Forward-compat for the widget STORE (U3): a render region for
   * curation / enable-disable badges in the hero's top-right corner.
   * Unused in this build; the store can supply it without a rewrite.
   */
  badgeSlot?: ReactNode;
  /**
   * Forward-compat for the widget STORE (U3): disable the Add affordance
   * (e.g. a not-yet-enabled store widget). Unused in this build.
   */
  disabled?: boolean;
  /**
   * Selects the action button's copy (label / Tooltip / aria-label) for the
   * surface this card lives on. "canvas" (default) = the canvas palette,
   * where the button places/removes the widget ON the canvas. "palette" =
   * the widget STORE, where it toggles whether the widget is enabled in the
   * user's "Add widget" palette. Defaults to "canvas" so existing callers
   * (SnapshotCanvas) are unchanged. See ACTION_COPY.
   */
  actionKind?: ActionKind;
}

export default function WidgetCard({
  widget,
  isMounted,
  onToggle,
  tourTarget,
  badgeSlot,
  disabled = false,
  actionKind = "canvas",
}: WidgetCardProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const inView = useInViewport(heroRef);
  const Tile = widget.SnapshotTile;
  const staticHero = <StaticHero widget={widget} />;
  const copy = ACTION_COPY[actionKind];

  return (
    <div
      data-tour-target={tourTarget}
      data-widget-card-id={widget.id}
      className={`group relative flex flex-col rounded-xl border bg-white text-left transition-shadow ${
        isMounted
          ? "border-blue-300 ring-2 ring-blue-400"
          : "border-gray-200 hover:ring-1 hover:ring-blue-200"
      }`}
    >
      {/* HERO: live preview clipped + non-interactive. The tile's own
          click-to-open / popups cannot fire from here (pointer-events-none
          + aria-hidden); the Add button below is the only live control. */}
      <div
        ref={heroRef}
        aria-hidden="true"
        className="pointer-events-none relative h-28 overflow-hidden rounded-t-xl border-b border-gray-100 bg-gray-50/60 select-none"
      >
        {badgeSlot && (
          <div className="absolute right-1.5 top-1.5 z-10">{badgeSlot}</div>
        )}
        {inView ? (
          <WidgetPreviewBoundary fallback={staticHero}>
            {/* Scaled-down so a full tile reads as a hero thumbnail. The
                inner box is sized larger then transform-scaled to fit. */}
            <div className="absolute inset-0 origin-top-left scale-[0.62] [width:161%] [height:161%] p-2">
              <Tile surface="canvas" />
            </div>
          </WidgetPreviewBoundary>
        ) : (
          <PreviewSkeleton />
        )}
      </div>

      {/* BODY */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-sm font-semibold text-gray-900">{widget.title}</p>
        {widget.description && (
          <p className="text-xs leading-snug text-gray-500 line-clamp-2">
            {widget.description}
          </p>
        )}

        {/* FOOTER: the one interactive affordance. */}
        <div className="mt-2 flex items-center justify-end">
          <Tooltip
            label={isMounted ? copy.onTooltip : copy.offTooltip}
            placement="top"
          >
            <button
              type="button"
              disabled={disabled}
              aria-pressed={isMounted}
              aria-label={
                isMounted
                  ? copy.onAria(widget.title)
                  : copy.offAria(widget.title)
              }
              onClick={onToggle}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isMounted
                  ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {isMounted ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {copy.onLabel}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {copy.offLabel}
                </>
              )}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
