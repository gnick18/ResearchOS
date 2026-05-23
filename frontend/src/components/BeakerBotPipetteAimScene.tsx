"use client";

// frontend/src/components/BeakerBotPipetteAimScene.tsx
//
// Side reward scene: BeakerBot carries a pipette over to a tiny 96-well
// plate, lines up the tip over a target well, his hand shakes for an
// instant of "precision focus", a single droplet falls in a quick arc
// and bounces into the well, a ripple pulses out from the well center,
// then he celebrates with a sparkle burst above the plate before
// walking off the way he came. ~4s total. Captures the "precision win"
// vibe for milestone celebrations.
//
// Built on the same skeleton as the other bench-style scenes:
//   - Portaled overlay at document.body
//   - position: fixed, inset: 0
//   - pointer-events: none (purely decorative)
//   - z-index 800 (above app chrome, below modals)
//   - useSyncExternalStore for SSR-safe portal mount
//   - prefers-reduced-motion gate with static "post-drop" tableau
//   - Multi-stage timeline driven by chained setTimeouts
//   - SCENE_GROUND_BOTTOM_VH baseline so BeakerBot's feet land where
//     they do in every other bench scene.
//
// Stage timeline (~4000ms total in motion mode):
//   1. walkIn    0    →  600ms   (BeakerBot enters carrying the pipette)
//   2. aim       600  → 1400ms   (stops at plate, pose=thinking, hand jitters)
//   3. drop      1400 → 1800ms   (droplet falls in a quick arc into the well)
//   4. ripple    1800 → 2400ms   (ripple ring expands from well center)
//   5. celebrate 2400 → 3600ms   (pose=cheering, 8-particle sparkle confetti)
//   6. exit      3600 → 4000ms   (walks off the side they entered from)
//
// Reduced-motion fallback: render BeakerBot in cheering pose at the
// plate, plate with a filled target well, sparkles at their final
// scattered positions above the plate. Hold 2000ms then fire
// onComplete.
//
// Pose note: the brainstorm called for the new `amazed` pose during
// celebrate, but this branch was anchored before `amazed` landed. We
// use `cheering` instead — it's the existing "win moment" pose and
// pairs naturally with the sparkle confetti.

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";
import {
  BEAKERBOT_SCENE_SIZE_CLASS,
  BEAKERBOT_SCENE_SIZE_PX,
  SCENE_GROUND_BOTTOM_CSS,
  SCENE_GROUND_BOTTOM_VH,
} from "./beakerbot/scene-constants";

export interface BeakerBotPipetteAimSceneProps {
  /** When true, the scene mounts and runs through its sequence.
   *  When false, the scene renders nothing (and any in-flight timer
   *  is cancelled). Toggle from false → true to (re)play. */
  active: boolean;
  /** Fires once the full sequence has finished playing (or once the
   *  reduced-motion shortcut has elapsed). The parent is expected to
   *  set `active=false` in response. */
  onComplete?: () => void;
  /** Side from which BeakerBot enters carrying the pipette. Default
   *  "left". He exits the same side after the celebration. */
  enterFrom?: "left" | "right";
}

/** Stage durations in ms. Kept as a const so tests can re-derive the
 *  total without hard-coding the sum. */
export const STAGE_DURATIONS = {
  walkIn: 600,
  aim: 800,
  drop: 400,
  ripple: 600,
  celebrate: 1200,
  exit: 400,
} as const;

export const TOTAL_DURATION_MS =
  STAGE_DURATIONS.walkIn +
  STAGE_DURATIONS.aim +
  STAGE_DURATIONS.drop +
  STAGE_DURATIONS.ripple +
  STAGE_DURATIONS.celebrate +
  STAGE_DURATIONS.exit;

/** Reduced-motion fallback duration. */
export const REDUCED_MOTION_DURATION_MS = 2000;

/** Discrete stages the state machine cycles through. */
export type PipetteAimStage =
  | "idle"
  | "walkIn"
  | "aim"
  | "drop"
  | "ripple"
  | "celebrate"
  | "exit"
  | "done";

export const STAGE_ORDER: readonly PipetteAimStage[] = [
  "walkIn",
  "aim",
  "drop",
  "ripple",
  "celebrate",
  "exit",
] as const;

/** Gold + rainbow palette for the celebrate-stage sparkle confetti.
 *  Leads with two golds so the "precision win" beat reads as a small
 *  trophy-flavored moment before the rainbow follows through. */
const SPARKLE_COLORS = [
  "#FFD24A", // gold
  "#FFE89A", // soft gold
  "#A6D2F4", // sky
  "#B7EBB1", // mint
  "#D6B5F0", // lavender
  "#FFC0CB", // pink
  "#FFD2B0", // peach
  "#FFD24A", // gold (cycle)
] as const;

/** Number of sparkles in the celebrate burst. */
const SPARKLE_COUNT = 8;

/** Sparkle outward radius in pixels. Spreads above the plate. */
const SPARKLE_RADIUS_PX = 70;

/** Z-index slot — matches the rest of the bench-style scenes. */
const SCENE_Z_INDEX = 800;

/** Well-plate grid layout — 4 rows x 6 cols visible. Compact size
 *  reads as "tiny plate sitting on the bench" without dominating the
 *  bot. */
const PLATE_ROWS = 4;
const PLATE_COLS = 6;
const PLATE_WELL_RADIUS_PX = 5;
const PLATE_WELL_SPACING_PX = 14;
const PLATE_PADDING_PX = 8;
const PLATE_WIDTH_PX =
  PLATE_COLS * PLATE_WELL_SPACING_PX + PLATE_PADDING_PX * 2;
const PLATE_HEIGHT_PX =
  PLATE_ROWS * PLATE_WELL_SPACING_PX + PLATE_PADDING_PX * 2;

/** Index of the target well in the (row, col) grid. Chosen so the
 *  droplet has somewhere "interesting" to land — second row in,
 *  third column. */
const TARGET_ROW = 1;
const TARGET_COL = 2;

/** SSR-safe client detection — same pattern used by the other scenes. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Four-point sparkle-star SVG used by the celebrate-stage burst. Same
 *  glyph the Eureka scene uses for its rainbow burst; inlined here
 *  because the shared `beakerbot/BurstParticles` primitive hadn't
 *  landed on the branch we're anchored to. */
function SparkleStar({
  color,
  size = 14,
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

/** Pipette glyph — thin barrel + plunger top + tip. Color: white body
 *  with sky-500 outline so it reads against the page background. */
function PipetteGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 12 48"
      fill="none"
      role="img"
      aria-label="Pipette"
      className={className ?? "w-3 h-12"}
    >
      {/* Plunger button on top */}
      <rect x="3" y="0" width="6" height="3" rx="1" fill="#0EA5E9" />
      {/* Plunger shaft (thin) */}
      <rect x="5" y="3" width="2" height="3" fill="#0EA5E9" />
      {/* Main barrel — wider at top, tapers to the tip */}
      <path
        d="M 2 6 L 10 6 L 10 30 L 7.5 36 L 7.5 42 L 4.5 42 L 4.5 36 L 2 30 Z"
        fill="white"
        stroke="#0EA5E9"
        strokeWidth="0.8"
      />
      {/* Volume window — small clear stripe near the top */}
      <rect x="4" y="10" width="4" height="6" rx="0.5" fill="#E0F2FE" stroke="#0EA5E9" strokeWidth="0.3" />
      {/* Tip — narrow extension below the barrel */}
      <path
        d="M 5 42 L 7 42 L 6.4 47 L 5.6 47 Z"
        fill="white"
        stroke="#0EA5E9"
        strokeWidth="0.8"
      />
    </svg>
  );
}

/** 96-well plate glyph rendered as a rounded-rect outline plus a grid
 *  of small circles. The `targetFilled` flag draws the target well as
 *  a darker fill (used in the reduced-motion tableau and after the
 *  droplet lands). */
function WellPlateGlyph({
  targetFilled,
  targetHighlight,
}: {
  /** Render the target well as a filled blue dot (post-drop look). */
  targetFilled: boolean;
  /** Render a glow halo around the target well (pre-drop "aim" look). */
  targetHighlight: boolean;
}) {
  return (
    <svg
      viewBox={`0 0 ${PLATE_WIDTH_PX} ${PLATE_HEIGHT_PX}`}
      fill="none"
      role="img"
      aria-label="96-well plate"
      width={PLATE_WIDTH_PX}
      height={PLATE_HEIGHT_PX}
      style={{ display: "block" }}
    >
      {/* Plate body — light gray rounded rect */}
      <rect
        x="0.5"
        y="0.5"
        width={PLATE_WIDTH_PX - 1}
        height={PLATE_HEIGHT_PX - 1}
        rx="4"
        fill="#F8FAFC"
        stroke="#94A3B8"
        strokeWidth="1"
      />
      {/* Grid of wells */}
      {Array.from({ length: PLATE_ROWS }).flatMap((_, r) =>
        Array.from({ length: PLATE_COLS }).map((__, c) => {
          const cx =
            PLATE_PADDING_PX +
            c * PLATE_WELL_SPACING_PX +
            PLATE_WELL_SPACING_PX / 2;
          const cy =
            PLATE_PADDING_PX +
            r * PLATE_WELL_SPACING_PX +
            PLATE_WELL_SPACING_PX / 2;
          const isTarget = r === TARGET_ROW && c === TARGET_COL;
          return (
            <g key={`${r}-${c}`}>
              {/* Halo first so it sits behind the well */}
              {isTarget && targetHighlight && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={PLATE_WELL_RADIUS_PX + 3}
                  fill="rgba(14, 165, 233, 0.25)"
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={isTarget ? PLATE_WELL_RADIUS_PX + 0.5 : PLATE_WELL_RADIUS_PX}
                fill={isTarget && targetFilled ? "#38BDF8" : "#E2E8F0"}
                stroke="#94A3B8"
                strokeWidth="0.6"
              />
            </g>
          );
        }),
      )}
    </svg>
  );
}

export default function BeakerBotPipetteAimScene({
  active,
  onComplete,
  enterFrom = "left",
}: BeakerBotPipetteAimSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<PipetteAimStage>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);

  // Stash onComplete in a ref so the stage-driver effect doesn't
  // re-fire just because a parent passes a new inline-fn each render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Detect prefers-reduced-motion. Same listen-for-live-changes pattern
  // as the other scenes.
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
  // When inactive we early-return; the outer `if (!active) return null`
  // handles the rendering side. All stage transitions happen inside
  // setTimeout callbacks (including the initial one at delay 0) so the
  // react-hooks/set-state-in-effect lint rule stays satisfied.
  useEffect(() => {
    if (!active) return;

    const timers: number[] = [];

    if (reducedMotion) {
      // Schedule the "done" stage in a microtask so the setState isn't
      // synchronous-in-effect; then dwell for REDUCED_MOTION_DURATION_MS
      // before firing onComplete.
      const stageHandle = window.setTimeout(() => setStage("done"), 0);
      const completeHandle = window.setTimeout(() => {
        onCompleteRef.current?.();
      }, REDUCED_MOTION_DURATION_MS);
      timers.push(stageHandle, completeHandle);
      return () => {
        for (const t of timers) window.clearTimeout(t);
      };
    }

    // Drive the stage machine via setTimeouts. Even the first stage
    // ("walkIn") is scheduled at delay 0 so no setState fires
    // synchronously from the effect body.
    let elapsed = 0;
    for (let i = 0; i < STAGE_ORDER.length; i++) {
      const next = STAGE_ORDER[i];
      const handle = window.setTimeout(() => setStage(next), elapsed);
      timers.push(handle);
      elapsed += STAGE_DURATIONS[next as keyof typeof STAGE_DURATIONS];
    }
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
  // share animation names. Same pattern as the other scenes.
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbpas-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );

  // Direction-driven offsets: BeakerBot enters from `enterFrom`, walks
  // to a position just to the side of the plate, then exits back the
  // way he came (so he doesn't trample the plate on the way out).
  const direction = useMemo(() => {
    const fromLeft = enterFrom === "left";
    return {
      beakerStartX: fromLeft ? "-20vw" : "120vw",
      // Stop position: the bot stands to the side the plate is opposite.
      // When entering from the left he stops at ~42vw with the plate on
      // his right; mirrored when entering from the right.
      beakerAimX: fromLeft ? "42vw" : "58vw",
      beakerExitX: fromLeft ? "-20vw" : "120vw",
      // Plate position: ~8vw to the side of the bot's aim position, on
      // the side he's facing (so the pipette tip naturally hovers above
      // the target well).
      plateX: fromLeft ? "55vw" : "45vw",
      // Facing during the aim/drop: bot faces the plate side.
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
        delayMs: i * 40,
      };
    });
  }, []);

  if (!active || !isClient) return null;

  // ----- Stage-driven visual state -----

  const plateVisible =
    stage === "aim" ||
    stage === "drop" ||
    stage === "ripple" ||
    stage === "celebrate" ||
    stage === "exit" ||
    stage === "done";

  // The pipette is carried (held) during walkIn / aim / drop, and put
  // away during the celebrate + exit stages so BeakerBot's hands are
  // free to wave / sparkle / etc.
  const pipetteCarried =
    stage === "walkIn" || stage === "aim" || stage === "drop";

  // The hand-shake jitter on the pipette only fires during "aim".
  const pipetteJittering = stage === "aim";

  // Droplet-in-flight during "drop".
  const dropletInFlight = stage === "drop";

  // The target well shows as filled once the droplet has landed.
  const targetFilled =
    stage === "ripple" ||
    stage === "celebrate" ||
    stage === "exit" ||
    stage === "done";

  // Highlight halo on the target well during the aim stage (so the
  // viewer can see where the droplet is about to land).
  const targetHighlight = stage === "aim" || stage === "drop";

  // Ripple ring active only during the "ripple" stage in motion mode.
  const rippleActive = stage === "ripple";

  // Celebrate-stage sparkle confetti.
  const sparklesBursting = stage === "celebrate";

  // Reduced-motion: render a static "post-drop" tableau (plate with
  // filled target, sparkles at scattered positions, amazed pose).
  const sparklesStatic = reducedMotion && stage === "done";

  // BeakerBot pose by stage.
  let pose: BeakerBotPose = "idle";
  switch (stage) {
    case "walkIn":
    case "exit":
      pose = "idle";
      break;
    case "aim":
    case "drop":
      pose = "thinking";
      break;
    case "ripple":
      // Brief beat before the celebration kicks in — keep him focused.
      pose = "thinking";
      break;
    case "celebrate":
    case "done":
      // `amazed` would be the ideal "wow, perfect drop!" beat but it
      // hasn't landed on this branch yet (added in A3). Falling back
      // to `cheering` — already the "win moment" pose elsewhere.
      pose = "cheering";
      break;
    default:
      pose = "idle";
  }

  // BeakerBot horizontal position by stage. CSS transition smooths
  // between stages.
  let beakerTranslateX: string;
  switch (stage) {
    case "walkIn":
      beakerTranslateX = direction.beakerStartX;
      break;
    case "aim":
    case "drop":
    case "ripple":
    case "celebrate":
      beakerTranslateX = direction.beakerAimX;
      break;
    case "exit":
      beakerTranslateX = direction.beakerExitX;
      break;
    case "done":
      // Reduced-motion tableau: bot at aim position.
      beakerTranslateX = direction.beakerAimX;
      break;
    default:
      beakerTranslateX = direction.beakerStartX;
  }

  // Transition timing per stage — slow on walkIn/exit (he's covering
  // ground), snappy on the bench stages.
  let transitionMs = 300;
  if (stage === "walkIn") transitionMs = STAGE_DURATIONS.walkIn;
  else if (stage === "exit") transitionMs = STAGE_DURATIONS.exit;

  // Plate vertical position: sits on the SCENE_GROUND_BOTTOM_VH baseline
  // with a small lift so the wells are above the ground line.
  const plateBottomCss = `calc(${SCENE_GROUND_BOTTOM_CSS} + 8px)`;

  // Target-well coordinates inside the plate SVG (used to position the
  // droplet, ripple, and sparkle origin).
  const targetCxPx =
    PLATE_PADDING_PX +
    TARGET_COL * PLATE_WELL_SPACING_PX +
    PLATE_WELL_SPACING_PX / 2;
  const targetCyPx =
    PLATE_PADDING_PX +
    TARGET_ROW * PLATE_WELL_SPACING_PX +
    PLATE_WELL_SPACING_PX / 2;

  return createPortal(
    <div
      data-testid="beakerbot-pipette-aim-scene"
      data-stage={stage}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: SCENE_Z_INDEX,
        // overflow: visible — universal scene-wrapper rule.
        overflow: "visible",
      }}
    >
      {/* Scoped keyframes: pipette hand jitter, droplet fall arc,
          ripple expand, body bob. */}
      <style>{`
        @keyframes ${animSuffix}-pipette-jitter {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          20%      { transform: translate(0.6px, -0.4px) rotate(0.8deg); }
          40%      { transform: translate(-0.5px, 0.5px) rotate(-0.6deg); }
          60%      { transform: translate(0.4px, 0.4px) rotate(0.5deg); }
          80%      { transform: translate(-0.4px, -0.3px) rotate(-0.4deg); }
        }
        @keyframes ${animSuffix}-droplet-fall {
          0%   { opacity: 0; transform: translate(-50%, 0) scaleY(0.8); }
          10%  { opacity: 1; transform: translate(-50%, 0) scaleY(0.8); }
          85%  { opacity: 1; transform: translate(-50%, var(--bbpas-fall-dy)) scaleY(1.1); }
          100% { opacity: 0; transform: translate(-50%, var(--bbpas-fall-dy)) scaleY(0.4); }
        }
        @keyframes ${animSuffix}-ripple-expand {
          0%   { opacity: 0.9; transform: translate(-50%, -50%) scale(0.3); }
          60%  { opacity: 0.55; transform: translate(-50%, -50%) scale(1.4); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(2.2); }
        }
        @keyframes ${animSuffix}-body-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-2px); }
        }
        @keyframes ${animSuffix}-sparkle-burst {
          0%   { opacity: 0; transform: translate(0, 0) scale(0); }
          20%  { opacity: 1; transform: translate(calc(var(--bbpas-spark-rx) * 0.4), calc(var(--bbpas-spark-ry) * 0.4)) scale(1.2); }
          60%  { opacity: 1; transform: translate(var(--bbpas-spark-rx), var(--bbpas-spark-ry)) scale(1); }
          100% { opacity: 0; transform: translate(calc(var(--bbpas-spark-rx) * 1.1), calc(var(--bbpas-spark-ry) * 1.1)) scale(0); }
        }
      `}</style>

      {/* WELL PLATE on the bench. Renders from "aim" onward. */}
      {plateVisible && (
        <div
          data-testid="beakerbot-pipette-aim-scene-plate"
          style={{
            position: "absolute",
            left: direction.plateX,
            bottom: plateBottomCss,
            transform: "translate(-50%, 0)",
            width: PLATE_WIDTH_PX,
            height: PLATE_HEIGHT_PX,
          }}
        >
          <WellPlateGlyph
            targetFilled={targetFilled || sparklesStatic}
            targetHighlight={targetHighlight}
          />

          {/* DROPLET — falls from above the plate down into the target
              well during the "drop" stage. Positioned relative to the
              plate so its target landing point is the well center. The
              keyframe handles the easing; the CSS custom property
              `--bbpas-fall-dy` tells it how far to fall. */}
          {dropletInFlight && (
            <div
              data-testid="beakerbot-pipette-aim-scene-droplet"
              style={
                {
                  position: "absolute",
                  // Start above the plate (negative offset from the
                  // plate's top edge), centered over the target column.
                  left: targetCxPx,
                  top: -36,
                  width: 0,
                  height: 0,
                  // CSS custom property consumed by the keyframe so the
                  // droplet ends up at the well center.
                  "--bbpas-fall-dy": `${targetCyPx + 36}px`,
                  animation: `${animSuffix}-droplet-fall ${STAGE_DURATIONS.drop}ms ease-in forwards`,
                  pointerEvents: "none",
                } as CSSProperties
              }
            >
              <svg
                viewBox="0 0 8 12"
                width="8"
                height="12"
                aria-hidden="true"
                style={{
                  display: "block",
                  position: "absolute",
                  left: "-4px",
                  top: 0,
                }}
              >
                {/* Tear-drop shape, blue/cyan fill */}
                <path
                  d="M 4 0 C 6 4, 7 7, 7 9 C 7 11, 5.5 12, 4 12 C 2.5 12, 1 11, 1 9 C 1 7, 2 4, 4 0 Z"
                  fill="#38BDF8"
                  stroke="#0284C7"
                  strokeWidth="0.5"
                />
              </svg>
            </div>
          )}

          {/* RIPPLE RING — expands out from the target well center
              during the "ripple" stage. */}
          {rippleActive && (
            <div
              data-testid="beakerbot-pipette-aim-scene-ripple"
              style={{
                position: "absolute",
                left: targetCxPx,
                top: targetCyPx,
                width: PLATE_WELL_RADIUS_PX * 2,
                height: PLATE_WELL_RADIUS_PX * 2,
                borderRadius: "50%",
                border: "1.5px solid #0EA5E9",
                transform: "translate(-50%, -50%) scale(0.3)",
                animation: `${animSuffix}-ripple-expand ${STAGE_DURATIONS.ripple}ms ease-out forwards`,
                pointerEvents: "none",
              }}
            />
          )}

          {/* CELEBRATE-STAGE SPARKLE CONFETTI — emits from above the
              plate when the celebration kicks in. The burst origin sits
              ~24px above the plate's top edge so the sparkles spread
              over the plate, not the wells. Inlined (rather than
              reusing the shared BurstParticles primitive) because that
              primitive hadn't landed on this branch's anchor commit. */}
          {(sparklesBursting || sparklesStatic) && (
            <div
              data-testid="beakerbot-pipette-aim-scene-sparkles"
              style={{
                position: "absolute",
                left: PLATE_WIDTH_PX / 2,
                top: -24,
                width: 0,
                height: 0,
                pointerEvents: "none",
              }}
            >
              {sparkles.map((s, i) => (
                <div
                  key={i}
                  data-testid="beakerbot-burst-particle"
                  style={
                    {
                      position: "absolute",
                      left: 0,
                      top: 0,
                      marginLeft: -7,
                      marginTop: -7,
                      // In reduced-motion tableau, place the sparkle at
                      // its final outward position statically. Otherwise
                      // the keyframe drives it.
                      transform: sparklesStatic
                        ? `translate(${s.rx}px, ${s.ry}px) scale(1)`
                        : "translate(0, 0) scale(0)",
                      "--bbpas-spark-rx": `${s.rx}px`,
                      "--bbpas-spark-ry": `${s.ry}px`,
                      animation: sparklesBursting
                        ? `${animSuffix}-sparkle-burst ${STAGE_DURATIONS.celebrate}ms ease-out ${s.delayMs}ms forwards`
                        : undefined,
                    } as CSSProperties
                  }
                >
                  <SparkleStar color={s.color} size={14} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BEAKERBOT — fixed-size, translated horizontally per stage. The
          bench is at SCENE_GROUND_BOTTOM_VH; BeakerBot sits with feet
          on the bench line. The pipette is rendered as an absolutely
          positioned child of the bot wrapper so it travels with him
          during walkIn / aim / drop. */}
      <div
        data-testid="beakerbot-pipette-aim-scene-bot"
        style={{
          position: "absolute",
          left: 0,
          bottom: `calc(${SCENE_GROUND_BOTTOM_VH}vh - 4px)`,
          // Canonical scene scale — see BEAKERBOT_SCENE_SIZE_PX in
          // beakerbot/scene-constants.ts.
          width: BEAKERBOT_SCENE_SIZE_PX,
          height: BEAKERBOT_SCENE_SIZE_PX,
          transform: `translate(calc(${beakerTranslateX} - ${BEAKERBOT_SCENE_SIZE_PX / 2}px), 0)`,
          transition: `transform ${transitionMs}ms ${
            stage === "walkIn" || stage === "exit" ? "ease-in-out" : "ease-out"
          }`,
        }}
      >
        {/* Bob wrapper — gentle body bob during celebrate. */}
        <div
          style={{
            width: "100%",
            height: "100%",
            animation:
              stage === "celebrate" && !reducedMotion
                ? `${animSuffix}-body-bob 400ms ease-in-out 3 alternate`
                : undefined,
            transformOrigin: "center bottom",
            position: "relative",
          }}
        >
          <BeakerBot
            pose={pose}
            direction={direction.facing}
            className={`${BEAKERBOT_SCENE_SIZE_CLASS} text-sky-500`}
            ariaLabel="BeakerBot"
          />

          {/* PIPETTE — held in BeakerBot's forward hand during the
              carry/aim/drop stages. Positioned in front of the bot on
              the side he's facing, with the tip pointing down toward
              the plate. The jitter keyframe adds the hand-shake during
              the aim stage. */}
          {pipetteCarried && (
            <div
              data-testid="beakerbot-pipette-aim-scene-pipette"
              style={{
                position: "absolute",
                // Side the bot is facing, scaled to the 2x bot size.
                left: direction.sideSign > 0 ? "auto" : "16px",
                right: direction.sideSign > 0 ? "16px" : "auto",
                // Pipette tip sits at roughly the bot's mid-height; the
                // plunger top extends up past the head.
                bottom: "20px",
                width: 18,
                height: 72,
                animation: pipetteJittering
                  ? `${animSuffix}-pipette-jitter 100ms ease-in-out infinite`
                  : undefined,
                transformOrigin: "center bottom",
              }}
            >
              <PipetteGlyph className="w-[18px] h-[72px]" />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
