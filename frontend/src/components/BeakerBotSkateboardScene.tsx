"use client";

/**
 * BeakerBotSkateboardScene — side easter-egg ambience.
 *
 * A 3-stage cruise across the viewport:
 *   1. Entry (~300ms)   — slide in from off-screen on the entry side,
 *                          BeakerBot already standing on a skateboard.
 *   2. Cruise (~2.5-3s) — smooth horizontal motion across the full
 *                          viewport. Wheels spin continuously, body
 *                          bobs ~3% to simulate micro-bumps.
 *   3. Exit (~300ms)    — slide off-screen on the opposite side, then
 *                          call `onComplete`.
 *
 * Pure ambient comedy — no trigger logic in this file. The parent
 * decides when `active` flips true; we own animation + reduced-motion
 * fallback + cleanup.
 *
 * Reduced motion: when `prefers-reduced-motion: reduce` matches, we
 * render the bot + skateboard at center-screen statically for ~2s,
 * then fire `onComplete`. No horizontal motion, no wheel spin, no
 * bobbing.
 *
 * Portal mount: `document.body`, position fixed, z-index 800 — high
 * enough to overlay app chrome but below modal-stacking surfaces
 * (`OnboardingTipCard` uses 1000+; OnboardingWizard uses ~9000).
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";

export interface BeakerBotSkateboardSceneProps {
  /** Mount + run the animation when true. Flipping back to false
   *  unmounts (the parent typically gates on `active` + clears it
   *  inside `onComplete`). */
  active: boolean;
  /** Fired once when the cruise + exit completes (or after the
   *  reduced-motion static hold). Caller is responsible for clearing
   *  `active` to unmount. */
  onComplete: () => void;
  /** Direction of travel. Default "left-to-right". */
  direction?: "left-to-right" | "right-to-left";
  /** Vertical position from the top of the viewport, expressed as a
   *  percentage 0-100. Default 85 (near the bottom). Useful for
   *  parking the cruise above a fixed footer / status bar. */
  bottomY?: number;
  /** Cruise speed in pixels per second. Default 350 — a relaxed
   *  skateboard glide that crosses a ~1440px viewport in ~4s
   *  including entry + exit. */
  speedPxPerSec?: number;
}

/** Visual constants — kept module-scoped so reduced-motion hold can
 *  reuse the same skateboard SVG without prop drilling sizes. */
const BOT_WIDTH = 40;
const BOT_HEIGHT = 40;
const SKATEBOARD_WIDTH = 60;
const SKATEBOARD_HEIGHT = 12;
/** Stack offset so the bot sits ON the deck (deck top ~y0 → bot
 *  bottom rests there). Tuned to match BeakerBot's round-bottom
 *  silhouette so feet-on-deck reads correctly. */
const BOT_DECK_OVERLAP = 2;
const COMBINED_WIDTH = Math.max(BOT_WIDTH, SKATEBOARD_WIDTH);
const COMBINED_HEIGHT = BOT_HEIGHT + SKATEBOARD_HEIGHT - BOT_DECK_OVERLAP;

const ENTRY_MS = 300;
const EXIT_MS = 300;
const REDUCED_MOTION_HOLD_MS = 2000;

/** Bobbing oscillation tuning. ~3% of bot height vertical drift, with
 *  a ~600ms cycle. Implemented as a CSS keyframe so the browser can
 *  hand it to the compositor — no React state churn per frame. */
const BOB_AMPLITUDE_PX = Math.round(BOT_HEIGHT * 0.03);
const BOB_CYCLE_MS = 600;
const WHEEL_SPIN_MS = 500;

export default function BeakerBotSkateboardScene({
  active,
  onComplete,
  direction = "left-to-right",
  bottomY = 85,
  speedPxPerSec = 350,
}: BeakerBotSkateboardSceneProps) {
  const [mounted, setMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const onCompleteRef = useRef(onComplete);
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");

  // Keep the latest callback in a ref so timer closures don't capture
  // a stale reference if the parent re-renders mid-cruise.
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Portal is client-only — render nothing on the server, then flip
  // to mounted on client mount so createPortal(document.body) is safe.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount detection for portal safety, same pattern as OnboardingTipCard
    setMounted(true);
  }, []);

  // Cache reduced-motion preference + viewport width once per active
  // cycle. Width is read here (not from window during render) so SSR
  // doesn't trip + so the entry/exit translate distance is locked in
  // before the transition starts (resize mid-cruise is rare enough
  // that we don't bother subscribing).
  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot snapshot of platform values (matchMedia + innerWidth) at activation; not a render-loop, runs once per active flip
    setReducedMotion(reduced);
    setViewportWidth(window.innerWidth);
  }, [active]);

  // Cruise duration in ms — derived from viewport width + speed prop.
  // Floor at 600ms so a sub-pixel viewport (jsdom default = 1024) or
  // unrealistically fast speed setting still leaves room for the
  // entry + bob to register visually.
  const cruiseMs = useMemo(() => {
    if (viewportWidth <= 0 || speedPxPerSec <= 0) return 2500;
    const ms = Math.round((viewportWidth / speedPxPerSec) * 1000);
    return Math.max(600, ms);
  }, [viewportWidth, speedPxPerSec]);

  const totalMs = ENTRY_MS + cruiseMs + EXIT_MS;

  // Drive completion: full motion = total animation ms; reduced
  // motion = static hold. Both paths fire onCompleteRef.current once,
  // and the timer is cleaned up if `active` flips back early.
  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;
    const hold = reducedMotion ? REDUCED_MOTION_HOLD_MS : totalMs;
    const handle = window.setTimeout(() => {
      onCompleteRef.current();
    }, hold);
    return () => window.clearTimeout(handle);
  }, [active, reducedMotion, totalMs]);

  if (!mounted || !active) return null;

  // ---- Reduced-motion branch: static center-screen render ---------
  if (reducedMotion) {
    return createPortal(
      <div
        data-testid="beakerbot-skateboard-scene"
        data-reduced-motion="true"
        aria-hidden="true"
        style={{
          position: "fixed",
          left: "50%",
          top: `${bottomY}%`,
          transform: "translate(-50%, -50%)",
          zIndex: 800,
          pointerEvents: "none",
          width: COMBINED_WIDTH,
          height: COMBINED_HEIGHT,
        }}
      >
        <SkateboardStack uid={uid} animate={false} />
      </div>,
      document.body,
    );
  }

  // ---- Full motion branch -----------------------------------------
  //
  // Geometry:
  //   - We position the scene at `left: 0`, then translate by
  //     `translateX(start) → translateX(end)` via CSS keyframes. The
  //     translate values include the off-screen distance on each side
  //     so entry/exit cleanly slide from / to fully out-of-view.
  //   - `bottomY` sets the vertical anchor (translate-y center-aligns
  //     the stack on that line).
  //   - keyframe percentages map the entry / cruise / exit segments
  //     onto the total animation duration. Easing eases the entry +
  //     exit only; cruise is linear so motion feels constant.
  const startX = direction === "left-to-right" ? -COMBINED_WIDTH : viewportWidth;
  const cruiseStartX = direction === "left-to-right" ? 0 : viewportWidth - COMBINED_WIDTH;
  const cruiseEndX = direction === "left-to-right" ? viewportWidth - COMBINED_WIDTH : 0;
  const endX = direction === "left-to-right" ? viewportWidth : -COMBINED_WIDTH;

  const entryPct = (ENTRY_MS / totalMs) * 100;
  const exitPct = 100 - (EXIT_MS / totalMs) * 100;

  const cruiseAnimName = `beakerbot-skate-cruise-${uid}`;
  const bobAnimName = `beakerbot-skate-bob-${uid}`;
  const spinAnimName = `beakerbot-skate-spin-${uid}`;

  return createPortal(
    <>
      <style>{`
        @keyframes ${cruiseAnimName} {
          0% { transform: translate(${startX}px, -50%); }
          ${entryPct.toFixed(2)}% { transform: translate(${cruiseStartX}px, -50%); }
          ${exitPct.toFixed(2)}% { transform: translate(${cruiseEndX}px, -50%); }
          100% { transform: translate(${endX}px, -50%); }
        }
        @keyframes ${bobAnimName} {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-${BOB_AMPLITUDE_PX}px); }
        }
        @keyframes ${spinAnimName} {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        data-testid="beakerbot-skateboard-scene"
        data-direction={direction}
        aria-hidden="true"
        style={{
          position: "fixed",
          left: 0,
          top: `${bottomY}%`,
          zIndex: 800,
          pointerEvents: "none",
          width: COMBINED_WIDTH,
          height: COMBINED_HEIGHT,
          animation: `${cruiseAnimName} ${totalMs}ms cubic-bezier(0.4, 0, 0.6, 1) both`,
          willChange: "transform",
        }}
      >
        <SkateboardStack
          uid={uid}
          animate={true}
          bobAnimName={bobAnimName}
          spinAnimName={spinAnimName}
        />
      </div>
    </>,
    document.body,
  );
}

/**
 * Internal layout: BeakerBot stacked on top of the skateboard SVG.
 * Extracted so the reduced-motion + full-motion branches share one
 * visual definition.
 *
 * When `animate` is true, the inner bot wrapper bobs and the wheels
 * spin via the keyframes whose names the caller passes in. When
 * false (reduced-motion), everything renders static.
 */
function SkateboardStack({
  uid,
  animate,
  bobAnimName,
  spinAnimName,
}: {
  uid: string;
  animate: boolean;
  bobAnimName?: string;
  spinAnimName?: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: COMBINED_WIDTH,
        height: COMBINED_HEIGHT,
      }}
    >
      {/* Bot — bobbing wrapper sits above the deck. Center horizontally
          within the combined width so the bot reads as standing on
          the middle of the deck even when the skateboard is wider
          than the bot. */}
      <div
        data-testid="beakerbot-skateboard-bot"
        style={{
          position: "absolute",
          left: (COMBINED_WIDTH - BOT_WIDTH) / 2,
          top: 0,
          width: BOT_WIDTH,
          height: BOT_HEIGHT,
          animation:
            animate && bobAnimName
              ? `${bobAnimName} ${BOB_CYCLE_MS}ms ease-in-out infinite`
              : undefined,
          willChange: animate ? "transform" : undefined,
        }}
      >
        <BeakerBot
          pose="pointing-up"
          direction="right"
          className="w-10 h-10 text-sky-500"
          ariaLabel="BeakerBot riding a skateboard"
        />
      </div>

      {/* Skateboard — deck + trucks + 2 spinning wheels. Sits at the
          bottom of the combined box so the bot rests on the deck. */}
      <svg
        data-testid="beakerbot-skateboard-svg"
        viewBox={`0 0 ${SKATEBOARD_WIDTH} ${SKATEBOARD_HEIGHT}`}
        width={SKATEBOARD_WIDTH}
        height={SKATEBOARD_HEIGHT}
        style={{
          position: "absolute",
          left: (COMBINED_WIDTH - SKATEBOARD_WIDTH) / 2,
          bottom: 0,
        }}
        role="img"
        aria-label="Skateboard"
      >
        {/* Deck — flat rounded rectangle, dark wood-tone. Slightly
            kicked-up nose + tail via the larger rx on the rect. */}
        <rect
          x="2"
          y="2"
          width={SKATEBOARD_WIDTH - 4}
          height="4"
          rx="2"
          ry="2"
          fill="#5d4037"
        />
        {/* Trucks — vertical bars connecting the deck to each wheel.
            Two of them, one near each end of the deck. */}
        <rect x="10" y="6" width="2" height="2" fill="#9e9e9e" />
        <rect x={SKATEBOARD_WIDTH - 12} y="6" width="2" height="2" fill="#9e9e9e" />
        {/* Wheels — two circles, each rotates independently around
            its own center via a wrapping `<g>` with transform-origin
            set to the circle's cx/cy. Continuous spin in real mode;
            static in reduced-motion mode. */}
        <g
          style={{
            transformOrigin: `11px 9px`,
            transformBox: "fill-box",
            animation:
              animate && spinAnimName
                ? `${spinAnimName} ${WHEEL_SPIN_MS}ms linear infinite`
                : undefined,
          }}
          data-testid={`beakerbot-skateboard-wheel-left-${uid}`}
        >
          <circle cx="11" cy="9" r="3" fill="#212121" />
          <circle cx="11" cy="9" r="1" fill="#bdbdbd" />
        </g>
        <g
          style={{
            transformOrigin: `${SKATEBOARD_WIDTH - 11}px 9px`,
            transformBox: "fill-box",
            animation:
              animate && spinAnimName
                ? `${spinAnimName} ${WHEEL_SPIN_MS}ms linear infinite`
                : undefined,
          }}
          data-testid={`beakerbot-skateboard-wheel-right-${uid}`}
        >
          <circle cx={SKATEBOARD_WIDTH - 11} cy="9" r="3" fill="#212121" />
          <circle cx={SKATEBOARD_WIDTH - 11} cy="9" r="1" fill="#bdbdbd" />
        </g>
      </svg>
    </div>
  );
}
