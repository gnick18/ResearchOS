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
 * (modals + onboarding overlays use higher z-indices).
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";
import { BEAKERBOT_SCENE_SIZE_PX } from "./beakerbot/scene-constants";

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
 *  reuse the same skateboard SVG without prop drilling sizes.
 *
 *  Sizes bumped ~1.8× from the original 40px bot so BeakerBot reads as
 *  a clear focal point during the cruise (not a tiny corner sprite).
 *  All SVG geometry is expressed in viewBox units that we then render
 *  at SKATEBOARD_WIDTH × SKATEBOARD_HEIGHT, so the deck/trucks/wheels
 *  all scale proportionally with the bot.
 *
 *  SCENE-LOCAL OVERRIDE of the canonical BEAKERBOT_SCENE_SIZE_PX
 *  (128px, see beakerbot/scene-constants.ts). The Skateboard scene's
 *  bot is geometrically tied to the deck (SKATEBOARD_WIDTH=108,
 *  BOT_DECK_OVERLAP, COMBINED_WIDTH/HEIGHT math) — a 128px bot on a
 *  108px deck would visually overshoot the trucks. The deck was sized
 *  for a 72px bot. Until/unless the deck geometry is rebuilt for a
 *  128px bot, this scene stays at 72px (~0.56 * canonical). */
const BOT_WIDTH = Math.round(BEAKERBOT_SCENE_SIZE_PX * 0.5625);
const BOT_HEIGHT = BOT_WIDTH;
const SKATEBOARD_WIDTH = 108;
const SKATEBOARD_HEIGHT = 22;
/** Stack offset so the bot sits ON the deck (deck top ~y0 → bot
 *  bottom rests there). Tuned to match BeakerBot's round-bottom
 *  silhouette so feet-on-deck reads correctly. Scaled with the bot. */
const BOT_DECK_OVERLAP = 4;
const COMBINED_WIDTH = Math.max(BOT_WIDTH, SKATEBOARD_WIDTH);
const COMBINED_HEIGHT = BOT_HEIGHT + SKATEBOARD_HEIGHT - BOT_DECK_OVERLAP;

const ENTRY_MS = 300;
const EXIT_MS = 300;
/** Extra runway added to the cruise to give the mid-screen loopy-loop
 *  room to read at human speed. Without this the loop would feel rushed
 *  on narrow viewports where the base cruise is already near the 600ms
 *  floor. */
const LOOP_EXTRA_MS = 700;
const REDUCED_MOTION_HOLD_MS = 2000;

/** Bobbing oscillation tuning. ~3% of bot height vertical drift, with
 *  a ~600ms cycle. Implemented as a CSS keyframe so the browser can
 *  hand it to the compositor — no React state churn per frame. */
const BOB_AMPLITUDE_PX = Math.round(BOT_HEIGHT * 0.03);
const BOB_CYCLE_MS = 600;
const WHEEL_SPIN_MS = 500;
/** Loop arc tuning. translateY peak at the apex of the loop —
 *  100px reads as a real vertical loop without flying off-screen at
 *  the default bottomY=85%. Paired with a full 360° rotation so the
 *  bot + deck flip together. */
const LOOP_ARC_PX = 100;

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount detection for portal safety
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

  // Cruise duration in ms — derived from viewport width + speed prop,
  // plus extra runway so the mid-cruise loopy-loop reads at human
  // speed even on a narrow viewport. Floor at 600ms so a sub-pixel
  // viewport (jsdom default = 1024) or unrealistically fast speed
  // setting still leaves room for the entry + bob to register
  // visually.
  const cruiseMs = useMemo(() => {
    if (viewportWidth <= 0 || speedPxPerSec <= 0) return 2500 + LOOP_EXTRA_MS;
    const ms = Math.round((viewportWidth / speedPxPerSec) * 1000) + LOOP_EXTRA_MS;
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

  // Loopy-loop windowing — occupies the middle ~35% of the timeline,
  // centered between entry and exit. translateY arcs up to LOOP_ARC_PX
  // at the apex, paired 1:1 with a 0deg → 360deg rotation so the bot
  // and deck flip together (reads as a real vertical loop, not just a
  // hover-spin). Bookended by 0/0 hold frames at the boundaries so the
  // cruise wrapper sees a plain on-deck pose during entry and exit.
  const cruiseSpan = exitPct - entryPct;
  const loopStartPct = entryPct + cruiseSpan * 0.32;
  const loopApexPct = entryPct + cruiseSpan * 0.5;
  const loopEndPct = entryPct + cruiseSpan * 0.68;

  const cruiseAnimName = `beakerbot-skate-cruise-${uid}`;
  const loopAnimName = `beakerbot-skate-loop-${uid}`;
  const bobAnimName = `beakerbot-skate-bob-${uid}`;
  const spinAnimName = `beakerbot-skate-spin-${uid}`;
  const trailAnimName = `beakerbot-skate-trail-${uid}`;

  // Motion-blur ghost trail. Three faded SkateboardStack silhouettes
  // sit behind the bot relative to his direction of travel. They fade
  // in just after the entry stage ends and fade out before the exit
  // stage begins, so the trail only appears during the actual cruise.
  // Offset sign flips with direction (left-to-right → trails to the
  // LEFT; right-to-left → trails to the RIGHT).
  const trailSign = direction === "left-to-right" ? -1 : 1;

  return createPortal(
    <>
      <style>{`
        @keyframes ${cruiseAnimName} {
          0% { transform: translate(${startX}px, -50%); }
          ${entryPct.toFixed(2)}% { transform: translate(${cruiseStartX}px, -50%); }
          ${exitPct.toFixed(2)}% { transform: translate(${cruiseEndX}px, -50%); }
          100% { transform: translate(${endX}px, -50%); }
        }
        @keyframes ${loopAnimName} {
          0%, ${loopStartPct.toFixed(2)}% {
            transform: translateY(0) rotate(0deg);
          }
          ${loopApexPct.toFixed(2)}% {
            transform: translateY(-${LOOP_ARC_PX}px) rotate(180deg);
          }
          ${loopEndPct.toFixed(2)}%, 100% {
            transform: translateY(0) rotate(360deg);
          }
        }
        @keyframes ${bobAnimName} {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-${BOB_AMPLITUDE_PX}px); }
        }
        @keyframes ${spinAnimName} {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        /* Motion-blur trail — fades in shortly after entry ends and
           fades out before exit begins, so the trail only reads during
           the actual cruise. Per-trail opacity peak is set inline so
           the three copies form a graduated fade (closest = boldest). */
        @keyframes ${trailAnimName} {
          0%, ${entryPct.toFixed(2)}% { opacity: 0; }
          ${(entryPct + 5).toFixed(2)}%,
          ${(exitPct - 5).toFixed(2)}% { opacity: var(--bbst-peak-opacity, 0.3); }
          ${exitPct.toFixed(2)}%, 100% { opacity: 0; }
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
          // Scene wrapper covers the full viewport conceptually — the
          // X cruise transform handles horizontal travel, so `overflow:
          // visible` lets the bot leave the wrapper box during the
          // loopy-loop apex without being clipped.
          overflow: "visible",
          animation: `${cruiseAnimName} ${totalMs}ms cubic-bezier(0.4, 0, 0.6, 1) both`,
          willChange: "transform",
        }}
      >
        <div
          data-testid="beakerbot-skateboard-loop"
          style={{
            position: "relative",
            width: COMBINED_WIDTH,
            height: COMBINED_HEIGHT,
            // Loop wrapper rides on top of the cruise wrapper. It owns
            // the translateY arc + 360° rotation for the mid-cruise
            // loopy-loop — separated from the cruise transform so X
            // and Y/rotate keyframes compose cleanly without fighting
            // for the same `transform` property.
            animation: `${loopAnimName} ${totalMs}ms linear both`,
            transformOrigin: "50% 50%",
            willChange: "transform",
          }}
        >
          {/* Motion-blur ghost trail — three faded SkateboardStack
              silhouettes behind the bot during the cruise. Rendered
              BEFORE the main stack so the bot paints on top. Each
              trail copy sits a graduated distance behind the bot (in
              the direction of travel) with a fixed peak-opacity that
              tapers with distance. */}
          {[
            { offsetPx: 18 * trailSign, peakOpacity: 0.4 },
            { offsetPx: 36 * trailSign, peakOpacity: 0.25 },
            { offsetPx: 54 * trailSign, peakOpacity: 0.12 },
          ].map((t, i) => (
            <div
              key={i}
              data-testid={`beakerbot-skateboard-trail-${i}`}
              aria-hidden="true"
              style={
                {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: COMBINED_WIDTH,
                  height: COMBINED_HEIGHT,
                  transform: `translateX(${t.offsetPx}px)`,
                  opacity: 0,
                  filter: "blur(1.5px)",
                  pointerEvents: "none",
                  ["--bbst-peak-opacity" as string]: `${t.peakOpacity}`,
                  animation: `${trailAnimName} ${totalMs}ms linear both`,
                } as React.CSSProperties
              }
            >
              <SkateboardStack
                uid={`${uid}-trail-${i}`}
                animate={false}
                isTrail
              />
            </div>
          ))}

          <SkateboardStack
            uid={uid}
            animate={true}
            bobAnimName={bobAnimName}
            spinAnimName={spinAnimName}
          />
        </div>
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
  isTrail = false,
}: {
  uid: string;
  animate: boolean;
  bobAnimName?: string;
  spinAnimName?: string;
  /** When true, the rendered subtree carries trail-specific testids
   *  (`...-trail-bot`, `...-trail-svg`) so tests that query
   *  `beakerbot-skateboard-bot`/`-svg` still match exactly the main
   *  stack, not a trail copy. Used by the motion-blur ghost trail. */
  isTrail?: boolean;
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
        data-testid={
          isTrail ? "beakerbot-skateboard-trail-bot" : "beakerbot-skateboard-bot"
        }
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
          // Fills the BOT_WIDTH x BOT_HEIGHT wrapper above — driven by
          // the scene-local size override (see comment on BOT_WIDTH).
          className="w-full h-full text-sky-500"
          ariaLabel="BeakerBot riding a skateboard"
        />
      </div>

      {/* Skateboard — deck + trucks + 2 spinning wheels. Sits at the
          bottom of the combined box so the bot rests on the deck. */}
      <svg
        data-testid={
          isTrail ? "beakerbot-skateboard-trail-svg" : "beakerbot-skateboard-svg"
        }
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
            kicked-up nose + tail via the larger rx on the rect.
            Coordinates are in viewBox units (108 × 22) and scale 1:1
            with the rendered size, so the wheel-spin transform-origin
            below can stay in matching px coordinates. */}
        <rect
          x="4"
          y="4"
          width={SKATEBOARD_WIDTH - 8}
          height="8"
          rx="4"
          ry="4"
          fill="#5d4037"
        />
        {/* Trucks — vertical bars connecting the deck to each wheel.
            Two of them, one near each end of the deck. */}
        <rect x="18" y="12" width="4" height="4" fill="#9e9e9e" />
        <rect x={SKATEBOARD_WIDTH - 22} y="12" width="4" height="4" fill="#9e9e9e" />
        {/* Wheels — two circles, each rotates independently around
            its own center via a wrapping `<g>` with transform-origin
            set to the circle's cx/cy. Continuous spin in real mode;
            static in reduced-motion mode. */}
        <g
          style={{
            transformOrigin: `20px 16px`,
            transformBox: "fill-box",
            animation:
              animate && spinAnimName
                ? `${spinAnimName} ${WHEEL_SPIN_MS}ms linear infinite`
                : undefined,
          }}
          data-testid={`beakerbot-skateboard-wheel-left-${uid}`}
        >
          <circle cx="20" cy="16" r="5" fill="#212121" />
          <circle cx="20" cy="16" r="2" fill="#bdbdbd" />
        </g>
        <g
          style={{
            transformOrigin: `${SKATEBOARD_WIDTH - 20}px 16px`,
            transformBox: "fill-box",
            animation:
              animate && spinAnimName
                ? `${spinAnimName} ${WHEEL_SPIN_MS}ms linear infinite`
                : undefined,
          }}
          data-testid={`beakerbot-skateboard-wheel-right-${uid}`}
        >
          <circle cx={SKATEBOARD_WIDTH - 20} cy="16" r="5" fill="#212121" />
          <circle cx={SKATEBOARD_WIDTH - 20} cy="16" r="2" fill="#bdbdbd" />
        </g>
      </svg>
    </div>
  );
}
