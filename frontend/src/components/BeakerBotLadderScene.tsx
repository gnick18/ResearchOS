"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";

/**
 * Side easter-egg scene: BeakerBot climbs a ladder, cleans an invisible
 * screen, then either slips or gets bumped by a passing bird and falls
 * off-screen alongside the ladder.
 *
 * This is a SCENE component — it orchestrates multiple SVG elements
 * (ladder + BeakerBot + optional bird) across stages. Lives outside the
 * BeakerBot SVG viewBox because the ladder extends well below BeakerBot
 * and the fall trajectory exits the viewport.
 *
 * The companion to the locked, in-production BeakerBot mascot
 * (`BeakerBot.tsx`). Onboarding shows BeakerBot once and then he
 * disappears for the life of the app — this scene + future trigger
 * logic (idle / page-specific) keep him present in small doses.
 *
 * Mount approach:
 *  - Renders into a React portal at `document.body`
 *  - `position: fixed` overlay so it can extend to viewport edges
 *  - `z-index: 800` — above app chrome (cursor is 400) but below
 *    modals (10000+) so user-blocking UI always wins
 *  - `pointer-events: none` end-to-end — the scene is purely visual,
 *    never intercepts clicks
 *
 * Stage timeline (~10.0s total in motion mode):
 *  1. ladder-rise        0     → 800ms   (ladder slides up from below)
 *  2. climb              800   → 2800ms  (BeakerBot translates up + bobs)
 *  3. top                2800  → 3100ms  (settles at top of ladder)
 *  4. clean              3100  → 8100ms  (wipe-back-and-forth + sparkles)
 *  5. disruption         8100  → 8400ms  (slip OR bird-bump)
 *  6. fall               8400  → 9900ms  (BeakerBot + ladder tumble off)
 *  7. done               9900ms          (onComplete fires, parent unmounts)
 *
 * Reduced-motion fallback: when
 * `prefers-reduced-motion: reduce` is set, the scene renders BeakerBot
 * statically at the top of the ladder with no climb / clean / fall
 * animations, holds for 3s, then calls onComplete.
 *
 * The caller is responsible for setting `active` back to false after
 * `onComplete` fires — this component does not manage its own
 * "should-I-show-up" state. Future trigger logic (idle detection,
 * page-specific easter eggs) composes that on top.
 */

export interface BeakerBotLadderSceneProps {
  /** When true, the scene mounts + animation plays. When the
   *  animation finishes the scene calls `onComplete`; the parent
   *  should then set this back to false. Toggling false mid-animation
   *  is safe — the portal unmounts immediately, no onComplete fires. */
  active: boolean;
  /** Called once when the full animation sequence (or the
   *  reduced-motion short-circuit) finishes. */
  onComplete: () => void;
  /** Which side of the viewport the ladder appears on. Default
   *  `"right"`. The ladder sits ~24px from the chosen edge. */
  side?: "left" | "right";
  /** Override the disruption outcome. If omitted, picked randomly
   *  at mount time. Useful for tests + future "preview this easter
   *  egg" dev surfaces. */
  outcome?: "slip" | "bird-bump";
}

type Stage =
  | "ladder-rise"
  | "climb"
  | "top"
  | "clean"
  | "disruption"
  | "fall"
  | "done";

/** Timings in ms. Tweak here, not at usage sites. */
const STAGE_MS = {
  ladderRise: 800,
  climb: 2000,
  top: 300,
  clean: 5000,
  disruption: 300,
  fall: 1500,
} as const;

const REDUCED_MOTION_HOLD_MS = 3000;

/** z-index slot — above cursor (400) + app chrome, below modals
 *  (10000+). See `Tooltip.tsx` for the broader stacking convention. */
const SCENE_Z_INDEX = 800;

/** Ladder dimensions. Width is the SVG viewBox width; on-screen we
 *  scale to LADDER_WIDTH_PX. Height tracks 50vh so the ladder is
 *  half the viewport regardless of screen size. */
const LADDER_VIEWBOX_W = 60;
const LADDER_VIEWBOX_H = 400;
const LADDER_WIDTH_PX = 60;
/** BeakerBot render size at climb-top. 96px matches the onboarding
 *  tip card size — feels consistent if the easter-egg fires after a
 *  fresh user has just seen the welcome modal. */
const BEAKERBOT_SIZE_PX = 96;
/** Distance the ladder sits inset from the chosen viewport edge. */
const EDGE_INSET_PX = 24;

/** Pick a deterministic-by-mount outcome when the prop is omitted.
 *  Called inside a useState initializer so React runs it exactly
 *  once per mount; `Math.random()` would be an impure call during
 *  render otherwise (react/purity rule). */
function rollOutcome(): "slip" | "bird-bump" {
  return Math.random() < 0.5 ? "slip" : "bird-bump";
}

/** SSR safety guard for createPortal. `'use client'` files still
 *  render once on the server during prerendering, so `document` is
 *  undefined. We subscribe to the "is client" state via
 *  useSyncExternalStore — same effect as the classic
 *  `useEffect(() => setMounted(true), [])` pattern but lints clean
 *  under `react-hooks/set-state-in-effect`. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    // No-op subscribe — the value never changes after first paint.
    () => () => {},
    () => true,
    () => false,
  );
}

export default function BeakerBotLadderScene({
  active,
  onComplete,
  side = "right",
  outcome,
}: BeakerBotLadderSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<Stage>("ladder-rise");
  const [reducedMotion, setReducedMotion] = useState(false);

  // Cache the rolled outcome across renders so it stays stable
  // through the disruption stage even if a parent re-renders. Use
  // a lazy useState initializer so React runs `rollOutcome` once
  // per mount (impure calls during render trip the purity rule).
  const [rolledOutcome] = useState<"slip" | "bird-bump">(() => rollOutcome());
  const effectiveOutcome = outcome ?? rolledOutcome;

  // Stash onComplete in a ref so the stage-progression effect can
  // call it without re-running when the parent passes a fresh
  // function identity on every render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Detect prefers-reduced-motion via a matchMedia subscription.
  // The subscribe-and-sync pattern keeps the lint clean
  // (`react-hooks/set-state-in-effect`) and also picks up live
  // changes if the user toggles their OS preference between
  // easter-egg fires. We only attach when active so we don't keep
  // a listener around for the entire app lifetime.
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mql.matches);
    sync();
    mql.addEventListener?.("change", sync);
    return () => {
      mql.removeEventListener?.("change", sync);
    };
  }, [active]);

  // Stage progression — schedules setTimeouts to advance through
  // the timeline. All setState calls happen inside timer callbacks
  // (external system events) which keeps the
  // `react-hooks/set-state-in-effect` rule happy. The reset to
  // "ladder-rise" runs in a 0ms timer too so it counts as a
  // callback rather than a sync render-cycle update. Clears all
  // timers on cleanup so toggling `active` off mid-animation
  // doesn't fire onComplete after unmount.
  useEffect(() => {
    if (!active) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (delay: number, fn: () => void) => {
      timers.push(setTimeout(fn, delay));
    };

    // Reset stage on every active→true transition so re-firing the
    // easter egg replays the full sequence. Scheduled as a 0-delay
    // timer rather than a sync setState so the lint treats it as a
    // callback-driven update.
    schedule(0, () => setStage("ladder-rise"));

    if (reducedMotion) {
      // Skip the choreography — show BeakerBot static at the top of
      // the ladder + hold for REDUCED_MOTION_HOLD_MS, then complete.
      schedule(0, () => setStage("top"));
      schedule(REDUCED_MOTION_HOLD_MS, () => {
        setStage("done");
        onCompleteRef.current();
      });
      return () => {
        for (const t of timers) clearTimeout(t);
      };
    }

    // Full timeline.
    let elapsed = 0;
    elapsed += STAGE_MS.ladderRise;
    schedule(elapsed, () => setStage("climb"));
    elapsed += STAGE_MS.climb;
    schedule(elapsed, () => setStage("top"));
    elapsed += STAGE_MS.top;
    schedule(elapsed, () => setStage("clean"));
    elapsed += STAGE_MS.clean;
    schedule(elapsed, () => setStage("disruption"));
    elapsed += STAGE_MS.disruption;
    schedule(elapsed, () => setStage("fall"));
    elapsed += STAGE_MS.fall;
    schedule(elapsed, () => {
      setStage("done");
      onCompleteRef.current();
    });

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [active, reducedMotion]);

  // Per-mount keyframe id suffix so multiple scene instances
  // (extremely unlikely but cheap to defend against) don't share
  // animation names. CSS `@keyframes` are document-global. `useId`
  // gives a stable, pure identifier — `Math.random()` here would
  // trip the react/purity rule. We sanitize the colon characters
  // some bundlers emit (`:r0:` → `r0`) so the suffix is a valid
  // CSS identifier.
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbls-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );

  if (!active || !isClient) return null;

  // Edge positioning — ladder sits inset EDGE_INSET_PX from the
  // chosen side. BeakerBot sits centered on the ladder.
  const edgeStyle: React.CSSProperties =
    side === "right"
      ? { right: `${EDGE_INSET_PX}px` }
      : { left: `${EDGE_INSET_PX}px` };

  return createPortal(
    <div
      data-testid="beakerbot-ladder-scene"
      data-stage={stage}
      data-outcome={effectiveOutcome}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: SCENE_Z_INDEX,
      }}
    >
      {/* Per-mount keyframes. Inlined because the choreography
          coordinates several CSS custom properties (ladder Y, climb
          Y, wipe X, fall Y/rotate) that would be awkward to express
          as a Tailwind utility. */}
      <style>{`
        @keyframes bbls-ladder-rise-${animSuffix} {
          from { transform: translateY(110%); }
          to   { transform: translateY(0%); }
        }
        @keyframes bbls-climb-${animSuffix} {
          0%   { transform: translate(0, 0); }
          12%  { transform: translate(-3px, -10%); }
          25%  { transform: translate(3px, -25%); }
          37%  { transform: translate(-3px, -40%); }
          50%  { transform: translate(3px, -55%); }
          62%  { transform: translate(-3px, -70%); }
          75%  { transform: translate(3px, -85%); }
          100% { transform: translate(0, -100%); }
        }
        @keyframes bbls-wipe-${animSuffix} {
          0%, 100% { transform: translateX(-8px) rotate(-6deg); }
          50%      { transform: translateX(8px)  rotate(6deg); }
        }
        @keyframes bbls-sparkle-${animSuffix} {
          0%, 100% { opacity: 0; transform: scale(0.6); }
          50%      { opacity: 1; transform: scale(1); }
        }
        @keyframes bbls-bird-fly-${animSuffix} {
          from { transform: translateX(0); }
          to   { transform: translateX(var(--bbls-bird-end, -110vw)); }
        }
        @keyframes bbls-bird-flap-${animSuffix} {
          0%, 100% { transform: scaleY(1); }
          50%      { transform: scaleY(0.4); }
        }
        @keyframes bbls-fall-bot-${animSuffix} {
          0%   { transform: translate(0, 0) rotate(0deg); }
          25%  { transform: translate(-10px, 20vh) rotate(-90deg); }
          60%  { transform: translate(15px, 60vh) rotate(-220deg); }
          100% { transform: translate(-5px, 120vh) rotate(-540deg); }
        }
        @keyframes bbls-fall-ladder-${animSuffix} {
          0%   { transform: translate(0, 0) rotate(0deg); }
          30%  { transform: translate(10px, 15vh) rotate(15deg); }
          70%  { transform: translate(-15px, 60vh) rotate(-25deg); }
          100% { transform: translate(20px, 120vh) rotate(40deg); }
        }
        @keyframes bbls-slip-${animSuffix} {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(20deg); }
        }
      `}</style>

      {/* Ladder + BeakerBot share a falling wrapper during stage 6
          so they exit together. Before fall they're positioned
          independently. */}

      {/* LADDER */}
      <div
        data-testid="beakerbot-ladder-scene-ladder"
        style={{
          position: "absolute",
          bottom: 0,
          ...edgeStyle,
          width: `${LADDER_WIDTH_PX}px`,
          height: "50vh",
          // Stage-driven animations.
          animation:
            stage === "ladder-rise"
              ? `bbls-ladder-rise-${animSuffix} ${STAGE_MS.ladderRise}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`
              : stage === "fall"
                ? `bbls-fall-ladder-${animSuffix} ${STAGE_MS.fall}ms cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                : undefined,
          // Pre-rise: keep the ladder hidden below the fold so the
          // first frame doesn't flash the ladder in its final spot.
          transform:
            stage === "ladder-rise" ? "translateY(110%)" : undefined,
        }}
      >
        <svg
          viewBox={`0 0 ${LADDER_VIEWBOX_W} ${LADDER_VIEWBOX_H}`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={{ display: "block" }}
        >
          {/* Two vertical rails — wood tone. */}
          <line
            x1="10"
            y1="0"
            x2="10"
            y2={LADDER_VIEWBOX_H}
            stroke="#8b4513"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <line
            x1="50"
            y1="0"
            x2="50"
            y2={LADDER_VIEWBOX_H}
            stroke="#8b4513"
            strokeWidth="4"
            strokeLinecap="round"
          />
          {/* 5 rungs evenly spaced (roughly 50, 120, 200, 280, 360). */}
          {[50, 120, 200, 280, 360].map((y) => (
            <line
              key={y}
              x1="10"
              y1={y}
              x2="50"
              y2={y}
              stroke="#a0522d"
              strokeWidth="4"
              strokeLinecap="round"
            />
          ))}
        </svg>
      </div>

      {/* BEAKERBOT — vertical positioning controlled per-stage.
          During fall, lives inside the same coordinate space as
          the ladder so both tumble off together. */}
      <div
        data-testid="beakerbot-ladder-scene-bot"
        style={{
          position: "absolute",
          // BeakerBot sits at "top of ladder" during clean +
          // disruption + falls from there. During ladder-rise he's
          // hidden below the viewport; during climb he animates up
          // from below to top.
          bottom:
            stage === "ladder-rise"
              ? `-${BEAKERBOT_SIZE_PX}px`
              : stage === "climb"
                ? // Start at the foot of the ladder; the animation
                  // translates from 0 → -100% which carries him to
                  // the top.
                  "0"
                : // top / clean / disruption / fall all start at
                  // the top of the ladder (50vh from bottom).
                  `calc(50vh - ${BEAKERBOT_SIZE_PX / 2}px)`,
          // Center BeakerBot horizontally on the ladder.
          ...(side === "right"
            ? {
                right: `${EDGE_INSET_PX + LADDER_WIDTH_PX / 2 - BEAKERBOT_SIZE_PX / 2}px`,
              }
            : {
                left: `${EDGE_INSET_PX + LADDER_WIDTH_PX / 2 - BEAKERBOT_SIZE_PX / 2}px`,
              }),
          width: `${BEAKERBOT_SIZE_PX}px`,
          height: `${BEAKERBOT_SIZE_PX}px`,
          animation:
            stage === "climb"
              ? `bbls-climb-${animSuffix} ${STAGE_MS.climb}ms linear forwards`
              : stage === "disruption" && effectiveOutcome === "slip"
                ? `bbls-slip-${animSuffix} ${STAGE_MS.disruption}ms ease-out forwards`
                : stage === "fall"
                  ? `bbls-fall-bot-${animSuffix} ${STAGE_MS.fall}ms cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                  : undefined,
          // Pre-rise + reduced-motion modes: stay hidden until
          // the ladder is in place. Reduced motion uses the static
          // "top" stage which keeps BeakerBot visible from the
          // moment the scene mounts.
          opacity: stage === "ladder-rise" ? 0 : 1,
          transition: "opacity 200ms",
        }}
      >
        {/* Pose-by-stage:
              climb        → "pointing-up" (mirrored so the
                              triangle reaches for the next rung
                              above-and-inward)
              top / clean  → "pointing" (mirrored — arm extended
                              toward the imaginary screen)
              disruption   → "cheering" (arms-up = startled, "uh-oh")
              fall         → "cheering" (arms flailing) */}
        <BeakerBot
          pose={
            stage === "climb"
              ? "pointing-up"
              : stage === "top" || stage === "clean"
                ? "pointing"
                : stage === "disruption" || stage === "fall"
                  ? "cheering"
                  : "idle"
          }
          direction={side === "right" ? "left" : "right"}
          className="w-full h-full text-sky-500"
        />

        {/* Wiping hand overlay during clean stage. A small circle
            translated back-and-forth in front of BeakerBot to
            simulate the wipe. Lives in the BeakerBot's coordinate
            space so it follows him correctly. */}
        {stage === "clean" && (
          <div
            data-testid="beakerbot-ladder-scene-wipe"
            style={{
              position: "absolute",
              top: "30%",
              left: side === "right" ? "-25%" : "100%",
              width: "20%",
              height: "20%",
              animation: `bbls-wipe-${animSuffix} 800ms ease-in-out infinite`,
              transformOrigin: "center",
            }}
          >
            <svg viewBox="0 0 20 20" width="100%" height="100%">
              {/* Tiny cleaning cloth — soft yellow square with a
                  small fold line. */}
              <rect
                x="2"
                y="4"
                width="16"
                height="12"
                rx="2"
                fill="#fef3c7"
                stroke="#d97706"
                strokeWidth="1"
              />
              <path
                d="M 6 10 L 14 10"
                stroke="#d97706"
                strokeWidth="0.8"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}

        {/* Cleaning sparkles — three small "✦" marks that pulse
            during the clean stage. Optional polish. */}
        {stage === "clean" && (
          <>
            {[
              { top: "20%", left: "-30%", delay: 0 },
              { top: "45%", left: "-35%", delay: 250 },
              { top: "70%", left: "-25%", delay: 500 },
            ].map((sp, i) =>
              side === "right" ? (
                <span
                  key={i}
                  data-testid="beakerbot-ladder-scene-sparkle"
                  style={{
                    position: "absolute",
                    top: sp.top,
                    left: sp.left,
                    fontSize: "14px",
                    color: "#fbbf24",
                    animation: `bbls-sparkle-${animSuffix} 1200ms ease-in-out ${sp.delay}ms infinite`,
                    pointerEvents: "none",
                  }}
                >
                  ✦
                </span>
              ) : (
                <span
                  key={i}
                  data-testid="beakerbot-ladder-scene-sparkle"
                  style={{
                    position: "absolute",
                    top: sp.top,
                    right: sp.left,
                    fontSize: "14px",
                    color: "#fbbf24",
                    animation: `bbls-sparkle-${animSuffix} 1200ms ease-in-out ${sp.delay}ms infinite`,
                    pointerEvents: "none",
                  }}
                >
                  ✦
                </span>
              ),
            )}
          </>
        )}
      </div>

      {/* BIRD — only renders during the disruption stage when the
          outcome is bird-bump. Flies across the viewport at
          roughly BeakerBot's vertical position. */}
      {stage === "disruption" && effectiveOutcome === "bird-bump" && (
        <div
          data-testid="beakerbot-ladder-scene-bird"
          style={
            {
              position: "absolute",
              bottom: `calc(50vh - 20px)`,
              // Enter from the OPPOSITE side of the ladder so the
              // bird flies toward BeakerBot before bumping him.
              ...(side === "right"
                ? { right: "-60px", "--bbls-bird-end": "calc(-100vw + 60px)" }
                : { left: "-60px", "--bbls-bird-end": "calc(100vw - 60px)" }),
              width: "40px",
              height: "30px",
              animation: `bbls-bird-fly-${animSuffix} ${STAGE_MS.disruption}ms linear forwards`,
            } as React.CSSProperties
          }
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              animation: `bbls-bird-flap-${animSuffix} 120ms ease-in-out infinite`,
              transformOrigin: "center",
              transform: side === "right" ? "scaleX(-1)" : undefined,
            }}
          >
            {/* Simple silhouette: two wing strokes forming an "M" */}
            <svg
              viewBox="0 0 40 30"
              width="100%"
              height="100%"
              fill="none"
              stroke="#1f2937"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M 4 18 Q 10 6, 16 14 Q 20 18, 24 14 Q 30 6, 36 18" />
              {/* Tiny dot for the body */}
              <circle cx="20" cy="16" r="1.5" fill="#1f2937" />
            </svg>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
