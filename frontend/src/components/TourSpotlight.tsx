"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Anchor-highlight primitive for the Onboarding v4 tour controller (P3 of the
 * v4 arc, see ONBOARDING_V4_PROPOSAL.md §4.3). Given a target element (or a
 * CSS selector that resolves to one), this overlay renders ONLY a pulsing
 * sky-blue glow ring tracking the target's bounding rectangle.
 *
 * Note on the dim layer (Grant feedback 2026-05-21): the v4 proposal's L5
 * lock originally specified "pulsing glow ring + slight dim ~60%" to focus
 * attention on the highlighted target. Browser testing of v4 surfaced that
 * dimming the entire viewport also dimmed BeakerBot's own speech bubble and
 * surrounding callouts, hurting readability. Grant revised the decision: keep
 * the pulsing glow ring as the single, universal highlight primitive across
 * every walkthrough step. The four-rect dim layer has been removed entirely
 * (not made configurable via prop) so the v4 visual language stays uniform.
 *
 * The overlay is mounted via React portal at `document.body` and slotted into
 * the v4 tour z-index band: above the InputLockOverlay (z-[420]) and the
 * TourPageLock dim layer (z-[419]) so the glow sits on top of the dim, but
 * BELOW the BeakerBot speech bubble overlay (`tour-beakerbot-overlay` at
 * z-[450]). Otherwise the glow bleeds through the bubble (Grant 2026-05-26
 * live-test screenshot, methods-cluster sub-bot fix). App-level modals live
 * at z-[500]+ and stay above the spotlight regardless.
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
 * opacity with the pulse animation disabled (it remains visible, only the
 * breathing motion is suppressed).
 *
 * No external animation deps. Pulse + fade are pure CSS keyframes injected
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
  /** Pulse cycle duration in ms. Defaults to 1500. */
  pulseDurationMs?: number;
  /** When true (default), scroll the target into view smoothly if it leaves
   *  the viewport. When false, the spotlight stays at the last known
   *  position. */
  scrollIntoView?: boolean;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Z-index for the overlay. Slotted into the v4 tour band: above the
 *  InputLockOverlay (z-[420]) and the TourPageLock dim layer (z-[419]) so
 *  the glow sits on top of the dim, but below the BeakerBot speech bubble
 *  (z-[450]) so the spotlight ring never bleeds through the bubble. App
 *  modals (Phase4Cleanup z-[500], TourGoodbye z-[600], etc.) stay above
 *  the spotlight automatically. */
const Z_INDEX = 440;

/** Padding (px) added around the target's bounding rect so the ring has a
 *  little breathing room and doesn't kiss the element's own border. */
const CUTOUT_PADDING = 4;

/** Ring offset (px) beyond the padded rect, so the glow sits just outside
 *  the target's bounding box rather than directly on the element edge. */
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
  glowColor = "#0284c7",
  pulseDurationMs = 1500,
  scrollIntoView = true,
}: TourSpotlightProps) {
  // SSR-safe portal mount — `document.body` is undefined during server render,
  // so the lazy initializer guards on `typeof document` and returns null on
  // server. Client renders pick up `document.body` immediately on render 0
  // with no extra effect/state-bump round trip (which would otherwise trip
  // `react-hooks/set-state-in-effect`).
  const [portalNode] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.body
  );

  // Resolve the current target. Live-test R5 (2026-05-22) found that
  // useMemo-with-[target]-dep silently captured null at first render
  // for late-mounting anchors (eg. workbench-shared-experiments lands
  // after the step navigates to /workbench). Once null, useMemo never
  // re-ran because target string didn't change → spotlight stayed
  // dark forever. Switched to useState + a polling-MutationObserver
  // effect that re-resolves on every DOM mutation until the anchor
  // appears, then drops back to the tracked-rect effect below.
  const [resolved, setResolved] = useState<HTMLElement | null>(() =>
    resolveTarget(target),
  );
  useEffect(() => {
    // Reset on target change.
    setResolved(resolveTarget(target));
    if (typeof target !== "string") return;
    if (typeof document === "undefined") return;
    // Observe document mutations. As soon as a node matching the
    // selector lands in the DOM, re-resolve and update state. The
    // tracked-rect effect below picks it up via its [resolved] dep.
    let stopped = false;
    const reresolve = () => {
      if (stopped) return;
      const next = resolveTarget(target);
      if (next) {
        setResolved((prev) => (prev === next ? prev : next));
      }
    };
    const mo = new MutationObserver(reresolve);
    mo.observe(document.body, { childList: true, subtree: true });
    // Safety net: also poll for ~3s in case MutationObserver doesn't
    // catch the mount (eg. portals to nodes outside body.subtree).
    const poll = window.setInterval(reresolve, 100);
    const stopAt = window.setTimeout(() => {
      stopped = true;
      window.clearInterval(poll);
    }, 3000);
    return () => {
      stopped = true;
      mo.disconnect();
      window.clearInterval(poll);
      window.clearTimeout(stopAt);
    };
  }, [target]);

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

  // Occlusion guard (widget tile-anatomy fix manager, 2026-05-27).
  // When a dashboard SnapshotTilePopup (or any caller that stamps
  // `data-tour-popup-occluding` on its overlay) mounts, the spotlight
  // ring would otherwise pulse behind the popup chrome — visually
  // noisy because the "active surface" has moved to the popup and the
  // tile beneath it is no longer interactive. We listen for the
  // open/close events and seed the initial value from the DOM so the
  // guard is correct on mount too (e.g. when the controller mounts
  // mid-popup due to a resume / late spotlight push).
  //
  // Generic shape: any element in the DOM with the
  // `data-tour-popup-occluding` attribute hides every TourSpotlight on
  // the page. Today only SnapshotTilePopup uses this; a future modal
  // that wants the same handoff treatment can opt in by stamping the
  // same attribute on its overlay root.
  const [occluded, setOccluded] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    return document.querySelector("[data-tour-popup-occluding]") !== null;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Read once on effect entry in case the popup mounted between the
    // lazy initializer and this effect (e.g. fast cursor demo).
    const recompute = () => {
      if (typeof document === "undefined") return;
      const hit = document.querySelector("[data-tour-popup-occluding]");
      setOccluded((prev) => {
        const next = hit !== null;
        return prev === next ? prev : next;
      });
    };
    recompute();
    const onOpen = () => setOccluded(true);
    const onClose = () => {
      // After the close event fires, re-read the DOM in case more
      // than one occluding popup is stacked (e.g. fullscreen toggle
      // re-mounts the dialog).
      recompute();
    };
    window.addEventListener("tour:snapshot-tile-popup-opened", onOpen);
    window.addEventListener("tour:snapshot-tile-popup-closed", onClose);
    // MutationObserver as the resilient fallback — any attribute /
    // child change that adds or removes a `data-tour-popup-occluding`
    // node recomputes occlusion. This also covers cases where a
    // future caller stamps the attribute without firing the event.
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      mo = new MutationObserver(recompute);
      mo.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-tour-popup-occluding"],
      });
    }
    return () => {
      window.removeEventListener("tour:snapshot-tile-popup-opened", onOpen);
      window.removeEventListener("tour:snapshot-tile-popup-closed", onClose);
      mo?.disconnect();
    };
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
  // Occlusion guard (widget tile-anatomy fix manager, 2026-05-27).
  // Drop the ring while an overlay with `data-tour-popup-occluding`
  // is mounted; the controller is still tracking the target so the
  // ring re-appears the moment the overlay unmounts.
  if (occluded) return null;

  // Padded rect (small breathing room around the target's bounding box) plus
  // a ring offset, so the glow sits just outside the element rather than on
  // its border. Clamped at non-negative for safety in case a target briefly
  // anchors above the viewport.
  const padded = {
    left: rect.left - CUTOUT_PADDING,
    top: rect.top - CUTOUT_PADDING,
    width: rect.width + CUTOUT_PADDING * 2,
    height: rect.height + CUTOUT_PADDING * 2,
  };

  // Ring sits one extra offset outside the padded rect to form a halo.
  const ring = {
    left: padded.left - RING_OFFSET,
    top: padded.top - RING_OFFSET,
    width: padded.width + RING_OFFSET * 2,
    height: padded.height + RING_OFFSET * 2,
  };

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

      {/* Glow ring around the target. `boxShadow` builds the glow (a colored
          shadow expanding outward + a soft inner sky-blue edge). Always
          pointer-events: none, the ring is decorative. The viewport dim
          layer was removed 2026-05-21 per Grant feedback (see file header):
          dimming the page also dimmed BeakerBot itself, so v4 now uses just
          the pulsing glow ring as the single, universal highlight. */}
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
          // Brighter + deeper-blue spotlight per Grant feedback 2026-05-21:
          // bumped border to 3px and box-shadow spread to 8px with stronger
          // outer glow at 32px so the highlight reads from across the screen.
          border: `3px solid ${glowColor}`,
          boxShadow: `0 0 0 2px ${glowColor}40, 0 0 32px 8px ${glowColor}, inset 0 0 12px 0 ${glowColor}`,
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
