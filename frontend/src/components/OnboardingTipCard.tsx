"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";
import type { OnboardingTip } from "@/lib/onboarding/tips";

/**
 * Visible tip card with a stand-alone 96px BeakerBot mascot to its
 * left, anime visual-novel style. Renders at the document root via
 * portal so it sits above the AppShell layout, anchored at
 * `bottom-20 right-4` to clear the AppShell's 5-icon cluster
 * (`bottom-6 right-6`).
 *
 * The dotted pointer-line is drawn as a separate SVG (also
 * portalled), emitting from the mascot's outer-edge finger position
 * (which side depends on the `direction` flip) and ending at the
 * target's center. It recomputes its endpoint from the target's
 * `getBoundingClientRect()` on resize and scroll (passive, debounced
 * via rAF). Pulses once on entry — fades back to 0.7 opacity after
 * 300ms.
 *
 * Assembly structure (left to right):
 *  - BeakerBot 96px (pointing pose, faces target)
 *  - Gap 12px
 *  - Card: title, body, footer (Show me later / Stop showing /
 *    setupAction button if present / Read more →)
 */

const MASCOT_SIZE_PX = 96;
const MASCOT_CARD_GAP_PX = 12;
const CARD_WIDTH = 320;
const CARD_HEIGHT_APPROX = 156;
/** Distance in px the assembly's bottom + right edges sit from the
 *  viewport edges. Mirrors `<FloatingLeaveDemoButton>`'s
 *  `bottom-20 right-4`. */
const ASSEMBLY_RIGHT_PX = 16;
const ASSEMBLY_BOTTOM_PX = 80;
/** The pointing-pose finger lives at roughly (35, 15) inside the
 *  BeakerBot's 40-unit viewBox. As a fraction of the 96px mascot
 *  bounding box: x=87.5%, y=37.5%. When `direction="left"` the
 *  whole SVG flips via scaleX(-1) so the finger ends up at x=12.5%
 *  of the bounding box. */
const FINGER_X_RIGHT = 0.875;
const FINGER_X_LEFT = 1 - FINGER_X_RIGHT;
const FINGER_Y = 0.375;

interface OnboardingTipCardProps {
  tip: OnboardingTip;
  /** The DOM element the pointer-line aims at. Null = no line drawn. */
  target: HTMLElement | null;
  onClose: (outcome: "x" | "later" | "stop" | "got-it" | "read") => void;
}

export default function OnboardingTipCard({
  tip,
  target,
  onClose,
}: OnboardingTipCardProps) {
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pulse, setPulse] = useState(true);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(
    target ? target.getBoundingClientRect() : null,
  );

  // Portal is client-only — render nothing on the server (this is a
  // "use client" file but still gets a server pass for the React tree).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount detection: render nothing on the server, then flip to mounted on client mount so createPortal(document.body) is safe to call.
    setMounted(true);
  }, []);

  // One-shot pulse on entry: starts at full opacity, fades to 0.7 after
  // 300ms. Pure visual flourish; nothing functional.
  useEffect(() => {
    if (!target) return;
    const handle = window.setTimeout(() => setPulse(false), 300);
    return () => window.clearTimeout(handle);
  }, [target]);

  // Recompute target rect on resize + scroll (passive, debounced by
  // requestAnimationFrame so a fast-scroll storm doesn't pin the main
  // thread). 16ms is plenty for a one-line redraw.
  useLayoutEffect(() => {
    if (!target) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      setTargetRect(target.getBoundingClientRect());
    };
    const schedule = () => {
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(sync);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- layout-sync: read the target's bounding-rect on mount + whenever the target ref changes, so the pointer-line draws to the right anchor before paint. The rAF-throttled `sync()` updates handle ongoing scroll/resize events; this initial pull is a one-shot.
    setTargetRect(target.getBoundingClientRect());
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true } as EventListenerOptions);
      if (raf !== 0) window.cancelAnimationFrame(raf);
    };
  }, [target]);

  const handleReadMore = useCallback(() => {
    // Open the wiki in a new tab so the user doesn't lose their place.
    window.open(tip.wikiPath, "_blank", "noopener,noreferrer");
    onClose("read");
  }, [tip.wikiPath, onClose]);

  // Compute the assembly's screen-anchor + mascot center first; the
  // bot's facing direction depends on which side of the mascot the
  // target is on. Both coordinates are in viewport-fixed px since
  // we're rendering inside a fixed-position portal.
  const assemblyGeometry = useMemo(() => {
    if (typeof window === "undefined") return null;
    const assemblyTotalWidth =
      MASCOT_SIZE_PX + MASCOT_CARD_GAP_PX + CARD_WIDTH;
    const assemblyLeft =
      window.innerWidth - ASSEMBLY_RIGHT_PX - assemblyTotalWidth;
    const assemblyBottom =
      window.innerHeight - ASSEMBLY_BOTTOM_PX;
    // Mascot sits at the LEFT end of the assembly, with its bottom
    // edge aligned to the card's bottom (so the mascot stands on
    // the same baseline as the card sits on).
    const mascotLeft = assemblyLeft;
    const mascotTop = assemblyBottom - MASCOT_SIZE_PX;
    const mascotCenterX = mascotLeft + MASCOT_SIZE_PX / 2;
    const cardLeft = mascotLeft + MASCOT_SIZE_PX + MASCOT_CARD_GAP_PX;
    const cardTop = assemblyBottom - CARD_HEIGHT_APPROX;
    return {
      mascotLeft,
      mascotTop,
      mascotCenterX,
      cardLeft,
      cardTop,
    };
  }, []);

  // Direction the BeakerBot faces — flip to face left when the
  // target is to the left of the mascot. In practice the mascot
  // sits at the bottom-right of the screen so almost every target
  // is to the left, but a target inside the AppShell cluster
  // (bottom-right) might be to the right.
  const botDirection = useMemo<"left" | "right">(() => {
    if (!targetRect || !assemblyGeometry) return "left";
    const targetCenterX = targetRect.left + targetRect.width / 2;
    return targetCenterX < assemblyGeometry.mascotCenterX ? "left" : "right";
  }, [targetRect, assemblyGeometry]);

  // Pointer-line geometry. Starts at the mascot's finger tip (which
  // is at one side of the mascot bounding box depending on
  // `botDirection`) and ends at the target's center.
  const pointerCoords = useMemo(() => {
    if (!targetRect || !assemblyGeometry) return null;
    const { mascotLeft, mascotTop } = assemblyGeometry;
    const fingerXFrac = botDirection === "left" ? FINGER_X_LEFT : FINGER_X_RIGHT;
    const startX = mascotLeft + MASCOT_SIZE_PX * fingerXFrac;
    const startY = mascotTop + MASCOT_SIZE_PX * FINGER_Y;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;
    return { startX, startY, endX, endY };
  }, [targetRect, assemblyGeometry, botDirection]);

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Dotted pointer-line — separate portal layer so it can extend
          beyond the card's bounds without clipping. */}
      {pointerCoords && (
        <svg
          aria-hidden
          className="fixed inset-0 pointer-events-none z-[200] transition-opacity duration-300"
          style={{ opacity: pulse ? 1 : 0.7 }}
          width="100vw"
          height="100vh"
        >
          <line
            x1={pointerCoords.startX}
            y1={pointerCoords.startY}
            x2={pointerCoords.endX}
            y2={pointerCoords.endY}
            stroke="currentColor"
            className="text-sky-500"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="2 4"
          />
        </svg>
      )}

      {/* Mascot — standalone, sits to the left of the card. Bottom
          edge aligns with the card's bottom so the bot "stands on"
          the same baseline. */}
      {assemblyGeometry && (
        <div
          aria-hidden
          className="fixed z-[201] drop-shadow-lg"
          style={{
            left: `${assemblyGeometry.mascotLeft}px`,
            top: `${assemblyGeometry.mascotTop}px`,
            width: `${MASCOT_SIZE_PX}px`,
            height: `${MASCOT_SIZE_PX}px`,
          }}
        >
          <BeakerBot
            pose="pointing"
            direction={botDirection}
            className="w-full h-full text-sky-500"
          />
        </div>
      )}

      {/* Tip card */}
      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby={`onboarding-tip-${tip.id}-title`}
        className="fixed z-[201] bg-white border border-gray-200 rounded-xl shadow-2xl p-4"
        style={{
          right: `${ASSEMBLY_RIGHT_PX}px`,
          bottom: `${ASSEMBLY_BOTTOM_PX}px`,
          width: `${CARD_WIDTH}px`,
        }}
      >
        {/* Comic-book callout tail — triangular notch on the card's
            left edge gesturing toward the mascot's mouth/face.
            Positioned at ~60% from the top so it sits at roughly the
            mascot's mouth level (mascot bottom-aligned with card,
            mouth at ~56% of mascot height from its top). The fill
            paints over the card's left border in the tail's vertical
            span so the seam is invisible; the outline is drawn as
            two open segments (no back edge) so the callout reads as
            a single continuous shape. */}
        <svg
          aria-hidden
          className="absolute pointer-events-none"
          style={{ left: "-11px", top: "60%", transform: "translateY(-50%)" }}
          width="12"
          height="22"
          viewBox="0 0 12 22"
        >
          <path d="M 0 11 L 12 0 L 12 22 Z" fill="white" />
          <path
            d="M 12 0 L 0 11 L 12 22"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div className="flex items-start justify-between gap-2">
          <h3
            id={`onboarding-tip-${tip.id}-title`}
            className="text-sm font-semibold text-gray-900 leading-tight"
          >
            {tip.title}
          </h3>
          <button
            type="button"
            onClick={() => onClose("x")}
            aria-label="Dismiss this tip"
            className="flex-shrink-0 -mt-1 -mr-1 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <p className="mt-1.5 text-xs text-gray-600 leading-snug">{tip.body}</p>

        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={() => onClose("later")}
            className="text-gray-500 hover:text-gray-700"
          >
            Show me later
          </button>
          <button
            type="button"
            onClick={() => onClose("stop")}
            className="text-gray-500 hover:text-gray-700"
          >
            Stop showing
          </button>
          <button
            type="button"
            onClick={handleReadMore}
            className="font-medium text-sky-600 hover:text-sky-700"
          >
            Read more →
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
