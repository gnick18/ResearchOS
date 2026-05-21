"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./BeakerBot.module.css";

/**
 * Inline-SVG mascot for the onboarding tip system. Round-bottomed
 * chemistry-beaker silhouette with a pastel-rainbow liquid fill,
 * dot eyes, smile, hair-flick, and measurement-mark cheek dashes.
 *
 * All outline paths use `stroke="currentColor"` so the parent can
 * tint via any Tailwind text-color utility. 2px stroke + rounded
 * line caps and joins match the rest of the app's icon family,
 * per the icon-style sweep commits (`f3e39af3`, `11054b2a`,
 * `1bc9fe36`, `72b0c385`).
 *
 * The body has TWO fills layered (back to front): an opaque white
 * fill covering the whole beaker silhouette, then a pastel-rainbow
 * gradient liquid in the lower portion (wavy meniscus at y≈19). The
 * white fill keeps the eyes/smile/cheek dashes legible against busy
 * page backgrounds; without it, the upper body section is
 * transparent and the features bleed into whatever's behind them.
 *
 * The liquid uses an SVG linearGradient with five pastel rainbow
 * stops (peach, yellow, mint, sky, lavender top to bottom). The
 * gradient id is generated per-mount via `useId()` so multiple
 * BeakerBots on the same page (gallery, multi-tip card scenarios)
 * don't collide on `url(#beaker-liquid-...)` references.
 *
 * Poses (the canonical union; the Onboarding v3 7-pose menu maps
 * onto these names, see the wizard shell + step bodies for the
 * mapping):
 *
 *  - `idle`           - neutral, no arm. Idle-bob animation loops
 *                       continuously when `animated` is true.
 *  - `pointing`       - right-side arm out, triangle finger
 *                       (mirror with `direction="left"`).
 *  - `pointing-up`    - right-side arm raised, triangle pointing up
 *                       (mirror with `direction="left"`).
 *  - `pointing-down`  - right-side arm lowered, triangle pointing
 *                       down (mirror with `direction="left"`).
 *  - `cheering`       - both arms up in a V, hand dots, no triangle
 *                       fingers (direction-agnostic). Used for the
 *                       Phase 4 celebrate moment; runs a multi-bounce
 *                       keyframe when `animated`.
 *  - `waving`         - single right-side hand raised in greeting,
 *                       hand dot, no triangle (mirror with
 *                       `direction="left"`). Animated wave loop on
 *                       the arm.
 *  - `bouncing`       - momentary ~600ms vertical bounce. Wizard
 *                       sets this on step transitions then flips
 *                       back to the step's resting pose.
 *  - `thinking`       - subtle head-tilt loop. Used while the user
 *                       is parked on a Q1-Q6 step and hasn't picked
 *                       a radio yet.
 *  - `typing`         - extended arm with a hand that pulses at
 *                       ~190ms (matched to the typewriter cadence
 *                       of 95ms x 2 ticks). W5 + W7 live-typing
 *                       demos. The cadence-match is the integration
 *                       hook; `use-typewriter.ts` itself is unchanged.
 *  - `bow-wink`       - combo pose: right eye winks first, then the
 *                       whole body bows forward. Used on the final
 *                       wizard exit screen after Phase 4 Finish.
 *
 * The dotted pointer-line in `OnboardingTipCard` emits from the
 * triangle tip in the `pointing*` poses; the non-pointing poses
 * (`cheering`, `waving`, `bouncing`, `thinking`, `typing`,
 * `bow-wink`) are used in the modal mascot slot and don't drive a
 * pointer line.
 */

export type BeakerBotPose =
  | "idle"
  | "pointing"
  | "pointing-up"
  | "pointing-down"
  | "cheering"
  | "waving"
  | "bouncing"
  | "thinking"
  | "typing"
  | "bow-wink"
  | "giggle"
  | "rolling-laughing";

export interface BeakerBotProps {
  pose: BeakerBotPose;
  /** Pointing direction for the directional poses (`pointing`,
   *  `pointing-up`, `pointing-down`, `waving`, `typing`). When
   *  `"left"`, the whole SVG flips horizontally via `scaleX(-1)`.
   *  Ignored for direction-agnostic poses. */
  direction?: "left" | "right";
  /** Tailwind class string applied to the wrapping <svg>. Default
   *  sizes it to 40x40 and tints `text-sky-500`. The pastel-rainbow
   *  liquid stays the same regardless of text color, it's a
   *  hardcoded gradient, not `currentColor`. */
  className?: string;
  /** Accessible label. Defaults to "ResearchOS assistant". */
  ariaLabel?: string;
  /** Set to true to render in wireframe mode: no white body fill
   *  AND no pastel-rainbow liquid, just the outline + features.
   *  Useful for monochrome icon contexts (e.g. small dev-button
   *  icons) where the multi-color treatment would feel out of
   *  place. Default false. */
  noLiquid?: boolean;
  /** Opt the pose into its CSS keyframe animation. Default true.
   *  Decorative call sites (settings page header, dev button icons,
   *  tip card thumbnails) can pass `false` to render a static
   *  silhouette. Animation is ALSO disabled regardless of this
   *  prop when the user's OS has `prefers-reduced-motion: reduce`. */
  animated?: boolean;
}

const DIRECTIONAL_POSES: ReadonlySet<BeakerBotPose> = new Set([
  "pointing",
  "pointing-up",
  "pointing-down",
  "waving",
  "typing",
]);

/** Map each pose to its root-level animation class. Sub-element
 *  animations (wave arm, type hand, wink eye) are layered on top via
 *  per-element wrappers below. */
function rootAnimationClass(
  pose: BeakerBotPose,
  animated: boolean,
): string | undefined {
  if (!animated) return undefined;
  switch (pose) {
    case "idle":
      return `${styles.idle} ${styles.animated}`;
    case "bouncing":
      return `${styles.bouncing} ${styles.animated}`;
    case "thinking":
      return `${styles.thinking} ${styles.animated}`;
    case "cheering":
      return `${styles.celebrating} ${styles.animated}`;
    case "bow-wink":
      return `${styles.bowing} ${styles.animated}`;
    case "giggle":
      return `${styles.giggling} ${styles.animated}`;
    case "rolling-laughing":
      return `${styles.rollLaughing} ${styles.animated}`;
    default:
      return undefined;
  }
}

// Easter egg interaction config: tickle BeakerBot (click or rapid
// mouse-jiggle over him) and he giggles; sustain it and he falls on
// his side laughing. Thresholds + decay are tuned for "feels playful
// without firing accidentally."
const TICKLE_THRESHOLD_GIGGLE = 1;
const TICKLE_THRESHOLD_ROLL = 5;
const TICKLE_DECAY_MS = 1500;
const GIGGLE_DURATION_MS = 1400;
const ROLL_LAUGH_DURATION_MS = 3400;
// Distance (in pixels) between consecutive mousemoves required to
// register as one "jiggle tick." Tuned so a gentle pointer drift
// doesn't tickle but rapid back-and-forth does.
const MOUSEMOVE_JIGGLE_PX = 8;

export default function BeakerBot({
  pose,
  direction = "right",
  className,
  ariaLabel = "ResearchOS assistant",
  noLiquid = false,
  animated = true,
}: BeakerBotProps) {
  // Unique gradient id per mount so multiple BeakerBots on the same
  // page don't collide on the url(#...) reference.
  const rawId = useId();
  const gradId = `beaker-liquid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // Easter egg state: tickle override. When the user clicks or rapidly
  // jiggles the cursor over BeakerBot, we temporarily override the
  // pose prop with `giggle` or `rolling-laughing` for the duration of
  // the animation, then fall back to the parent's pose. Works on every
  // mount of BeakerBot anywhere in the app.
  const [tickleOverride, setTickleOverride] = useState<
    "giggle" | "rolling-laughing" | null
  >(null);
  const tickleCountRef = useRef(0);
  const decayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overrideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMoveRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    return () => {
      if (decayTimeoutRef.current) clearTimeout(decayTimeoutRef.current);
      if (overrideTimeoutRef.current) clearTimeout(overrideTimeoutRef.current);
    };
  }, []);

  const scheduleDecay = () => {
    if (decayTimeoutRef.current) clearTimeout(decayTimeoutRef.current);
    decayTimeoutRef.current = setTimeout(() => {
      tickleCountRef.current = 0;
    }, TICKLE_DECAY_MS);
  };

  const scheduleOverrideReset = (durationMs: number) => {
    if (overrideTimeoutRef.current) clearTimeout(overrideTimeoutRef.current);
    overrideTimeoutRef.current = setTimeout(() => {
      setTickleOverride(null);
      // Hard reset so a brief calm period doesn't carry over residual
      // tickle into the next interaction.
      tickleCountRef.current = 0;
    }, durationMs);
  };

  const bumpTickle = (amount: number) => {
    tickleCountRef.current += amount;
    scheduleDecay();
    if (tickleCountRef.current >= TICKLE_THRESHOLD_ROLL) {
      // Sustained tickling: rolling on the ground laughing.
      setTickleOverride("rolling-laughing");
      scheduleOverrideReset(ROLL_LAUGH_DURATION_MS);
      return;
    }
    if (
      tickleCountRef.current >= TICKLE_THRESHOLD_GIGGLE &&
      tickleOverride !== "rolling-laughing"
    ) {
      setTickleOverride("giggle");
      scheduleOverrideReset(GIGGLE_DURATION_MS);
    }
  };

  const handleClick = () => {
    bumpTickle(1);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const prev = lastMoveRef.current;
    lastMoveRef.current = { x: e.clientX, y: e.clientY };
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.hypot(dx, dy) >= MOUSEMOVE_JIGGLE_PX) {
      bumpTickle(0.5);
    }
  };

  const handleMouseLeave = () => {
    lastMoveRef.current = null;
  };

  const effectivePose = tickleOverride ?? pose;

  // Mirror via CSS transform so the path data stays canonical
  // (cheaper than maintaining two mirrored sets).
  const flip = DIRECTIONAL_POSES.has(effectivePose) && direction === "left";

  const rootAnim = rootAnimationClass(effectivePose, animated);
  const wrapperClass = [
    styles.root,
    rootAnim,
    className ?? "w-10 h-10 text-sky-500",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={ariaLabel}
      data-pose={effectivePose}
      data-animated={animated ? "true" : "false"}
      className={wrapperClass}
      style={{
        ...(flip ? { transform: "scaleX(-1)" } : undefined),
        cursor: "pointer",
      }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <defs>
        {/* Pastel rainbow gradient for the liquid. Vertical (top to
            bottom): peach, yellow, mint, sky, lavender. Slightly
            translucent so the body outline still reads cleanly on
            top of it. */}
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD2B0" />
          <stop offset="25%" stopColor="#FFF1A8" />
          <stop offset="50%" stopColor="#B7EBB1" />
          <stop offset="75%" stopColor="#A6D2F4" />
          <stop offset="100%" stopColor="#D6B5F0" />
        </linearGradient>
      </defs>

      {/* White body fill: full beaker silhouette, opaque white.
          Rendered BEFORE the rainbow liquid AND the outline so the
          mascot's eyes/smile/cheek dashes have a solid backdrop
          against busy page backgrounds (project chips, colorful
          buttons). Without this, the upper body section is
          transparent and the features bleed into whatever's
          behind them. Skipped when `noLiquid` is true. */}
      {!noLiquid && (
        <path
          d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
          fill="white"
          stroke="none"
        />
      )}

      {/* Liquid: pastel rainbow fill, wavy meniscus at the top,
          follows the rounded-bottom body silhouette. Rendered AFTER
          the white fill so the rainbow paints on top of the white
          in the lower portion. Skipped when `noLiquid` is true. */}
      {!noLiquid && (
        <path
          d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"
          fill={`url(#${gradId})`}
          stroke="none"
        />
      )}

      {/* Hair flick: small curl at the top, anime-ish */}
      <path d="M22 8 C 22 6, 24 4, 26 6" />
      {/* Body: rounded-bottom beaker silhouette */}
      <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
      {/* Beaker lip */}
      <path d="M11 12 L29 12" />
      {/* Left eye */}
      <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
      {/* Right eye: wrapped in a <g> so the bow-wink pose can scale
          it to a closed line independently of the body's bow tilt. */}
      <g
        className={
          effectivePose === "bow-wink" && animated
            ? `${styles.winkEye} ${styles.animated}`
            : undefined
        }
      >
        <circle cx="23" cy="18" r="1.2" fill="currentColor" stroke="none" />
      </g>
      {/* Smile */}
      <path d="M18 22 Q 20 24, 22 22" />
      {/* Measurement-mark "cheek" dashes: slightly higher so they
          sit above the liquid meniscus and stay visible */}
      <path d="M14 26 L15.5 26" />
      <path d="M24.5 26 L26 26" />

      {effectivePose === "pointing" && (
        <>
          {/* Arm extended right */}
          <path d="M28 18 L33 16" />
          {/* Finger triangle: fills currentColor so it reads as a
              directional arrow at-a-glance. */}
          <path d="M33 16 L32 14 L34.5 15 Z" fill="currentColor" />
        </>
      )}

      {effectivePose === "pointing-up" && (
        <>
          {/* Arm raised up-and-out to the upper right */}
          <path d="M28 16 L32 10" />
          {/* Triangle pointing up */}
          <path d="M32 10 L30.5 12 L33.5 12 Z" fill="currentColor" />
        </>
      )}

      {effectivePose === "pointing-down" && (
        <>
          {/* Arm lowered down-and-out to the lower right */}
          <path d="M28 22 L32 30" />
          {/* Triangle pointing down */}
          <path d="M32 30 L30.5 28 L33.5 28 Z" fill="currentColor" />
        </>
      )}

      {effectivePose === "cheering" && (
        <>
          {/* Both arms up in a V, hand dots instead of triangles,
              celebratory / "ta-da" energy. Symmetric so flipping
              is unnecessary. */}
          <path d="M12 18 L8 10" />
          <path d="M28 18 L32 10" />
          <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="32" cy="10" r="1" fill="currentColor" stroke="none" />
          {/* Two sparkles for extra energy */}
          <path d="M6 6 L7 7 M7 6 L6 7" />
          <path d="M33 6 L34 7 M34 6 L33 7" />
        </>
      )}

      {effectivePose === "waving" && (
        <g
          className={
            animated ? `${styles.waveArm} ${styles.animated}` : undefined
          }
        >
          {/* Single arm raised in a greeting wave, hand dot, no
              triangle (this pose isn't a pointer; used for welcome
              modal openers). */}
          <path d="M28 18 L32 12" />
          <circle cx="32" cy="12" r="1" fill="currentColor" stroke="none" />
        </g>
      )}

      {effectivePose === "typing" && (
        <>
          {/* Arm out forward to the right (toward a virtual keyboard) */}
          <path d="M28 20 L33 20" />
          <g
            className={
              animated ? `${styles.typeHand} ${styles.animated}` : undefined
            }
          >
            {/* Hand dot at the tip; pulses up/down on a 190ms cadence
                to visually echo the typewriter's per-char ticks. */}
            <circle cx="33" cy="20" r="1.1" fill="currentColor" stroke="none" />
          </g>
        </>
      )}

      {effectivePose === "thinking" && (
        <>
          {/* Three small thought dots floating up and to the right.
              Static positions; the head-tilt comes from the root
              rotation keyframe so we don't need to animate the dots
              themselves. */}
          <circle cx="30" cy="9" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="33" cy="6" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="36" cy="3.5" r="1.3" fill="currentColor" stroke="none" />
        </>
      )}

      {effectivePose === "bouncing" && (
        // The bounce is purely a root-transform animation, no extra
        // geometry. Keep this branch present (even with no JSX) so
        // typecheck on the pose union stays exhaustive at the call
        // sites that switch on pose.
        null
      )}

      {effectivePose === "bow-wink" && (
        // Bow tilt is a root-transform animation; the wink is a
        // sub-element animation on the right eye (above). No extra
        // geometry needed here.
        null
      )}
    </svg>
  );
}
