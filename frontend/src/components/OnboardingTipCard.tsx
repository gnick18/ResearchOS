"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";
import type { OnboardingTip } from "@/lib/onboarding/tips";

/**
 * Visible tip card. Renders at the document root via portal so it sits
 * above the AppShell layout, anchored at `bottom-20 right-4` to clear
 * the AppShell's 5-icon cluster (`bottom-6 right-6`).
 *
 * The dotted pointer-line is drawn as a separate SVG (also portalled)
 * that recomputes its endpoint from the target's `getBoundingClientRect()`
 * on resize and scroll (passive, debounced via rAF). Pulses once on
 * entry — fades back to a steady 0.7 opacity after 300ms.
 *
 * Card structure (top to bottom):
 *  - Upper row: BeakerBot (pointing pose) + X close button
 *  - Title
 *  - Body (≤140 chars)
 *  - Footer row: "Show me later" / "Stop showing" / "Read more →"
 */

const CARD_WIDTH = 320;
const CARD_HEIGHT_APPROX = 156;
/** Distance in px the card edge sits from the viewport's right + bottom
 *  edges. Mirrors `<FloatingLeaveDemoButton>`'s `bottom-20 right-4`. */
const CARD_RIGHT_PX = 16;
const CARD_BOTTOM_PX = 80;

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

  // Compute pointer-line geometry. The line starts at the card's
  // top-left corner (where the BeakerBot's pointing finger lives) and
  // ends at the target's center. Both coordinates are in viewport-fixed
  // px since we're rendering inside a fixed-position portal.
  const pointerCoords = useMemo(() => {
    if (!targetRect || typeof window === "undefined") return null;
    const cardLeft = window.innerWidth - CARD_RIGHT_PX - CARD_WIDTH;
    const cardTop = window.innerHeight - CARD_BOTTOM_PX - CARD_HEIGHT_APPROX;
    // Start at the BeakerBot's finger location inside the card (top-left
    // cell, ~24px from top, ~52px from left of the card).
    const startX = cardLeft + 24;
    const startY = cardTop + 28;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;
    return { startX, startY, endX, endY };
  }, [targetRect]);

  // Direction the BeakerBot faces — flip to face left when the target
  // is to the card's left, which is true in practice for every target
  // since the card sits at the right edge of the screen.
  const botDirection = useMemo<"left" | "right">(() => {
    if (!pointerCoords) return "left";
    return pointerCoords.endX < pointerCoords.startX ? "left" : "right";
  }, [pointerCoords]);

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

      {/* Tip card */}
      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby={`onboarding-tip-${tip.id}-title`}
        className="fixed z-[201] bg-white border border-gray-200 rounded-xl shadow-2xl p-4"
        style={{
          right: `${CARD_RIGHT_PX}px`,
          bottom: `${CARD_BOTTOM_PX}px`,
          width: `${CARD_WIDTH}px`,
        }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 -mt-1 -ml-1">
            <BeakerBot
              pose="pointing"
              direction={botDirection}
              className="w-10 h-10 text-sky-500"
            />
          </div>
          <div className="flex-1 min-w-0">
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
            <p className="mt-1 text-xs text-gray-600 leading-snug">{tip.body}</p>
          </div>
        </div>

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
