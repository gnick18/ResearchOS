"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";

/**
 * Side easter-egg slapstick scene: BeakerBot enters carrying a precarious
 * stack of small beakers above his head, foot catches, he stumbles and
 * almost drops them, then catches them at the last second with a "phew!"
 * speech bubble. He walks away looking relieved, then trips a SECOND time
 * — this one's the real failure. All beakers drop and shatter on the
 * floor, and BeakerBot tumbles + rolls off-screen.
 *
 * The double-trip is the comedy beat: first stumble is a fake-out save,
 * second stumble is the actual punchline. Spec locked from Grant's
 * voice-to-text brief (carries-too-many-beakers chip).
 *
 * Stage timeline (defaults total ≈ 7.1s):
 *   1. Entry            — 800ms — walks in from off-screen, stack bobs
 *   2. First stumble    — 200ms — foot catches, stack tilts ~25°
 *   3. Catch + rebalance— 400ms — stack returns vertical, body rebounds
 *   4. Phew speech bub  — 900ms — "phew!" bubble, body still
 *   5. Walking away     — 1200ms — proud strut, slight wobble
 *   6. Second stumble   — 400ms — bigger jolt, stack tilts ~55°
 *   7. Drop + fall      — 700ms — 4 beakers fall on independent
 *                                  trajectories with rotation, then
 *                                  shatter-puff on floor
 *   8. Roll off-screen  — 1500ms — BeakerBot tumbles, continuous 720°
 *                                  rotation + translateX exit
 *
 * Mounted via React portal at `document.body`, position fixed,
 * z-index 800 (above app shell, below modals at 1000+).
 *
 * Reduced-motion fallback: per `prefers-reduced-motion: reduce`,
 * skips the full slapstick sequence and renders a static aftermath
 * shot (BeakerBot standing dejected with 4 scattered/tipped beakers
 * on the ground) for 2s, then fires onComplete. The joke still lands
 * — viewer sees the outcome without the motion.
 *
 * Component-only — no trigger logic. Parent decides when to mount
 * (e.g. random easter-egg roll, dev button, achievement unlock).
 */

export interface BeakerBotTooManyBeakersSceneProps {
  /** When false, the scene is not rendered at all (parent unmounts).
   *  When toggled from false → true, the animation restarts. */
  active: boolean;
  /** Fired once the scene finishes (whether full or reduced-motion).
   *  Parent typically uses this to unmount via `setActive(false)`. */
  onComplete: () => void;
  /** Number of beakers in the stack. Default 4. Spec calls for 4-5;
   *  clamped to [3, 6] to keep the falling trajectories visually
   *  readable (more than 6 = pile of garbage on the floor). */
  beakerCount?: number;
  /** Side BeakerBot enters from. Default "left" (walks left → right,
   *  rolls off the right). With "right", entry + exit mirror. */
  entersFrom?: "left" | "right";
}

/** Pastel-rainbow palette stops shared with the BeakerBot liquid
 *  gradient. Used to tint each small carried beaker so the stack
 *  visually reads as 4 distinct items, not one fat block. Index 0-3
 *  cycle if beakerCount > 4. */
const BEAKER_COLORS = [
  "#FFD2B0", // peach (top)
  "#B7EBB1", // mint
  "#A6D2F4", // sky
  "#D6B5F0", // lavender (bottom)
  "#FFF1A8", // yellow (overflow)
  "#FFC9C9", // rose (overflow)
] as const;

/** Stage durations in ms. Exported for tests so they don't have to
 *  re-derive the total. */
export const STAGE_DURATIONS = {
  entry: 800,
  firstStumble: 200,
  catchRebalance: 400,
  phew: 900,
  walkingAway: 1200,
  secondStumble: 400,
  dropFall: 700,
  rollOff: 1500,
} as const;

export const TOTAL_DURATION_MS =
  STAGE_DURATIONS.entry +
  STAGE_DURATIONS.firstStumble +
  STAGE_DURATIONS.catchRebalance +
  STAGE_DURATIONS.phew +
  STAGE_DURATIONS.walkingAway +
  STAGE_DURATIONS.secondStumble +
  STAGE_DURATIONS.dropFall +
  STAGE_DURATIONS.rollOff;

/** Reduced-motion aftermath dwell time before onComplete fires. */
export const REDUCED_MOTION_DURATION_MS = 2000;

/** Discrete stages the state machine cycles through. The "second
 *  stumble" stage and the "drop + fall" stage are exposed as named
 *  values so tests can assert the double-trip beat exercises both. */
export type SceneStage =
  | "idle"
  | "entry"
  | "firstStumble"
  | "catchRebalance"
  | "phew"
  | "walkingAway"
  | "secondStumble"
  | "dropFall"
  | "rollOff"
  | "done";

/** Order of stages used by the timer chain. Kept as a const tuple
 *  so the test can assert the double-trip beat (firstStumble +
 *  secondStumble) both fire. */
export const STAGE_ORDER: readonly SceneStage[] = [
  "entry",
  "firstStumble",
  "catchRebalance",
  "phew",
  "walkingAway",
  "secondStumble",
  "dropFall",
  "rollOff",
] as const;

/** Read prefers-reduced-motion once at mount. SSR safe (matchMedia
 *  guarded by typeof window). */
function readsPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface CarriedBeakerStyle {
  color: string;
  size: number;
}

/** Build the carried-beaker style array. Each beaker gets a distinct
 *  color from the palette and a slight size variation so the stack
 *  reads as hand-built, not a copy-paste loop. */
function buildBeakerStyles(count: number): CarriedBeakerStyle[] {
  const clamped = Math.max(3, Math.min(6, Math.floor(count)));
  return Array.from({ length: clamped }, (_, i) => ({
    color: BEAKER_COLORS[i % BEAKER_COLORS.length],
    size: 14 - i * 0.4, // top beaker slightly larger, bottom slightly smaller
  }));
}

/** Per-beaker fall trajectory. Each beaker drops on its own arc with
 *  independent rotation rate so the visual reads as chaotic loss-of-
 *  control rather than a synchronized formation. Mount-time random
 *  jitter is deterministic per-index via a tiny LCG seed so the
 *  scene plays the same way every time (and tests are stable). */
function buildFallTrajectory(index: number, count: number) {
  // Tiny deterministic pseudo-random based on index (no Math.random
  // so SSR + tests stay stable).
  const seed = (index * 9301 + 49297) % 233280;
  const r1 = seed / 233280;
  const r2 = ((seed * 7) % 233280) / 233280;
  const r3 = ((seed * 13) % 233280) / 233280;

  // Horizontal spread: center beaker (count/2) goes straight, outer
  // beakers fan out left/right. Range roughly ±60px.
  const horizontal = ((index - (count - 1) / 2) / Math.max(1, count - 1)) * 80 + (r1 - 0.5) * 30;
  // Rotation: alternating direction + magnitude jitter.
  const rotateTo = (index % 2 === 0 ? 1 : -1) * (180 + r2 * 360);
  // Stagger start delay so they don't fall in perfect sync.
  const delayMs = index * 35 + r3 * 50;
  return { horizontal, rotateTo, delayMs };
}

export default function BeakerBotTooManyBeakersScene({
  active,
  onComplete,
  beakerCount = 4,
  entersFrom = "left",
}: BeakerBotTooManyBeakersSceneProps) {
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<SceneStage>("idle");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  // onComplete is held in a ref so the stage-driver effect doesn't
  // re-fire just because a parent re-render passes a new function
  // identity. Same pattern as CelebrationAnimation / RockExplosion.
  // Sync inside an effect to satisfy react-hooks/refs (no ref mutation
  // during render).
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const beakers = useMemo(() => buildBeakerStyles(beakerCount), [beakerCount]);

  // Portal mount + reduced-motion detection. Defers the createPortal
  // call to after first client render so SSR doesn't try to mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync (SSR → client portal gate + prefers-reduced-motion read), same pattern as CelebrationAnimation
    setMounted(true);
    setPrefersReducedMotion(readsPrefersReducedMotion());
  }, []);

  // Stage driver: chains setTimeouts to walk through STAGE_ORDER,
  // then fires onComplete. Reduced-motion mode skips straight to a
  // 2s "aftermath" dwell and then fires onComplete.
  //
  // setState inside an effect is the right tool here — each scene
  // activation is a one-shot run driven by chained timers, not state
  // synchronization. Lint allows it with the same justification used
  // by CelebrationAnimation / RockExplosionAnimation.
  useEffect(() => {
    if (!active || !mounted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset stage when scene deactivates so a re-activation restarts from "entry"
      setStage("idle");
      return;
    }

    if (prefersReducedMotion) {
      // Static aftermath shot — render BeakerBot + scattered beakers
      // (handled in the JSX below by the "done" stage interpretation
      // when prefersReducedMotion is true), dwell briefly, then exit.
      setStage("done");
      const t = window.setTimeout(() => {
        onCompleteRef.current();
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
    // Final completion timer
    const lastStage = STAGE_ORDER[STAGE_ORDER.length - 1];
    elapsed += STAGE_DURATIONS[lastStage as keyof typeof STAGE_DURATIONS];
    const doneHandle = window.setTimeout(() => {
      setStage("done");
      onCompleteRef.current();
    }, elapsed);
    timers.push(doneHandle);

    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [active, mounted, prefersReducedMotion]);

  if (!active || !mounted || typeof document === "undefined") {
    return null;
  }

  // ---------- Visual transforms per stage ----------

  // BeakerBot's horizontal position (translateX, vw units) by stage.
  // entersFrom controls the sign convention.
  const sideSign = entersFrom === "left" ? 1 : -1;
  // off-screen start position, in viewport-width percentage
  const offscreenStartVw = -25 * sideSign;
  const centerLeftVw = -8 * sideSign; // settled near center-left during phew
  const centerRightVw = 8 * sideSign; // walked past center after recovery
  const offscreenExitVw = 60 * sideSign; // rolled out the opposite side

  let bodyTranslateXVw: number;
  let bodyRotateDeg = 0;
  let bodyBobPx = 0;
  let stackTiltDeg = 0;
  let stackOffsetPx = 0;
  let beakersFalling = false;
  let showPhewBubble = false;
  let bodyTilted = false; // small forward lean during stumble

  switch (stage) {
    case "entry":
      bodyTranslateXVw = offscreenStartVw + (centerLeftVw - offscreenStartVw) * 1;
      stackTiltDeg = 3; // subtle natural wobble
      bodyBobPx = -2;
      break;
    case "firstStumble":
      bodyTranslateXVw = centerLeftVw + 0.5 * sideSign;
      stackTiltDeg = 25 * sideSign;
      stackOffsetPx = 2;
      bodyTilted = true;
      bodyRotateDeg = 4 * sideSign;
      break;
    case "catchRebalance":
      bodyTranslateXVw = centerLeftVw + 1 * sideSign;
      stackTiltDeg = -4 * sideSign; // slight overcorrect
      bodyBobPx = -3; // body extends upward in the catch
      bodyRotateDeg = -1 * sideSign;
      break;
    case "phew":
      bodyTranslateXVw = centerLeftVw + 1.5 * sideSign;
      stackTiltDeg = 1;
      showPhewBubble = true;
      break;
    case "walkingAway":
      bodyTranslateXVw = centerRightVw;
      stackTiltDeg = -2;
      bodyBobPx = -2;
      break;
    case "secondStumble":
      bodyTranslateXVw = centerRightVw + 0.5 * sideSign;
      stackTiltDeg = 55 * sideSign;
      stackOffsetPx = 4;
      bodyTilted = true;
      bodyRotateDeg = 9 * sideSign;
      break;
    case "dropFall":
      bodyTranslateXVw = centerRightVw + 1 * sideSign;
      stackTiltDeg = 70 * sideSign;
      beakersFalling = true;
      bodyTilted = true;
      bodyRotateDeg = 25 * sideSign;
      break;
    case "rollOff":
      bodyTranslateXVw = offscreenExitVw;
      // continuous 720° rotation handled by CSS animation below
      bodyRotateDeg = 720 * sideSign;
      beakersFalling = true;
      break;
    case "done":
    case "idle":
    default:
      // Reduced-motion aftermath: BeakerBot stays at center-right,
      // looks sad, beakers scattered on floor.
      bodyTranslateXVw = prefersReducedMotion ? centerRightVw : offscreenStartVw;
      break;
  }

  // For BeakerBot pose: mostly `idle`, "thinking" not in the pose
  // enum, so we use `waving` during phew to imply a head-up "made it"
  // gesture, and `idle` everywhere else. (Spec's "thinking" head-tilt
  // doesn't exist in BeakerBotPose; closest readable substitution.)
  const pose = stage === "phew" ? "waving" : "idle";

  // CSS transition duration per stage, ms — drives smooth tweening
  // between discrete stage transforms.
  const transitionMs =
    stage === "entry"
      ? STAGE_DURATIONS.entry
      : stage === "rollOff"
        ? STAGE_DURATIONS.rollOff
        : stage === "walkingAway"
          ? STAGE_DURATIONS.walkingAway
          : 250;

  const transitionStyle =
    stage === "rollOff"
      ? `transform ${STAGE_DURATIONS.rollOff}ms cubic-bezier(0.4, 0, 0.7, 1)`
      : `transform ${transitionMs}ms ${
          stage === "firstStumble" || stage === "secondStumble"
            ? "cubic-bezier(0.6, 0.2, 0.3, 1.4)"
            : "ease-in-out"
        }`;

  // Reduced-motion aftermath uses a different layout (scattered beakers
  // around BeakerBot's feet).
  const isAftermath = prefersReducedMotion && stage === "done";

  return createPortal(
    <div
      // Scene root — fixed full viewport, ignores pointer events,
      // z-800 (above shell, below modals).
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 800 }}
      data-testid="beakerbot-too-many-beakers-scene"
      data-stage={stage}
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
      aria-hidden="true"
    >
      {/* BeakerBot + carried stack — anchored bottom-center, translated
          horizontally by stage. transform-origin: center for the
          tumble-roll rotation. */}
      <div
        className="absolute"
        style={{
          left: "50%",
          bottom: "8vh",
          width: "120px",
          height: "180px",
          transform: `translateX(calc(-50% + ${bodyTranslateXVw}vw)) translateY(${bodyBobPx}px) rotate(${bodyRotateDeg}deg)`,
          transformOrigin: "center center",
          transition: transitionStyle,
        }}
        data-testid="beakerbot-body"
      >
        {/* Carried beaker stack — sits above BeakerBot's head. Anchored
            at bottom so tilts pivot from the base (where his hands
            would be). */}
        {!isAftermath && (
          <div
            className="absolute left-1/2"
            style={{
              top: 0,
              transform: `translateX(-50%) translateX(${stackOffsetPx}px) rotate(${stackTiltDeg}deg)`,
              transformOrigin: "bottom center",
              transition: `transform 200ms ease-out`,
              opacity: beakersFalling ? 0 : 1,
            }}
            data-testid="beaker-stack"
          >
            {beakers.map((b, i) => (
              <CarriedBeaker
                key={i}
                color={b.color}
                size={b.size}
                wobblePhase={i}
                stage={stage}
              />
            ))}
          </div>
        )}

        {/* BeakerBot himself — slight forward lean during stumbles via
            an inner wrapper so the outer transform handles position. */}
        <div
          className="absolute left-1/2"
          style={{
            bottom: 0,
            transform: `translateX(-50%) ${bodyTilted ? `rotate(${8 * sideSign}deg)` : ""}`,
            transition: "transform 250ms ease-out",
            width: "80px",
            height: "80px",
          }}
        >
          <BeakerBot
            pose={pose}
            className="w-20 h-20 text-sky-500"
            ariaLabel="BeakerBot carrying too many beakers"
          />
        </div>

        {/* "Phew!" speech bubble — same look-and-feel as the
            laugh-text bubble on the giggle pose: small white rounded
            bubble, currentColor text, tiny tail pointing down toward
            BeakerBot's head. Fade-in via opacity. */}
        {showPhewBubble && (
          <div
            className="absolute left-1/2 text-sky-700"
            style={{
              top: "-18px",
              transform: "translateX(-50%)",
              animation: "beakerbot-phew-bubble 700ms ease-out",
            }}
            data-testid="phew-bubble"
          >
            <div className="relative rounded-2xl bg-white px-3 py-1 shadow-md border border-sky-200">
              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: "currentColor" }}>
                phew!
              </span>
              {/* Tail */}
              <div
                className="absolute left-1/2"
                style={{
                  bottom: "-5px",
                  transform: "translateX(-50%) rotate(45deg)",
                  width: "8px",
                  height: "8px",
                  background: "white",
                  borderRight: "1px solid rgb(186 230 253)",
                  borderBottom: "1px solid rgb(186 230 253)",
                }}
              />
            </div>
            {/* Sweat-bead polish — tiny SVG drop next to bubble */}
            <svg
              className="absolute"
              style={{ top: "-2px", right: "-10px" }}
              width="10"
              height="14"
              viewBox="0 0 10 14"
              fill="none"
            >
              <path
                d="M5 1 C 5 1, 1 7, 1 10 A 4 4 0 0 0 9 10 C 9 7, 5 1, 5 1 Z"
                fill="#A6D2F4"
                stroke="#6FB5E8"
                strokeWidth="0.8"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Falling beakers — render once dropFall stage starts, each
          beaker tweens independently from start position above
          BeakerBot's head down to floor. */}
      {beakersFalling && !isAftermath && (
        <div
          className="absolute"
          style={{
            left: "50%",
            bottom: "8vh",
            transform: `translateX(calc(-50% + ${centerRightVw}vw))`,
          }}
          data-testid="falling-beakers"
        >
          {beakers.map((b, i) => {
            const traj = buildFallTrajectory(i, beakers.length);
            return (
              <FallingBeaker
                key={i}
                color={b.color}
                size={b.size}
                stackIndex={i}
                stackCount={beakers.length}
                horizontalPx={traj.horizontal}
                rotateToDeg={traj.rotateTo}
                delayMs={traj.delayMs}
              />
            );
          })}
        </div>
      )}

      {/* Reduced-motion aftermath: BeakerBot dejected + scattered
          tipped-over beakers on the floor. No animation, just a still
          frame for 2s before onComplete. */}
      {isAftermath && (
        <div
          className="absolute"
          style={{
            left: "50%",
            bottom: "8vh",
            transform: `translateX(calc(-50% + ${centerRightVw}vw))`,
            display: "flex",
            gap: "12px",
            alignItems: "flex-end",
          }}
          data-testid="aftermath-scattered"
        >
          {beakers.map((b, i) => (
            <div
              key={i}
              style={{
                transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (60 + i * 8)}deg)`,
                transformOrigin: "bottom center",
                opacity: 0.85,
              }}
            >
              <CarriedBeaker color={b.color} size={b.size} wobblePhase={i} stage="done" />
            </div>
          ))}
        </div>
      )}

      {/* Inline keyframes — kept colocated so the component is fully
          self-contained (no Tailwind config edits required). */}
      <style>{`
        @keyframes beakerbot-phew-bubble {
          0%   { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.85); }
          30%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.05); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes beakerbot-stack-wobble {
          0%,100% { transform: rotate(-2deg); }
          50%     { transform: rotate(2deg); }
        }
        @keyframes beakerbot-falling-beaker {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 1;
          }
          85% {
            transform: translate(var(--bb-fall-x, 0), var(--bb-fall-y, 60vh))
              rotate(var(--bb-fall-rot, 360deg));
            opacity: 1;
          }
          100% {
            transform: translate(var(--bb-fall-x, 0), var(--bb-fall-y, 60vh))
              rotate(var(--bb-fall-rot, 360deg)) scale(0.6);
            opacity: 0;
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}

// --------------------------------------------------------------------
// Subcomponents
// --------------------------------------------------------------------

interface CarriedBeakerProps {
  color: string;
  size: number; // viewbox-equivalent units; scales the wrapper
  wobblePhase: number;
  stage: SceneStage;
}

/** A single small carried beaker — minimal silhouette + colored
 *  liquid, no face/eyes (BeakerBot's face is the only face in the
 *  scene). Rendered as a stack from top to bottom in the parent. */
function CarriedBeaker({ color, size, wobblePhase, stage }: CarriedBeakerProps) {
  // Small intrinsic wobble during normal walking — tiny offset based
  // on phase so adjacent beakers don't sway in perfect sync.
  const wobble = stage === "entry" || stage === "walkingAway" ? wobblePhase * 0.3 : 0;
  return (
    <div
      style={{
        width: `${size * 2}px`,
        height: `${size * 2.2}px`,
        marginBottom: "-3px", // stack overlap so beakers nest visually
        transform: `rotate(${wobble}deg)`,
        transformOrigin: "bottom center",
      }}
    >
      <svg viewBox="0 0 20 22" width="100%" height="100%" fill="none">
        {/* White backing fill so the silhouette reads on any background */}
        <path
          d="M 4 4 L 4 14 C 4 18, 7 19, 10 19 C 13 19, 16 18, 16 14 L 16 4 Z"
          fill="white"
          stroke="none"
        />
        {/* Colored liquid — fills lower portion of beaker */}
        <path
          d="M 4 11 Q 6 10, 8 11 T 12 11 T 16 11 L 16 14 C 16 18, 13 19, 10 19 C 7 19, 4 18, 4 14 Z"
          fill={color}
          stroke="none"
        />
        {/* Body outline */}
        <path
          d="M 4 4 L 4 14 C 4 18, 7 19, 10 19 C 13 19, 16 18, 16 14 L 16 4"
          stroke="#475569"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Lip */}
        <path d="M 3.4 4 L 16.6 4" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

interface FallingBeakerProps {
  color: string;
  size: number;
  stackIndex: number;
  stackCount: number;
  horizontalPx: number;
  rotateToDeg: number;
  delayMs: number;
}

/** A beaker mid-flight — uses CSS animation with ease-in to fake
 *  gravity acceleration, lands + scale-shrinks (puff effect) at end. */
function FallingBeaker({
  color,
  size,
  stackIndex,
  stackCount,
  horizontalPx,
  rotateToDeg,
  delayMs,
}: FallingBeakerProps) {
  // Start position: at the top of the stack (each beaker offset
  // upward relative to the bottom beaker).
  const startTop = -(stackCount - 1 - stackIndex) * (size * 1.9 + -3) - size * 2;
  return (
    <div
      className="absolute left-1/2"
      style={{
        top: startTop,
        transform: "translateX(-50%)",
        width: `${size * 2}px`,
        height: `${size * 2.2}px`,
        // Custom properties feed the keyframes — keeps the CSS rule
        // shared across all falling beakers.
        ["--bb-fall-x" as string]: `${horizontalPx}px`,
        ["--bb-fall-y" as string]: `60vh`,
        ["--bb-fall-rot" as string]: `${rotateToDeg}deg`,
        animation: `beakerbot-falling-beaker 700ms ease-in ${delayMs}ms forwards`,
      }}
      data-testid={`falling-beaker-${stackIndex}`}
    >
      <svg viewBox="0 0 20 22" width="100%" height="100%" fill="none">
        <path
          d="M 4 4 L 4 14 C 4 18, 7 19, 10 19 C 13 19, 16 18, 16 14 L 16 4 Z"
          fill="white"
          stroke="none"
        />
        <path
          d="M 4 11 Q 6 10, 8 11 T 12 11 T 16 11 L 16 14 C 16 18, 13 19, 10 19 C 7 19, 4 18, 4 14 Z"
          fill={color}
          stroke="none"
        />
        <path
          d="M 4 4 L 4 14 C 4 18, 7 19, 10 19 C 13 19, 16 18, 16 14 L 16 4"
          stroke="#475569"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path d="M 3.4 4 L 16.6 4" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
