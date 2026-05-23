"use client";

/**
 * <BeakerBotMouseWaveScene />
 *
 * Side easter-egg "mouse wave" animation primitive. BeakerBot sits at a
 * fixed viewport-corner anchor, turns to face a target screen point, then
 * waves at it before settling back into the idle pose. Total runtime is
 * ~2.0s in motion mode and ~1.5s under prefers-reduced-motion.
 *
 * This is an animation primitive only. The TRIGGER that decides when to
 * fire the scene (mouse-proximity detection, hover-on-cursor heuristics,
 * etc.) is intentionally NOT in scope here. Callers pass `active=true`
 * along with the target point; on completion the scene fires
 * `onComplete()` and the parent flips `active` back to false. Composition
 * of trigger logic on top of this primitive is future work.
 *
 * Stage timeline (motion mode, ~2.0s total):
 *
 *   1. Turn ......   200ms  (BeakerBot flips facing direction toward the
 *                            target via an X-scale flip, with a small
 *                            rotational tilt for "I'm pivoting" feel)
 *   2. Wave ......  1500ms  (waving pose held facing the target. The
 *                            pose itself is a single keyframe; we layer
 *                            a CSS arm-pulse animation on the wrapper
 *                            for three discrete "hi, hi, hi" beats)
 *   3. Settle ....   300ms  (returns to idle pose, neutral forward
 *                            facing; the speech bubble, if shown,
 *                            fades out during this stage)
 *                  ──────
 *                   2000ms  then onComplete()
 *
 * Reduced-motion fallback:
 *   Renders BeakerBot statically in the waving pose, already facing the
 *   target, holds for 1500ms, then fires onComplete. No keyframes
 *   attach. The speech bubble (if enabled) renders statically too.
 *
 * Mount approach matches the other side-easter-egg scenes: a
 * `createPortal` overlay rooted at `document.body`, position: fixed,
 * z-index 800 (above app chrome but below modals), pointer-events: none
 * end-to-end so the scene never intercepts clicks. SSR safety via
 * useSyncExternalStore so the file can live alongside the rest of the
 * `'use client'` components without spilling document references during
 * the prerender pass.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import BeakerBot from "./BeakerBot";
import BeakerBotSpeechBubble from "./beakerbot/SpeechBubble";
import { BEAKERBOT_SCENE_SIZE_PX } from "./beakerbot/scene-constants";

export interface BeakerBotMouseWaveSceneProps {
  /** When true, the scene mounts and the wave sequence plays. When the
   *  sequence finishes the scene calls `onComplete`; the parent should
   *  then flip this back to false. Toggling to false mid-scene is safe:
   *  the portal unmounts immediately and no onComplete fires. */
  active: boolean;
  /** Called once after the full wave sequence (or the reduced-motion
   *  short-circuit) finishes. Optional because some callers only mount
   *  the scene and never read completion. */
  onComplete?: () => void;
  /** Screen x in px (0 = left edge of viewport). Defaults to the
   *  viewport center. Used to decide which way BeakerBot turns. */
  targetX?: number;
  /** Screen y in px (0 = top edge of viewport). Defaults to the
   *  viewport center. Currently used only for the speech-bubble tilt
   *  hint, not the facing direction. */
  targetY?: number;
  /** Which viewport corner BeakerBot is anchored to. Defaults to
   *  `"bottom-right"`. The bot sits 24px inset from the chosen
   *  corner. */
  beakerBotAnchor?:
    | "bottom-right"
    | "bottom-left"
    | "top-right"
    | "top-left";
  /** When true, a small "Hi!" speech bubble fades in during the wave
   *  and fades out during settle. Default true (charm without
   *  clutter). Pass false to disable in contexts where the bubble
   *  would distract. */
  showSpeechBubble?: boolean;
}

type Stage = "turn" | "wave" | "settle" | "done";

/** Stage durations in ms. Keep these in sync with the TOTAL_MS sum and
 *  with the CSS animation-duration values in the inlined keyframes. */
const TURN_MS = 200;
const WAVE_MS = 1500;
const SETTLE_MS = 300;
const TOTAL_MS = TURN_MS + WAVE_MS + SETTLE_MS;

/** Reduced-motion hold: matches the wave-only segment so the experience
 *  still feels like "BeakerBot waved at me" without any motion. */
const REDUCED_MOTION_HOLD_MS = 1500;

/** Pixel size of the rendered BeakerBot. Scene polish C bumped this
 *  from 96 to the canonical BEAKERBOT_SCENE_SIZE_PX so the corner wave
 *  reads at the same visual weight as the bench-style scenes (Eureka,
 *  BugStomp, CoffeeRefill, ...). */
const BOT_SIZE_PX = BEAKERBOT_SCENE_SIZE_PX;

/** Pixel inset from the chosen viewport corner. 24px keeps BeakerBot
 *  clear of the corner without floating awkwardly far in. */
const CORNER_INSET_PX = 24;

/** z-index slot, mirroring the rest of the easter-egg scene family
 *  (cursor is 400, modals are 10000+, this sits between). */
const SCENE_Z_INDEX = 800;

/** SSR-safe client detection. The `'use client'` directive still
 *  allows a server prerender pass where `document` is undefined; this
 *  useSyncExternalStore pattern returns false on the server and true
 *  after first paint on the client. Same effect as a
 *  `useEffect(setMounted)` flip but lints clean under
 *  `react-hooks/set-state-in-effect`. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Resolve the corner anchor name into concrete pixel offsets. Returns
 *  a CSS-style object suitable for spreading onto an absolutely
 *  positioned element. */
function anchorOffsetStyle(
  anchor: NonNullable<BeakerBotMouseWaveSceneProps["beakerBotAnchor"]>,
): React.CSSProperties {
  switch (anchor) {
    case "bottom-right":
      return { bottom: CORNER_INSET_PX, right: CORNER_INSET_PX };
    case "bottom-left":
      return { bottom: CORNER_INSET_PX, left: CORNER_INSET_PX };
    case "top-right":
      return { top: CORNER_INSET_PX, right: CORNER_INSET_PX };
    case "top-left":
      return { top: CORNER_INSET_PX, left: CORNER_INSET_PX };
  }
}

/** Resolve the anchor's center-x in viewport pixels for a given
 *  viewport width. Used to compute whether the target is to the left
 *  or the right of BeakerBot's resting position. */
function anchorCenterX(
  anchor: NonNullable<BeakerBotMouseWaveSceneProps["beakerBotAnchor"]>,
  viewportWidth: number,
): number {
  const isRight = anchor === "bottom-right" || anchor === "top-right";
  if (isRight) {
    return viewportWidth - CORNER_INSET_PX - BOT_SIZE_PX / 2;
  }
  return CORNER_INSET_PX + BOT_SIZE_PX / 2;
}

export default function BeakerBotMouseWaveScene({
  active,
  onComplete,
  targetX,
  targetY,
  beakerBotAnchor = "bottom-right",
  showSpeechBubble = true,
}: BeakerBotMouseWaveSceneProps) {
  const isClient = useIsClient();
  const [stage, setStage] = useState<Stage>("turn");
  const [reducedMotion, setReducedMotion] = useState(false);

  // Cache viewport dimensions for the facing-direction calculation and
  // for resolving default target coordinates. Initialized with a
  // sensible non-zero default for SSR; real values populate on mount.
  const [viewport, setViewport] = useState<{
    width: number;
    height: number;
  }>(() =>
    typeof window === "undefined"
      ? { width: 1024, height: 768 }
      : { width: window.innerWidth, height: window.innerHeight },
  );

  // Stash onComplete in a ref so the stage-progression effect doesn't
  // re-run every time the parent passes a new callback identity
  // (common foot-gun: inline arrow at the call site).
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Track prefers-reduced-motion only while the scene is active. Picks
  // up live OS-preference changes between firings.
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

  // Re-sample viewport on resize so the facing-direction call stays
  // correct if the user resizes mid-wave.
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const sync = () =>
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    window.addEventListener("resize", sync, { passive: true });
    return () => window.removeEventListener("resize", sync);
  }, [active]);

  // Stage scheduler. Mirrors the chained-setTimeout pattern from the
  // other scenes: setState calls live inside timer callbacks (external
  // events) which keeps the `react-hooks/set-state-in-effect` rule
  // happy. All timers tear down on cleanup so toggling `active` off
  // mid-scene cannot fire onComplete after the unmount.
  useEffect(() => {
    if (!active) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (delay: number, fn: () => void) => {
      timers.push(setTimeout(fn, delay));
    };

    // Reset to the opening stage every time `active` flips true so
    // re-firing replays the full sequence. Scheduled as a 0ms timer
    // rather than a sync setState so the lint treats it as a
    // callback-driven update.
    schedule(0, () => setStage("turn"));

    if (reducedMotion) {
      // No animation. Jump straight to the wave pose and hold for
      // REDUCED_MOTION_HOLD_MS, then fire onComplete.
      schedule(0, () => setStage("wave"));
      schedule(REDUCED_MOTION_HOLD_MS, () => {
        setStage("done");
        onCompleteRef.current?.();
      });
      return () => {
        for (const t of timers) clearTimeout(t);
      };
    }

    // Motion-mode timeline.
    let elapsed = 0;
    elapsed += TURN_MS;
    schedule(elapsed, () => setStage("wave"));
    elapsed += WAVE_MS;
    schedule(elapsed, () => setStage("settle"));
    elapsed += SETTLE_MS;
    schedule(elapsed, () => {
      setStage("done");
      onCompleteRef.current?.();
    });

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [active, reducedMotion]);

  // Compute facing direction. Default target is viewport center so a
  // bare `<BeakerBotMouseWaveScene active />` still works.
  const resolvedTargetX = targetX ?? viewport.width / 2;
  const resolvedTargetY = targetY ?? viewport.height / 2;
  const anchorX = anchorCenterX(beakerBotAnchor, viewport.width);
  // facing="left" when the target is to the LEFT of BeakerBot's
  // anchor, facing="right" when it's to the right. This drives the
  // `direction` prop on the BeakerBot SVG (which mirrors the
  // directional poses via scaleX(-1)).
  const facing: "left" | "right" =
    resolvedTargetX < anchorX ? "left" : "right";

  // Compute speech-bubble side. Place the bubble on the same side as
  // the target so the bubble points roughly toward what BeakerBot is
  // waving at. The bubble sits above BeakerBot for bottom anchors and
  // below for top anchors so it doesn't clip the viewport edge.
  const isBottomAnchor =
    beakerBotAnchor === "bottom-left" ||
    beakerBotAnchor === "bottom-right";
  const bubbleSide = facing;

  // Compute a tiny vertical-tilt hint based on where the target sits
  // relative to BeakerBot. Just a few degrees of rotation during the
  // wave so the bot looks like he's leaning toward what he's waving
  // at. Positive degrees = clockwise.
  const anchorY = isBottomAnchor
    ? viewport.height - CORNER_INSET_PX - BOT_SIZE_PX / 2
    : CORNER_INSET_PX + BOT_SIZE_PX / 2;
  const verticalLean = useMemo(() => {
    const dy = resolvedTargetY - anchorY;
    // Clamp the rotation to a small range so the bot never tips
    // dramatically. 6 degrees is enough to read as "leaning toward".
    const max = 6;
    // Sign depends on facing: if facing right, leaning toward a
    // target ABOVE means rotating counter-clockwise (negative). If
    // facing left, it's flipped.
    const sign = facing === "right" ? -1 : 1;
    const clamped = Math.max(-1, Math.min(1, dy / 200));
    return sign * clamped * max;
  }, [resolvedTargetY, anchorY, facing]);

  if (!active || !isClient) return null;

  // Stable pose-by-stage. The waving pose handles the arm geometry;
  // the wrapper's keyframe animation pulses three discrete waves on
  // top of that. Settle returns to idle.
  const pose = stage === "turn" || stage === "wave" ? "waving" : "idle";

  // Direction prop: only meaningful for directional poses (waving is
  // one of them). During settle/idle we force "right" so the bot
  // returns to canonical neutral.
  const direction = pose === "waving" ? facing : "right";

  // Wrapper transform: combine the turn-flip with the lean rotation.
  // The flip is handled by the BeakerBot component's own direction
  // prop; we only need to apply the lean here.
  // During "turn" stage we apply a brief overshoot scale on the X
  // axis to sell the pivot. During "settle" we ease the lean back to
  // zero.
  const wrapperRotateDeg =
    stage === "wave" ? verticalLean : stage === "turn" ? verticalLean * 0.5 : 0;

  return createPortal(
    <div
      data-testid="beakerbot-mouse-wave-scene"
      data-stage={stage}
      data-facing={facing}
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
      {/* Scoped keyframes for the wave-pulse and bubble fade. Inlined
          so the component stays self-contained. The wave-pulse drives
          three discrete arm bobs by rotating the wrapper a few
          degrees back and forth, since the waving pose itself is a
          single static keyframe in BeakerBot.tsx. */}
      <style>{`
        @keyframes bbmw-wave-pulse {
          0%   { transform: rotate(0deg); }
          16%  { transform: rotate(-8deg); }
          33%  { transform: rotate(0deg); }
          50%  { transform: rotate(-8deg); }
          66%  { transform: rotate(0deg); }
          83%  { transform: rotate(-8deg); }
          100% { transform: rotate(0deg); }
        }
        @keyframes bbmw-turn-flash {
          0%   { transform: scaleX(1); }
          50%  { transform: scaleX(0.85); }
          100% { transform: scaleX(1); }
        }
        @keyframes bbmw-bubble-fade-in {
          from { opacity: 0; transform: translateY(4px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes bbmw-bubble-fade-out {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to   { opacity: 0; transform: translateY(-2px) scale(0.95); }
        }
      `}</style>

      {/* Outer anchor box. Pinned to the chosen viewport corner. */}
      <div
        data-testid="beakerbot-mouse-wave-scene-anchor"
        style={{
          position: "absolute",
          ...anchorOffsetStyle(beakerBotAnchor),
          width: BOT_SIZE_PX,
          height: BOT_SIZE_PX,
          // Apply the lean rotation here (separate from the per-stage
          // wave-pulse which rotates the inner wrapper).
          transform: `rotate(${wrapperRotateDeg}deg)`,
          transition: reducedMotion ? "none" : "transform 200ms ease-out",
          transformOrigin: "center bottom",
        }}
      >
        {/* Inner wrapper. Owns the per-stage animation (turn flash or
            wave pulse). Splitting these into two layers keeps the
            transform composition straightforward (lean is on the
            outer, pulse / flash on the inner). */}
        <div
          data-testid="beakerbot-mouse-wave-scene-bot"
          style={{
            width: "100%",
            height: "100%",
            // turn: a quick scaleX squash to suggest the pivot.
            // wave: the wrapper rotates back and forth three times to
            //       drive the "wave" arm motion.
            // settle: no animation, just sits in idle pose.
            animation: reducedMotion
              ? undefined
              : stage === "turn"
                ? `bbmw-turn-flash ${TURN_MS}ms ease-in-out`
                : stage === "wave"
                  ? `bbmw-wave-pulse ${WAVE_MS}ms ease-in-out`
                  : undefined,
            transformOrigin: "center bottom",
          }}
        >
          <BeakerBot
            pose={pose}
            direction={direction}
            className="w-full h-full text-sky-500"
          />
        </div>

        {/* Optional speech bubble. Lives in the anchor coordinate
            space so it tracks the bot's corner position. Scene polish
            B: now uses the shared SpeechBubble primitive (default
            sky-blue tone), which also gives the bubble a proper SVG
            tail (the auditor's catch — the pre-polish bubble had no
            tail). Tail direction points TOWARD BeakerBot: down when
            the bubble sits above him (bottom anchors), up when it
            sits below (top anchors). */}
        {showSpeechBubble && (stage === "wave" || stage === "settle") && (
          <BeakerBotSpeechBubble
            data-testid="beakerbot-mouse-wave-scene-bubble"
            tone="default"
            // Bottom-anchored bot → bubble sits above him → tail
            // points DOWN at the bot. Top-anchored bot → bubble sits
            // below → tail points UP.
            direction={isBottomAnchor ? "down" : "up"}
            position={{
              ...(isBottomAnchor
                ? { bottom: BOT_SIZE_PX + 4 }
                : { top: BOT_SIZE_PX + 4 }),
              ...(bubbleSide === "left"
                ? { right: BOT_SIZE_PX / 2 - 8 }
                : { left: BOT_SIZE_PX / 2 - 8 }),
            }}
            style={{
              animation: reducedMotion
                ? undefined
                : stage === "wave"
                  ? "bbmw-bubble-fade-in 240ms ease-out forwards"
                  : "bbmw-bubble-fade-out 240ms ease-in forwards",
              opacity: reducedMotion ? 1 : undefined,
            }}
          >
            Hi!
          </BeakerBotSpeechBubble>
        )}
      </div>
    </div>,
    document.body,
  );
}
