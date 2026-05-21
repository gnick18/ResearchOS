"use client";

/**
 * <BeakerBotScreenBumpScene />
 *
 * Side easter-egg "screen bump" animation. BeakerBot drifts horizontally
 * (or vertically) toward a viewport edge, doesn't notice it, bonks his
 * head/side, rubs the bonked spot, then drifts back to a relaxed
 * position. Pure cartoon physics, no trigger logic — the parent decides
 * when to mount it (`active`) and is notified on completion via
 * `onComplete`.
 *
 * Stage timing (~3s total, matches the brief):
 *
 *   1. Drift toward edge .....  1000ms  (eyes glance AWAY from the
 *                                        bonk edge — that's why he
 *                                        doesn't see it coming)
 *   2. Bonk impact ..........   200ms  (horizontal squash 1.0 → 0.92
 *                                        → 1.0 + 4 sparkles spawn)
 *   3. Dazed reaction .......   700ms  (eyes go to ✕✕ overlay, body
 *                                        wobbles, sparkles fade)
 *   4. Recovery + head-rub ..   600ms  (small hand circles the bonked
 *                                        area; eyes return to normal)
 *   5. Apologetic drift back   500ms  (slides back toward center,
 *                                        downcast eyes)
 *                              ─────
 *                              3000ms
 *
 * Mounted via `react-dom` portal at `document.body` so the bonk works
 * against the actual viewport edges regardless of where the parent
 * happens to sit in the DOM tree.
 *
 * Reduced-motion fallback: when `(prefers-reduced-motion: reduce)`
 * matches, the bot + impact sparkles render statically at the bonk
 * position for ~2s, then `onComplete` fires. No transforms animate.
 *
 * The component owns NO trigger logic — it just plays the scene when
 * `active` flips from false → true and calls `onComplete` when done.
 * The parent is responsible for unmounting it / resetting `active`.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "./BeakerBot";

export interface BeakerBotScreenBumpSceneProps {
  active: boolean;
  onComplete: () => void;
  /** Which edge to bonk into. Default `"right"`. */
  bumpEdge?: "left" | "right" | "top" | "bottom";
  /** Vertical anchor (percent) for left/right edge bumps. Default 50
   *  (vertically centered). Clamped to [0, 100]. */
  anchorY?: number;
  /** Horizontal anchor (percent) for top/bottom edge bumps. Default
   *  50 (horizontally centered). Clamped to [0, 100]. */
  anchorX?: number;
}

/** Pixel size of the rendered BeakerBot. The bot sits in a square box;
 *  this drives both the rendered size AND the bonk-position math
 *  (distance from edge to "rest" position once bonked). */
const BOT_SIZE_PX = 96;

/** Pixel padding from the configured edge once BeakerBot is in
 *  "bonked" position. Effectively the gap between the bot's leading
 *  surface and the viewport edge after impact — needs to be small but
 *  > 0 so the bonk reads as "I hit the edge" not "I'm pressed against
 *  the edge from the start". */
const BONK_INSET_PX = 4;

/** How far BeakerBot pulls back from the bonk position during the
 *  apologetic drift-back stage. ~30% of viewport extent on the bumped
 *  axis feels like a believable "embarrassed retreat without
 *  overshooting toward the opposite edge". */
const RETREAT_EXTENT_PERCENT = 30;

// Stage durations in ms.
const DRIFT_IN_MS = 1000;
const BONK_MS = 200;
const REACTION_MS = 700;
const RECOVERY_MS = 600;
const DRIFT_OUT_MS = 500;
const TOTAL_MS =
  DRIFT_IN_MS + BONK_MS + REACTION_MS + RECOVERY_MS + DRIFT_OUT_MS;

/** Reduced-motion total hold before `onComplete` fires. Long enough to
 *  notice the bot, short enough not to overstay the welcome. */
const REDUCED_MOTION_HOLD_MS = 2000;

/** A single impact sparkle. Four are spawned at bonk time, each with
 *  a fixed drift offset so they fan out cartoon-style instead of
 *  landing in a stack. Coordinates are deltas from the impact point
 *  in CSS px. */
const SPARKLE_DRIFTS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: -14, dy: -10 },
  { dx: 14, dy: -10 },
  { dx: -10, dy: 14 },
  { dx: 10, dy: 14 },
];

type Stage = "drift-in" | "bonk" | "reaction" | "recovery" | "drift-out";

interface StagePositions {
  /** CSS transform for the bot's container during the drift-in stage. */
  driftIn: string;
  /** Transform at the moment of bonk (pressed against the edge, with
   *  horizontal/vertical squash applied). */
  bonk: string;
  /** Transform during reaction (held at edge, light wobble). */
  reaction: string;
  /** Transform during recovery (held at edge, no squash). */
  recovery: string;
  /** Transform during apologetic drift-out (pulled back toward
   *  center). */
  driftOut: string;
}

/** Build the per-stage transforms for the configured bump edge.
 *
 *  All transforms operate on a wrapper box positioned at the anchor
 *  point (anchorX%, anchorY%) and `translate(-50%, -50%)` centered.
 *  Drift / bonk / retreat then layer additional translates on top. */
function buildStagePositions(
  bumpEdge: "left" | "right" | "top" | "bottom",
  viewport: { width: number; height: number },
): StagePositions {
  // The bot starts at the anchor and drifts toward the edge. The
  // distance from anchor to "bonked at edge" depends on the axis +
  // edge.
  const isHorizontal = bumpEdge === "left" || bumpEdge === "right";

  // Compute how far the bot needs to move along the bonk axis to be
  // just-touching the edge. Anchor is at viewport-center by default,
  // so the bot must travel ~half the viewport extent minus its own
  // half-size minus the bonk inset.
  const axisExtent = isHorizontal ? viewport.width : viewport.height;
  const distanceToEdge = axisExtent / 2 - BOT_SIZE_PX / 2 - BONK_INSET_PX;
  // Direction sign: positive for right/bottom, negative for left/top.
  const direction =
    bumpEdge === "right" || bumpEdge === "bottom" ? 1 : -1;

  const baseCenter = "translate(-50%, -50%)";

  if (isHorizontal) {
    const bonkX = direction * distanceToEdge;
    // Squash horizontally on impact: scale-X 0.92, slight stretch in Y
    // to suggest displaced volume.
    const squashScale = "scale(0.92, 1.04)";
    // Retreat ~30% of viewport width back toward center.
    const retreatX =
      bonkX - direction * (viewport.width * (RETREAT_EXTENT_PERCENT / 100));
    return {
      driftIn: `${baseCenter} translate(${bonkX}px, 0)`,
      bonk: `${baseCenter} translate(${bonkX}px, 0) ${squashScale}`,
      reaction: `${baseCenter} translate(${bonkX}px, 0) rotate(${direction * 4}deg)`,
      recovery: `${baseCenter} translate(${bonkX}px, 0)`,
      driftOut: `${baseCenter} translate(${retreatX}px, 0)`,
    };
  }

  // Vertical bonk (top / bottom).
  const bonkY = direction * distanceToEdge;
  const squashScale = "scale(1.04, 0.92)";
  const retreatY =
    bonkY - direction * (viewport.height * (RETREAT_EXTENT_PERCENT / 100));
  return {
    driftIn: `${baseCenter} translate(0, ${bonkY}px)`,
    bonk: `${baseCenter} translate(0, ${bonkY}px) ${squashScale}`,
    reaction: `${baseCenter} translate(0, ${bonkY}px) rotate(${direction * 4}deg)`,
    recovery: `${baseCenter} translate(0, ${bonkY}px)`,
    driftOut: `${baseCenter} translate(0, ${retreatY}px)`,
  };
}

/** Map the active stage → the transform string + transition duration
 *  used on the bot wrapper. */
function transformForStage(
  stage: Stage,
  positions: StagePositions,
): { transform: string; transitionMs: number } {
  switch (stage) {
    case "drift-in":
      return { transform: positions.driftIn, transitionMs: DRIFT_IN_MS };
    case "bonk":
      return { transform: positions.bonk, transitionMs: BONK_MS };
    case "reaction":
      return { transform: positions.reaction, transitionMs: REACTION_MS };
    case "recovery":
      return { transform: positions.recovery, transitionMs: RECOVERY_MS };
    case "drift-out":
      return { transform: positions.driftOut, transitionMs: DRIFT_OUT_MS };
  }
}

/** During the dazed-reaction + recovery stages we cover BeakerBot's
 *  dot eyes with an overlay that draws ✕ marks. Returns null when no
 *  overlay should be shown. */
function DazedEyesOverlay() {
  // Coordinates are in BeakerBot's own viewBox (0 0 40 40). Eye dots
  // live at (17,18) and (23,18); we draw little ✕ shapes centered on
  // each of those, slightly larger so they obviously replace the dots.
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Absolute-overlay the bot SVG so the ✕ marks paint on top of
      // the dot eyes. `inset-0` + matching aspect-ratio guarantees a
      // pixel-perfect overlap with the underlying <BeakerBot>.
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        // Match BeakerBot's default tint (text-sky-500). The parent
        // wrapper sets the color; the overlay inherits via
        // `currentColor`.
        color: "inherit",
      }}
    >
      {/* Left eye ✕ */}
      <path d="M15.5 16.5 L18.5 19.5 M18.5 16.5 L15.5 19.5" />
      {/* Right eye ✕ */}
      <path d="M21.5 16.5 L24.5 19.5 M24.5 16.5 L21.5 19.5" />
    </svg>
  );
}

/** During the recovery stage, render a "hand" SVG that orbits the
 *  bonked area in a small circle. Reuses the waving-pose hand-dot
 *  geometry (small filled circle) so it visually matches BeakerBot's
 *  vocabulary instead of introducing a brand-new appendage style.
 *
 *  The hand sits in its own overlay so its position can be animated
 *  independently of BeakerBot's body. We use a CSS keyframe rotation
 *  to drive the orbit (cheap, hardware-accelerated, no JS frame
 *  loop). */
function HeadRubHand({
  bumpEdge,
}: {
  bumpEdge: "left" | "right" | "top" | "bottom";
}) {
  // Position the orbit center near the bonked corner of BeakerBot's
  // body. For a right-edge bump the bonked spot is roughly the right
  // side of the head (BeakerBot viewBox x ≈ 30, y ≈ 12). We place the
  // overlay's origin there and let the hand orbit a small radius
  // around it.
  let originLeft = "50%";
  let originTop = "50%";
  switch (bumpEdge) {
    case "right":
      originLeft = "82%";
      originTop = "22%";
      break;
    case "left":
      originLeft = "18%";
      originTop = "22%";
      break;
    case "top":
      originLeft = "50%";
      originTop = "10%";
      break;
    case "bottom":
      originLeft = "50%";
      originTop = "82%";
      break;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: originLeft,
        top: originTop,
        width: 18,
        height: 18,
        marginLeft: -9,
        marginTop: -9,
        // The orbit animation rotates the wrapper; the hand circle
        // inside is offset along the X axis so rotation traces a
        // 6px-radius circle. Keep it slow enough to read as "rubbing"
        // (~600ms per revolution matches the recovery stage length).
        animation: "beakerbot-bump-head-rub 600ms linear infinite",
      }}
    >
      <svg
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        aria-hidden="true"
        style={{ width: "100%", height: "100%", color: "inherit" }}
      >
        {/* Hand dot — matches the waving-pose hand circle (r=1 in the
            40-viewBox; scaled up here to r=2.4 in an 18-viewBox so it
            reads against the body when overlaid). */}
        <circle cx="15" cy="9" r="2.4" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
}

/** Spawn-and-fade impact sparkles at the bonk point. Each sparkle is
 *  a 4-point SVG starburst. They fade in instantly on bonk, drift
 *  outward via individual translate offsets, then fade out over
 *  ~400ms. The container itself is positioned at the impact point;
 *  individual sparkles offset relative to that. */
function ImpactSparkles({
  bumpEdge,
  visible,
}: {
  bumpEdge: "left" | "right" | "top" | "bottom";
  /** True from the moment bonk begins through the end of reaction.
   *  Drives opacity via CSS transition. */
  visible: boolean;
}) {
  // Anchor the sparkle cluster at the bonked surface of BeakerBot.
  // Same logic as HeadRubHand but slightly more "outside" the body
  // so the sparkles read as splash impact rather than body decoration.
  let left = "50%";
  let top = "50%";
  switch (bumpEdge) {
    case "right":
      left = "95%";
      top = "30%";
      break;
    case "left":
      left = "5%";
      top = "30%";
      break;
    case "top":
      left = "50%";
      top = "5%";
      break;
    case "bottom":
      left = "50%";
      top = "95%";
      break;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left,
        top,
        width: 0,
        height: 0,
        // Crossfade: visible during bonk + reaction, then fades out
        // entirely. 400ms fade matches the "stars wear off as the
        // dazed look settles in" beat in the brief.
        opacity: visible ? 1 : 0,
        transition: "opacity 400ms ease-out",
        pointerEvents: "none",
      }}
      data-testid="beakerbot-bump-sparkles"
    >
      {SPARKLE_DRIFTS.map((drift, i) => (
        <svg
          key={i}
          viewBox="-6 -6 12 12"
          fill="none"
          stroke="#facc15"
          strokeWidth={1.4}
          strokeLinecap="round"
          aria-hidden="true"
          style={{
            position: "absolute",
            // Drift outward from the impact point.
            left: drift.dx - 6,
            top: drift.dy - 6,
            width: 12,
            height: 12,
          }}
        >
          {/* 4-point sparkle: two crossing line segments. */}
          <path d="M0 -5 L0 5 M-5 0 L5 0" />
        </svg>
      ))}
    </div>
  );
}

export default function BeakerBotScreenBumpScene({
  active,
  onComplete,
  bumpEdge = "right",
  anchorY = 50,
  anchorX = 50,
}: BeakerBotScreenBumpSceneProps) {
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>("drift-in");
  // Track viewport size so the bonk-distance math stays correct on
  // resize mid-animation. Initialized to a sensible non-zero default
  // for the SSR pass; real values populate on mount.
  const [viewport, setViewport] = useState<{ width: number; height: number }>(
    () =>
      typeof window === "undefined"
        ? { width: 1024, height: 768 }
        : { width: window.innerWidth, height: window.innerHeight },
  );
  const [reducedMotion, setReducedMotion] = useState(false);
  // Sparkle visibility tracks the bonk + reaction stages explicitly
  // (rather than deriving from stage) so the fade-out transition has
  // its own owned state.
  const [sparklesVisible, setSparklesVisible] = useState(false);
  // Guard against duplicate `onComplete` calls if the active flag
  // bounces while a scene is mid-flight.
  const completeFiredRef = useRef(false);

  // Portal is client-only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount detection: render nothing on the server, then flip to mounted on client mount so createPortal(document.body) is safe to call.
    setMounted(true);

    // Detect reduced-motion preference once on mount. We don't listen
    // for changes mid-animation; the user toggling the preference
    // mid-bonk is an edge case not worth the complexity.
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      setReducedMotion(
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    }
  }, []);

  // Listen for viewport resizes so the bonk-distance math stays
  // correct if the user resizes the browser mid-animation.
  useEffect(() => {
    if (!mounted) return;
    const sync = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", sync, { passive: true });
    return () => window.removeEventListener("resize", sync);
  }, [mounted]);

  // Reset state every time the scene re-arms (active flips false →
  // true). Without this, a second activation would skip the drift-in
  // because `stage` is still at "drift-out" from the prior run.
  useEffect(() => {
    if (!active) {
      completeFiredRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- external-prop sync: when the parent flips `active` off, reset our internal scene state so the next activation starts fresh at drift-in. Cannot be done at deactivation time by the parent (it doesn't own our stage state) and cannot be a derived value (stages need to progress over time via the scheduler).
      setStage("drift-in");
      setSparklesVisible(false);
    }
  }, [active]);

  // Stage scheduler: chained setTimeouts. Each transition gets its
  // own delay matching the brief's per-stage durations. Reduced-motion
  // path skips the chain entirely and fires onComplete after a short
  // static hold. All timers are cleared on cleanup so re-activations
  // don't pile up overlapping schedules.
  useEffect(() => {
    if (!active || !mounted) return;

    if (reducedMotion) {
      // Static hold: render bot at bonked position + sparkles, then
      // call onComplete. No stage chaining.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot scene initialization: when the scene activates under reduced-motion, jump directly to the static "reaction" pose. Can't be a derived value because the animation-mode path uses a scheduler to evolve `stage` over time; this branch is the static-mode equivalent and has to seed `stage` once on entry.
      setStage("reaction");
      setSparklesVisible(true);
      const handle = window.setTimeout(() => {
        if (!completeFiredRef.current) {
          completeFiredRef.current = true;
          onComplete();
        }
      }, REDUCED_MOTION_HOLD_MS);
      return () => window.clearTimeout(handle);
    }

    const timers: number[] = [];

    // Stage 1 → 2 (drift-in → bonk): after DRIFT_IN_MS.
    timers.push(
      window.setTimeout(() => {
        setStage("bonk");
        setSparklesVisible(true);
      }, DRIFT_IN_MS),
    );

    // Stage 2 → 3 (bonk → reaction): after DRIFT_IN_MS + BONK_MS.
    timers.push(
      window.setTimeout(() => {
        setStage("reaction");
      }, DRIFT_IN_MS + BONK_MS),
    );

    // Sparkles fade out during reaction (start the fade right at
    // reaction begin so they're gone by recovery).
    timers.push(
      window.setTimeout(() => {
        setSparklesVisible(false);
      }, DRIFT_IN_MS + BONK_MS + 100),
    );

    // Stage 3 → 4 (reaction → recovery).
    timers.push(
      window.setTimeout(() => {
        setStage("recovery");
      }, DRIFT_IN_MS + BONK_MS + REACTION_MS),
    );

    // Stage 4 → 5 (recovery → drift-out).
    timers.push(
      window.setTimeout(() => {
        setStage("drift-out");
      }, DRIFT_IN_MS + BONK_MS + REACTION_MS + RECOVERY_MS),
    );

    // Stage 5 → done.
    timers.push(
      window.setTimeout(() => {
        if (!completeFiredRef.current) {
          completeFiredRef.current = true;
          onComplete();
        }
      }, TOTAL_MS),
    );

    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [active, mounted, reducedMotion, onComplete]);

  if (!mounted || !active) return null;

  const positions = buildStagePositions(bumpEdge, viewport);
  const { transform, transitionMs } = transformForStage(stage, positions);

  // BeakerBot pose strategy:
  //   - drift-in: `idle` — neutral cruise
  //   - bonk + reaction: `idle` body (we layer the dazed-eyes overlay
  //     ourselves; switching to a different pose would lose the eye
  //     dots that the overlay aligns with)
  //   - recovery: `idle` body + HeadRubHand overlay
  //   - drift-out: `idle` (downcast vibe communicated via the slow
  //     retreat motion, not a new pose)
  const pose: BeakerBotPose = "idle";

  // Show dazed eyes during bonk + reaction. Recovery briefly retains
  // them at the start, then they "wear off" — but since the recovery
  // stage is short, just clear them when recovery begins.
  const showDazedEyes = stage === "bonk" || stage === "reaction";
  const showHeadRub = stage === "recovery";

  // Anchor wrapper position (fixed, full-viewport). The bot sits in
  // its own inner box that we translate via the stage transforms.
  return createPortal(
    <div
      // Full-viewport non-interactive overlay. `pointer-events: none`
      // so the scene never blocks clicks behind it (it's purely
      // decorative).
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 800,
        pointerEvents: "none",
        // No background — the scene is just BeakerBot drifting around.
      }}
      aria-hidden="true"
      data-testid="beakerbot-bump-scene"
    >
      {/* Local stylesheet — head-rub orbit keyframes. Injected here
          rather than in a global CSS file so the component is fully
          self-contained (the only side-effect on document.body is the
          portal node itself). */}
      <style>{`
        @keyframes beakerbot-bump-head-rub {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* Anchor box — positioned at (anchorX%, anchorY%) of the
          viewport. The inner bot wrapper translates relative to this
          anchor for the drift / bonk / retreat motion. */}
      <div
        style={{
          position: "absolute",
          left: `${Math.max(0, Math.min(100, anchorX))}%`,
          top: `${Math.max(0, Math.min(100, anchorY))}%`,
          width: BOT_SIZE_PX,
          height: BOT_SIZE_PX,
          // Drift / bonk / retreat transforms applied here. The
          // transition runs on `transform` only — opacity stays at 1
          // the whole scene.
          transform,
          transition: reducedMotion
            ? "none"
            : `transform ${transitionMs}ms ease-in-out`,
          // The bot wrapper itself houses BeakerBot + the dazed-eyes
          // overlay + the head-rub hand + the sparkle cluster.
          color: "#0ea5e9", // sky-500 — matches BeakerBot default tint
        }}
        data-stage={stage}
      >
        <BeakerBot
          pose={pose}
          className="w-full h-full text-sky-500"
          ariaLabel="BeakerBot bonks into the screen edge"
        />
        {showDazedEyes && <DazedEyesOverlay />}
        {showHeadRub && <HeadRubHand bumpEdge={bumpEdge} />}
        <ImpactSparkles
          bumpEdge={bumpEdge}
          visible={reducedMotion ? true : sparklesVisible}
        />
      </div>
    </div>,
    document.body,
  );
}
