"use client";

// frontend/src/components/BeakerBotCoffeeRefillScene.tsx
//
// Reward easter-egg scene: BeakerBot walks in carrying his beaker, walks
// to a small ceramic mug sitting on the bench, pours pastel-brown coffee
// from his beaker into the mug (mug fills via a rising liquid level),
// sets the beaker down, picks up the mug, blows on it (three small steam
// wisps drift sideways), takes a sip, eyes go heart-shaped, a few small
// hearts drift up from his chest, sighs contentedly, then walks off
// carrying the mug. ~5s total. Lab-life cameo, no failure, pure joy.
// "You've earned this" tone for after a long task.
//
// Built on the same skeleton as BeakerBotEurekaScene and
// BeakerBotTooManyBeakersScene:
//   - Portaled overlay at document.body
//   - position: fixed, inset: 0
//   - pointer-events: none (purely decorative)
//   - z-index 800 (above app chrome, below modals)
//   - useSyncExternalStore for SSR-safe portal mount
//   - prefers-reduced-motion gate with static "post-sip" fallback
//
// Stage timeline (~5000ms total in motion mode):
//   1. walkIn      0    → 600ms   (enters carrying beaker, walks to mug)
//   2. pour        600  → 1500ms  (tilts beaker, coffee streams into mug, mug fills)
//   3. sipPrep     1500 → 1900ms  (sets beaker on bench, picks up mug)
//   4. blow        1900 → 2400ms  (blows on mug, three steam wisps drift)
//   5. sip         2400 → 2800ms  (tilts mug to mouth, small backward lean)
//   6. heartEyes   2800 → 4000ms  (heart-shape eyes, hearts drift up, contented sway)
//   7. walkOff     4000 → 5000ms  (carries mug off the opposite side, content bob)
//
// Reduced-motion fallback: render BeakerBot at center holding the mug
// with heart-eyes overlay (the "after the sip" tableau) for 2000ms then
// fire onComplete.
//
// Heart-eye override is INLINE to this scene only — it is NOT a new
// pose on the BeakerBotPose union. The base BeakerBot renders behind a
// small SVG overlay that masks his normal dot eyes with pink hearts
// during the heartEyes stage.

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";
import { SCENE_GROUND_BOTTOM_CSS, SCENE_GROUND_BOTTOM_VH } from "./beakerbot/scene-constants";

export interface BeakerBotCoffeeRefillSceneProps {
  /** When true, the scene mounts and runs through its sequence.
   *  When false, the scene renders nothing (and any in-flight timer
   *  is cancelled). Toggle from false → true to (re)play. */
  active: boolean;
  /** Fires once the full sequence has finished playing (or once the
   *  reduced-motion shortcut has elapsed). The parent is expected to
   *  set `active=false` in response. */
  onComplete?: () => void;
  /** Side from which BeakerBot enters carrying his beaker. Default
   *  "left". He exits the opposite side carrying the mug. */
  enterFrom?: "left" | "right";
}

/** Stage durations in ms. Exported so tests can derive the total without
 *  hard-coding the sum. Total: 600+900+400+500+400+1200+1000 = 5000ms. */
export const STAGE_DURATIONS = {
  walkIn: 600,
  pour: 900,
  sipPrep: 400,
  blow: 500,
  sip: 400,
  heartEyes: 1200,
  walkOff: 1000,
} as const;

export const TOTAL_DURATION_MS =
  STAGE_DURATIONS.walkIn +
  STAGE_DURATIONS.pour +
  STAGE_DURATIONS.sipPrep +
  STAGE_DURATIONS.blow +
  STAGE_DURATIONS.sip +
  STAGE_DURATIONS.heartEyes +
  STAGE_DURATIONS.walkOff;

/** Reduced-motion fallback duration. */
export const REDUCED_MOTION_DURATION_MS = 2000;

/** Discrete stages the state machine cycles through. */
export type CoffeeRefillStage =
  | "idle"
  | "walkIn"
  | "pour"
  | "sipPrep"
  | "blow"
  | "sip"
  | "heartEyes"
  | "walkOff"
  | "done";

export const STAGE_ORDER: readonly CoffeeRefillStage[] = [
  "walkIn",
  "pour",
  "sipPrep",
  "blow",
  "sip",
  "heartEyes",
  "walkOff",
] as const;

/** Coffee fill color — pastel brown. */
const COFFEE_COLOR = "#A87854";
/** Coffee rim foam color — small white arc on top of the coffee. */
const COFFEE_FOAM_COLOR = "#F5E6D3";
/** Mug body color — soft sky-blue tinted ceramic to keep the pastel palette. */
const MUG_BODY_COLOR = "#E6F2FB";
const MUG_OUTLINE_COLOR = "#475569";
/** Heart eye + drifting heart particle color. */
const HEART_COLOR = "#F472B6"; // pink-400
const HEART_STROKE = "#DB2777"; // pink-600

/** Z-index slot — matches the other reward scenes. */
const SCENE_Z_INDEX = 800;

/** SSR-safe client detection — same pattern used elsewhere. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Small ceramic mug glyph. Rounded-rect body + curved handle on the
 *  side facing away from BeakerBot. Inside fills with coffee up to a
 *  caller-controlled `fillRatio` (0..1) so the pour can rise. */
function MugGlyph({
  className,
  fillRatio,
  showHandleOnRight = true,
}: {
  className?: string;
  /** Coffee fill level inside the mug. 0 = empty, 1 = full to brim. */
  fillRatio: number;
  /** Side the curved handle hangs off. Defaults to right; the carried
   *  mug during walkOff flips this so the handle always faces away from
   *  BeakerBot's body. */
  showHandleOnRight?: boolean;
}) {
  // Coffee fill: the mug's inside spans roughly y=8..y=24 (16 units tall).
  // fillRatio=1 -> coffee top edge at y=8; fillRatio=0 -> at y=24.
  const fill = Math.max(0, Math.min(1, fillRatio));
  const coffeeTopY = 24 - fill * 16; // y-coord of the coffee surface
  const showCoffee = fill > 0.001;
  // Foam arc sits 0.6 units above the coffee surface for the rim look.
  const foamY = coffeeTopY - 0.4;
  return (
    <svg
      viewBox="0 0 32 30"
      fill="none"
      role="img"
      aria-label="Coffee mug"
      className={className ?? "w-8 h-7"}
    >
      {/* Mug body — rounded rect, ceramic blue-tinted */}
      <rect
        x="6"
        y="6"
        width="18"
        height="20"
        rx="2"
        ry="2"
        fill={MUG_BODY_COLOR}
        stroke={MUG_OUTLINE_COLOR}
        strokeWidth="1.1"
      />
      {/* Coffee fill — masked to the mug interior. Inset 0.6 from the
          mug border so the outline stays visible. */}
      {showCoffee && (
        <>
          <rect
            x="6.8"
            y={coffeeTopY}
            width="16.4"
            height={26 - coffeeTopY - 0.4}
            fill={COFFEE_COLOR}
          />
          {/* Foam — small white arc on top of the coffee. */}
          <path
            d={`M 7.5 ${foamY + 0.2} Q 11 ${foamY - 0.5}, 15 ${foamY + 0.2} T 22.5 ${foamY + 0.2}`}
            stroke={COFFEE_FOAM_COLOR}
            strokeWidth="0.8"
            fill="none"
            strokeLinecap="round"
          />
        </>
      )}
      {/* Mug lip — top rim. */}
      <ellipse cx="15" cy="6" rx="9" ry="1.5" fill={MUG_BODY_COLOR} stroke={MUG_OUTLINE_COLOR} strokeWidth="0.9" />
      {/* Handle — curved D-shape on the chosen side. */}
      {showHandleOnRight ? (
        <path
          d="M 24 11 C 28 11, 28 21, 24 21"
          stroke={MUG_OUTLINE_COLOR}
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M 6 11 C 2 11, 2 21, 6 21"
          stroke={MUG_OUTLINE_COLOR}
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
      )}
      {/* Small base shadow line so the mug visually plants on the bench. */}
      <ellipse cx="15" cy="26.5" rx="8" ry="0.7" fill="rgba(15, 23, 42, 0.18)" />
    </svg>
  );
}

/** Single heart glyph used for both the heart-eye overlay and the
 *  drifting heart particles. */
function HeartGlyph({ size, opacity = 1 }: { size: number; opacity?: number }) {
  return (
    <svg
      viewBox="0 0 12 11"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      style={{ display: "block", opacity }}
    >
      <path
        d="M 6 10 C 6 10, 0.6 6.4, 0.6 3.4 A 2.6 2.6 0 0 1 6 2.6 A 2.6 2.6 0 0 1 11.4 3.4 C 11.4 6.4, 6 10, 6 10 Z"
        fill={HEART_COLOR}
        stroke={HEART_STROKE}
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function BeakerBotCoffeeRefillScene({
  active,
  onComplete,
  enterFrom = "left",
}: BeakerBotCoffeeRefillSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<CoffeeRefillStage>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);

  // Stash onComplete in a ref so the stage-driver effect doesn't
  // re-fire just because a parent passes a new inline-fn each render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Detect prefers-reduced-motion. Listen for live changes since the
  // scene runs for 5s and a mid-play toggle is uncommon but cheap.
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
  // share animation names. Same pattern as the other scenes.
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbcr-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );

  // Direction-driven offsets: BeakerBot enters from `enterFrom`, walks
  // to a center bench position, then exits the opposite side carrying
  // the mug.
  const direction = useMemo(() => {
    const fromLeft = enterFrom === "left";
    return {
      botStartX: fromLeft ? "-20vw" : "120vw",
      botBenchX: "50vw",
      botExitX: fromLeft ? "120vw" : "-20vw",
      // Mug sits on the bench ~28px to the side BeakerBot walks toward
      // (the exit side). When carried, the handle should face away from
      // his body — that's the entry side, so it points back the way he
      // came.
      mugOffsetPx: fromLeft ? 32 : -32,
      facing: (fromLeft ? "right" : "left") as "left" | "right",
      sideSign: fromLeft ? 1 : -1,
      handleOnRightDuringCarry: fromLeft, // mirror appropriately
    };
  }, [enterFrom]);

  if (!active || !isClient) return null;

  // ----- Stage-driven visual state -----

  // Mug position. During walkIn/pour/sipPrep it sits on the bench. From
  // sipPrep onward BeakerBot is holding it. From walkOff onward it
  // travels with him off-screen.
  const mugOnBench = stage === "walkIn" || stage === "pour";
  const mugHeldHigh =
    stage === "sipPrep" ||
    stage === "blow" ||
    stage === "sip" ||
    stage === "heartEyes" ||
    stage === "walkOff" ||
    (reducedMotion && stage === "done");

  // Coffee fill ratio in the mug, by stage.
  //   walkIn:     mostly empty (0.15) — there's a tiny dreg
  //   pour:       transitions from ~0.15 to ~0.85 (CSS transition)
  //   sipPrep:    holds at 0.85
  //   blow:       holds at 0.85
  //   sip:        dips to 0.7 (took a sip)
  //   heartEyes:  stays at 0.7
  //   walkOff:    stays at 0.7
  //   done (rm):  0.7
  let mugFillRatio = 0.15;
  switch (stage) {
    case "walkIn":
      mugFillRatio = 0.15;
      break;
    case "pour":
      mugFillRatio = 0.85;
      break;
    case "sipPrep":
    case "blow":
      mugFillRatio = 0.85;
      break;
    case "sip":
    case "heartEyes":
    case "walkOff":
      mugFillRatio = 0.7;
      break;
    case "done":
      mugFillRatio = reducedMotion ? 0.7 : 0.15;
      break;
    default:
      mugFillRatio = 0.15;
  }

  // Are the steam wisps visible? Always when there's coffee in the mug,
  // but most pronounced during blow stage (extra wisps + sideways drift).
  const steamVisible =
    stage === "pour" ||
    stage === "sipPrep" ||
    stage === "blow" ||
    stage === "sip" ||
    stage === "heartEyes" ||
    stage === "walkOff" ||
    (reducedMotion && stage === "done");
  const steamBlowing = stage === "blow";

  // Is the pouring stream visible? Only during pour.
  const pourStreamVisible = stage === "pour";

  // Heart-eye overlay + drifting hearts: only during heartEyes (and the
  // reduced-motion final tableau).
  const heartEyesActive =
    stage === "heartEyes" || (reducedMotion && stage === "done");
  const heartParticlesActive = stage === "heartEyes";

  // BeakerBot pose by stage:
  //   walkIn / walkOff / done: idle (walking)
  //   pour: pointing-down (he's tilting his beaker over the mug)
  //   sipPrep: idle (transitional)
  //   blow: thinking (cloud-thought thinking expression covers "blowing"
  //         beat reasonably — heads slightly tilted)
  //   sip: idle (mug to mouth)
  //   heartEyes: cheering (contented, hands forward holding mug)
  let pose: BeakerBotPose = "idle";
  switch (stage) {
    case "walkIn":
    case "walkOff":
      pose = "idle";
      break;
    case "pour":
      pose = "pointing-down";
      break;
    case "sipPrep":
      pose = "idle";
      break;
    case "blow":
      pose = "thinking";
      break;
    case "sip":
      pose = "idle";
      break;
    case "heartEyes":
      pose = "cheering";
      break;
    case "done":
      pose = "cheering";
      break;
    default:
      pose = "idle";
  }

  // BeakerBot horizontal position + small per-stage body adjustments.
  let botTranslateX: string;
  let botBobPx = 0;
  let botLeanDeg = 0;
  let botLeanTranslateY = 0;
  switch (stage) {
    case "walkIn":
      botTranslateX = direction.botStartX;
      break;
    case "pour":
      botTranslateX = direction.botBenchX;
      // Forward lean over the mug while pouring.
      botLeanDeg = 8 * direction.sideSign;
      botLeanTranslateY = 4;
      break;
    case "sipPrep":
      botTranslateX = direction.botBenchX;
      break;
    case "blow":
      botTranslateX = direction.botBenchX;
      // Slight head-down posture as he blows on the mug.
      botLeanTranslateY = 2;
      break;
    case "sip":
      botTranslateX = direction.botBenchX;
      // Backward lean for the sip — tilts mug to mouth.
      botLeanDeg = -6 * direction.sideSign;
      botLeanTranslateY = -2;
      break;
    case "heartEyes":
      botTranslateX = direction.botBenchX;
      botBobPx = -2;
      break;
    case "walkOff":
      botTranslateX = direction.botExitX;
      botBobPx = -1;
      break;
    case "done":
      botTranslateX = reducedMotion ? direction.botBenchX : direction.botExitX;
      break;
    default:
      botTranslateX = direction.botStartX;
  }

  // Transition timing per stage — slow on walkIn/walkOff, snappier on
  // the interaction beats.
  let transitionMs = 300;
  if (stage === "walkIn") transitionMs = STAGE_DURATIONS.walkIn;
  else if (stage === "walkOff") transitionMs = STAGE_DURATIONS.walkOff;
  else if (stage === "pour") transitionMs = STAGE_DURATIONS.pour;
  else if (stage === "heartEyes") transitionMs = STAGE_DURATIONS.heartEyes;

  // The mug-on-bench horizontal position. The mug sits at (bench + offset).
  // Computed as: "50vw + Xpx" via calc. We render the bench mug at
  // direction.botBenchX, offset by direction.mugOffsetPx.
  const benchMugTransform = `translate(calc(-50% + ${direction.mugOffsetPx * 2}px), 0)`;

  // The held-mug attaches to BeakerBot's body via the held-mug wrapper
  // below; it does not need its own absolute positioning at scene level.

  return createPortal(
    <div
      data-testid="beakerbot-coffee-refill-scene"
      data-stage={stage}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: SCENE_Z_INDEX,
        // overflow: visible — scene's own off-screen entry/exit
        // translations (120vw / -20vw) handle "stays out of view".
        overflow: "visible",
      }}
    >
      {/* Scoped keyframes for steam wisps, pour stream, heart drift, body sway. */}
      <style>{`
        @keyframes ${animSuffix}-steam-rise {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.6); }
          25%  { opacity: 0.7; transform: translate(0, -8px) scale(0.85); }
          70%  { opacity: 0.5; transform: translate(2px, -20px) scale(1); }
          100% { opacity: 0; transform: translate(4px, -32px) scale(1.15); }
        }
        @keyframes ${animSuffix}-steam-blow {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.6); }
          25%  { opacity: 0.85; transform: translate(8px, -4px) scale(0.9); }
          70%  { opacity: 0.6; transform: translate(22px, -10px) scale(1.05); }
          100% { opacity: 0; transform: translate(36px, -14px) scale(1.2); }
        }
        @keyframes ${animSuffix}-pour-stream {
          0%   { opacity: 0; transform: scaleY(0); }
          15%  { opacity: 1; transform: scaleY(1); }
          85%  { opacity: 1; transform: scaleY(1); }
          100% { opacity: 0; transform: scaleY(0.5); }
        }
        @keyframes ${animSuffix}-heart-drift {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.4); }
          20%  { opacity: 1; transform: translate(0, -8px) scale(1); }
          70%  { opacity: 0.9; transform: translate(var(--bbcr-heart-x), -32px) scale(1); }
          100% { opacity: 0; transform: translate(var(--bbcr-heart-x), -54px) scale(0.7); }
        }
        @keyframes ${animSuffix}-content-sway {
          0%,100% { transform: rotate(-1.5deg); }
          50%     { transform: rotate(1.5deg); }
        }
      `}</style>

      {/* MUG ON BENCH — only renders while it's sitting on the bench.
          Once BeakerBot picks it up (sipPrep onward), the mug renders
          attached to his hand instead. */}
      {mugOnBench && (
        <div
          data-testid="beakerbot-coffee-refill-scene-mug-bench"
          style={{
            position: "absolute",
            left: direction.botBenchX,
            bottom: SCENE_GROUND_BOTTOM_CSS,
            transform: benchMugTransform,
            // 2x scale (was 32x30 → 64x60).
            width: 64,
            height: 60,
          }}
        >
          {/* Steam rising from the mug while it sits. */}
          {steamVisible && !reducedMotion && (
            <SteamWisps animSuffix={animSuffix} blowing={false} />
          )}
          <MugGlyph
            className="w-16 h-[60px]"
            fillRatio={mugFillRatio}
            showHandleOnRight={direction.sideSign > 0}
          />
        </div>
      )}

      {/* POUR STREAM — a thin vertical pastel-brown rectangle between
          BeakerBot's tilted beaker and the mug rim. Animates scaleY in
          + out via the `pour-stream` keyframe so it reads as a falling
          stream rather than a static rod. Rendered at scene level so
          its position doesn't inherit BeakerBot's lean rotation. */}
      {pourStreamVisible && (
        <div
          data-testid="beakerbot-coffee-refill-scene-pour-stream"
          style={{
            position: "absolute",
            left: direction.botBenchX,
            bottom: `calc(${SCENE_GROUND_BOTTOM_VH}vh + 18px)`,
            // Stream lands ~at the mug center (which is offset
            // mugOffsetPx*2 from the bench center). Width is a thin
            // 4px column.
            transform: `translate(calc(-50% + ${direction.mugOffsetPx * 2}px), 0)`,
            width: 4,
            height: 40,
            background: COFFEE_COLOR,
            borderRadius: 2,
            transformOrigin: "top center",
            animation: `${animSuffix}-pour-stream ${STAGE_DURATIONS.pour}ms ease-in-out forwards`,
            opacity: 0,
          }}
        />
      )}

      {/* BEAKERBOT — fixed-size, translated horizontally per stage. */}
      <div
        data-testid="beakerbot-coffee-refill-scene-bot"
        style={{
          position: "absolute",
          left: 0,
          bottom: `calc(${SCENE_GROUND_BOTTOM_VH}vh - 4px)`,
          // 2x scale (was 64x64 → 128x128).
          width: 128,
          height: 128,
          transform: `translate(calc(${botTranslateX} - 64px), ${botBobPx}px)`,
          transition: `transform ${transitionMs}ms ${
            stage === "walkIn" || stage === "walkOff" ? "ease-in-out" : "ease-out"
          }`,
        }}
      >
        {/* Body-lean wrapper — pivots from the bottom so the pour tilt /
            sip back-lean read as "leaning over the bench" rather than
            "falling forward". */}
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `rotate(${botLeanDeg}deg) translateY(${botLeanTranslateY}px)`,
            transformOrigin: "center bottom",
            transition: `transform ${transitionMs}ms ease-out`,
            position: "relative",
          }}
        >
          {/* Contented body-sway loop during heartEyes. */}
          <div
            style={{
              width: "100%",
              height: "100%",
              animation:
                stage === "heartEyes"
                  ? `${animSuffix}-content-sway 600ms ease-in-out 2 alternate`
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

          {/* HEART-EYE OVERLAY — sits over BeakerBot's normal dot eyes
              during the heartEyes stage. The base BeakerBot SVG draws
              its eyes at roughly the upper third of the 128x128 wrapper;
              the hearts here are positioned to overlap them. INLINE to
              this scene only (not a new pose on the union). */}
          {heartEyesActive && (
            <div
              data-testid="beakerbot-coffee-refill-scene-heart-eyes"
              aria-hidden="true"
              style={{
                position: "absolute",
                // The eyes sit roughly horizontally centered at the
                // upper-middle of the body silhouette. Offsets tuned
                // empirically against the existing 128x128 BeakerBot.
                left: "50%",
                top: 44,
                transform: "translateX(-50%)",
                display: "flex",
                gap: 14,
                pointerEvents: "none",
              }}
            >
              {/* Left eye heart. */}
              <HeartGlyph size={14} />
              {/* Right eye heart. */}
              <HeartGlyph size={14} />
            </div>
          )}

          {/* HEART PARTICLES — drift upward from BeakerBot's chest during
              the heartEyes stage. Three hearts on staggered delays + a
              small left/right fan so they don't pile up in a single
              vertical column. */}
          {heartParticlesActive && (
            <div
              data-testid="beakerbot-coffee-refill-scene-heart-drift"
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "50%",
                top: 60,
                transform: "translateX(-50%)",
                pointerEvents: "none",
              }}
            >
              {[
                { x: -10, delay: 0, size: 10 },
                { x: 12, delay: 200, size: 12 },
                { x: -4, delay: 420, size: 9 },
                { x: 8, delay: 640, size: 11 },
              ].map((h, i) => (
                <div
                  key={i}
                  data-testid="beakerbot-coffee-refill-scene-heart-particle"
                  style={
                    {
                      position: "absolute",
                      left: 0,
                      top: 0,
                      ["--bbcr-heart-x" as string]: `${h.x}px`,
                      transform: "translate(0, 0) scale(0)",
                      opacity: 0,
                      animation: `${animSuffix}-heart-drift 1100ms ease-out ${h.delay}ms forwards`,
                    } as React.CSSProperties
                  }
                >
                  <HeartGlyph size={h.size} />
                </div>
              ))}
            </div>
          )}

          {/* HELD MUG — attached to BeakerBot's hand area from sipPrep
              onward. Positioned roughly where his arm extends in the
              `cheering` / `idle` poses; offsets are tuned to look like
              he's holding it. */}
          {mugHeldHigh && (
            <div
              data-testid="beakerbot-coffee-refill-scene-mug-held"
              style={{
                position: "absolute",
                // During sip, the mug rises closer to his mouth.
                bottom: stage === "sip" ? 80 : 56,
                left: "50%",
                transform: `translateX(-50%) ${
                  stage === "sip" ? `rotate(${-15 * direction.sideSign}deg)` : ""
                }`,
                transition: "transform 250ms ease-out, bottom 300ms ease-out",
                // 2x scale (was 32x30 → 56x52).
                width: 56,
                height: 52,
                pointerEvents: "none",
              }}
            >
              {/* Steam rising from the held mug. */}
              {steamVisible && !reducedMotion && (
                <SteamWisps animSuffix={animSuffix} blowing={steamBlowing} />
              )}
              <MugGlyph
                className="w-14 h-[52px]"
                fillRatio={mugFillRatio}
                showHandleOnRight={direction.handleOnRightDuringCarry}
              />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Three small steam wisps drifting up off the top of a mug. When
 *  `blowing` is true, the wisps drift sideways (BeakerBot blowing on
 *  it) instead of straight up. Rendered as thin curved SVG paths with
 *  per-wisp delays so the column reads as continuous wisps, not a
 *  single puff. */
function SteamWisps({
  animSuffix,
  blowing,
}: {
  animSuffix: string;
  blowing: boolean;
}) {
  const animName = blowing ? `${animSuffix}-steam-blow` : `${animSuffix}-steam-rise`;
  return (
    <div
      data-testid="beakerbot-coffee-refill-scene-steam"
      aria-hidden="true"
      style={{
        position: "absolute",
        // Wisps emerge from above the mug rim. The mug glyph spans
        // bottom 60-86% of the wrapper height (depending on which mug,
        // carried vs bench); -10px puts the wisp origin at the rim.
        left: "50%",
        top: -10,
        transform: "translateX(-50%)",
        width: 24,
        height: 32,
        pointerEvents: "none",
      }}
    >
      {[
        { left: -4, delay: 0 },
        { left: 2, delay: 250 },
        { left: 8, delay: 500 },
      ].map((w, i) => (
        <svg
          key={i}
          width="10"
          height="20"
          viewBox="0 0 10 20"
          fill="none"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: w.left + 6,
            top: 0,
            opacity: 0,
            animation: `${animName} 1200ms ease-out ${w.delay}ms infinite`,
          }}
        >
          <path
            d="M 5 18 C 3 14, 7 12, 5 8 C 3 4, 7 2, 5 0"
            stroke="rgba(148, 163, 184, 0.7)"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      ))}
    </div>
  );
}
