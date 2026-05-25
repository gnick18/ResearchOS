"use client";

/**
 * Lab overview PI tooltips (Chip B, lab overview PI tooltips manager,
 * 2026-05-25): the small "?" badge that sits next to each widget tile's
 * title and explains what the widget is.
 *
 * Behavior:
 *   - Renders a 14px inline-SVG "?" mark (no emoji, mirrors the
 *     surrounding icon affordance pattern).
 *   - Wraps in the canonical `<Tooltip>` component (per Grant's tooltip
 *     standard) — hover shows the explanatory copy, click toggles a
 *     sticky open state so the user can pin the bubble while they read.
 *   - When `shouldAutoOpen` is true on mount (first widget, fresh
 *     lab_head session), the badge opens its tooltip once and stays
 *     open until the user clicks anywhere. The auto-open marker is
 *     stamped on dismiss via the `markSeen` callback so a refresh
 *     doesn't re-trigger.
 *   - The badge stays put after dismiss so the explainer is
 *     recoverable — the proposal's "discoverable, non-blocking,
 *     respects the dense-canvas aesthetic" guidance.
 *
 * No emoji, no native title=, no dimming, no modal — passive icon-
 * affordance pattern.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Tooltip from "@/components/Tooltip";

export interface WidgetHelpBadgeProps {
  /** Headline shown bold at the top of the tooltip bubble. Typically
   *  the widget title. */
  title: string;
  /** The 1-2 sentence explanatory copy. Multi-line is fine; the
   *  Tooltip component wraps long sentences inside a card. */
  body: string;
  /** When true on mount, the badge auto-opens its tooltip once. The
   *  caller (the `useFirstPaintHint` hook consumer) is responsible for
   *  passing this only for the FIRST widget on the lab_head canvas. */
  shouldAutoOpen?: boolean;
  /** Called the moment the auto-open bubble is dismissed (by click).
   *  The caller stamps the sidecar so the auto-open never re-fires.
   *  Not invoked on subsequent click-opens. */
  markSeen?: () => void;
  /** Optional aria-label override. Defaults to "What is the {title}
   *  widget?" so screen readers announce the badge's purpose without
   *  needing to read the SVG. */
  ariaLabel?: string;
  /**
   * Stops click propagation on the badge so a tile-click handler (the
   * snapshot canvas wraps each tile in a click-to-open handler) doesn't
   * also fire. Defaults to true. Set false if the caller wants the
   * click to bubble (e.g. an embedded variant inside a non-clickable
   * frame).
   */
  stopPropagation?: boolean;
}

const QUESTION_MARK_SVG = (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1.5 1-1.5 2v.2" />
    <line x1="12" y1="17" x2="12" y2="17.01" />
  </svg>
);

export default function WidgetHelpBadge({
  title,
  body,
  shouldAutoOpen = false,
  markSeen,
  ariaLabel,
  stopPropagation = true,
}: WidgetHelpBadgeProps) {
  // Controlled-open state. `null` = uncontrolled (hover-only). `true` =
  // pinned open (auto-fired or user-clicked-open). `false` = closed but
  // hover still works.
  const [pinnedOpen, setPinnedOpen] = useState<boolean | null>(null);
  const autoOpenedRef = useRef(false);

  // Auto-open once on mount when the hint hook says so. The ref guard
  // prevents a re-render with `shouldAutoOpen = true` from re-opening
  // after the user has already dismissed. This effect is the
  // intentional "external input → controlled component state" sync —
  // `shouldAutoOpen` is the upstream hook's verdict for THIS widget,
  // and we promote it once into the pinned-open visual state. The
  // alternative (read `shouldAutoOpen` directly in render) would
  // re-open the bubble on every parent re-render until the hook
  // resolved, which is the wrong shape.
  useEffect(() => {
    if (shouldAutoOpen && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot promotion of an external boolean into our pinned state; the ref guard plus the upstream hook's in-memory once-per-session guard ensure this fires at most once per mount.
      setPinnedOpen(true);
    }
  }, [shouldAutoOpen]);

  // Outside-click closes the pinned tooltip + stamps the seen marker
  // on the auto-open path. Mousedown (not click) so the tooltip closes
  // before any other click handler runs — feels snappier.
  useEffect(() => {
    if (pinnedOpen !== true) return;
    const onDocClick = () => {
      setPinnedOpen(false);
      // markSeen is the one-shot stamp; safe to call multiple times
      // (the hook idempotently records the timestamp). We invoke it
      // on every pinned-open dismiss so a user who manually clicks the
      // badge open after the first auto-open also extends the marker
      // — cheap, and keeps "the user has acknowledged the explainer
      // at least once" semantics aligned across paths.
      markSeen?.();
    };
    // Defer the listener install by one frame so the SAME click that
    // opened the bubble (in the click-toggle path) doesn't immediately
    // close it. Auto-open path goes through useEffect on mount, where
    // there's no concurrent click, so the deferral is harmless there.
    const handle = window.setTimeout(() => {
      window.addEventListener("mousedown", onDocClick);
    }, 0);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener("mousedown", onDocClick);
    };
  }, [pinnedOpen, markSeen]);

  const handleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (stopPropagation) e.stopPropagation();
      // Toggle: closed → open, open → closed. Hover-only state (null)
      // gets promoted to open on first click.
      setPinnedOpen((prev) => (prev === true ? false : true));
    },
    [stopPropagation],
  );

  // Stop mousedown propagation too so the canvas wrapper's drag-init
  // (react-grid-layout uses mousedown to start drags) doesn't fight
  // with the click toggle.
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (stopPropagation) e.stopPropagation();
    },
    [stopPropagation],
  );

  // Tooltip `open` prop: when pinned, we control it. When null, fall
  // back to undefined so the existing hover behavior runs.
  const controlledOpen = pinnedOpen === null ? undefined : pinnedOpen;

  return (
    <Tooltip
      label={title}
      body={body}
      placement="bottom"
      open={controlledOpen}
    >
      <button
        type="button"
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        aria-label={ariaLabel ?? `What is the ${title} widget?`}
        aria-expanded={controlledOpen === true}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
      >
        {QUESTION_MARK_SVG}
      </button>
    </Tooltip>
  );
}
