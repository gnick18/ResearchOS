"use client";

// frontend/src/components/BeakerBotEurekaScene.tsx
//
// Side easter-egg scene: BeakerBot walks in carrying a tiny microscope,
// sets it down, leans forward to peek through the eyepiece (with one
// eye squinted), pulls back in amazement, a light bulb pops on above
// his head with rainbow sparkles bursting outward, then he cheers and
// walks off. The microscope stays on the bench, the light bulb fades
// out as he exits.
//
// Built on the same skeleton as BeakerBotBugStompScene and
// BeakerBotLadderScene:
//   - Portaled overlay at document.body
//   - position: fixed, inset: 0
//   - pointer-events: none (purely decorative)
//   - z-index 800 (above app chrome, below modals)
//   - useSyncExternalStore for SSR-safe portal mount
//   - prefers-reduced-motion gate with static "post-eureka" fallback
//
// Stage timeline (~6.9s total in motion mode):
//   1. walk-in       0    → 600ms   (BeakerBot enters carrying microscope)
//   2. set-down      600  → 900ms   (microscope drops to bench position)
//   3. lean-peek     900  → 1400ms  (BeakerBot tilts forward, one eye closes)
//   4. peeking       1400 → 2600ms  (holds peek pose, eyepiece glints)
//   5. pull-back     2600 → 3000ms  (snaps back upright, eye-widen overlay)
//   6. bulb-on       3000 → 3300ms  (light bulb fades in above head)
//   7. sparkles      3300 → 3900ms  (8 rainbow sparkles burst outward)
//   8. cheering      3900 → 4900ms  (cheering pose, body sway, "Eureka!")
//   9. scan          4900 → 6100ms  (slow L→R→L head-turn over the bulb)
//  10. exit          6100 → 6900ms  (walks off opposite side, bulb fades)
//
// Reduced-motion fallback: render BeakerBot in cheering pose with light
// bulb above his head, microscope on the bench, sparkles at their final
// scattered positions. Hold 2000ms then fire onComplete.

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";

export interface BeakerBotEurekaSceneProps {
  /** When true, the scene mounts and runs through its sequence.
   *  When false, the scene renders nothing (and any in-flight timer
   *  is cancelled). Toggle from false → true to (re)play. */
  active: boolean;
  /** Fires once the full sequence has finished playing (or once the
   *  reduced-motion shortcut has elapsed). The parent is expected to
   *  set `active=false` in response. */
  onComplete?: () => void;
  /** Side from which BeakerBot enters carrying the microscope.
   *  Default "right". He exits the opposite side. */
  enterFrom?: "left" | "right";
}

/** Stage durations in ms. Kept as a const so tests can re-derive the
 *  total without hard-coding the sum. */
export const STAGE_DURATIONS = {
  walkIn: 600,
  setDown: 300,
  leanPeek: 500,
  peeking: 1200,
  pullBack: 400,
  bulbOn: 300,
  sparkles: 600,
  cheering: 1000,
  scan: 1200,
  exit: 800,
} as const;

export const TOTAL_DURATION_MS =
  STAGE_DURATIONS.walkIn +
  STAGE_DURATIONS.setDown +
  STAGE_DURATIONS.leanPeek +
  STAGE_DURATIONS.peeking +
  STAGE_DURATIONS.pullBack +
  STAGE_DURATIONS.bulbOn +
  STAGE_DURATIONS.sparkles +
  STAGE_DURATIONS.cheering +
  STAGE_DURATIONS.scan +
  STAGE_DURATIONS.exit;

/** Reduced-motion fallback duration. */
export const REDUCED_MOTION_DURATION_MS = 2000;

/** Discrete stages the state machine cycles through. */
export type EurekaStage =
  | "idle"
  | "walkIn"
  | "setDown"
  | "leanPeek"
  | "peeking"
  | "pullBack"
  | "bulbOn"
  | "sparkles"
  | "cheering"
  | "scan"
  | "exit"
  | "done";

export const STAGE_ORDER: readonly EurekaStage[] = [
  "walkIn",
  "setDown",
  "leanPeek",
  "peeking",
  "pullBack",
  "bulbOn",
  "sparkles",
  "cheering",
  "scan",
  "exit",
] as const;

/** Rainbow palette for the sparkle burst. Cycled by sparkle index. */
const SPARKLE_COLORS = [
  "#FFD2B0", // peach
  "#B7EBB1", // mint
  "#A6D2F4", // sky
  "#D6B5F0", // lavender
  "#FFE89A", // yellow
  "#FFC0CB", // pink
  "#FFD2B0", // peach (cycle continues for 8 sparkles)
  "#B7EBB1", // mint
] as const;

/** Number of sparkles in the burst ring. Spec: 8. */
const SPARKLE_COUNT = 8;

/** Sparkle ring outward radius in pixels. Each sparkle animates from
 *  the bulb center to (cos(theta) * R, sin(theta) * R) at this radius.
 *  Scaled 2x with the rest of the scene (BeakerBot + bulb). */
const SPARKLE_RADIUS_PX = 80;

/** Z-index slot — matches BeakerBotBugStompScene + BeakerBotLadderScene. */
const SCENE_Z_INDEX = 800;

/** SSR-safe client detection — same pattern used by the ladder scene. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Tiny microscope SVG. Base + stage + slide + arm + eyepiece.
 *  Color is gunmetal #4A5568. The slide is a thin white rect on the
 *  stage. */
function MicroscopeGlyph({
  className,
  glint = false,
}: {
  className?: string;
  /** When true, render a small glint sparkle on the eyepiece (used
   *  during the "peeking" stage). */
  glint?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 36"
      fill="none"
      role="img"
      aria-label="Microscope"
      className={className ?? "w-8 h-9"}
    >
      {/* Base — wide rounded rect at the bottom */}
      <rect x="4" y="28" width="24" height="6" rx="2" fill="#4A5568" />
      {/* Stage — flat rect with slide on top */}
      <rect x="8" y="22" width="16" height="4" rx="1" fill="#4A5568" />
      <rect x="13" y="20.5" width="6" height="1.5" fill="white" stroke="#A0AEC0" strokeWidth="0.3" />
      {/* Arm — angled connector from base to eyepiece (drawn as a
          quadrilateral for the slight back-curve characteristic of a
          microscope). */}
      <path d="M 18 28 L 21 28 L 21 12 L 17 12 L 17 8 L 21 8 L 22 8 L 18 28 Z"
            fill="#4A5568" />
      <rect x="18" y="10" width="4" height="14" fill="#4A5568" />
      {/* Eyepiece — cylinder at the top */}
      <rect x="14" y="2" width="6" height="8" rx="1" fill="#4A5568" />
      <ellipse cx="17" cy="2.5" rx="3" ry="1.2" fill="#2D3748" />
      {/* Optional glint on the eyepiece lens */}
      {glint && (
        <g aria-hidden="true">
          <circle cx="15.5" cy="2.2" r="0.6" fill="white" opacity="0.9" />
          <circle cx="16.5" cy="2.8" r="0.3" fill="white" opacity="0.7" />
        </g>
      )}
    </svg>
  );
}

/** Comic-style light bulb glyph. Glass bulb (yellow), filament inside
 *  (zigzag), screw-thread base, all floating (no wire — comic style).
 *  The glow halo is rendered as a separate element behind so it can
 *  pulse independently. */
function LightBulbGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 14 18"
      fill="none"
      role="img"
      aria-label="Light bulb"
      className={className ?? "w-4 h-5"}
    >
      {/* Glass bulb — round body with a slight neck */}
      <path
        d="M 7 1 C 4 1, 2 3, 2 6 C 2 8.5, 4 10, 4.5 11.5 L 9.5 11.5 C 10 10, 12 8.5, 12 6 C 12 3, 10 1, 7 1 Z"
        fill="#FFE89A"
        stroke="#FFC107"
        strokeWidth="0.8"
      />
      {/* Filament — zigzag inside the bulb */}
      <path
        d="M 5 7 L 5.8 5.5 L 6.5 7 L 7.3 5.5 L 8 7 L 8.7 5.5 L 9 7"
        stroke="#D97706"
        strokeWidth="0.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Screw thread base — three horizontal bands */}
      <rect x="4" y="11.5" width="6" height="1.2" fill="#9CA3AF" />
      <rect x="4.5" y="12.8" width="5" height="1.0" fill="#6B7280" />
      <rect x="5" y="13.9" width="4" height="0.9" fill="#9CA3AF" />
      <rect x="5.5" y="14.9" width="3" height="0.8" fill="#6B7280" />
      {/* Bottom tip — small contact point */}
      <ellipse cx="7" cy="16" rx="1.2" ry="0.6" fill="#374151" />
    </svg>
  );
}

/** Four-point sparkle star — used for the eureka burst ring. */
function SparkleStar({
  color,
  size = 6,
}: {
  color: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 8 8"
      fill="none"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path
        d="M 4 0 L 4.8 3.2 L 8 4 L 4.8 4.8 L 4 8 L 3.2 4.8 L 0 4 L 3.2 3.2 Z"
        fill={color}
      />
    </svg>
  );
}

export default function BeakerBotEurekaScene({
  active,
  onComplete,
  enterFrom = "right",
}: BeakerBotEurekaSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<EurekaStage>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);

  // Stash onComplete in a ref so the stage-driver effect doesn't
  // re-fire just because a parent passes a new inline-fn each render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Detect prefers-reduced-motion. Listen for live changes since the
  // scene runs for ~5.7s and a mid-play toggle is uncommon but cheap.
  useEffect(() => {
    if (!active || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mql.matches);
    sync();
    mql.addEventListener?.("change", sync);
    return () => {
      mql.removeEventListener?.("change", sync);
    };
  }, [active]);

  // Stage driver: chains setTimeouts through STAGE_ORDER, then fires
  // onComplete. Reduced-motion mode skips straight to "done" + dwells.
  useEffect(() => {
    if (!active) {
      setStage("idle");
      return;
    }

    if (reducedMotion) {
      setStage("done");
      const t = window.setTimeout(() => {
        onCompleteRef.current?.();
      }, REDUCED_MOTION_DURATION_MS);
      return () => window.clearTimeout(t);
    }

    const timers: number[] = [];
    let elapsed = 0;
    setStage(STAGE_ORDER[0]);
    for (let i = 1; i < STAGE_ORDER.length; i++) {
      const prev = STAGE_ORDER[i - 1];
      elapsed += STAGE_DURATIONS[prev as keyof typeof STAGE_DURATIONS];
      const next = STAGE_ORDER[i];
      const handle = window.setTimeout(() => setStage(next), elapsed);
      timers.push(handle);
    }
    const lastStage = STAGE_ORDER[STAGE_ORDER.length - 1];
    elapsed += STAGE_DURATIONS[lastStage as keyof typeof STAGE_DURATIONS];
    const doneHandle = window.setTimeout(() => {
      setStage("done");
      onCompleteRef.current?.();
    }, elapsed);
    timers.push(doneHandle);

    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [active, reducedMotion]);

  // Per-mount keyframe id suffix so multiple scene instances don't
  // share animation names. Same pattern as BeakerBotLadderScene.
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbes-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );

  // Direction-driven offsets: BeakerBot enters from `enterFrom`, walks
  // to a center bench position, then exits the opposite side. The
  // microscope sits slightly in front (toward the exit side).
  const direction = useMemo(() => {
    const fromLeft = enterFrom === "left";
    return {
      beakerStartX: fromLeft ? "-20vw" : "120vw",
      beakerBenchX: "50vw",
      beakerExitX: fromLeft ? "120vw" : "-20vw",
      // BeakerBot faces toward the microscope during the peek stages.
      // Microscope sits ~24px to the side the bot will exit toward.
      microscopeOffsetPx: fromLeft ? 28 : -28,
      // Facing during the peek: bot faces the microscope side.
      facing: (fromLeft ? "right" : "left") as "left" | "right",
      sideSign: fromLeft ? 1 : -1,
    };
  }, [enterFrom]);

  // Sparkle ring positions — precomputed angles + colors.
  const sparkles = useMemo(() => {
    return Array.from({ length: SPARKLE_COUNT }, (_, i) => {
      const angle = (i / SPARKLE_COUNT) * Math.PI * 2;
      return {
        rx: Math.cos(angle) * SPARKLE_RADIUS_PX,
        ry: Math.sin(angle) * SPARKLE_RADIUS_PX,
        color: SPARKLE_COLORS[i % SPARKLE_COLORS.length],
        delayMs: i * 30,
      };
    });
  }, []);

  if (!active || !isClient) return null;

  // ----- Stage-driven visual state -----

  // Is the microscope visible? Yes once it's been set down (stage 2+).
  // Before stage 2 (walkIn) BeakerBot is "carrying" it in his arm; we
  // render a smaller carried microscope during walkIn and the bench
  // microscope from setDown onward.
  const microscopeOnBench =
    stage === "setDown" ||
    stage === "leanPeek" ||
    stage === "peeking" ||
    stage === "pullBack" ||
    stage === "bulbOn" ||
    stage === "sparkles" ||
    stage === "cheering" ||
    stage === "scan" ||
    stage === "exit" ||
    stage === "done";

  const microscopeCarried = stage === "walkIn";

  // Is the light bulb visible? From "bulbOn" through "exit". During
  // exit it fades + translates with BeakerBot. In reduced-motion
  // ("done"), the bulb is also shown as part of the static tableau.
  const bulbVisible =
    stage === "bulbOn" ||
    stage === "sparkles" ||
    stage === "cheering" ||
    stage === "scan" ||
    stage === "exit" ||
    (reducedMotion && stage === "done");

  // Are the sparkles bursting? Only during the "sparkles" stage in
  // motion mode; in reduced-motion ("done") they're rendered at their
  // final scattered positions as part of the static tableau.
  const sparklesBursting = stage === "sparkles";
  const sparklesStatic = reducedMotion && stage === "done";

  // Is the "Eureka!" speech bubble visible? Only during cheering.
  const eurekaBubbleVisible = stage === "cheering";

  // Eye-widen overlay fires during pull-back (snap back amazed).
  const eyeWidenActive = stage === "pullBack";

  // BeakerBot pose by stage. Spec says "existing poses only" — we
  // use `idle` (walk), `pointing-down` (lean to peek, custom forward
  // lean via transform), `cheering` (eureka moment). Exit reuses
  // `cheering` for body sway.
  let pose: BeakerBotPose = "idle";
  switch (stage) {
    case "walkIn":
    case "setDown":
      pose = "idle";
      break;
    case "leanPeek":
    case "peeking":
    case "pullBack":
      pose = "pointing-down";
      break;
    case "bulbOn":
      pose = "idle";
      break;
    case "sparkles":
    case "cheering":
    case "scan":
    case "exit":
      pose = "cheering";
      break;
    case "done":
      pose = "cheering";
      break;
    default:
      pose = "idle";
  }

  // BeakerBot horizontal position by stage.
  // Use a single computed translateX value; CSS transition smooths
  // between stages.
  let beakerTranslateX: string;
  let beakerBobPx = 0;
  let beakerLeanDeg = 0;
  let beakerLeanTranslateY = 0;
  switch (stage) {
    case "walkIn":
      beakerTranslateX = direction.beakerStartX;
      // Animation target — CSS keyframe handles the actual translate.
      break;
    case "setDown":
    case "leanPeek":
    case "peeking":
    case "pullBack":
    case "bulbOn":
    case "sparkles":
    case "cheering":
    case "scan":
      beakerTranslateX = direction.beakerBenchX;
      // Forward lean during peek stages: tilt + small downward
      // translate so his face is at the eyepiece.
      if (stage === "leanPeek" || stage === "peeking") {
        beakerLeanDeg = -8 * direction.sideSign;
        beakerLeanTranslateY = 6;
      }
      // Body sway during cheering.
      if (stage === "cheering") {
        beakerBobPx = -2;
      }
      break;
    case "exit":
      beakerTranslateX = direction.beakerExitX;
      break;
    case "done":
      // Reduced-motion tableau: bot at bench position.
      beakerTranslateX = direction.beakerBenchX;
      break;
    default:
      beakerTranslateX = direction.beakerStartX;
  }

  // Transition timing per stage — slow on walkIn/exit, snappier on
  // peek/pull-back so they read as deliberate actions.
  let transitionMs = 300;
  if (stage === "walkIn") transitionMs = STAGE_DURATIONS.walkIn;
  else if (stage === "exit") transitionMs = STAGE_DURATIONS.exit;
  else if (stage === "leanPeek") transitionMs = STAGE_DURATIONS.leanPeek;
  else if (stage === "pullBack") transitionMs = STAGE_DURATIONS.pullBack;
  else if (stage === "cheering") transitionMs = STAGE_DURATIONS.cheering;
  else if (stage === "scan") transitionMs = STAGE_DURATIONS.scan;

  return createPortal(
    <div
      data-testid="beakerbot-eureka-scene"
      data-stage={stage}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: SCENE_Z_INDEX,
        // overflow: visible — universal scene-wrapper rule. The scene's
        // own off-screen entry/exit translations (e.g. 120vw) handle
        // the "stays out of view" requirement; we don't need clipping.
        overflow: "visible",
      }}
    >
      {/* Scoped keyframes for the bulb glow pulse + sparkle burst + body sway. */}
      <style>{`
        @keyframes ${animSuffix}-glow-pulse {
          0%, 100% { transform: scale(1); opacity: 0.55; }
          50%      { transform: scale(1.15); opacity: 0.85; }
        }
        @keyframes ${animSuffix}-bulb-fade-in {
          0%   { opacity: 0; transform: scale(0.3) translateY(8px); }
          60%  { opacity: 1; transform: scale(1.15) translateY(-2px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes ${animSuffix}-bulb-fade-out {
          0%   { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes ${animSuffix}-sparkle-burst {
          0%   { opacity: 0; transform: translate(0, 0) scale(0); }
          20%  { opacity: 1; transform: translate(calc(var(--bbes-spark-rx) * 0.4), calc(var(--bbes-spark-ry) * 0.4)) scale(1.2); }
          60%  { opacity: 1; transform: translate(var(--bbes-spark-rx), var(--bbes-spark-ry)) scale(1); }
          100% { opacity: 0; transform: translate(calc(var(--bbes-spark-rx) * 1.1), calc(var(--bbes-spark-ry) * 1.1)) scale(0); }
        }
        @keyframes ${animSuffix}-body-sway {
          0%, 100% { transform: rotate(-3deg); }
          50%      { transform: rotate(3deg); }
        }
        @keyframes ${animSuffix}-eye-widen {
          0%, 100% { opacity: 0; transform: scale(1); }
          30%, 60% { opacity: 0.55; transform: scale(1.05); }
        }
        @keyframes ${animSuffix}-glint {
          0%, 100% { opacity: 0; }
          50%      { opacity: 1; }
        }
        @keyframes ${animSuffix}-bubble-pop {
          0%   { opacity: 0; transform: translate(-50%, 6px) scale(0.5); }
          40%  { opacity: 1; transform: translate(-50%, -2px) scale(1.1); }
          70%  { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
        /* Slow L → R → L body tilt so BeakerBot "scans" the bulb above
           his head; because the bulb is nested inside the lean wrapper
           it rotates with him, giving the user a moving view of the
           whole bulb. ±10deg, single 1.2s pass, anchored at body bottom. */
        @keyframes ${animSuffix}-scan-tilt {
          0%   { transform: rotate(0deg); }
          25%  { transform: rotate(-10deg); }
          50%  { transform: rotate(0deg); }
          75%  { transform: rotate(10deg); }
          100% { transform: rotate(0deg); }
        }
      `}</style>

      {/* Bench line: characters and the microscope sit on this y-axis.
          Computed as bottom 20vh so the scene reads as "BeakerBot at
          a lab bench" rather than "floating on a void". */}

      {/* MICROSCOPE on the bench. Only renders from setDown onward.
          Sits slightly to the side of BeakerBot (in the direction he
          will exit). Centered horizontally with translate(-50%, ...). */}
      {microscopeOnBench && (
        <div
          data-testid="beakerbot-eureka-scene-microscope"
          style={{
            position: "absolute",
            left: direction.beakerBenchX,
            bottom: "20vh",
            transform: `translate(calc(-50% + ${direction.microscopeOffsetPx * 2}px), 0)`,
            // 2x scale (was 36x40).
            width: 72,
            height: 80,
          }}
        >
          <MicroscopeGlyph
            // w-18 isn't a stock Tailwind size; use h-20 + w-[72px].
            className="w-[72px] h-20"
            glint={stage === "peeking"}
          />
        </div>
      )}

      {/* BEAKERBOT — fixed-size, translated horizontally per stage. The
          bench is at bottom: 20vh; BeakerBot sits with feet on the
          bench line, his head ~64px above. Forward lean is applied via
          a nested wrapper so it pivots from the base of the body. */}
      <div
        data-testid="beakerbot-eureka-scene-bot"
        style={{
          position: "absolute",
          left: 0,
          bottom: "calc(20vh - 4px)",
          // 2x scale (was 64x64).
          width: 128,
          height: 128,
          // Half-width offset bumps with the size to keep him centered.
          transform: `translate(calc(${beakerTranslateX} - 64px), ${beakerBobPx}px)`,
          transition: `transform ${transitionMs}ms ${
            stage === "walkIn" || stage === "exit" ? "ease-in-out" : "ease-out"
          }`,
        }}
      >
        {/* Forward-lean wrapper — pivots from the bottom of the body so
            the peek tilt reads as "leaning over the bench" rather than
            "falling forward". */}
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `rotate(${beakerLeanDeg}deg) translateY(${beakerLeanTranslateY}px)`,
            transformOrigin: "center bottom",
            transition: `transform ${transitionMs}ms ease-out`,
            position: "relative",
          }}
        >
          {/* Cheering pose gets a body-sway loop; scan stage gets a
              single slow L → R → L head-turn so the user can see the
              whole bulb above his head from multiple angles. */}
          <div
            style={{
              width: "100%",
              height: "100%",
              animation:
                stage === "cheering"
                  ? `${animSuffix}-body-sway 500ms ease-in-out 2 alternate`
                  : stage === "scan"
                    ? `${animSuffix}-scan-tilt ${STAGE_DURATIONS.scan}ms ease-in-out forwards`
                    : undefined,
              transformOrigin: "center bottom",
            }}
          >
            <BeakerBot
              pose={pose}
              direction={direction.facing}
              // 2x scale (was w-16 h-16).
              className="w-32 h-32 text-sky-500"
              ariaLabel="BeakerBot"
            />
          </div>

          {/* Eye-widen overlay during pullBack stage. Same pattern as
              BugStomp: a slightly enlarged duplicate at low opacity
              that fades in then out. Limited to a brief window so it
              reads as a "pop" rather than a sustained second BeakerBot. */}
          {eyeWidenActive && (
            <div
              data-testid="beakerbot-eureka-scene-eye-widen"
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                transform: "scale(1.05)",
                transformOrigin: "center center",
                animation: `${animSuffix}-eye-widen ${STAGE_DURATIONS.pullBack}ms ease-in-out forwards`,
                pointerEvents: "none",
              }}
            >
              <BeakerBot
                pose="cheering"
                // 2x scale (matches main BeakerBot above).
                className="w-32 h-32 text-sky-500"
                ariaLabel=""
              />
            </div>
          )}

          {/* Carried microscope during walkIn — small, held in front. */}
          {microscopeCarried && (
            <div
              data-testid="beakerbot-eureka-scene-microscope-carried"
              style={{
                position: "absolute",
                // Offsets bump with the 2x BeakerBot size.
                left: direction.sideSign > 0 ? "auto" : "16px",
                right: direction.sideSign > 0 ? "16px" : "auto",
                bottom: "32px",
                // 2x scale (was 18x22).
                width: 36,
                height: 44,
              }}
            >
              <MicroscopeGlyph className="w-8 h-10" />
            </div>
          )}

          {/* LIGHT BULB above BeakerBot's head + GLOW HALO behind it. */}
          {bulbVisible && (
            <div
              data-testid="beakerbot-eureka-scene-lightbulb"
              style={{
                position: "absolute",
                left: "50%",
                // 2x offset above head (was -30px).
                top: "-60px",
                // 2x scale (was 20x24).
                width: 40,
                height: 48,
                transform: "translateX(-50%)",
                animation: reducedMotion
                  ? undefined
                  : stage === "bulbOn"
                    ? `${animSuffix}-bulb-fade-in ${STAGE_DURATIONS.bulbOn}ms ease-out forwards`
                    : stage === "exit"
                      ? `${animSuffix}-bulb-fade-out ${STAGE_DURATIONS.exit}ms ease-in forwards`
                      : undefined,
              }}
            >
              {/* Glow halo — radial gradient, pulsing scale loop. Sits
                  behind the bulb (z-index trick via order in DOM + the
                  bulb's higher opacity). */}
              <div
                data-testid="beakerbot-eureka-scene-lightbulb-glow"
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  // 2x scale (was 40x40).
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(255, 232, 154, 0.85) 0%, rgba(255, 232, 154, 0.5) 35%, rgba(255, 232, 154, 0) 70%)",
                  transform: "translate(-50%, -50%) scale(1)",
                  filter: "blur(2px)",
                  animation: reducedMotion
                    ? undefined
                    : `${animSuffix}-glow-pulse 1200ms ease-in-out infinite`,
                  pointerEvents: "none",
                }}
              />
              {/* Bulb glyph itself */}
              <div style={{ position: "relative", zIndex: 1 }}>
                {/* 2x scale (was w-5 h-6). */}
                <LightBulbGlyph className="w-10 h-12" />
              </div>

              {/* SPARKLE BURST — 8 sparkles radiating outward from the
                  bulb center. Each sparkle is absolutely positioned at
                  bulb-center; CSS custom properties drive its outward
                  target so the keyframe is generic. */}
              {(sparklesBursting || sparklesStatic) && (
                <div
                  data-testid="beakerbot-eureka-scene-sparkle-burst"
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 0,
                    height: 0,
                    pointerEvents: "none",
                  }}
                >
                  {sparkles.map((s, i) => (
                    <div
                      key={i}
                      data-testid="beakerbot-eureka-scene-sparkle"
                      style={
                        {
                          position: "absolute",
                          left: 0,
                          top: 0,
                          // In reduced-motion tableau, place the
                          // sparkle at its final outward position
                          // statically. Otherwise the keyframe handles
                          // it.
                          transform: sparklesStatic
                            ? `translate(${s.rx}px, ${s.ry}px) scale(1)`
                            : "translate(0, 0) scale(0)",
                          "--bbes-spark-rx": `${s.rx}px`,
                          "--bbes-spark-ry": `${s.ry}px`,
                          animation: sparklesBursting
                            ? `${animSuffix}-sparkle-burst ${STAGE_DURATIONS.sparkles}ms ease-out ${s.delayMs}ms forwards`
                            : undefined,
                        } as React.CSSProperties
                      }
                    >
                      {/* 2x scale (was size 8). */}
                      <SparkleStar color={s.color} size={16} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* "Eureka!" speech bubble during cheering stage. Sky-blue
              border, sky-700 text, downward tail. NO em-dashes in copy. */}
          {eurekaBubbleVisible && (
            <div
              data-testid="beakerbot-eureka-scene-bubble"
              style={{
                position: "absolute",
                left: "50%",
                // Lifted to clear the now-larger bulb above his head.
                top: "-120px",
                transform: "translate(-50%, 0)",
                background: "white",
                border: "2px solid #38bdf8", // sky-400
                borderRadius: 16,
                padding: "6px 14px",
                color: "#0369a1", // sky-700
                fontFamily: "system-ui, sans-serif",
                fontWeight: 700,
                // 2x scale (was 13).
                fontSize: 22,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                animation: `${animSuffix}-bubble-pop 350ms ease-out forwards`,
                pointerEvents: "none",
              }}
            >
              Eureka!
              {/* Downward tail — small triangle below the bubble. */}
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: -13,
                  width: 0,
                  height: 0,
                  borderLeft: "10px solid transparent",
                  borderRight: "10px solid transparent",
                  borderTop: "13px solid #38bdf8",
                  transform: "translateX(-50%)",
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: -8,
                  width: 0,
                  height: 0,
                  borderLeft: "8px solid transparent",
                  borderRight: "8px solid transparent",
                  borderTop: "11px solid white",
                  transform: "translateX(-50%)",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
