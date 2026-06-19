"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";
import BeakerBotSpeechBubble from "./beakerbot/SpeechBubble";
import BurstParticles, {
  type BurstParticlePosition,
} from "./beakerbot/BurstParticles";
import {
  BEAKERBOT_SCENE_SIZE_PX,
  SCENE_GROUND_BOTTOM_CSS,
} from "./beakerbot/scene-constants";

/** Scene-local BeakerBot size. Previously this scene rendered the bot
 *  small (0.625 * canonical = 80px) because the sample tubes shot
 *  STRAIGHT UP very high, forcing a tall-and-narrow action footprint
 *  that wasted the wide showcase stage. Now that the tubes scatter in a
 *  WIDE FAN with a much lower peak (see buildTubeTrajectory), the bot is
 *  no longer fighting a tall column, so he comes up to full canonical
 *  size (128px) and reads as a prominent performer.
 *
 *  Every prop coordinate that used to be hand-calibrated against the
 *  old 80px bot (the centrifuge rest height, the tube launch anchor,
 *  the speech-bubble height) is derived from BOT_SIZE_PX via the scale
 *  factor below, so they stay proportional and keep landing on the
 *  bot's hands / disc / above his head. */
const BOT_SIZE_PX = BEAKERBOT_SCENE_SIZE_PX;
/** Ratio of the new bot size to the original 80px calibration. Used to
 *  rescale the prop anchors that were tuned against 80px so they track
 *  the bigger bot instead of snapping to the wrong height. */
const PROP_SCALE = BOT_SIZE_PX / 80;
/** Centrifuge rests on the bot's hands. Calibrated at 60px for the old
 *  80px bot; scaled with the bot so it still meets the hands. */
const CENTRIFUGE_HANDS_BOTTOM_PX = Math.round(60 * PROP_SCALE);
/** Tube launch anchor (centrifuge disc center) above the ground line.
 *  Calibrated at 125px for the old bot; scaled to track the disc. */
const TUBE_LAUNCH_BOTTOM_PX = Math.round(125 * PROP_SCALE);
/** Speech-bubble height above the bot. Calibrated at 95px; scaled so
 *  the bubble clears the now-taller bot's head. */
const BUBBLE_BOTTOM_PX = Math.round(95 * PROP_SCALE);
/** Rendered centrifuge glyph size. Calibrated at 68px against the old
 *  80px bot; scaled with the bot so the prop he holds stays in the same
 *  visual proportion (it should not shrink relative to the bigger bot). */
const CENTRIFUGE_GLYPH_PX = Math.round(68 * PROP_SCALE);

/**
 * Side easter-egg slapstick scene: BeakerBot walks in carrying a small
 * centrifuge, sets it on the bench, starts it spinning. It ramps up
 * smoothly, then immediately gets the wobbles, then violently shakes
 * and jumps on the bench. The lid pops off, sample tubes scatter out
 * in a WIDE FAN (left, right, up-left, up-right, shallow-sideways, only
 * one going high) on independent gravity trajectories rather than a
 * single tall column, liquid splatters everywhere.
 * BeakerBot freezes wide-eyed ("!"), then does a sheepish shrug
 * (sweat-bead) and slinks off the other side. Dented centrifuge stays.
 *
 * Same skeleton + portal/z-index/pointer-events conventions as
 * BeakerBotTooManyBeakersScene and BeakerBotBugStompScene. Multi-stage
 * state machine driven by chained setTimeouts, smooth tweening between
 * stage transforms via CSS transitions. Falling sample tubes reuse the
 * --bb-fall-x / --bb-fall-y / --bb-fall-rot custom-property pattern
 * from the beaker scene so a single @keyframes block covers all four.
 *
 * Stage timeline (defaults total = 5800ms):
 *   1. Walk-in           — 700ms — BeakerBot enters carrying centrifuge
 *   2. Set down          — 400ms — centrifuge placed on bench
 *   3. Start spinning    — 600ms — disc ramps up; smooth spin
 *   4. Out of control    — 1200ms — violent shake, disc accelerates,
 *                                    BeakerBot's eyes widen
 *   5. Explosion         — 500ms — lid pops, tubes fly, liquid splats
 *   6. Reaction          — 600ms — frozen surprised "!" speech bubble
 *   7. Sheepish shrug    — 800ms — sigh + sweat bead, "..."
 *   8. Exit              — 1000ms — walks off the OPPOSITE side
 *
 * Mounted via React portal at `document.body`, position: fixed,
 * z-index 800 (above app shell, below modals).
 *
 * UNIVERSAL SCENE RULE: NO animation is ever limit-bound by a
 * container box. The outer wrapper is `position: fixed; inset: 0;
 * overflow: visible;` so every child has full viewport access.
 * Composition comes from animation keyframes + viewport-relative
 * anchors (vw/vh + translate-50%), NOT from container clipping.
 * Internal wrappers carry zero size (just anchor points) so SVGs +
 * trajectories burst out freely — no implicit bounding square.
 *
 * Reduced-motion fallback: prefers-reduced-motion: reduce skips the
 * full sequence and renders a static aftermath tableau (sheepish
 * BeakerBot next to tilted centrifuge with tubes scattered around)
 * for 2000ms before firing onComplete.
 *
 * Component-only — no trigger logic. Parent decides when to mount
 * (random easter-egg roll, dev button, achievement unlock, etc.).
 */

export interface BeakerBotCentrifugeSceneProps {
  /** When false, the scene is not rendered at all (parent unmounts).
   *  When toggled from false to true, the animation restarts. */
  active: boolean;
  /** Fired once the scene finishes (whether full or reduced-motion).
   *  Parent typically uses this to unmount via `setActive(false)`. */
  onComplete?: () => void;
  /** Side from which BeakerBot enters carrying the centrifuge. He exits
   *  off the OPPOSITE side. Default "left". */
  enterFrom?: "left" | "right";
  /** Where the scene's full-screen portal mounts. Defaults to
   *  document.body (the global easter-egg behavior, unchanged). The
   *  showcase Scenes view passes its scaled in-frame viewport so the
   *  scene plays inside the fixed window. When explicitly null the scene
   *  renders nothing (the target is not live yet). */
  portalTarget?: HTMLElement | null;
}

/** Pastel sample-tube palette — four distinct colors so the tubes
 *  read as separate items mid-flight, not a single colored blob. */
const TUBE_COLORS = ["#FFD2B0", "#B7EBB1", "#A6D2F4", "#D6B5F0"] as const;

/** Stage durations in ms. Exported for tests + parent timing math. */
export const STAGE_DURATIONS = {
  walkIn: 700,
  setDown: 400,
  startSpinning: 600,
  outOfControl: 1200,
  explosion: 500,
  reaction: 600,
  sheepishShrug: 800,
  exit: 1000,
} as const;

export const TOTAL_DURATION_MS =
  STAGE_DURATIONS.walkIn +
  STAGE_DURATIONS.setDown +
  STAGE_DURATIONS.startSpinning +
  STAGE_DURATIONS.outOfControl +
  STAGE_DURATIONS.explosion +
  STAGE_DURATIONS.reaction +
  STAGE_DURATIONS.sheepishShrug +
  STAGE_DURATIONS.exit;

/** Reduced-motion aftermath dwell time before onComplete fires. */
export const REDUCED_MOTION_DURATION_MS = 2000;

/** Discrete stages the state machine cycles through. */
export type SceneStage =
  | "idle"
  | "walkIn"
  | "setDown"
  | "startSpinning"
  | "outOfControl"
  | "explosion"
  | "reaction"
  | "sheepishShrug"
  | "exit"
  | "done";

/** Order of stages driven by the timer chain. Exported so tests can
 *  walk through it without re-deriving the sequence. */
export const STAGE_ORDER: readonly SceneStage[] = [
  "walkIn",
  "setDown",
  "startSpinning",
  "outOfControl",
  "explosion",
  "reaction",
  "sheepishShrug",
  "exit",
] as const;

/** Read prefers-reduced-motion once at mount. SSR safe. */
function readsPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Per-tube launch direction template. The tubes scatter OUTWARD from
 *  the spinning centrifuge in a WIDE FAN: a deliberate mix of left,
 *  right, up-left, up-right and shallow-sideways throws, with only one
 *  or two going high. This trades the old tall-and-narrow column (every
 *  tube shot straight up ~55vh) for a wide-and-short footprint that
 *  fills the 16:10 showcase stage horizontally, freeing the vertical
 *  room that was forcing BeakerBot to render small.
 *
 *  Each entry is hand-authored per launch slot:
 *    dirVw   — horizontal launch bias in vw (negative = left). The fan
 *              reaches farther sideways (+/- ~34vw) than it does up.
 *    peakVh  — apex height of the arc in vh. Most are shallow (10-22vh);
 *              one slot goes higher (~30vh) so the burst still has a
 *              lively pop, but nothing approaches the old ~55vh column.
 *  Authored for TUBE_COLORS.length (4) slots; buildTubeTrajectory wraps
 *  the index so adding a color degrades gracefully. */
const TUBE_FAN: ReadonlyArray<{ dirVw: number; peakVh: number }> = [
  { dirVw: -34, peakVh: 12 }, // far left, shallow skim
  { dirVw: -12, peakVh: 30 }, // up-left, the one that pops highest
  { dirVw: 16, peakVh: 18 }, // up-right, medium arc
  { dirVw: 33, peakVh: 10 }, // far right, shallow skim
] as const;

/** Per-tube fall trajectory. Each tube launches outward in its fan
 *  direction, arcs over a LOW peak, then falls and tumbles. Deterministic
 *  per-index so tests + SSR stay stable (no Math.random).
 *  All distances are VIEWPORT-RELATIVE so the burst is never clipped
 *  by a parent container — the trajectory genuinely uses the full
 *  width of the screen. */
function buildTubeTrajectory(index: number, count: number) {
  const seed = (index * 7919 + 104729) % 233280;
  const r1 = seed / 233280;
  const r2 = ((seed * 11) % 233280) / 233280;
  const r3 = ((seed * 17) % 233280) / 233280;

  // Pull the authored fan slot for this tube (wrap so extra colors
  // still get a direction). A touch of per-tube jitter keeps the fan
  // from looking mechanically symmetric.
  const slot = TUBE_FAN[index % TUBE_FAN.length];
  // Horizontal launch: the authored fan direction plus a small jitter.
  // This is what spreads the action across the WIDE stage instead of
  // stacking every tube into one vertical column.
  const horizontalVw = slot.dirVw + (r1 - 0.5) * 6;
  // Rotation: alternating direction, magnitude jitter so they tumble
  // chaotically not in lockstep.
  const rotateTo = (index % 2 === 0 ? 1 : -1) * (220 + r2 * 320);
  // Stagger start delay slightly so they don't fire in perfect sync.
  const delayMs = index * 25 + r3 * 40;
  // Vertical drop target after the arc — viewport-scale so the tubes
  // still travel down to the floor and out of frame.
  const fallYVh = 34 + r3 * 10; // vh below origin
  // Per-tube peak height during the arc: the authored LOW apex plus a
  // little jitter. Far shorter than the old ~55vh so the burst spreads
  // wide rather than tall, and the bigger BeakerBot has room overhead.
  const peakYVh = slot.peakVh + r2 * 6; // vh upward
  return { horizontalVw, rotateTo, delayMs, fallYVh, peakYVh };
}

export default function BeakerBotCentrifugeScene({
  active,
  onComplete,
  enterFrom = "left",
  portalTarget,
}: BeakerBotCentrifugeSceneProps) {
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<SceneStage>("idle");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  // onComplete pinned to a ref so the stage-driver effect doesn't
  // re-fire on every parent re-render that passes a new inline fn.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Portal mount + reduced-motion detection (one-shot client gate).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot SSR to client portal gate + prefers-reduced-motion read, same pattern as BeakerBotTooManyBeakersScene
    setMounted(true);
    setPrefersReducedMotion(readsPrefersReducedMotion());
  }, []);

  // Stage driver: chains setTimeouts through STAGE_ORDER, then fires
  // onComplete. Reduced-motion mode shortcuts to the static tableau.
  useEffect(() => {
    if (!active || !mounted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset stage when scene deactivates so a re-activation restarts from "walkIn"
      setStage("idle");
      return;
    }

    if (prefersReducedMotion) {
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
  }, [active, mounted, prefersReducedMotion]);

  // Memoize tube trajectories so a re-render mid-explosion doesn't
  // recompute (and the falling animation doesn't restart).
  const tubes = useMemo(
    () =>
      TUBE_COLORS.map((color, i) => ({
        color,
        ...buildTubeTrajectory(i, TUBE_COLORS.length),
      })),
    [],
  );

  // Default (prop omitted) keeps the global behavior: portal to body.
  // An explicit null means "target not live yet" so we render nothing.
  const portalRoot =
    typeof document === "undefined"
      ? null
      : portalTarget === undefined
        ? document.body
        : portalTarget;
  if (!active || !mounted || !portalRoot) {
    return null;
  }

  // ---------- Visual transforms per stage ----------

  // Sign convention: enterFrom "left" means BeakerBot starts at -25vw
  // and exits to +60vw; "right" mirrors that.
  const sideSign = enterFrom === "left" ? 1 : -1;
  const offscreenStartVw = -25 * sideSign;
  const benchPosVw = -2 * sideSign; // settled at bench, slightly off-center
  const offscreenExitVw = 60 * -sideSign; // exit OPPOSITE side

  let bodyTranslateXVw: number;
  let bodyTranslateYPx = 0;
  const bodyRotateDeg = 0;
  let bodyShakeAmp = 0; // when non-zero, body wobbles
  let centrifugeTranslateYPx = 22; // baked-in bench rest position
  let centrifugeRotateDeg = 0; // tilt for visual variety
  let centrifugeShakeAmp = 0;
  let discSpinSpeedSec = 0; // animation duration; 0 = stopped
  let lidPopped = false;
  let tubesFlying = false;
  let panelLit = false;
  let eyeWiden = false;
  const beakerVisible = true;
  const centrifugeVisible = true;
  let centrifugeDented = false;
  let showAlarmBubble = false; // "!"
  let showShrugBubble = false; // "..." sweat bead

  switch (stage) {
    case "walkIn":
      // End position of the walk-in: at bench. The body wrapper
      // RENDERS at bench from frame one, but a CSS keyframe animation
      // (`bb-centrifuge-walkin`) slides him in from offscreen during
      // this stage. This avoids the React-transition pitfall where the
      // initial paint shows the END position because the previous
      // value never existed.
      bodyTranslateXVw = benchPosVw;
      bodyTranslateYPx = -2;
      centrifugeTranslateYPx = -10; // held above bench while walking
      break;
    case "setDown":
      bodyTranslateXVw = benchPosVw;
      centrifugeTranslateYPx = 22; // dropped onto bench surface
      break;
    case "startSpinning":
      bodyTranslateXVw = benchPosVw;
      centrifugeTranslateYPx = 22;
      discSpinSpeedSec = 0.7; // moderate spin
      panelLit = true;
      break;
    case "outOfControl":
      bodyTranslateXVw = benchPosVw;
      centrifugeTranslateYPx = 22;
      discSpinSpeedSec = 0.18; // much faster
      centrifugeShakeAmp = 4;
      bodyShakeAmp = 1.5;
      panelLit = true;
      eyeWiden = true;
      break;
    case "explosion":
      bodyTranslateXVw = benchPosVw + 0.5 * sideSign;
      centrifugeTranslateYPx = 22;
      discSpinSpeedSec = 0.12;
      centrifugeShakeAmp = 5;
      bodyShakeAmp = 2;
      lidPopped = true;
      tubesFlying = true;
      panelLit = true;
      eyeWiden = true;
      break;
    case "reaction":
      bodyTranslateXVw = benchPosVw + 0.5 * sideSign;
      centrifugeTranslateYPx = 24; // settles slightly lower (dented)
      centrifugeRotateDeg = -4 * sideSign;
      discSpinSpeedSec = 0; // wobbled to a stop
      tubesFlying = true; // tubes still on the floor
      eyeWiden = true;
      showAlarmBubble = true;
      centrifugeDented = true;
      break;
    case "sheepishShrug":
      bodyTranslateXVw = benchPosVw + 1 * sideSign;
      centrifugeTranslateYPx = 24;
      centrifugeRotateDeg = -4 * sideSign;
      tubesFlying = true;
      showShrugBubble = true;
      centrifugeDented = true;
      break;
    case "exit":
      bodyTranslateXVw = offscreenExitVw;
      bodyTranslateYPx = -1;
      centrifugeTranslateYPx = 24;
      centrifugeRotateDeg = -4 * sideSign;
      tubesFlying = true;
      centrifugeDented = true;
      break;
    case "done":
    case "idle":
    default:
      // Reduced-motion aftermath: bench-side sheepish frame with
      // tilted dented centrifuge and scattered tubes.
      bodyTranslateXVw = prefersReducedMotion ? benchPosVw + 1 * sideSign : offscreenStartVw;
      centrifugeTranslateYPx = 24;
      centrifugeRotateDeg = prefersReducedMotion ? -8 * sideSign : 0;
      centrifugeDented = prefersReducedMotion;
      break;
  }

  // Pose by stage (Scene polish B swap from the original
  // "thinking + pointing-up" stand-ins):
  //   - walk-in: idle (just walking the centrifuge in)
  //   - set-down + start: pointing-down (looking at the bench)
  //   - outOfControl + explosion: panicked (wide eyes + Y-shape arms,
  //     the original "thinking" pose read as calm head-tilt — wrong
  //     tone for "centrifuge is about to detonate")
  //   - reaction: embarrassed (post-explosion sheepish "whoops" — the
  //     pre-polish "thinking" also missed; embarrassed pairs better
  //     with the persistent alarm-bubble + dented centrifuge)
  //   - sheepishShrug: embarrassed (the dropped-eyes neck-rub matches
  //     the "..." beat better than pointing-up did)
  //   - exit: idle (slinking off; the translateX motion + body sway
  //     carry the dejected read)
  let pose: "idle" | "pointing-down" | "panicked" | "embarrassed" = "idle";
  switch (stage) {
    case "setDown":
    case "startSpinning":
      pose = "pointing-down";
      break;
    case "outOfControl":
    case "explosion":
      pose = "panicked";
      break;
    case "reaction":
    case "sheepishShrug":
      pose = "embarrassed";
      break;
    default:
      pose = "idle";
  }

  // CSS transition timing for the inter-stage tween. Long for walkIn
  // (matches the keyframe duration so position-only changes between
  // stages still ease) and exit, medium for setDown, snappy elsewhere.
  // This is what makes mid-sequence boundaries (e.g. explosion ->
  // reaction body shift) read as smooth, not snappy.
  const bodyTransitionMs =
    stage === "exit"
      ? STAGE_DURATIONS.exit
      : stage === "setDown"
        ? STAGE_DURATIONS.setDown
        : 320;
  const centrifugeTransitionMs =
    stage === "setDown"
      ? STAGE_DURATIONS.setDown
      : 320;

  const isAftermath = prefersReducedMotion && stage === "done";

  // During walkIn we drive entry via a one-shot keyframe so the
  // initial paint can show offscreen-then-slide-in without depending
  // on React reconciling two consecutive transform states. The
  // keyframe ends at translate(0,0) so it composes with the wrapper's
  // own transform (bench position).
  const bodyWalkInAnimation =
    stage === "walkIn"
      ? `bb-centrifuge-walkin-${enterFrom} ${STAGE_DURATIONS.walkIn}ms ease-out both`
      : undefined;

  return createPortal(
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 800, overflow: "visible" }}
      data-testid="beakerbot-centrifuge-scene"
      data-stage={stage}
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
      aria-hidden="true"
    >
      {/* BeakerBot + held centrifuge wrapper — anchored bottom-center
          of the VIEWPORT (not a parent box). Carries only the
          inter-stage position transform; the shake animation lives on
          a NESTED inner wrapper so the keyframes don't overwrite the
          position. */}
      <div
        className="absolute"
        style={{
          left: "50%",
          bottom: SCENE_GROUND_BOTTOM_CSS,
          // Zero-size anchor point — children burst out via their own
          // absolute positioning. No bounding box clipping anything.
          width: 0,
          height: 0,
          overflow: "visible",
          transform: `translateX(calc(-50% + ${bodyTranslateXVw}vw)) translateY(${bodyTranslateYPx}px) rotate(${bodyRotateDeg}deg)`,
          transformOrigin: "center bottom",
          transition: `transform ${bodyTransitionMs}ms ease-in-out`,
          animation: bodyWalkInAnimation,
        }}
        data-testid="beakerbot-body"
      >
        {/* Inner shake layer — only this element runs the jitter
            keyframes, so the parent's position transform survives
            unscathed. */}
        <div
          className="absolute"
          style={{
            // Re-center over the wrapper's zero-size anchor point.
            left: "50%",
            bottom: 0,
            transform: "translateX(-50%)",
            overflow: "visible",
            animation:
              bodyShakeAmp > 0
                ? `bb-centrifuge-shake ${bodyShakeAmp > 1.5 ? "70ms" : "100ms"} ease-in-out infinite`
                : undefined,
          }}
          data-testid="beakerbot-shake-layer"
        >
          {/* Centrifuge — rendered ABOVE BeakerBot's hands during
              walk-in (negative Y), then settles onto the bench at
              +22px from setDown onward. */}
          {centrifugeVisible && (
            <div
              className="absolute left-1/2"
              style={{
                bottom: `${CENTRIFUGE_HANDS_BOTTOM_PX}px`, // sit on top of BeakerBot's hands / bench surface relative to body (scales with BOT_SIZE_PX)
                transform: `translateX(-50%) translateY(${centrifugeTranslateYPx}px) rotate(${centrifugeRotateDeg}deg)`,
                transformOrigin: "center bottom",
                transition: `transform ${centrifugeTransitionMs}ms ease-out`,
                overflow: "visible",
                willChange: "transform",
              }}
              data-testid="centrifuge"
            >
              {/* Centrifuge shake layer — same nesting trick so jump
                  keyframe doesn't wipe the position transform above. */}
              <div
                style={{
                  overflow: "visible",
                  animation:
                    centrifugeShakeAmp > 0
                      ? `bb-centrifuge-jump ${centrifugeShakeAmp > 4.5 ? "60ms" : "90ms"} ease-in-out infinite`
                      : undefined,
                }}
              >
                <CentrifugeGlyph
                  sizePx={CENTRIFUGE_GLYPH_PX}
                  discSpinSpeedSec={discSpinSpeedSec}
                  lidPopped={lidPopped}
                  panelLit={panelLit}
                  dented={centrifugeDented}
                />
              </div>
            </div>
          )}

          {/* BeakerBot himself — uses the scene-local BOT_SIZE_PX
              (see top-of-file comment for the override rationale). */}
          {beakerVisible && (
            <div
              className="absolute left-1/2"
              style={{
                bottom: 0,
                transform: `translateX(-50%)`,
                width: `${BOT_SIZE_PX}px`,
                height: `${BOT_SIZE_PX}px`,
                overflow: "visible",
                transition: "transform 220ms ease-out",
              }}
            >
              <BeakerBot
                pose={pose}
                // Fills the BOT_SIZE_PX wrapper above.
                className="w-full h-full text-sky-500"
                ariaLabel="BeakerBot operating a centrifuge"
              />
              {/* Eye-widen overlay — same trick as BugStompScene: a
                  stacked BeakerBot at slightly larger scale, semi-
                  transparent, only visible during the "uh oh" stages. */}
              {eyeWiden && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    transform: "scale(1.08)",
                    transformOrigin: "center 30%",
                    opacity: 0.55,
                    transition: "opacity 200ms ease-out",
                  }}
                  data-testid="eye-widen-overlay"
                >
                  <BeakerBot
                    pose={pose}
                    // Fills the parent overlay (inset:0), so this
                    // tracks the BOT_SIZE_PX wrapper above.
                    className="w-full h-full text-sky-500"
                    ariaLabel=""
                  />
                </div>
              )}
            </div>
          )}

          {/* Alarm "!" bubble — fires during the reaction stage. Now
              uses the shared SpeechBubble primitive (alarm tone = red
              border, red text). */}
          {showAlarmBubble && (
            <BeakerBotSpeechBubble
              data-testid="alarm-bubble"
              tone="alarm"
              direction="down"
              position={{ bottom: BUBBLE_BOTTOM_PX, left: "50%" }}
              style={{
                transform: "translateX(-50%)",
                animation: "bb-centrifuge-bubble 500ms ease-out",
                fontSize: 18,
              }}
            >
              !
            </BeakerBotSpeechBubble>
          )}

          {/* Shrug bubble + sweat bead — fires during sheepish shrug.
              Sweat tone (sky border) + the optional sweat-bead overlay
              from the SpeechBubble primitive. */}
          {showShrugBubble && (
            <BeakerBotSpeechBubble
              data-testid="shrug-bubble"
              tone="sweat"
              direction="down"
              withSweatBead
              position={{ bottom: BUBBLE_BOTTOM_PX, left: "50%" }}
              style={{
                transform: "translateX(-50%)",
                animation: "bb-centrifuge-bubble 600ms ease-out",
              }}
            >
              ...
            </BeakerBotSpeechBubble>
          )}
        </div>
      </div>

      {/* Flying sample tubes — anchored to the centrifuge disc
          position in the viewport so they LAUNCH from the disc, not
          from the floor. Zero-size anchor + viewport-relative
          trajectories = no bounding-box artifacts. */}
      {tubesFlying && !isAftermath && (
        <div
          className="absolute"
          style={{
            left: "50%",
            // Anchor near the centrifuge disc: bench bottom + body
            // wrapper offset to reach the disc center. Scales with
            // BOT_SIZE_PX so the launch point tracks the bigger bot's
            // raised centrifuge.
            bottom: `calc(${SCENE_GROUND_BOTTOM_CSS} + ${TUBE_LAUNCH_BOTTOM_PX}px)`,
            width: 0,
            height: 0,
            overflow: "visible",
            transform: `translateX(calc(-50% + ${benchPosVw}vw))`,
          }}
          data-testid="flying-tubes"
        >
          {tubes.map((t, i) => (
            <FlyingTube
              key={i}
              index={i}
              color={t.color}
              horizontalVw={t.horizontalVw}
              rotateToDeg={t.rotateTo}
              delayMs={t.delayMs}
              fallYVh={t.fallYVh}
              peakYVh={t.peakYVh}
            />
          ))}
          {/* Liquid splatter sparkles on the floor — tiny colored
              droplets scattered around where the tubes land. */}
          <SplatterField tubes={tubes} />
        </div>
      )}

      {/* Reduced-motion aftermath: sheepish BeakerBot + tilted dented
          centrifuge + scattered tubes around bench. */}
      {isAftermath && (
        <div
          className="absolute"
          style={{
            left: "50%",
            bottom: SCENE_GROUND_BOTTOM_CSS,
            transform: `translateX(calc(-50% + ${benchPosVw}vw))`,
            display: "flex",
            gap: "16px",
            alignItems: "flex-end",
            overflow: "visible",
          }}
          data-testid="aftermath-scattered"
        >
          {tubes.map((t, i) => (
            <div
              key={i}
              style={{
                transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (50 + i * 10)}deg)`,
                transformOrigin: "bottom center",
                opacity: 0.85,
              }}
            >
              <TubeGlyph color={t.color} />
            </div>
          ))}
        </div>
      )}

      {/* Scoped keyframes — colocated to keep the component self-
          contained (no Tailwind config edits).
          UNIVERSAL SCENE RULE (repeated for emphasis): every animation
          here uses viewport-relative units (vw/vh) so trajectories
          burst across the full screen. No `overflow: hidden` lives on
          any wrapper in this scene. */}
      <style>{`
        @keyframes bb-centrifuge-disc-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes bb-centrifuge-shake {
          0%, 100% { transform: translateX(-50%) translate(0, 0); }
          25%      { transform: translateX(-50%) translate(1px, -1px); }
          50%      { transform: translateX(-50%) translate(-1px, 1px); }
          75%      { transform: translateX(-50%) translate(1px, 1px); }
        }
        @keyframes bb-centrifuge-jump {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          25%      { transform: translate(1px, -4px) rotate(-2deg); }
          50%      { transform: translate(-1px, 0) rotate(2deg); }
          75%      { transform: translate(1px, -3px) rotate(-1deg); }
        }
        @keyframes bb-centrifuge-bubble {
          0%   { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.85); }
          30%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.1); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        /* Walk-in keyframes: slide from offscreen to translate(0,0)
           composed with the wrapper's bench-position transform.
           Direction matches enterFrom so the body actually walks IN
           rather than popping into place. */
        @keyframes bb-centrifuge-walkin-left {
          0%   { transform: translateX(calc(-50% - 23vw)) translateY(-2px) rotate(0deg); }
          100% { transform: translateX(calc(-50% - 2vw)) translateY(-2px) rotate(0deg); }
        }
        @keyframes bb-centrifuge-walkin-right {
          0%   { transform: translateX(calc(-50% + 23vw)) translateY(-2px) rotate(0deg); }
          100% { transform: translateX(calc(-50% + 2vw)) translateY(-2px) rotate(0deg); }
        }
        /* Tube flight — viewport-scale WIDE-FAN trajectory. Each tube
           launches outward in its authored fan direction (var(--bb-fall-x),
           up to ~+/-34vw), arcs over a LOW peak (-var(--bb-peak-y), now
           only ~10-30vh instead of the old ~55vh column), then keeps
           travelling sideways as it falls to +var(--bb-fall-y) (~34vh
           below origin) by 85% and fades. The tube is already ~70% of
           the way out horizontally at the peak so the sideways scatter
           reads immediately. Uses vw/vh so the burst covers the full
           width of the screen, no parent bounding box. */
        @keyframes bb-centrifuge-tube-fly {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 1;
          }
          30% {
            transform: translate(calc(var(--bb-fall-x, 0vw) * 0.7), calc(var(--bb-peak-y, 20vh) * -1))
              rotate(calc(var(--bb-fall-rot, 360deg) * 0.4));
            opacity: 1;
          }
          85% {
            transform: translate(var(--bb-fall-x, 0vw), var(--bb-fall-y, 34vh))
              rotate(var(--bb-fall-rot, 360deg));
            opacity: 1;
          }
          100% {
            transform: translate(var(--bb-fall-x, 0vw), var(--bb-fall-y, 34vh))
              rotate(var(--bb-fall-rot, 360deg)) scale(0.7);
            opacity: 0;
          }
        }
        /* Lid fly-off — pops upward briefly, then accelerates left
           off-screen with continuous rotation at ~30°/sec (1400ms
           total → ~42° rotation, but we let the lid keep spinning by
           giving it 540° across the trajectory so the motion reads as
           "tumbling away" rather than "tilting"). The y trajectory
           arcs up then falls back down past the bench as gravity
           catches up. */
        @keyframes bb-centrifuge-lid-fly {
          0%   { transform: translate(0, 0) rotate(0deg); }
          15%  { transform: translate(-4px, -22px) rotate(-40deg); }
          50%  { transform: translate(-60px, -32px) rotate(-220deg); }
          100% { transform: translate(-220px, 60px) rotate(-540deg); }
        }
      `}</style>
    </div>,
    portalRoot,
  );
}

// --------------------------------------------------------------------
// Subcomponents
// --------------------------------------------------------------------

interface CentrifugeGlyphProps {
  /** Rendered px size of the (square) glyph. Defaults to the original
   *  68px calibration; the scene passes a bot-scaled value so the prop
   *  stays proportional to the bigger BeakerBot. */
  sizePx?: number;
  discSpinSpeedSec: number;
  lidPopped: boolean;
  panelLit: boolean;
  dented: boolean;
}

/** Centrifuge SVG: gray/silver base (50x35 rect), rounded lid (40x10
 *  ellipse on top), inner disc (24x24 with 4 tube-slot dots at 0/90/
 *  180/270 degrees), control panel band with 2 dots that "light up"
 *  when running. Lid pops upward when `lidPopped`. The viewBox is fixed
 *  (0 0 60 60) so the whole glyph scales uniformly with `sizePx`. */
function CentrifugeGlyph({
  sizePx = 68,
  discSpinSpeedSec,
  lidPopped,
  panelLit,
  dented,
}: CentrifugeGlyphProps) {
  return (
    <svg
      viewBox="0 0 60 60"
      width={sizePx}
      height={sizePx}
      fill="none"
      aria-hidden="true"
      data-testid="centrifuge-svg"
      style={{ overflow: "visible" }}
    >
      {/* Base body (50x35 rect, rounded corners) */}
      <rect
        x="5"
        y="20"
        width="50"
        height="35"
        rx="4"
        ry="4"
        fill="#CBD5E1"
        stroke="#475569"
        strokeWidth="1.2"
      />
      {/* Bench shadow stripe under the centrifuge */}
      <ellipse cx="30" cy="55" rx="26" ry="2" fill="#1e293b" opacity="0.18" />
      {/* Inner disc well (recessed darker area) */}
      <ellipse cx="30" cy="32" rx="13" ry="13" fill="#94A3B8" stroke="#475569" strokeWidth="0.8" />
      {/* Spinning disc — group rotates via CSS animation when speed > 0. */}
      <g
        style={{
          transformOrigin: "30px 32px",
          animation:
            discSpinSpeedSec > 0
              ? `bb-centrifuge-disc-spin ${discSpinSpeedSec}s linear infinite`
              : undefined,
        }}
        data-testid="centrifuge-disc"
      >
        {/* Inner disc circle */}
        <circle cx="30" cy="32" r="11" fill="#E2E8F0" stroke="#475569" strokeWidth="0.8" />
        {/* 4 tube-slot dots at 0/90/180/270 — visual cue the disc is
            actually spinning even at moderate speeds. */}
        <circle cx="30" cy="23" r="2" fill="#475569" />
        <circle cx="39" cy="32" r="2" fill="#475569" />
        <circle cx="30" cy="41" r="2" fill="#475569" />
        <circle cx="21" cy="32" r="2" fill="#475569" />
        {/* Spoke marker so the rotation reads even when blurred. */}
        <line x1="30" y1="32" x2="30" y2="22" stroke="#0F172A" strokeWidth="1" />
      </g>
      {/* Control panel band — 2 dots that light up red/green when
          running. Dim gray when stopped. */}
      <rect x="9" y="44" width="42" height="7" rx="1.5" fill="#1e293b" />
      <circle cx="14" cy="47.5" r="1.6" fill={panelLit ? "#22c55e" : "#475569"} />
      <circle cx="20" cy="47.5" r="1.6" fill={panelLit ? "#ef4444" : "#475569"} />
      {/* Tiny progress slats next to the dots */}
      <rect x="26" y="46" width="20" height="1" fill={panelLit ? "#a7f3d0" : "#475569"} opacity="0.7" />
      <rect x="26" y="48.5" width="14" height="1" fill={panelLit ? "#a7f3d0" : "#475569"} opacity="0.5" />
      {/* Lid (rounded ellipse on top). When `lidPopped` flips true, a
          one-shot keyframe (bb-centrifuge-lid-fly) pops the lid upward,
          accelerates it leftward off-screen, and spins it at ~30°/sec
          throughout the trajectory. Before the pop it sits flat on the
          base via a static no-transform; the keyframe takes over once
          `lidPopped` is true. */}
      <g
        style={{
          transformOrigin: "30px 20px",
          // Reset transform when not popped; the keyframe owns it
          // once the lid pops so the lid doesn't snap-back when the
          // CSS transition ends.
          transform: lidPopped ? undefined : "translateY(0) rotate(0deg)",
          animation: lidPopped
            ? "bb-centrifuge-lid-fly 1400ms cubic-bezier(0.3, 0, 0.7, 1) forwards"
            : undefined,
        }}
        data-testid="centrifuge-lid"
      >
        <ellipse
          cx="30"
          cy="18"
          rx="22"
          ry="5"
          fill="#94A3B8"
          stroke="#475569"
          strokeWidth="1.2"
        />
        {/* Lid handle nub */}
        <rect x="27" y="13" width="6" height="3" rx="1" fill="#475569" />
      </g>
      {/* Loose nuts / bolts — only when dented. Small circles +
          a tiny stroke "crack" line on the side for slapstick polish. */}
      {dented && (
        <g data-testid="centrifuge-dent">
          <circle cx="9" cy="40" r="1.2" fill="#475569" />
          <circle cx="52" cy="40" r="1.2" fill="#475569" />
          <path d="M 50 25 L 53 28 L 50 30" stroke="#1e293b" strokeWidth="1" fill="none" />
        </g>
      )}
    </svg>
  );
}

interface FlyingTubeProps {
  index: number;
  color: string;
  horizontalVw: number;
  rotateToDeg: number;
  delayMs: number;
  fallYVh: number;
  peakYVh: number;
}

/** Sample tube mid-flight: thin vertical pill (3x14 base), drives a
 *  one-shot keyframe animation that arcs up-and-out then falls. CSS
 *  custom properties carry the trajectory so a single @keyframes block
 *  covers every tube.
 *  Trajectory is VIEWPORT-RELATIVE — horizontalVw / fallYVh / peakYVh
 *  all in vw/vh — so the burst genuinely covers the screen and is
 *  never clipped by a parent bounding box. */
function FlyingTube({
  index,
  color,
  horizontalVw,
  rotateToDeg,
  delayMs,
  fallYVh,
  peakYVh,
}: FlyingTubeProps) {
  return (
    <div
      className="absolute left-1/2"
      style={{
        top: "-18px",
        transform: "translateX(-50%)",
        width: "10px",
        height: "26px",
        overflow: "visible",
        ["--bb-fall-x" as string]: `${horizontalVw}vw`,
        ["--bb-fall-y" as string]: `${fallYVh}vh`,
        ["--bb-peak-y" as string]: `${peakYVh}vh`,
        ["--bb-fall-rot" as string]: `${rotateToDeg}deg`,
        animation: `bb-centrifuge-tube-fly 1100ms ease-in ${delayMs}ms forwards`,
      }}
      data-testid={`flying-tube-${index}`}
    >
      <TubeGlyph color={color} />
    </div>
  );
}

/** Static sample-tube glyph: thin vertical pill, colored liquid in
 *  the lower portion, dark cap on top. Used both for flying tubes and
 *  the reduced-motion aftermath scatter. */
function TubeGlyph({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 8 24" width="100%" height="100%" fill="none">
      {/* Outer pill shape — white backing */}
      <path d="M 1.5 2 L 1.5 19 A 2.5 4 0 0 0 6.5 19 L 6.5 2 Z" fill="white" />
      {/* Colored liquid in lower portion */}
      <path d="M 1.5 11 L 1.5 19 A 2.5 4 0 0 0 6.5 19 L 6.5 11 Z" fill={color} />
      {/* Outline */}
      <path
        d="M 1.5 2 L 1.5 19 A 2.5 4 0 0 0 6.5 19 L 6.5 2"
        stroke="#475569"
        strokeWidth="0.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Cap */}
      <rect x="1" y="1" width="6" height="2.5" rx="0.8" fill="#475569" />
    </svg>
  );
}

interface SplatterFieldProps {
  tubes: ReadonlyArray<{
    color: string;
    horizontalVw: number;
    rotateTo: number;
    delayMs: number;
    fallYVh: number;
    peakYVh: number;
  }>;
}

/** A handful of small colored droplets scattered on the floor around
 *  where the tubes landed. Pure decoration — fades in after the tubes
 *  arc down so the splatter feels like a consequence of the landing.
 *  Coordinates are viewport-relative so the splatter matches the
 *  viewport-relative tube trajectories.
 *
 *  Scene polish B: pulled the per-droplet rendering into the shared
 *  BurstParticles primitive. The deterministic per-droplet seed lives
 *  here (because the position function depends on per-tube data, not
 *  a uniform ring) and gets handed to BurstParticles via the explicit
 *  `positions` prop. The visual identity (3 droplets per tube,
 *  colored to match the tube, sub-second staggered fade-in) is
 *  unchanged. */
function SplatterField({ tubes }: SplatterFieldProps) {
  const positions: BurstParticlePosition[] = useMemo(() => {
    const out: BurstParticlePosition[] = [];
    tubes.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const seed = (i * 100 + k * 31 + 7) % 233280;
        const r1 = seed / 233280;
        const r2 = ((seed * 13) % 233280) / 233280;
        out.push({
          x: `${t.horizontalVw + (r1 - 0.5) * 8}vw`,
          y: `${(t.fallYVh + (r2 - 0.5) * 4) * 0.8}vh`,
          color: t.color,
          delayMs: t.delayMs + 800 + k * 50,
          size: 3 + r2 * 3,
        });
      }
    });
    return out;
  }, [tubes]);

  return (
    <div
      className="absolute left-1/2 top-0"
      style={{ transform: "translateX(-50%)", overflow: "visible" }}
      data-testid="splatter-field"
    >
      <BurstParticles
        positions={positions}
        palette={TUBE_COLORS as unknown as ReadonlyArray<string>}
        particleType="circle"
        durationMs={800}
        originX={0}
        originY={0}
      />
    </div>
  );
}
