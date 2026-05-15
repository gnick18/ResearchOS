"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";

/**
 * Standalone "What's Lab Mode?" onboarding tip rendered inline inside
 * `UserLoginScreen`. Lives entirely outside the orchestrator — no
 * sidecar reads/writes, no welcome-modal/mode coupling. The user
 * isn't logged in yet at this point, so the orchestrator can't run
 * anyway.
 *
 * Persistence: a single sessionStorage key
 * `researchos:labModePickerTipDismissed`. Once set to "1" the tip
 * stays gone for the rest of this browser session. Next session
 * (or after the user clears site data) it re-fires. That's the
 * intended behavior — the login screen is a low-stakes surface and
 * "make sure new visitors notice Lab Mode" beats "remember dismissal
 * forever."
 *
 * Visuals: same vocabulary as `OnboardingTipCard` (96px BeakerBot +
 * comic-callout speech bubble + pulsing red glow on the target), but
 * positioned via `getBoundingClientRect()` on a target the parent
 * passes by ref. No "Show me later"/"Stop showing" — single X.
 */

const STORAGE_KEY = "researchos:labModePickerTipDismissed";

const MASCOT_SIZE_PX = 96;
const MASCOT_CARD_GAP_PX = 12;
const CARD_WIDTH = 320;
const CARD_HEIGHT_APPROX = 168;
const ASSEMBLY_WIDTH = MASCOT_SIZE_PX + MASCOT_CARD_GAP_PX + CARD_WIDTH;
const ASSEMBLY_HEIGHT = Math.max(MASCOT_SIZE_PX, CARD_HEIGHT_APPROX);
const VIEWPORT_MARGIN_PX = 16;
const TARGET_GAP_PX = 20;

interface OnboardingLabModePickerTipProps {
  /** Element the tip points at — the Lab Mode button. Null means the
   *  tip renders nothing (e.g. the button hasn't mounted yet or the
   *  parent decided to hide it). */
  target: HTMLElement | null;
}

export default function OnboardingLabModePickerTip({
  target,
}: OnboardingLabModePickerTipProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  });
  const [mounted, setMounted] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount detection so the portal target is available.
    setMounted(true);
  }, []);

  // Track target rect for positioning; recompute on scroll/resize.
  useLayoutEffect(() => {
    if (!target || dismissed) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      setTargetRect(target.getBoundingClientRect());
    };
    const schedule = () => {
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(sync);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- layout sync: pull the initial bounding rect so the card paints in the right spot before the first scroll/resize event lands.
    setTargetRect(target.getBoundingClientRect());
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, {
      passive: true,
      capture: true,
    });
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, {
        capture: true,
      } as EventListenerOptions);
      if (raf !== 0) window.cancelAnimationFrame(raf);
    };
  }, [target, dismissed]);

  // Red-glow highlight on the target while the tip is visible.
  useEffect(() => {
    if (!target || dismissed) return;
    target.classList.add("onboarding-tip-highlight");
    return () => {
      target.classList.remove("onboarding-tip-highlight");
    };
  }, [target, dismissed]);

  const handleDismiss = () => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // sessionStorage can fail in private mode or sandboxed iframes —
      // we still flip the local state so the tip disappears.
    }
    setDismissed(true);
  };

  const anchor = useMemo(() => {
    if (!targetRect || typeof window === "undefined") return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const fitsRight =
      vw - targetRect.right >=
      ASSEMBLY_WIDTH + TARGET_GAP_PX + VIEWPORT_MARGIN_PX;
    const fitsLeft =
      targetRect.left >= ASSEMBLY_WIDTH + TARGET_GAP_PX + VIEWPORT_MARGIN_PX;
    const fitsBelow =
      vh - targetRect.bottom >=
      ASSEMBLY_HEIGHT + TARGET_GAP_PX + VIEWPORT_MARGIN_PX;
    const fitsAbove =
      targetRect.top >= ASSEMBLY_HEIGHT + TARGET_GAP_PX + VIEWPORT_MARGIN_PX;

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
      };
    }
    if (fitsLeft) {
      return {
        left: targetRect.left - TARGET_GAP_PX - ASSEMBLY_WIDTH,
        top: clampTop(
          targetRect.top + targetRect.height / 2 - ASSEMBLY_HEIGHT / 2,
        ),
      };
    }
    if (fitsBelow) {
      return {
        left: clampLeft(
          targetRect.left + targetRect.width / 2 - ASSEMBLY_WIDTH / 2,
        ),
        top: targetRect.bottom + TARGET_GAP_PX,
      };
    }
    if (fitsAbove) {
      return {
        left: clampLeft(
          targetRect.left + targetRect.width / 2 - ASSEMBLY_WIDTH / 2,
        ),
        top: targetRect.top - TARGET_GAP_PX - ASSEMBLY_HEIGHT,
      };
    }
    return {
      left: vw - ASSEMBLY_WIDTH - VIEWPORT_MARGIN_PX,
      top: vh - ASSEMBLY_HEIGHT - VIEWPORT_MARGIN_PX,
    };
  }, [targetRect]);

  if (dismissed || !mounted || !target || !anchor) return null;

  return createPortal(
    <>
      {/* Highlight CSS — same keyframes as OnboardingTipCard. Scoped
          to this mount so we don't have to share a stylesheet. */}
      <style>{`
        .onboarding-tip-highlight {
          position: relative;
          z-index: 200 !important;
          border-radius: 8px;
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
      `}</style>

      {/* Mascot */}
      <div
        aria-hidden
        className="fixed z-[201] drop-shadow-lg"
        style={{
          left: `${anchor.left}px`,
          top: `${anchor.top + (ASSEMBLY_HEIGHT - MASCOT_SIZE_PX) / 2}px`,
          width: `${MASCOT_SIZE_PX}px`,
          height: `${MASCOT_SIZE_PX}px`,
        }}
      >
        <BeakerBot
          pose="pointing"
          direction="right"
          className="w-full h-full text-emerald-400"
        />
      </div>

      {/* Tip card */}
      <div
        role="dialog"
        aria-labelledby="onboarding-lab-mode-picker-title"
        className="fixed z-[201] bg-white border border-gray-200 rounded-xl shadow-2xl p-4"
        style={{
          left: `${anchor.left + MASCOT_SIZE_PX + MASCOT_CARD_GAP_PX}px`,
          top: `${anchor.top + (ASSEMBLY_HEIGHT - CARD_HEIGHT_APPROX) / 2}px`,
          width: `${CARD_WIDTH}px`,
        }}
      >
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
            id="onboarding-lab-mode-picker-title"
            className="text-sm font-semibold text-gray-900 leading-tight"
          >
            What&apos;s Lab Mode?
          </h3>
          <button
            type="button"
            onClick={handleDismiss}
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
        <p className="mt-1.5 text-xs text-gray-600 leading-snug">
          New here? Try Lab Mode to see everything everyone in the lab is
          working on. It&apos;s read-only, so poke around. You won&apos;t
          accidentally edit anyone&apos;s data.
        </p>
      </div>
    </>,
    document.body,
  );
}
