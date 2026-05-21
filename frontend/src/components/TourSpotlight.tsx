"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Anchor-highlight primitive for the Onboarding v4 tour controller (P3 of the
 * v4 arc — see ONBOARDING_V4_PROPOSAL.md §4.3). Given a target element (or a
 * CSS selector that resolves to one), this overlay renders:
 *
 *  1. A pulsing sky-blue glow ring tracking the target's bounding rectangle.
 *  2. A 60%-ish dim layer covering the entire viewport EXCEPT a clean cutout
 *     around the target (rendered as four dim rectangles around the cutout —
 *     simpler than clip-path tricks, no SVG mask required, and avoids the
 *     pointer-event quirks `clip-path` has with `evenodd` masking on Safari).
 *
 * The overlay is mounted via React portal at `document.body` so it sits above
 * app chrome (z-index 9000) but below modals (which typically live at 10000+).
 *
 * Position tracking happens via ResizeObserver on the target plus a passive
 * scroll listener on the document (capture-phase, so nested scroll containers
 * also bubble through). Updates are batched via `requestAnimationFrame` so
 * fast scroll pixels coalesce into one render per frame. An IntersectionObserver
 * detects when the target leaves the viewport and (by default) smooth-scrolls
 * it back into view. A MutationObserver on `document.body` detects target
 * removal mid-tour and hides the spotlight gracefully.
 *
 * When `prefers-reduced-motion: reduce` is set, the ring renders at full
 * opacity with the pulse animation disabled (it remains visible — only the
 * breathing motion is suppressed).
 *
 * No external animation deps — pulse + fade are pure CSS keyframes injected
 * via a `<style>` element inside the portal (so multiple spotlights on the
 * same page don't fight over a global stylesheet).
 */

export interface TourSpotlightProps {
  /** Target to highlight. Pass an `HTMLElement`, a CSS selector string, or
   *  `null` to unmount the overlay. Invalid selectors log once and render
   *  nothing. */
  target: HTMLElement | string | null;
  /** Glow ring color. Defaults to `#0ea5e9` (Tailwind `sky-500`). */
  glowColor?: string;
  /** Dim layer opacity in `0..1`. Defaults to `0.6` — high enough to focus
   *  attention, low enough that surrounding UI remains readable. */
  dimOpacity?: number;
  /** Pulse cycle duration in ms. Defaults to 1500. */
  pulseDurationMs?: number;
  /** When true (default), scroll the target into view smoothly if it leaves
   *  the viewport. When false, the spotlight stays at the last known
   *  position. */
  scrollIntoView?: boolean;
  /** When true, the dim layer captures pointer events outside the cutout
   *  so the user must interact with the target. Defaults to `false` —
   *  the overlay is purely visual and the user can click anywhere. */
  blockClickOutsideTarget?: boolean;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Z-index for the overlay. Above the app shell (typical max ~50) but below
 *  modal stacks (which live at 10000+ in this codebase). */
const Z_INDEX = 9000;

/** Padding (px) added around the target's bounding rect so the cutout has a
 *  little breathing room and the ring doesn't kiss the element's own border. */
const CUTOUT_PADDING = 4;

/** Ring offset (px) beyond the padded cutout — the ring sits just outside the
 *  dim cutout to look like a glow around it rather than on the element. */
const RING_OFFSET = 2;

/** Bool indicating we've already warned about an unresolved selector. The
 *  warning is once-per-selector-instance to avoid console spam during a tour
 *  step that mounts before the target page renders. */
const warnedSelectors = new Set<string>();

function warnOnceForSelector(selector: string) {
  if (warnedSelectors.has(selector)) return;
  warnedSelectors.add(selector);
  console.warn(
    `[TourSpotlight] target selector ${JSON.stringify(selector)} did not resolve to an element`
  );
}

function resolveTarget(target: HTMLElement | string | null): HTMLElement | null {
  if (target == null) return null;
  if (typeof target === "string") {
    if (typeof document === "undefined") return null;
    let el: Element | null = null;
    try {
      el = document.querySelector(target);
    } catch {
      // Invalid CSS selector — treat as unresolved.
      warnOnceForSelector(target);
      return null;
    }
    if (!(el instanceof HTMLElement)) {
      warnOnceForSelector(target);
      return null;
    }
    return el;
  }
  return target;
}

function readRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function TourSpotlight({
  target,
  glowColor = "#0ea5e9",
  dimOpacity = 0.6,
  pulseDurationMs = 1500,
  scrollIntoView = true,
  blockClickOutsideTarget = false,
}: TourSpotlightProps) {
  // SSR-safe portal mount — `document.body` is undefined during server render,
  // so the lazy initializer guards on `typeof document` and returns null on
  // server. Client renders pick up `document.body` immediately on render 0
  // with no extra effect/state-bump round trip (which would otherwise trip
  // `react-hooks/set-state-in-effect`).
  const [portalNode] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.body
  );

  // Resolve the current target on every render. When the prop is a selector
  // and the page has finished routing, this picks up the matching element.
  // Re-rendering naturally re-resolves; we also re-poll on a MutationObserver
  // tick further below to handle late-mounting anchors.
  const resolved = useMemo(() => resolveTarget(target), [target]);

  // Tracked bounding rect of the target. `null` while we haven't measured
  // anything yet, or after the target detached from the DOM.
  const [rect, setRect] = useState<Rect | null>(null);

  // Reduced-motion preference — initial value read via lazy state initializer
  // (SSR-safe; runs once on first client render), then kept fresh via a media
  // query change listener. The pulse keyframe is only applied when this is
  // false. Using the lazy initializer (instead of `useState(false)` + an
  // effect that bumps state) avoids the `react-hooks/set-state-in-effect`
  // cascade-render lint, since the initial value is correct from render 0.
  const [reducedMotion, setReducedMotion] = useState<boolean>(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    // Safari < 14 used `addListener`; we use the modern signature only since
    // the rest of the codebase targets evergreen browsers.
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Position-tracking effect — wires ResizeObserver + scroll/resize listeners
  // and uses requestAnimationFrame to batch updates within a frame. The effect
  // re-runs whenever `resolved` changes, so each closure has a fresh reference
  // to the current target — no stale-ref worries.
  //
  // When `resolved` is null we early-return without scheduling listeners;
  // render-time short-circuits on `!resolved` so we never read a stale `rect`
  // from a previous target — that lets us avoid a `setRect(null)` in the
  // effect body (which would trip `react-hooks/set-state-in-effect`).
  //
  // Inside the effect, the only setState calls left are: (a) the initial
  // measurement immediately after the target resolves and (b) calls from
  // observer/listener callbacks — both are the canonical "external system
  // subscription" pattern the rule's docs allow.
  useEffect(() => {
    if (!resolved) return;

    // `scheduled` is the "frame already queued" flag (not the rAF id — we
    // need a bool, not the id, because some test environments invoke the
    // rAF callback synchronously, which lets `measure` run and clear state
    // before `requestAnimationFrame`'s return value is even assigned. Using
    // a separate bool avoids that race entirely).
    let scheduled = false;
    let cancelled = false;

    const measure = () => {
      scheduled = false;
      if (cancelled) return;
      if (!resolved.isConnected) {
        setRect(null);
        return;
      }
      setRect(readRect(resolved));
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(measure);
    };

    // Initial measurement — scheduled (not synchronous) so the rect-update
    // happens inside a rAF tick alongside the regular update path. This keeps
    // the effect body itself free of synchronous setState calls, which is
    // what the React-hooks lint rule wants for cleanly distinguishing setup
    // from external-system synchronization.
    schedule();

    // ResizeObserver fires when the target itself resizes (e.g., its content
    // changes height). Layout-shifting siblings won't trigger this — that's
    // what the scroll listener handles.
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(resolved);

    // Scroll listener in capture phase so nested scroll containers also
    // bubble through to us. Passive — we never preventDefault.
    const onScroll = () => schedule();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    // IntersectionObserver — when the target leaves the viewport, optionally
    // scroll it back. We don't use IO to drive position tracking (that's the
    // scroll listener's job); IO is purely for the "off-screen" detection.
    let io: IntersectionObserver | null = null;
    if (scrollIntoView && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting && resolved.isConnected) {
              resolved.scrollIntoView({
                behavior: prefersReducedMotion() ? "auto" : "smooth",
                block: "center",
                inline: "center",
              });
            }
          }
        },
        { threshold: 0 }
      );
      io.observe(resolved);
    }

    // MutationObserver — if the target detaches from the DOM mid-tour, drop
    // the overlay. We watch `document.body` with `subtree: true` so any
    // removal that takes our target out of the tree gets caught. This is
    // cheaper than polling and avoids stranded glow rings on stale anchors.
    const mo = new MutationObserver(() => {
      if (!resolved.isConnected) {
        setRect(null);
      } else {
        schedule();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      // `cancelled` short-circuits any in-flight rAF measurement so a fading
      // effect doesn't write to unmounted state. We don't cancel the rAF id
      // itself (we stopped tracking it — see the `scheduled` bool above);
      // the `cancelled` check inside `measure` is the equivalent guard.
      cancelled = true;
      ro?.disconnect();
      io?.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [resolved, scrollIntoView]);

  if (!portalNode || !resolved || !rect) return null;

  // Cutout rect with padding. Clamped to non-negative for safety — a target
  // briefly anchored above the viewport can produce a negative top, and our
  // dim-strip math expects non-negative widths/heights.
  const cutout = {
    left: rect.left - CUTOUT_PADDING,
    top: rect.top - CUTOUT_PADDING,
    width: rect.width + CUTOUT_PADDING * 2,
    height: rect.height + CUTOUT_PADDING * 2,
  };

  // Ring sits one extra offset outside the cutout to form a halo.
  const ring = {
    left: cutout.left - RING_OFFSET,
    top: cutout.top - RING_OFFSET,
    width: cutout.width + RING_OFFSET * 2,
    height: cutout.height + RING_OFFSET * 2,
  };

  // Four dim rectangles surrounding the cutout. Total opacity matches
  // `dimOpacity`. Pointer events are disabled by default (the overlay is
  // visual only); when `blockClickOutsideTarget` is true the strips capture
  // events to force interaction with the target.
  const dimBg = `rgba(0, 0, 0, ${dimOpacity})`;
  const dimPointerEvents = blockClickOutsideTarget ? "auto" : "none";

  // Pulse animation parameters. The keyframe oscillates opacity (0.4 -> 0.8)
  // and scale (1 -> 1.05). With reduced motion, we lock the ring at 0.8.
  const pulseDuration = `${pulseDurationMs}ms`;

  return createPortal(
    <div
      data-testid="tour-spotlight"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z_INDEX,
        pointerEvents: "none",
      }}
    >
      <style>{`
        @keyframes tourSpotlightPulse {
          0%   { opacity: 0.4; transform: scale(1); }
          50%  { opacity: 0.8; transform: scale(1.05); }
          100% { opacity: 0.4; transform: scale(1); }
        }
        @keyframes tourSpotlightFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Dim strips — top / left-of-cutout / right-of-cutout / bottom. The
          four-rect approach keeps each strip a simple solid-colored div, no
          SVG mask or clip-path. Performance is one paint per frame with no
          compositor recalculation of mask shapes. */}
      <div
        data-testid="tour-spotlight-dim-top"
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: "100vw",
          height: Math.max(0, cutout.top),
          background: dimBg,
          pointerEvents: dimPointerEvents,
          animation: "tourSpotlightFadeIn 200ms ease-out",
        }}
      />
      <div
        data-testid="tour-spotlight-dim-bottom"
        style={{
          position: "fixed",
          left: 0,
          top: cutout.top + cutout.height,
          width: "100vw",
          height: `calc(100vh - ${cutout.top + cutout.height}px)`,
          background: dimBg,
          pointerEvents: dimPointerEvents,
          animation: "tourSpotlightFadeIn 200ms ease-out",
        }}
      />
      <div
        data-testid="tour-spotlight-dim-left"
        style={{
          position: "fixed",
          left: 0,
          top: cutout.top,
          width: Math.max(0, cutout.left),
          height: cutout.height,
          background: dimBg,
          pointerEvents: dimPointerEvents,
          animation: "tourSpotlightFadeIn 200ms ease-out",
        }}
      />
      <div
        data-testid="tour-spotlight-dim-right"
        style={{
          position: "fixed",
          left: cutout.left + cutout.width,
          top: cutout.top,
          width: `calc(100vw - ${cutout.left + cutout.width}px)`,
          height: cutout.height,
          background: dimBg,
          pointerEvents: dimPointerEvents,
          animation: "tourSpotlightFadeIn 200ms ease-out",
        }}
      />

      {/* Glow ring — positioned around the cutout. `boxShadow` builds the
          glow (a colored shadow expanding outward + a soft inner sky-blue
          edge). Always pointer-events: none — the ring is decorative. */}
      <div
        data-testid="tour-spotlight-ring"
        data-reduced-motion={reducedMotion ? "true" : "false"}
        style={{
          position: "fixed",
          left: ring.left,
          top: ring.top,
          width: ring.width,
          height: ring.height,
          borderRadius: 8,
          border: `2px solid ${glowColor}`,
          boxShadow: `0 0 16px 4px ${glowColor}, inset 0 0 8px 0 ${glowColor}`,
          pointerEvents: "none",
          opacity: reducedMotion ? 0.8 : undefined,
          animation: reducedMotion
            ? "tourSpotlightFadeIn 200ms ease-out"
            : `tourSpotlightPulse ${pulseDuration} ease-in-out infinite`,
          willChange: "opacity, transform",
        }}
      />
    </div>,
    portalNode
  );
}
