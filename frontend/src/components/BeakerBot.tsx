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
 *  - `volcano-eruption` - side easter-egg one-shot: a small floating
 *                       test tube tilts over BeakerBot's head, pours
 *                       a purple liquid into his beaker, his rainbow
 *                       liquid "reacts," a particle fountain erupts
 *                       upward, BeakerBot wobbles dizzy, then settles.
 *                       Total ~3.2s. No trigger logic shipped yet;
 *                       future idle trigger will dispatch it.
 *
 * The dotted pointer-line in `OnboardingTipCard` emits from the
 * triangle tip in the `pointing*` poses; the non-pointing poses
 * (`cheering`, `waving`, `bouncing`, `thinking`, `typing`,
 * `bow-wink`, `volcano-eruption`) are used in the modal mascot slot
 * and don't drive a pointer line.
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
  | "rolling-laughing"
  | "volcano-eruption";

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
    case "volcano-eruption":
      return `${styles.volcanoErupting} ${styles.animated}`;
    default:
      return undefined;
  }
}

// Volcano eruption particle fountain: 10 droplets that arc upward and
// outward from BeakerBot's beaker top, then fall. Each particle has a
// per-index angle + delay offset so the burst reads as a fountain
// rather than a synchronized ring. Colors pull from the rainbow
// gradient palette (peach, yellow, mint, sky, lavender) so the burst
// looks like a piece of BeakerBot's own liquid was ejected. Coords
// are in SVG viewBox units (0-40), origin at the beaker top (~20,12).
const VOLCANO_PARTICLES: ReadonlyArray<{
  cx: number;
  cy: number;
  r: number;
  fill: string;
  delayMs: number;
  endX: number;
  endY: number;
}> = [
  { cx: 20, cy: 12, r: 0.9, fill: "#FFD2B0", delayMs: 0, endX: -8, endY: -14 },
  { cx: 20, cy: 12, r: 0.7, fill: "#FFF1A8", delayMs: 40, endX: -4, endY: -18 },
  { cx: 20, cy: 12, r: 0.8, fill: "#B7EBB1", delayMs: 80, endX: 0, endY: -20 },
  { cx: 20, cy: 12, r: 0.6, fill: "#A6D2F4", delayMs: 30, endX: 5, endY: -18 },
  { cx: 20, cy: 12, r: 0.9, fill: "#D6B5F0", delayMs: 60, endX: 9, endY: -14 },
  { cx: 20, cy: 12, r: 0.7, fill: "#FFD2B0", delayMs: 110, endX: -11, endY: -8 },
  { cx: 20, cy: 12, r: 0.8, fill: "#B7EBB1", delayMs: 90, endX: -2, endY: -22 },
  { cx: 20, cy: 12, r: 0.6, fill: "#A6D2F4", delayMs: 50, endX: 3, endY: -22 },
  { cx: 20, cy: 12, r: 0.7, fill: "#D6B5F0", delayMs: 70, endX: 11, endY: -8 },
  { cx: 20, cy: 12, r: 0.6, fill: "#FFF1A8", delayMs: 120, endX: -6, endY: -10 },
];

// Dizzy stars: 3 small four-point sparkles that orbit BeakerBot's head
// during the dizzy stage. Hand-placed offsets so they don't all clump.
const VOLCANO_DIZZY_STARS: ReadonlyArray<{
  cx: number;
  cy: number;
  delayMs: number;
}> = [
  { cx: 14, cy: 8, delayMs: 0 },
  { cx: 26, cy: 7, delayMs: 120 },
  { cx: 20, cy: 5, delayMs: 60 },
];

// Easter egg interaction config: tickle BeakerBot (click or rapid
// back-and-forth mouse-jiggle over him) and he giggles; sustain it
// and he falls on his side laughing. Thresholds + decay tuned for
// "feels playful without firing accidentally on a single swipe."
const TICKLE_THRESHOLD_GIGGLE = 1;
const TICKLE_THRESHOLD_ROLL = 4;
const TICKLE_DECAY_MS = 1800;
const GIGGLE_DURATION_MS = 1400;
const ROLL_LAUGH_DURATION_MS = 3400;
// Minimum distance (in pixels) for a mousemove segment to count toward
// jiggle detection. Filters out micro-motion / jitter.
const MOUSEMOVE_MIN_PX = 5;
// How much each detected direction reversal contributes to the tickle
// counter. Requires ~3 reversals (= ~2-3 quick back-and-forth swipes)
// to reach the giggle threshold, so a single one-direction swipe over
// BeakerBot doesn't trigger anything.
const REVERSAL_TICKLE_WEIGHT = 0.35;

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
  // Tracks the most recent mousemove vector over BeakerBot. We tickle
  // on DIRECTION REVERSALS (dot product < 0) rather than raw moves, so
  // a single one-way swipe across him produces zero tickle while a
  // genuine back-and-forth jiggle ratchets up quickly.
  const lastMoveRef = useRef<{
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);

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
    if (!prev) {
      lastMoveRef.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.hypot(dx, dy) < MOUSEMOVE_MIN_PX) {
      // Below the noise floor; don't update lastMoveRef so a slow
      // diagonal drift doesn't accidentally accumulate "reversals."
      return;
    }
    // Direction reversal check via dot product against the previous
    // segment vector. dot < 0 means the cursor changed direction by
    // more than 90 degrees, which is what a back-and-forth jiggle
    // produces. A single straight swipe across BeakerBot has no
    // prior vector or a positive dot product, so it contributes 0.
    if (prev.dx !== 0 || prev.dy !== 0) {
      const dot = dx * prev.dx + dy * prev.dy;
      if (dot < 0) {
        bumpTickle(REVERSAL_TICKLE_WEIGHT);
      }
    }
    lastMoveRef.current = { x: e.clientX, y: e.clientY, dx, dy };
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
      {/* Mouth: smile by default, open-laugh for giggle/rolling.
       *  Open-mouth path is wider + filled so it reads as "ha ha"
       *  rather than a static smile during the laugh poses. */}
      {effectivePose === "giggle" ||
      effectivePose === "rolling-laughing" ? (
        <path
          d="M17 22 Q 20 26.5, 23 22 Q 20 23.5, 17 22 Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={1}
        />
      ) : (
        <path d="M18 22 Q 20 24, 22 22" />
      )}
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

      {/* Volcano-eruption: side easter-egg one-shot. A small floating
       *  test tube tilts over BeakerBot's head and pours a purple
       *  liquid into his beaker; a fountain of pastel rainbow particles
       *  erupts upward; dizzy stars orbit during the wobble recovery.
       *  Total cadence is ~3.2s, sequenced via stage-specific keyframes
       *  in BeakerBot.module.css (test-tube appear/pour, particle
       *  erupt, dizzy stars orbit). The root body wobble is driven by
       *  the .volcanoErupting class on the SVG root. All animations
       *  collapse to a static silhouette under prefers-reduced-motion. */}
      {effectivePose === "volcano-eruption" && (
        <>
          {/* Test tube: small flask above and slightly right of
           *  BeakerBot's head. Two paths layered: outline (white fill
           *  for body, currentColor stroke) + purple liquid inside.
           *  Animation tilts it forward 90deg at the pour stage then
           *  flings it off-screen on the erupt stage. */}
          <g
            className={
              animated
                ? `${styles.volcanoTestTube} ${styles.animated}`
                : undefined
            }
          >
            {/* Test tube body: rectangular flask with rounded bottom. */}
            <path
              d="M 32 -2 L 32 8 Q 32 10, 34 10 L 38 10 Q 40 10, 40 8 L 40 -2 Z"
              fill="white"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            {/* Test tube liquid: purple, settled at the bottom half. */}
            <path
              d="M 32 4 L 40 4 L 40 8 Q 40 10, 38 10 L 34 10 Q 32 10, 32 8 Z"
              fill="#8b5cf6"
              stroke="none"
            />
          </g>

          {/* Particle fountain: 10 droplets that erupt upward + outward
           *  from the beaker top. Each particle has its own keyframe
           *  delay so the burst staggers rather than firing as one
           *  ring. The animation-delay is composed by the .animated
           *  class via the inline style on each circle. */}
          <g
            className={
              animated
                ? `${styles.volcanoParticles} ${styles.animated}`
                : undefined
            }
          >
            {VOLCANO_PARTICLES.map((p, i) => (
              <circle
                key={i}
                cx={p.cx}
                cy={p.cy}
                r={p.r}
                fill={p.fill}
                stroke="none"
                className={animated ? styles.volcanoParticle : undefined}
                style={
                  animated
                    ? ({
                        animationDelay: `${p.delayMs}ms`,
                        "--volcano-end-x": `${p.endX}px`,
                        "--volcano-end-y": `${p.endY}px`,
                      } as React.CSSProperties)
                    : undefined
                }
              />
            ))}
          </g>

          {/* Dizzy stars: 3 small four-point sparkles that orbit
           *  BeakerBot's head during the dizzy stage. Pure decoration;
           *  the wobble itself is on the root body. */}
          <g
            className={
              animated
                ? `${styles.volcanoDizzyStars} ${styles.animated}`
                : undefined
            }
          >
            {VOLCANO_DIZZY_STARS.map((s, i) => (
              <g
                key={i}
                className={animated ? styles.volcanoDizzyStar : undefined}
                style={
                  animated
                    ? { animationDelay: `${s.delayMs}ms` }
                    : undefined
                }
              >
                <path
                  d={`M ${s.cx - 1.2} ${s.cy} L ${s.cx + 1.2} ${s.cy} M ${s.cx} ${s.cy - 1.2} L ${s.cx} ${s.cy + 1.2}`}
                  stroke="currentColor"
                  strokeWidth="0.8"
                />
              </g>
            ))}
          </g>
        </>
      )}

      {/* Laugh-text speech bubble: pops up above BeakerBot during the
       *  giggle and rolling-laughing easter-egg poses so the laughter
       *  reads clearly without relying solely on body motion. White
       *  rounded-pill background separates the text from BeakerBot's
       *  body + outline (same color via currentColor) so the letters
       *  stay legible even where the bubble overlaps the body silhouette.
       *  Counter-rotates against the body's tilt on rolling-laughing
       *  via the laughText className so the bubble + text stay upright
       *  while BeakerBot is sideways on the ground. */}
      {(effectivePose === "giggle" ||
        effectivePose === "rolling-laughing") && (
        <g
          className={`${styles.laughText} ${
            effectivePose === "rolling-laughing"
              ? styles.laughTextRoll
              : styles.laughTextGiggle
          }`}
        >
          <rect
            x="24.5"
            y="4.4"
            width="15"
            height="6.2"
            rx="3.1"
            ry="3.1"
            fill="white"
            stroke="currentColor"
            strokeWidth="0.5"
          />
          <text
            x="32"
            y="8.6"
            textAnchor="middle"
            fontSize="3.6"
            fontWeight="700"
            fill="currentColor"
            stroke="none"
          >
            {effectivePose === "rolling-laughing" ? "HAHA!" : "hehe!"}
          </text>
        </g>
      )}
    </svg>
  );
}
