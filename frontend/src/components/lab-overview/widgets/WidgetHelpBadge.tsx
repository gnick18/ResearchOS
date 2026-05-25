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
 *     standard). Hover shows the explanatory copy; click toggles a
 *     sticky open state so the user can pin the bubble while they read.
 *   - When `shouldAutoOpen` is true on mount (first widget, fresh
 *     lab_head session), the badge opens its tooltip once and stays
 *     open until the user clicks anywhere. The auto-open marker is
 *     stamped on dismiss via the `markSeen` callback so a refresh
 *     doesn't re-trigger.
 *   - The badge stays put after dismiss so the explainer is
 *     recoverable.
 *
 * Mira PI R1 fix manager (Fix 4 + Fix 6, 2026-05-25):
 *   - Click TOGGLES (closed -> open, open -> closed). The previous
 *     implementation had two interlocking handlers (the inline
 *     `handleClick` toggle + a document-level mousedown that closed on
 *     any click, including the badge itself). `handleMouseDown` was
 *     stopping propagation so the document-level handler never fired
 *     for badge-on-badge clicks, but ALSO never fired for clicks on
 *     OTHER badges — producing 13 simultaneously-open tooltips after a
 *     sequential walk. The new shape uses a module-level "active badge
 *     registry": when a badge opens, every other registered badge
 *     closes. The document-level outside-click handler still closes the
 *     currently-active badge on clicks anywhere off the badge surface
 *     (toggle still works because we let the click handler run after
 *     the document handler closes us — the toggle handler then sees
 *     `pinnedOpen === false` and reopens... no, wait — the document
 *     handler now CHECKS if the click was on a badge button and skips
 *     in that case, so the toggle gets a clean false -> true or true ->
 *     false flip without interference).
 *   - When `shouldAutoOpen` fires, the Tooltip variant flips to
 *     `firstPaintHint` so the bubble reads as a guided first-paint
 *     moment (BeakerBot header + "Got it" CTA) instead of an
 *     accidental hover hint. Click-opened tooltips keep the default
 *     hover styling.
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

/**
 * Mira PI R1 fix manager (Fix 4, 2026-05-25): module-level "active
 * badge registry". Each mounted-and-open badge registers a `close()`
 * callback here; when a different badge opens it closes everything
 * else in the registry first. This is the single-active-tooltip
 * semantics the fresh-eyes verifier called for — without it, 13
 * tooltips can be open simultaneously after a sequential walk.
 *
 * Exported as a test seam so jsdom tests can drain it between cases.
 */
const activeBadgeRegistry = new Set<() => void>();

/** Test-only: drain the active-badge registry. */
export function _resetActiveBadgeRegistryForTest(): void {
  activeBadgeRegistry.clear();
}

/**
 * Mira PI R1 fix manager (Fix 4, 2026-05-25): tag every badge button
 * with this data attribute so the document-level outside-click handler
 * can recognize a click on ANY badge (own or other) and skip the
 * close. The handler also matches on closest() so a click on the SVG
 * descendant lands on the button via the data attribute.
 */
const BADGE_DATA_ATTR = "data-widget-help-badge";

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
  // Track whether the CURRENT pinned-open state was promoted from the
  // auto-open path (Mira PI R1 Fix 6). Click-opened tooltips use the
  // default hover styling; auto-opened tooltips use the firstPaintHint
  // variant so the bubble reads as a guided first-paint moment instead
  // of an accidental hover hint. Reset on dismiss so a subsequent
  // click-open doesn't inherit the firstPaintHint variant.
  const [openedViaAutoOpen, setOpenedViaAutoOpen] = useState(false);

  // Auto-open once on mount when the hint hook says so. The ref guard
  // prevents a re-render with `shouldAutoOpen = true` from re-opening
  // after the user has already dismissed.
  useEffect(() => {
    if (shouldAutoOpen && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot promotion of an external boolean into our pinned state; the ref guard plus the upstream hook's in-memory once-per-session guard ensure this fires at most once per mount.
      setPinnedOpen(true);
      setOpenedViaAutoOpen(true);
    }
  }, [shouldAutoOpen]);

  // Mira PI R1 fix manager (Fix 4, 2026-05-25): when this badge opens,
  // register a close-callback in the module-level registry and close
  // every OTHER registered badge first. This is the
  // single-active-tooltip semantics — clicking a different badge while
  // one is open closes the previous one cleanly.
  const closeSelf = useCallback(() => {
    setPinnedOpen(false);
    setOpenedViaAutoOpen(false);
  }, []);
  useEffect(() => {
    if (pinnedOpen !== true) return;
    // Close every other registered badge before adding ourselves.
    for (const fn of activeBadgeRegistry) {
      if (fn !== closeSelf) fn();
    }
    activeBadgeRegistry.add(closeSelf);
    return () => {
      activeBadgeRegistry.delete(closeSelf);
    };
  }, [pinnedOpen, closeSelf]);

  // Outside-click closes the pinned tooltip + stamps the seen marker
  // on the auto-open path. Mira PI R1 fix manager (Fix 4): the
  // document-level handler now CHECKS if the click landed on any badge
  // button (matched by the `data-widget-help-badge` attribute via
  // closest()) and skips the close in that case. Why: without this,
  // clicking the SAME badge twice flowed mousedown -> outside-click
  // handler (close) -> click -> toggle handler (re-open), so the
  // second click was a no-op. With the check, the document handler
  // ignores badge-on-badge clicks and the toggle handler runs cleanly
  // (false -> true on first click, true -> false on second).
  useEffect(() => {
    if (pinnedOpen !== true) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Element) {
        // If the click landed on ANY help-badge button (own or other),
        // skip the close-on-outside path. The active-badge registry
        // handles the other-badge case; the toggle handler handles
        // the own-badge case.
        if (target.closest(`[${BADGE_DATA_ATTR}]`)) return;
      }
      setPinnedOpen(false);
      setOpenedViaAutoOpen(false);
      // markSeen is the one-shot stamp; safe to call multiple times
      // (the hook idempotently records the timestamp).
      markSeen?.();
    };
    // Defer the listener install by one frame so the SAME click that
    // opened the bubble (in the click-toggle path) doesn't immediately
    // close it. Auto-open path goes through useEffect on mount, where
    // there's no concurrent click, so the deferral is harmless there.
    const handle = window.setTimeout(() => {
      window.addEventListener("mousedown", onDocMouseDown);
    }, 0);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener("mousedown", onDocMouseDown);
    };
  }, [pinnedOpen, markSeen]);

  const handleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (stopPropagation) e.stopPropagation();
      // Toggle: closed -> open, open -> closed. Hover-only state (null)
      // gets promoted to open on first click. Click-opened tooltips
      // always use the default styling (Fix 6 firstPaintHint variant
      // only fires on the auto-open path).
      setPinnedOpen((prev) => {
        const next = prev === true ? false : true;
        if (!next) {
          // Closing — also reset the variant flag so a later auto-open
          // path can re-promote cleanly. Closing via click also clears
          // the firstPaintHint variant since we're dismissing.
          setOpenedViaAutoOpen(false);
        } else {
          // Opening via click - explicitly NOT the firstPaintHint path.
          setOpenedViaAutoOpen(false);
        }
        return next;
      });
    },
    [stopPropagation],
  );

  // Stop mousedown propagation too so the canvas wrapper's drag-init
  // (react-grid-layout uses mousedown to start drags) doesn't fight
  // with the click toggle. Note: this STILL stops bubbling to ancestor
  // handlers, but the document-level outside-click handler reads via
  // window.addEventListener("mousedown") which fires in CAPTURE-style
  // ordering for the document — and it explicitly skips badge clicks
  // via the `BADGE_DATA_ATTR` check, so the toggle wins for own-badge
  // clicks and the registry handles other-badge clicks.
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (stopPropagation) e.stopPropagation();
    },
    [stopPropagation],
  );

  // Tooltip `open` prop: when pinned, we control it. When null, fall
  // back to undefined so the existing hover behavior runs.
  const controlledOpen = pinnedOpen === null ? undefined : pinnedOpen;
  // Mira PI R1 Fix 6: variant flips to firstPaintHint ONLY when the
  // bubble is currently visible AND was promoted via the auto-open
  // path. Hover-opened + click-opened bubbles keep the default
  // styling. Closing the auto-open bubble (Got it CTA or outside
  // click) resets `openedViaAutoOpen` so a subsequent re-open via
  // click reads as the default variant.
  const tooltipVariant =
    pinnedOpen === true && openedViaAutoOpen ? "firstPaintHint" : undefined;
  const handleFirstPaintGotIt = useCallback(() => {
    setPinnedOpen(false);
    setOpenedViaAutoOpen(false);
    markSeen?.();
  }, [markSeen]);

  return (
    <Tooltip
      label={title}
      body={body}
      placement="bottom"
      open={controlledOpen}
      variant={tooltipVariant}
      onPrimaryAction={
        tooltipVariant === "firstPaintHint" ? handleFirstPaintGotIt : undefined
      }
    >
      <button
        type="button"
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        aria-label={ariaLabel ?? `What is the ${title} widget?`}
        aria-expanded={controlledOpen === true}
        {...{ [BADGE_DATA_ATTR]: "" }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
      >
        {QUESTION_MARK_SVG}
      </button>
    </Tooltip>
  );
}
