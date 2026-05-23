"use client";

// frontend/src/components/BeakerBotMicroscopeBubbleScene.tsx
//
// Side easter-egg scene: BeakerBot peers through a microscope (reusing
// the same microscope glyph shape as BeakerBotEurekaScene's lean-to-
// peek beat), the eyepiece glows, then a BIG soap bubble rises out of
// the microscope with a tiny BeakerBot silhouette floating inside. The
// bubble drifts upward + sways slightly, then pops with a brief "pop!"
// speech bubble. BeakerBot stands up amazed and watches where the
// bubble was. Whimsical "look at what's inside" beat.
//
// Built on the same skeleton as the other bench-style scenes:
//   - Portaled overlay at document.body
//   - position: fixed, inset: 0
//   - pointer-events: none (purely decorative)
//   - z-index 800 (above app chrome, below modals)
//   - useSyncExternalStore for SSR-safe portal mount
//   - prefers-reduced-motion gate with static fallback
//
// Stage timeline (~5000ms total in motion mode):
//   1. walkIn      0    → 600ms   (BeakerBot enters from side toward bench)
//   2. peek        600  → 1600ms  (Leans down to eyepiece, pose=pointing-down)
//   3. glow        1600 → 2200ms  (Eyepiece glows with sky-cyan radial pulse)
//   4. bubbleRise  2200 → 3700ms  (Big soap bubble with tiny BeakerBot inside
//                                  rises from the microscope, drifts up + sways)
//   5. pop         3700 → 4000ms  (Bubble pops with scale + fade, "pop!" appears)
//   6. reaction    4000 → 5000ms  (BeakerBot stands up amazed, watches up)
//
// Reduced-motion fallback: render BeakerBot in amazed pose with the
// microscope on the bench and a single static bubble floating above.
// Hold 2000ms then fire onComplete.

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";
import BeakerBotSpeechBubble from "./beakerbot/SpeechBubble";
import { SCENE_GROUND_BOTTOM_CSS, SCENE_GROUND_BOTTOM_VH } from "./beakerbot/scene-constants";

export interface BeakerBotMicroscopeBubbleSceneProps {
  /** When true, the scene mounts and runs through its sequence.
   *  When false, the scene renders nothing (and any in-flight timer
   *  is cancelled). Toggle from false → true to (re)play. */
  active: boolean;
  /** Fires once the full sequence has finished playing (or once the
   *  reduced-motion shortcut has elapsed). The parent is expected to
   *  set `active=false` in response. */
  onComplete?: () => void;
  /** Side from which BeakerBot enters. Default "right". */
  enterFrom?: "left" | "right";
}

/** Stage durations in ms. Kept as a const so tests can re-derive the
 *  total without hard-coding the sum. */
export const STAGE_DURATIONS = {
  walkIn: 600,
  peek: 1000,
  glow: 600,
  bubbleRise: 1500,
  pop: 300,
  reaction: 1000,
} as const;

export const TOTAL_DURATION_MS =
  STAGE_DURATIONS.walkIn +
  STAGE_DURATIONS.peek +
  STAGE_DURATIONS.glow +
  STAGE_DURATIONS.bubbleRise +
  STAGE_DURATIONS.pop +
  STAGE_DURATIONS.reaction;

/** Reduced-motion fallback duration. */
export const REDUCED_MOTION_DURATION_MS = 2000;

/** Discrete stages the state machine cycles through. */
export type MicroscopeBubbleStage =
  | "idle"
  | "walkIn"
  | "peek"
  | "glow"
  | "bubbleRise"
  | "pop"
  | "reaction"
  | "done";

export const STAGE_ORDER: readonly MicroscopeBubbleStage[] = [
  "walkIn",
  "peek",
  "glow",
  "bubbleRise",
  "pop",
  "reaction",
] as const;

/** Z-index slot — matches BeakerBotEurekaScene + sibling scenes. */
const SCENE_Z_INDEX = 800;

/** SSR-safe client detection — same pattern used by the other scenes. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Tiny microscope SVG. Visually identical to the Eureka scene's glyph
 *  (same base + stage + slide + arm + eyepiece structure, same gunmetal
 *  #4A5568 color). Inlined here so this scene doesn't need to import
 *  from / refactor BeakerBotEurekaScene. */
function MicroscopeGlyph({
  className,
  eyepieceGlow = false,
}: {
  className?: string;
  /** When true, render a glow sparkle on the eyepiece lens (during the
   *  "glow" stage). */
  eyepieceGlow?: boolean;
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
      {/* Arm — angled connector from base to eyepiece */}
      <path d="M 18 28 L 21 28 L 21 12 L 17 12 L 17 8 L 21 8 L 22 8 L 18 28 Z"
            fill="#4A5568" />
      <rect x="18" y="10" width="4" height="14" fill="#4A5568" />
      {/* Eyepiece — cylinder at the top */}
      <rect x="14" y="2" width="6" height="8" rx="1" fill="#4A5568" />
      <ellipse cx="17" cy="2.5" rx="3" ry="1.2" fill="#2D3748" />
      {/* Eyepiece glow sparkle when the lens lights up */}
      {eyepieceGlow && (
        <g aria-hidden="true">
          <circle cx="17" cy="2.5" r="2.4" fill="#7DD3FC" opacity="0.55" />
          <circle cx="15.8" cy="2.0" r="0.7" fill="white" opacity="0.95" />
          <circle cx="17.2" cy="2.8" r="0.4" fill="white" opacity="0.8" />
        </g>
      )}
    </svg>
  );
}

/** Soap bubble SVG. Iridescent rim (radial gradient white → faint pink
 *  → faint purple at the edge) plus a small specular highlight at the
 *  upper-left. The fill is mostly transparent so the tiny BeakerBot
 *  inside reads through. */
function SoapBubble({
  size,
  gradientId,
  children,
}: {
  size: number;
  gradientId: string;
  /** Inner content rendered on top of the bubble fill (the tiny
   *  BeakerBot lives here). */
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        pointerEvents: "none",
      }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
            <stop offset="70%" stopColor="rgba(255,255,255,0.10)" />
            <stop offset="85%" stopColor="rgba(255,182,193,0.45)" />
            <stop offset="95%" stopColor="rgba(186,160,232,0.55)" />
            <stop offset="100%" stopColor="rgba(125,211,252,0.85)" />
          </radialGradient>
        </defs>
        {/* Bubble body — large transparent sphere with iridescent rim */}
        <circle
          cx="50"
          cy="50"
          r="48"
          fill={`url(#${gradientId})`}
          stroke="rgba(186,160,232,0.65)"
          strokeWidth="0.8"
        />
        {/* Specular highlight — small white ellipse upper-left */}
        <ellipse
          cx="32"
          cy="28"
          rx="9"
          ry="6"
          fill="white"
          opacity="0.85"
          transform="rotate(-30 32 28)"
        />
        {/* Smaller secondary highlight */}
        <ellipse cx="40" cy="22" rx="3" ry="2" fill="white" opacity="0.7" />
      </svg>
      {/* Inner content sits above the SVG, centered. */}
      {children && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export default function BeakerBotMicroscopeBubbleScene({
  active,
  onComplete,
  enterFrom = "right",
}: BeakerBotMicroscopeBubbleSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<MicroscopeBubbleStage>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);

  // Stash onComplete in a ref so the stage-driver effect doesn't
  // re-fire just because a parent passes a new inline-fn each render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Detect prefers-reduced-motion.
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset stage when scene deactivates so a re-activation restarts from "walkIn"
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
  // share animation names. Also drives the bubble gradient defs id.
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbmb-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );
  const bubbleGradId = `${animSuffix}-bubble-grad`;

  // Direction-driven offsets: BeakerBot enters from `enterFrom`, walks
  // to a center bench position. The microscope sits to the side opposite
  // the entry so the bot ends up facing it.
  const direction = useMemo(() => {
    const fromLeft = enterFrom === "left";
    return {
      beakerStartX: fromLeft ? "-20vw" : "120vw",
      beakerBenchX: "50vw",
      // Microscope sits ~28px to the side toward which the bot ends up
      // facing (the opposite of entry direction).
      microscopeOffsetPx: fromLeft ? 28 : -28,
      // Facing during the peek: bot faces the microscope side.
      facing: (fromLeft ? "right" : "left") as "left" | "right",
      sideSign: fromLeft ? 1 : -1,
    };
  }, [enterFrom]);

  if (!active || !isClient) return null;

  // ----- Stage-driven visual state -----

  // The microscope is on the bench from stage 2 onward (and in the
  // reduced-motion tableau).
  const microscopeOnBench =
    stage === "peek" ||
    stage === "glow" ||
    stage === "bubbleRise" ||
    stage === "pop" ||
    stage === "reaction" ||
    stage === "done";

  // Eyepiece glow lights up during the glow + bubbleRise stages (and
  // the reduced-motion tableau).
  const eyepieceGlowActive =
    stage === "glow" ||
    stage === "bubbleRise" ||
    (reducedMotion && stage === "done");

  // The big bubble is visible during bubbleRise + pop. In reduced-motion
  // mode we also show a static bubble floating above the microscope.
  const bigBubbleVisible =
    stage === "bubbleRise" ||
    stage === "pop" ||
    (reducedMotion && stage === "done");

  // The "pop!" speech bubble appears briefly during the pop stage.
  const popBubbleVisible = stage === "pop";

  // BeakerBot pose by stage:
  //   - walkIn: idle (walking in)
  //   - peek / glow / bubbleRise / pop: pointing-down (leaning over eyepiece)
  //   - reaction: amazed (stands up, watches the popped bubble)
  //   - done (reduced-motion): amazed (static tableau)
  let pose: BeakerBotPose = "idle";
  switch (stage) {
    case "walkIn":
      pose = "idle";
      break;
    case "peek":
    case "glow":
    case "bubbleRise":
    case "pop":
      pose = "pointing-down";
      break;
    case "reaction":
    case "done":
      pose = "amazed";
      break;
    default:
      pose = "idle";
  }

  // BeakerBot horizontal position + lean by stage.
  let beakerTranslateX: string;
  let beakerLeanDeg = 0;
  let beakerLeanTranslateY = 0;
  switch (stage) {
    case "walkIn":
      beakerTranslateX = direction.beakerStartX;
      break;
    case "peek":
    case "glow":
    case "bubbleRise":
    case "pop":
      beakerTranslateX = direction.beakerBenchX;
      // Forward lean — tilt toward the microscope and translate down a
      // touch so his face is at the eyepiece.
      beakerLeanDeg = -8 * direction.sideSign;
      beakerLeanTranslateY = 6;
      break;
    case "reaction":
    case "done":
      // Stands back up. No lean.
      beakerTranslateX = direction.beakerBenchX;
      beakerLeanDeg = 0;
      beakerLeanTranslateY = 0;
      break;
    default:
      beakerTranslateX = direction.beakerStartX;
  }

  // Transition timing per stage.
  let transitionMs = 300;
  if (stage === "walkIn") transitionMs = STAGE_DURATIONS.walkIn;
  else if (stage === "peek") transitionMs = STAGE_DURATIONS.peek;
  else if (stage === "reaction") transitionMs = STAGE_DURATIONS.reaction;

  // Big-bubble size in px. Big enough that "tiny BeakerBot inside" is
  // legible at the gallery preview scale.
  const BIG_BUBBLE_SIZE_PX = 96;
  // The microscope is 72x80 (matches the Eureka scene's bench microscope).
  // Eyepiece center is at (~17/32) * 72 ≈ 38px from left, ~2.5/36 * 80 ≈ 5px
  // from top. Bubble emerges from that point and drifts upward.

  return createPortal(
    <div
      data-testid="beakerbot-microscope-bubble-scene"
      data-stage={stage}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: SCENE_Z_INDEX,
        overflow: "visible",
      }}
    >
      {/* Scoped keyframes for the eyepiece glow pulse, bubble rise + sway,
          bubble pop, and pop-text appearance. */}
      <style>{`
        @keyframes ${animSuffix}-eyepiece-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0.45; }
          50%      { transform: translate(-50%, -50%) scale(1.2); opacity: 0.85; }
        }
        @keyframes ${animSuffix}-bubble-rise {
          0%   { opacity: 0; transform: translate(-50%, 0) scale(0.2); }
          15%  { opacity: 1; transform: translate(-50%, -12px) scale(0.7); }
          40%  { opacity: 1; transform: translate(-50%, -60px) scale(1); }
          60%  { opacity: 1; transform: translate(calc(-50% + 6px), -100px) scale(1.02); }
          80%  { opacity: 1; transform: translate(calc(-50% - 6px), -140px) scale(1); }
          100% { opacity: 1; transform: translate(-50%, -170px) scale(1); }
        }
        @keyframes ${animSuffix}-bubble-pop {
          0%   { opacity: 1; transform: translate(-50%, -170px) scale(1); }
          40%  { opacity: 1; transform: translate(-50%, -170px) scale(1.15); }
          100% { opacity: 0; transform: translate(-50%, -170px) scale(0); }
        }
        @keyframes ${animSuffix}-pop-text {
          0%   { opacity: 0; transform: translate(-50%, 6px) scale(0.5); }
          40%  { opacity: 1; transform: translate(-50%, -2px) scale(1.1); }
          70%  { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 0; transform: translate(-50%, 0) scale(1); }
        }
        @keyframes ${animSuffix}-tiny-bot-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
      `}</style>

      {/* MICROSCOPE on the bench. Only renders from peek onward. */}
      {microscopeOnBench && (
        <div
          data-testid="beakerbot-microscope-bubble-scene-microscope"
          style={{
            position: "absolute",
            left: direction.beakerBenchX,
            bottom: SCENE_GROUND_BOTTOM_CSS,
            transform: `translate(calc(-50% + ${direction.microscopeOffsetPx * 2}px), 0)`,
            // 2x scale to match the Eureka scene's bench microscope.
            width: 72,
            height: 80,
          }}
        >
          {/* Eyepiece glow halo — radial gradient behind the eyepiece lens.
              Pulses during the glow + bubbleRise stages. */}
          {eyepieceGlowActive && (
            <div
              data-testid="beakerbot-microscope-bubble-scene-eyepiece-glow"
              style={{
                position: "absolute",
                // Eyepiece sits at top of the 72x80 microscope frame.
                // ~17/32 * 72 ≈ 38px from left, ~2.5/36 * 80 ≈ 5px from top.
                left: 38,
                top: 5,
                width: 48,
                height: 48,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(125,211,252,0.85) 0%, rgba(125,211,252,0.5) 35%, rgba(125,211,252,0) 70%)",
                transform: "translate(-50%, -50%) scale(0.9)",
                filter: "blur(2px)",
                animation: reducedMotion
                  ? undefined
                  : `${animSuffix}-eyepiece-pulse 800ms ease-in-out infinite`,
                pointerEvents: "none",
              }}
            />
          )}

          <MicroscopeGlyph
            className="w-[72px] h-20"
            eyepieceGlow={eyepieceGlowActive}
          />

          {/* BIG SOAP BUBBLE — rises from the microscope eyepiece during
              bubbleRise, then pops during pop. Positioned in the
              microscope's local frame so its origin is the eyepiece. */}
          {bigBubbleVisible && (
            <div
              data-testid="beakerbot-microscope-bubble-scene-bubble"
              style={{
                position: "absolute",
                // Anchored to the eyepiece center (left 38, top 5).
                // The keyframe handles the vertical rise.
                left: 38,
                top: 5,
                width: BIG_BUBBLE_SIZE_PX,
                height: BIG_BUBBLE_SIZE_PX,
                // Initial transform for first frame before the keyframe
                // kicks in (centered on the eyepiece, zero scale).
                transform: "translate(-50%, 0) scale(0.2)",
                opacity: 0,
                animation: reducedMotion
                  ? undefined
                  : stage === "bubbleRise"
                    ? `${animSuffix}-bubble-rise ${STAGE_DURATIONS.bubbleRise}ms ease-out forwards`
                    : stage === "pop"
                      ? `${animSuffix}-bubble-pop ${STAGE_DURATIONS.pop}ms ease-out forwards`
                      : undefined,
                // In reduced-motion mode the bubble sits at its final
                // floating position as part of the static tableau.
                ...(reducedMotion && stage === "done"
                  ? {
                      opacity: 1,
                      transform: "translate(-50%, -170px) scale(1)",
                    }
                  : {}),
                marginLeft: -BIG_BUBBLE_SIZE_PX / 2,
                marginTop: -BIG_BUBBLE_SIZE_PX / 2,
                pointerEvents: "none",
              }}
            >
              <SoapBubble size={BIG_BUBBLE_SIZE_PX} gradientId={bubbleGradId}>
                {/* TINY BEAKERBOT inside the bubble — small floating
                    silhouette, faces the same direction as the outer
                    bot. Gentle float loop while bubble drifts. */}
                <div
                  data-testid="beakerbot-microscope-bubble-scene-tiny-bot"
                  style={{
                    width: BIG_BUBBLE_SIZE_PX * 0.55,
                    height: BIG_BUBBLE_SIZE_PX * 0.55,
                    animation: reducedMotion
                      ? undefined
                      : `${animSuffix}-tiny-bot-float 1200ms ease-in-out infinite`,
                  }}
                >
                  <BeakerBot
                    pose="idle"
                    direction={direction.facing}
                    className="w-full h-full text-sky-500"
                    ariaLabel=""
                  />
                </div>
              </SoapBubble>
            </div>
          )}

          {/* "pop!" speech bubble — appears briefly at the pop position. */}
          {popBubbleVisible && (
            <BeakerBotSpeechBubble
              data-testid="beakerbot-microscope-bubble-scene-pop-bubble"
              tone="default"
              direction="down"
              position={{
                // Anchor at the eyepiece, lifted to the bubble's pop
                // location (~170px up from the eyepiece) so "pop!"
                // appears right where the bubble burst.
                left: 38,
                top: -165,
              }}
              style={{
                transform: "translate(-50%, 0)",
                fontSize: 16,
                padding: "4px 10px",
                animation: `${animSuffix}-pop-text ${STAGE_DURATIONS.pop}ms ease-out forwards`,
                pointerEvents: "none",
              }}
            >
              pop!
            </BeakerBotSpeechBubble>
          )}
        </div>
      )}

      {/* BEAKERBOT — fixed-size, translated horizontally per stage. */}
      <div
        data-testid="beakerbot-microscope-bubble-scene-bot"
        style={{
          position: "absolute",
          left: 0,
          bottom: `calc(${SCENE_GROUND_BOTTOM_VH}vh - 4px)`,
          // 2x scale (matches the Eureka scene).
          width: 128,
          height: 128,
          transform: `translate(calc(${beakerTranslateX} - 64px), 0)`,
          transition: `transform ${transitionMs}ms ${
            stage === "walkIn" ? "ease-in-out" : "ease-out"
          }`,
        }}
      >
        {/* Forward-lean wrapper — pivots from the bottom so the peek
            tilt reads as "leaning over the bench". */}
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
          <BeakerBot
            pose={pose}
            direction={direction.facing}
            className="w-32 h-32 text-sky-500"
            ariaLabel="BeakerBot"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
