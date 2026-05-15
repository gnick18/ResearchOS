"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import BeakerBot from "./BeakerBot";
import DynamicAnimation from "./DynamicAnimation";
import type { AnimationType } from "./animations";
import type { OnboardingTip } from "@/lib/onboarding/tips";

/**
 * Visible tip card with a stand-alone 96px BeakerBot mascot to its
 * left, anime visual-novel style. Positions itself NEAR the target
 * (right / below / left / above, in that priority) without covering
 * it, and applies a pulsing red glow to the target element until
 * the tip is dismissed.
 *
 * No dotted pointer-line. The target's own red glow is the "look
 * here" signal; the mascot just speaks the explanation next to it.
 *
 * Assembly structure (left to right):
 *  - BeakerBot 96px (pose adapts to where target is relative to
 *    mascot: pointing left/right/up/down)
 *  - Gap 12px
 *  - Card: title, body, footer (Show me later / Stop showing /
 *    setupAction button if present / Read more →) with comic-book
 *    callout tail on the left edge.
 *
 * Renders at the document root via portal so it sits above the
 * AppShell layout. Recomputes its anchor from the target's
 * `getBoundingClientRect()` on resize and scroll (passive,
 * debounced via rAF).
 */

const MASCOT_SIZE_PX = 96;
const MASCOT_CARD_GAP_PX = 12;
const CARD_WIDTH = 360;
const CARD_HEIGHT_APPROX = 220;
const ASSEMBLY_WIDTH = MASCOT_SIZE_PX + MASCOT_CARD_GAP_PX + CARD_WIDTH;
const ASSEMBLY_HEIGHT = Math.max(MASCOT_SIZE_PX, CARD_HEIGHT_APPROX);
/** Margin from the viewport edges. */
const VIEWPORT_MARGIN_PX = 16;
/** Gap between the target's edge and the nearest assembly edge. */
const TARGET_GAP_PX = 20;

type AssemblySide = "right" | "below" | "left" | "above" | "fallback";

interface AssemblyAnchor {
  left: number;
  top: number;
  side: AssemblySide;
}

interface OnboardingTipCardProps {
  tip: OnboardingTip;
  /** The DOM element the pointer-line aims at. Null = no line drawn. */
  target: HTMLElement | null;
  onClose: (outcome: "x" | "later" | "stop" | "got-it" | "read") => void;
}

/** The "animation-burst" sequence fired when a tip with
 *  `onShow: "animation-burst"` mounts. 5 animations spread across
 *  screen-center + 4 inset corners, 0.2s apart. Sequence:
 *  scary → plants → underwater → fungi → celebration, mapped to
 *  positions 0..4 (center, top-left, top-right, bottom-left,
 *  bottom-right). */
const ANIMATION_BURST_SEQUENCE: AnimationType[] = [
  "scary",
  "plants",
  "underwater",
  "fungi",
  "celebration",
];
const ANIMATION_BURST_INTERVAL_MS = 200;
/** Position factors (relative to viewport) for each animation in the
 *  burst. (0.5, 0.5) is dead-center; corners are inset 15% from each
 *  edge so animations don't clip. Index aligns with
 *  ANIMATION_BURST_SEQUENCE — scary fires center first, then plants
 *  top-left, etc. */
const ANIMATION_BURST_POSITIONS: { fx: number; fy: number }[] = [
  { fx: 0.5, fy: 0.5 },   // center — scary
  { fx: 0.18, fy: 0.25 }, // top-left — plants
  { fx: 0.82, fy: 0.25 }, // top-right — underwater
  { fx: 0.18, fy: 0.78 }, // bottom-left — fungi
  { fx: 0.82, fy: 0.78 }, // bottom-right — celebration
];

interface BurstShot {
  /** A unique id so React doesn't re-mount the same animation when the
   *  next burst overlaps. */
  key: string;
  type: AnimationType;
  x: number;
  y: number;
}

/** Small per-shot wrapper. Holds a stable `onComplete` reference so
 *  the animation components' useEffect (which lists `onComplete` as
 *  a dep — see e.g. ScaryAnimation.tsx:266) doesn't re-fire on every
 *  parent re-render. Without this, each new BurstShot pushed onto the
 *  state array would reset all previously-mounted animations'
 *  completion timers, leaving them looping until the card unmounts. */
function BurstShotRenderer({
  shot,
  onRemove,
}: {
  shot: BurstShot;
  onRemove: (key: string) => void;
}) {
  const handleComplete = useCallback(() => {
    onRemove(shot.key);
  }, [shot.key, onRemove]);
  return (
    <DynamicAnimation
      type={shot.type}
      x={shot.x}
      y={shot.y}
      onComplete={handleComplete}
    />
  );
}

export default function OnboardingTipCard({
  tip,
  target,
  onClose,
}: OnboardingTipCardProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pulse, setPulse] = useState(true);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(
    target ? target.getBoundingClientRect() : null,
  );
  const [burst, setBurst] = useState<BurstShot[]>([]);

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

  const handleSetupAction = useCallback(() => {
    const action = tip.setupAction;
    if (!action) return;
    if (action.kind === "navigate" && action.href) {
      router.push(action.href);
      // Count this as a successful "I followed up on it" outcome.
      onClose("got-it");
    }
    // `modal` kind reserved for future use — see proposal.
  }, [tip.setupAction, router, onClose]);

  // onShow="animation-burst": fire 5 animations 200ms apart across
  // screen center + 4 inset corners when the card mounts. The
  // DynamicAnimation children self-remove via onComplete; we keep
  // them in `burst` only so React mounts them, then prune them once
  // they're done. Fires once per mount — the dep is just `tip.onShow`
  // so a re-render doesn't re-trigger.
  useEffect(() => {
    if (tip.onShow !== "animation-burst") return;
    if (typeof window === "undefined") return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const timers: number[] = [];
    const fireId = Date.now();
    ANIMATION_BURST_SEQUENCE.forEach((type, i) => {
      const pos = ANIMATION_BURST_POSITIONS[i];
      const handle = window.setTimeout(() => {
        setBurst((prev) => [
          ...prev,
          {
            key: `${type}-${fireId}-${i}`,
            type,
            x: vw * pos.fx,
            y: vh * pos.fy,
          },
        ]);
      }, i * ANIMATION_BURST_INTERVAL_MS);
      timers.push(handle);
    });
    return () => {
      timers.forEach((h) => window.clearTimeout(h));
    };
  }, [tip.onShow]);

  // Stable per-shot remove handler. Captured in BurstShotRenderer's
  // useCallback so the animation child's `onComplete` prop identity
  // doesn't change across re-renders of OnboardingTipCard. Without
  // this, ScaryAnimation et al. (which list `onComplete` in their
  // useEffect deps) re-run on every parent re-render, restarting
  // the animation and resetting its 3000ms completion timer.
  const handleBurstComplete = useCallback((key: string) => {
    setBurst((prev) => prev.filter((s) => s.key !== key));
  }, []);

  // Pick a side to place the assembly on, in priority order:
  // right > below > left > above. Falls back to bottom-right corner
  // if nothing fits (assembly may overlap target — rare for our tip
  // set since all targets are bounded by the viewport).
  const anchor = useMemo<AssemblyAnchor | null>(() => {
    if (!targetRect || typeof window === "undefined") return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const fitsRight = vw - targetRect.right >=
      ASSEMBLY_WIDTH + TARGET_GAP_PX + VIEWPORT_MARGIN_PX;
    const fitsLeft = targetRect.left >=
      ASSEMBLY_WIDTH + TARGET_GAP_PX + VIEWPORT_MARGIN_PX;
    const fitsBelow = vh - targetRect.bottom >=
      ASSEMBLY_HEIGHT + TARGET_GAP_PX + VIEWPORT_MARGIN_PX;
    const fitsAbove = targetRect.top >=
      ASSEMBLY_HEIGHT + TARGET_GAP_PX + VIEWPORT_MARGIN_PX;

    const clampTop = (t: number) =>
      Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(vh - ASSEMBLY_HEIGHT - VIEWPORT_MARGIN_PX, t),
      );
    const clampLeft = (l: number) =>
      Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(vw - ASSEMBLY_WIDTH - VIEWPORT_MARGIN_PX, l),
      );

    if (fitsRight) {
      return {
        left: targetRect.right + TARGET_GAP_PX,
        top: clampTop(
          targetRect.top + targetRect.height / 2 - ASSEMBLY_HEIGHT / 2,
        ),
        side: "right",
      };
    }
    if (fitsBelow) {
      return {
        left: clampLeft(
          targetRect.left + targetRect.width / 2 - ASSEMBLY_WIDTH / 2,
        ),
        top: targetRect.bottom + TARGET_GAP_PX,
        side: "below",
      };
    }
    if (fitsLeft) {
      return {
        left: targetRect.left - TARGET_GAP_PX - ASSEMBLY_WIDTH,
        top: clampTop(
          targetRect.top + targetRect.height / 2 - ASSEMBLY_HEIGHT / 2,
        ),
        side: "left",
      };
    }
    if (fitsAbove) {
      return {
        left: clampLeft(
          targetRect.left + targetRect.width / 2 - ASSEMBLY_WIDTH / 2,
        ),
        top: targetRect.top - TARGET_GAP_PX - ASSEMBLY_HEIGHT,
        side: "above",
      };
    }
    // Fallback — bottom-right corner.
    return {
      left: vw - ASSEMBLY_WIDTH - VIEWPORT_MARGIN_PX,
      top: vh - ASSEMBLY_HEIGHT - VIEWPORT_MARGIN_PX,
      side: "fallback",
    };
  }, [targetRect]);

  // Pose adapts to where the target is relative to the mascot. The
  // mascot always sits on the LEFT side of the assembly (so the
  // card's left-edge callout tail keeps gesturing at it), so the
  // mascot's screen position is `anchor.left + MASCOT_SIZE_PX/2`.
  const mascotCenter = useMemo(() => {
    if (!anchor) return null;
    return {
      x: anchor.left + MASCOT_SIZE_PX / 2,
      y: anchor.top + MASCOT_SIZE_PX / 2,
    };
  }, [anchor]);

  const { botPose, botDirection } = useMemo<{
    botPose: "pointing" | "pointing-up" | "pointing-down";
    botDirection: "left" | "right";
  }>(() => {
    if (!targetRect || !mascotCenter) {
      return { botPose: "pointing", botDirection: "left" };
    }
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const dx = targetCenterX - mascotCenter.x;
    const dy = targetCenterY - mascotCenter.y;
    // If the target is mostly above/below the mascot, use vertical
    // pose; otherwise horizontal. Vertical-vs-horizontal decided by
    // which delta is larger in magnitude.
    if (Math.abs(dy) > Math.abs(dx) * 1.3) {
      return {
        botPose: dy < 0 ? "pointing-up" : "pointing-down",
        botDirection: dx < 0 ? "left" : "right",
      };
    }
    return { botPose: "pointing", botDirection: dx < 0 ? "left" : "right" };
  }, [targetRect, mascotCenter]);

  // Target-element class toggle. Adds an `onboarding-tip-highlight`
  // class so the target itself can carry the red border treatment
  // (CSS rules below). Some targets are inside their own stacking
  // context that suppresses or clips the box-shadow, so we ALSO
  // render an absolutely-positioned overlay ring at the target's
  // bounding rect (see `<div data-onboarding-tip-overlay-ring>`
  // below). The overlay is the bulletproof signal; the class is
  // there as a redundant in-place cue for unobstructed targets.
  useEffect(() => {
    if (!target) return;
    target.classList.add("onboarding-tip-highlight");
    return () => {
      target.classList.remove("onboarding-tip-highlight");
    };
  }, [target]);

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Pulsing red-glow highlight on the target — scoped CSS
          injected once per mount. Two outline rings + soft outer
          glow + a 1.4s ease-in-out pulse. Sits on top of whatever
          background the target has via box-shadow (no clipping).
          Style block uses opacity tween via the `pulse` flag so the
          first ~300ms after entry stays at peak intensity, then
          settles into the breathing animation. */}
      <style>{`
        .onboarding-tip-highlight {
          position: relative;
          z-index: 200 !important;
          animation: onboarding-tip-pulse 1.4s ease-in-out infinite;
        }
        @keyframes onboarding-tip-pulse {
          0%, 100% {
            box-shadow:
              0 0 0 3px rgba(239, 68, 68, 0.95),
              0 0 0 6px rgba(239, 68, 68, 0.35),
              0 0 18px 6px rgba(239, 68, 68, 0.55);
          }
          50% {
            box-shadow:
              0 0 0 3px rgba(239, 68, 68, 0.65),
              0 0 0 8px rgba(239, 68, 68, 0.18),
              0 0 24px 10px rgba(239, 68, 68, 0.35);
          }
        }
        @keyframes onboarding-tip-overlay-pulse {
          0%, 100% {
            box-shadow:
              0 0 0 3px rgba(239, 68, 68, 0.95),
              0 0 0 6px rgba(239, 68, 68, 0.35),
              0 0 22px 8px rgba(239, 68, 68, 0.55);
            border-color: rgba(239, 68, 68, 1);
          }
          50% {
            box-shadow:
              0 0 0 3px rgba(239, 68, 68, 0.7),
              0 0 0 8px rgba(239, 68, 68, 0.2),
              0 0 28px 12px rgba(239, 68, 68, 0.35);
            border-color: rgba(239, 68, 68, 0.85);
          }
        }
      `}</style>

      {/* Bulletproof overlay ring — absolutely positioned to the
          target's bounding rect, sits at z-[202] (above the tip card
          + mascot). The class-on-target approach above can be
          suppressed by stacking-context contained ancestors (eg. an
          ancestor with `overflow: hidden` or its own positioned
          z-index lower than the page chrome); this overlay lives at
          the document root and is independent of any ancestor
          chain. */}
      {targetRect && (
        <div
          aria-hidden
          className="fixed pointer-events-none rounded-lg border-2"
          style={{
            left: `${targetRect.left - 4}px`,
            top: `${targetRect.top - 4}px`,
            width: `${targetRect.width + 8}px`,
            height: `${targetRect.height + 8}px`,
            zIndex: 202,
            animation: "onboarding-tip-overlay-pulse 1.4s ease-in-out infinite",
          }}
        />
      )}

      {/* Mascot — standalone, sits at the LEFT end of the assembly.
          Pose adapts to where the target is relative to the mascot
          (pointing / pointing-up / pointing-down + direction flip). */}
      {anchor && (
        <div
          aria-hidden
          className="fixed z-[201] drop-shadow-lg transition-opacity duration-300"
          style={{
            left: `${anchor.left}px`,
            top: `${anchor.top + (ASSEMBLY_HEIGHT - MASCOT_SIZE_PX) / 2}px`,
            width: `${MASCOT_SIZE_PX}px`,
            height: `${MASCOT_SIZE_PX}px`,
            opacity: pulse ? 1 : 0.95,
          }}
        >
          <BeakerBot
            pose={botPose}
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
          left: anchor
            ? `${anchor.left + MASCOT_SIZE_PX + MASCOT_CARD_GAP_PX}px`
            : undefined,
          top: anchor
            ? `${anchor.top + (ASSEMBLY_HEIGHT - CARD_HEIGHT_APPROX) / 2}px`
            : undefined,
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
            className="text-base font-semibold text-gray-900 leading-snug"
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
              className="w-5 h-5"
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
        <p className="mt-2 text-sm text-gray-700 leading-relaxed">{tip.body}</p>

        {/* Secondary dismissals — small text links above the primary
            action row so they're available without competing for
            attention with the CTA. */}
        <div className="mt-3 flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => onClose("later")}
            className="text-gray-500 hover:text-gray-700"
          >
            Show me later
          </button>
          <span className="text-gray-300" aria-hidden>·</span>
          <button
            type="button"
            onClick={() => onClose("stop")}
            className="text-gray-500 hover:text-gray-700"
          >
            Stop showing
          </button>
        </div>

        {/* Primary action row — filled setupAction button (if present)
            + outlined Read-more button as the secondary CTA. */}
        <div className="mt-2 flex items-center gap-2">
          {tip.setupAction && (
            <button
              type="button"
              onClick={handleSetupAction}
              className="px-3 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg shadow-sm transition-colors"
            >
              {tip.setupAction.label}
            </button>
          )}
          <button
            type="button"
            onClick={handleReadMore}
            className="px-3 py-2 text-sm font-medium border border-sky-300 text-sky-700 hover:bg-sky-50 rounded-lg transition-colors"
          >
            Read more →
          </button>
        </div>
      </div>

      {/* Animation-burst overlay — fires for tips with
          `onShow: "animation-burst"`. Each shot renders through
          BurstShotRenderer so the per-shot onComplete reference is
          stable across re-renders of this card (see comment on the
          renderer for the bug this fixes). Each shot self-removes
          via onComplete. */}
      {burst.map((shot) => (
        <BurstShotRenderer
          key={shot.key}
          shot={shot}
          onRemove={handleBurstComplete}
        />
      ))}
    </>,
    document.body,
  );
}
