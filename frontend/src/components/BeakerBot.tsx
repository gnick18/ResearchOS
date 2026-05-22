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
 *  - `typing-on-laptop` - ONE-HAND variant of `typing`: reuses the
 *                       regular typing pose's arm + hand verbatim
 *                       (same 190ms pulse cadence on .typeHand), with
 *                       a small side-profile laptop tucked under the
 *                       hand. The other arm rests against the body
 *                       silhouette (not drawn, same convention as the
 *                       regular `typing` pose). Used by the v4
 *                       walkthrough project-overview-prose step.
 *                       Redesigned 2026-05-22 from a two-arm hammer
 *                       layout (Grant: the two-hand version read as
 *                       awkward / disconcerting).
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
 *  - `sleeping`       - side easter-egg looping idle: eyes close to
 *                       flat lines, a small blanket drapes over the
 *                       lower body, three ZZZ letters drift up + right
 *                       above the head on staggered fades, body sways
 *                       gently left/right. Looping infinite, intended
 *                       for long-idle states.
 *  - `hiccup`         - side easter-egg one-shot (~2s): body jolts, a
 *                       rainbow bubble forms inside the beaker, rises,
 *                       escapes out the top, then pops in a rainbow
 *                       particle ring; a small follow-up jolt suggests
 *                       persistent hiccups.
 *  - `yawn`           - side easter-egg one-shot (~1.5s): mouth opens
 *                       wide, body stretches upward, mouth closes,
 *                       body relaxes back with a small overshoot.
 *  - `reading`        - side easter-egg looping idle: a small book
 *                       appears in front of BeakerBot, eyes scan
 *                       left/right across the pages, every ~6s the
 *                       right page flips to the left. Looping infinite.
 *
 * The dotted pointer-line in `OnboardingTipCard` emits from the
 * triangle tip in the `pointing*` poses; the non-pointing poses
 * (`cheering`, `waving`, `bouncing`, `thinking`, `typing`,
 * `typing-on-laptop`, `bow-wink`, `volcano-eruption`, `sleeping`,
 * `hiccup`, `yawn`, `reading`) are used in the modal mascot slot
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
  | "typing-on-laptop"
  | "bow-wink"
  | "giggle"
  | "rolling-laughing"
  | "volcano-eruption"
  | "sleeping"
  | "hiccup"
  | "yawn"
  | "reading";

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
  "typing-on-laptop",
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
    case "typing-on-laptop":
      // No root animation: matches the regular `typing` pose (which
      // also has no body lean). The hand pulse is on the inner <g> via
      // .typeHand, same as `typing`. Per Grant 2026-05-22 redesign: the
      // pose should read as "regular typing + a small laptop," nothing
      // more on the body.
      return undefined;
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
    case "sleeping":
      return `${styles.sleeping} ${styles.animated}`;
    case "hiccup":
      return `${styles.hiccup} ${styles.animated}`;
    case "yawn":
      return `${styles.yawning} ${styles.animated}`;
    case "reading":
      return `${styles.reading} ${styles.animated}`;
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

// Sleeping ZZZs: three "Z" glyphs that drift up + right above
// BeakerBot's head with staggered fade-in/out delays so the trio reads
// as a continuous puff rather than a synchronized blink. Each Z grows
// in size moving up to suggest depth + perspective.
const SLEEPING_ZZZS: ReadonlyArray<{
  x: number;
  y: number;
  fontSize: number;
  delayMs: number;
}> = [
  { x: 27, y: 10, fontSize: 3.2, delayMs: 0 },
  { x: 30, y: 7, fontSize: 3.8, delayMs: 800 },
  { x: 33, y: 4, fontSize: 4.4, delayMs: 1600 },
];

// Hiccup pop particles: 8 small droplets bursting outward in a ring
// when the rainbow bubble pops outside the beaker. Spawn point is the
// bubble's escape position (cx=20, cy=8 — just above the beaker lip).
// Each particle has its own outward angle so the burst reads as a ring.
const HICCUP_POP_PARTICLES: ReadonlyArray<{
  endX: number;
  endY: number;
  fill: string;
}> = [
  { endX: -6, endY: 0, fill: "#FFD2B0" },
  { endX: -4.2, endY: -4.2, fill: "#FFF1A8" },
  { endX: 0, endY: -6, fill: "#B7EBB1" },
  { endX: 4.2, endY: -4.2, fill: "#A6D2F4" },
  { endX: 6, endY: 0, fill: "#D6B5F0" },
  { endX: 4.2, endY: 4.2, fill: "#FFD2B0" },
  { endX: 0, endY: 6, fill: "#FFF1A8" },
  { endX: -4.2, endY: 4.2, fill: "#B7EBB1" },
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
      {/* Left eye: wrapped in a <g> so the sleeping pose can close it
          to a flat line and the reading pose can horizontally scan it
          across the book. Idle / pointing / etc. leave the wrapper as
          a no-op pass-through. */}
      <g
        className={
          animated && effectivePose === "sleeping"
            ? `${styles.sleepEye} ${styles.animated}`
            : animated && effectivePose === "reading"
              ? `${styles.readEye} ${styles.animated}`
              : undefined
        }
      >
        <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
      </g>
      {/* Right eye: wrapped in a <g> so the bow-wink pose can scale
          it to a closed line independently of the body's bow tilt.
          Also closes for the sleeping pose and scans for reading. */}
      <g
        className={
          animated && effectivePose === "bow-wink"
            ? `${styles.winkEye} ${styles.animated}`
            : animated && effectivePose === "sleeping"
              ? `${styles.sleepEye} ${styles.animated}`
              : animated && effectivePose === "reading"
                ? `${styles.readEye} ${styles.animated}`
                : undefined
        }
      >
        <circle cx="23" cy="18" r="1.2" fill="currentColor" stroke="none" />
      </g>
      {/* Mouth: smile by default, open-laugh for giggle/rolling, yawn-
       *  oval for yawn (wrapped in a scaling <g> to animate open/close),
       *  closed flat line for sleeping (peaceful).
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
      ) : effectivePose === "yawn" ? (
        <g
          className={
            animated ? `${styles.yawnMouth} ${styles.animated}` : undefined
          }
        >
          {/* Yawn oval: wide-open mouth, filled. The animation scales
              this oval from a small smile up to its full open size and
              back, anchored at the mouth's center (20, 23). */}
          <ellipse
            cx="20"
            cy="23"
            rx="2.4"
            ry="2.0"
            fill="currentColor"
            stroke="none"
          />
        </g>
      ) : effectivePose === "sleeping" ? (
        /* Sleeping: tiny flat-line mouth, no smile curve. Peaceful. */
        <path d="M18.5 23 L21.5 23" />
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

      {/* Typing-on-laptop: one-hand variant that reuses the REGULAR
       *  `typing` pose's arm + hand verbatim, with a small side-profile
       *  laptop tucked under that single hand. The other arm is at rest
       *  (not drawn, matching the regular typing pose convention).
       *
       *  Redesigned 2026-05-22 (Grant feedback on the v2 two-hand pose):
       *  the two-arm hammer layout read as disconcerting / awkward; the
       *  regular `typing` arm + hand is the silhouette he likes, so this
       *  pose is now "regular typing pose + a small laptop in front of
       *  the hand." Same arm geometry, same hand circle, same 190ms hand
       *  pulse cadence as `typing` (.typeHand on the wrapper <g>).
       *
       *  Geometry (SVG viewBox 0..40):
       *    Right arm (reused from `typing`): M28 20 L33 20.
       *    Right hand (reused from `typing`): circle cx=33, cy=20, r=1.1.
       *    Laptop keyboard slab: x=29..37, y=21..22
       *                          (8 x 1 units, dark gray #374151).
       *                          Sits just under the hand so the pulse
       *                          reads as "hand tapping the keyboard."
       *    Laptop screen edge: x=36..37, y=15..21
       *                        (1 x 6 units, dark gray #374151).
       *                        Far-right edge of the keyboard, so the
       *                        screen faces AWAY from BeakerBot (matches
       *                        the physical posture of using a laptop).
       *
       *  Hand pulse animation is the same `.typeHand` class used by the
       *  regular typing pose: 190ms cadence, transform-origin (33, 18).
       *  No body lean / no extra root animation, because the regular
       *  typing pose doesn't have one either. */}
      {effectivePose === "typing-on-laptop" && (
        <>
          {/* Laptop keyboard slab (seen from the side, edge-on). Sits
              directly under the hand at y=20 so the hand pulse reads
              as "tapping keys." */}
          <rect
            x="29"
            y="21"
            width="8"
            height="1"
            fill="#374151"
            stroke="none"
          />
          {/* Laptop screen panel (seen from the side, edge-on). Placed
              at the far-right end of the keyboard so the screen faces
              AWAY from BeakerBot, matching how someone actually sits at
              a laptop. */}
          <rect
            x="36"
            y="15"
            width="1"
            height="6"
            fill="#374151"
            stroke="none"
          />
          {/* Arm extended right toward the keyboard (REUSED verbatim
              from the regular `typing` pose). */}
          <path d="M28 20 L33 20" />
          {/* Hand dot at the tip + 190ms pulse wrapper (REUSED verbatim
              from the regular `typing` pose). The pulse echoes the
              typewriter cadence used elsewhere in the v4 tour. */}
          <g
            className={
              animated ? `${styles.typeHand} ${styles.animated}` : undefined
            }
          >
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
          {/* Test tube: small flask above-LEFT of BeakerBot's head.
           *  Two paths layered: outline (white fill for body,
           *  currentColor stroke) + purple liquid inside. Dimensions
           *  are 4 units wide x 8 units tall (skinny + small, so the
           *  tube reads as a chemistry test tube rather than a flask
           *  and stays fully inside the viewBox during the slide-in).
           *  Animation tilts it CLOCKWISE at the pour stage so the
           *  mouth (bottom) swings down-and-right toward BeakerBot's
           *  beaker top at (20, 12). Tube body sits at x=4..8,
           *  y=0..8 in the static state. */}
          <g
            className={
              animated
                ? `${styles.volcanoTestTube} ${styles.animated}`
                : undefined
            }
          >
            {/* Test tube body: skinny vessel with rounded mouth at
             *  the bottom (sealed flat top at y=0). */}
            <path
              d="M 4 0 L 4 6 Q 4 8, 5 8 L 7 8 Q 8 8, 8 6 L 8 0 Z"
              fill="white"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            {/* Test tube liquid: purple, settled in the bottom half
             *  of the smaller tube (y=4..8). */}
            <path
              d="M 4 4 L 8 4 L 8 6 Q 8 8, 7 8 L 5 8 Q 4 8, 4 6 Z"
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

      {/* Sleeping: side easter-egg looping idle. Decorative layers:
       *   1. Blanket draped over BeakerBot's lower body (~y=24-30)
       *      with a wavy upper edge and a soft folded-edge detail.
       *   2. Three "Z" letters drifting up + right above his head on
       *      staggered fade-in/out cycles, increasing in size to
       *      suggest depth.
       * The eyes are closed via the .sleepEye <g> wrappers above and
       * the mouth is a flat line. The body sway is the root
       * .sleeping.animated keyframe (subtle ±2deg rotation). */}
      {effectivePose === "sleeping" && (
        <>
          {/* Blanket: a soft-blue rectangle with a wavy upper edge
           *  draped over BeakerBot's lower body. The wavy top edge
           *  follows the same pattern as the rainbow liquid meniscus
           *  so the blanket reads as a soft fabric, not a hard slab.
           *  A small folded-edge stripe sits along the top for a
           *  fabric-fold detail. */}
          <g className={styles.sleepBlanket}>
            {/* Main blanket panel: wavy top, follows body silhouette
             *  on the bottom. Soft blue fill, faint outline. */}
            <path
              d="M 12 26 Q 14 25, 16 26 T 20 26 T 24 26 T 28 26 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 26 Z"
              fill="#A6D2F4"
              stroke="currentColor"
              strokeWidth="0.6"
              opacity="0.85"
            />
            {/* Folded-edge highlight stripe: a thinner band along the
             *  wavy top edge, slightly darker, to suggest the blanket
             *  has been folded back at the top. */}
            <path
              d="M 12 26 Q 14 25, 16 26 T 20 26 T 24 26 T 28 26"
              fill="none"
              stroke="#7AB8E0"
              strokeWidth="0.8"
              opacity="0.7"
            />
          </g>
          {/* ZZZs: three glyphs drifting up + right. Each has its own
           *  fade-in/out cycle via animation-delay. */}
          <g className={styles.sleepZzzs}>
            {SLEEPING_ZZZS.map((z, i) => (
              <text
                key={i}
                x={z.x}
                y={z.y}
                textAnchor="middle"
                fontSize={z.fontSize}
                fontWeight="700"
                fill="currentColor"
                stroke="none"
                className={animated ? styles.sleepZzz : undefined}
                style={
                  animated
                    ? { animationDelay: `${z.delayMs}ms` }
                    : undefined
                }
              >
                Z
              </text>
            ))}
          </g>
        </>
      )}

      {/* Hiccup: side easter-egg one-shot. A rainbow bubble forms
       *  inside the beaker, rises, escapes out the top, then pops in a
       *  ring of rainbow particles. The body jolt is the root
       *  .hiccup.animated keyframe. Total ~2s. */}
      {effectivePose === "hiccup" && (
        <>
          {/* Rainbow bubble: starts inside the beaker (cy ~ 26),
           *  rises to the meniscus, then escapes to above the lip
           *  (cy ~ 8), where it pops. The bubble uses its own radial
           *  gradient to fake a multi-color sheen. */}
          <defs>
            <radialGradient id={`${gradId}-hiccup`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor="#FFD2B0" />
              <stop offset="30%" stopColor="#FFF1A8" />
              <stop offset="55%" stopColor="#B7EBB1" />
              <stop offset="80%" stopColor="#A6D2F4" />
              <stop offset="100%" stopColor="#D6B5F0" />
            </radialGradient>
          </defs>
          <g
            className={
              animated
                ? `${styles.hiccupBubble} ${styles.animated}`
                : undefined
            }
          >
            <circle
              cx="20"
              cy="26"
              r="1.6"
              fill={`url(#${gradId}-hiccup)`}
              stroke="currentColor"
              strokeWidth="0.4"
              opacity="0.9"
            />
          </g>
          {/* Pop particles: ring of 8 small rainbow droplets bursting
           *  outward from the bubble's pop position (~20, 8). Each
           *  particle keyframe starts in-place at zero opacity and
           *  expands to its (endX, endY) offset on the pop stage. */}
          <g className={styles.hiccupParticles}>
            {HICCUP_POP_PARTICLES.map((p, i) => (
              <circle
                key={i}
                cx="20"
                cy="8"
                r="0.7"
                fill={p.fill}
                stroke="none"
                className={animated ? styles.hiccupParticle : undefined}
                style={
                  animated
                    ? ({
                        "--hiccup-end-x": `${p.endX}px`,
                        "--hiccup-end-y": `${p.endY}px`,
                      } as React.CSSProperties)
                    : undefined
                }
              />
            ))}
          </g>
        </>
      )}

      {/* Yawn: side easter-egg one-shot. The mouth oval renders above
       *  (in the mouth-branch conditional) so the yawn animation
       *  scales it open + closed. No additional decoration here — the
       *  body stretch is the root .yawning.animated keyframe. The
       *  branch is kept present (with no JSX) so the pose union stays
       *  exhaustive at switch sites. */}
      {effectivePose === "yawn" && null}

      {/* Reading: side easter-egg looping idle. A small book held in
       *  front of BeakerBot (~y=22-29). Two pages with a fold down the
       *  middle. The eyes scan left-right via the .readEye wrappers
       *  above. Every ~6s the right page flips to the left as the
       *  .readPageFlip keyframe. The body stays still. */}
      {effectivePose === "reading" && (
        <g className={styles.readBook}>
          {/* Book cover: a darker burgundy rectangle behind the
           *  pages, with rounded corners. Sits in front of BeakerBot's
           *  body so the eyes appear to look down at it. */}
          <rect
            x="13"
            y="22"
            width="14"
            height="7"
            rx="0.6"
            ry="0.6"
            fill="#7A3B3B"
            stroke="currentColor"
            strokeWidth="0.6"
          />
          {/* Left page: off-white rectangle with horizontal lines
           *  suggesting text. */}
          <rect
            x="13.6"
            y="22.6"
            width="6.2"
            height="5.8"
            fill="#FAF6EC"
            stroke="none"
          />
          {/* Right page: a separate rect so it can rotate around the
           *  spine (x=20) during the page-flip keyframe. Static lines
           *  inside read as text. */}
          <g
            className={
              animated
                ? `${styles.readPageRight} ${styles.animated}`
                : undefined
            }
          >
            <rect
              x="20.2"
              y="22.6"
              width="6.2"
              height="5.8"
              fill="#FAF6EC"
              stroke="none"
            />
            {/* Right-page text lines */}
            <path
              d="M 21 24 L 25.6 24 M 21 25.2 L 25.6 25.2 M 21 26.4 L 24.4 26.4 M 21 27.6 L 25.2 27.6"
              stroke="#7A3B3B"
              strokeWidth="0.3"
              opacity="0.6"
            />
          </g>
          {/* Left-page text lines (static; left page doesn't flip) */}
          <path
            d="M 14.4 24 L 19 24 M 14.4 25.2 L 19 25.2 M 14.4 26.4 L 17.8 26.4 M 14.4 27.6 L 18.6 27.6"
            stroke="#7A3B3B"
            strokeWidth="0.3"
            opacity="0.6"
          />
          {/* Center spine fold */}
          <path
            d="M 20 22.6 L 20 28.4"
            stroke="#7A3B3B"
            strokeWidth="0.5"
            opacity="0.7"
          />
        </g>
      )}

      {/* Laugh-text speech bubble: pops up above BeakerBot during the
       *  giggle and rolling-laughing easter-egg poses so the laughter
       *  reads clearly without relying solely on body motion. White
       *  rounded-pill background separates the text from BeakerBot's
       *  body + outline (same color via currentColor) so the letters
       *  stay legible even where the bubble overlaps the body silhouette.
       *  Counter-rotates against the body's tilt on rolling-laughing
       *  via the laughText className so the bubble + text stay upright
       *  while BeakerBot is sideways on the ground.
       *
       *  Bubble bounds: x=[22, 36], y=[4.4, 10.6], center (29, 7.5).
       *  When rolling-laughing rotates the parent SVG ~92deg, the
       *  bubble's counter-rotation (laughTextRoll keyframe) pivots
       *  around (29, 7.5) and lands the bubble at viewBox x=[23.9,
       *  30.1], y=[1.5, 15.5] (Grant feedback 2026-05-21: the bubble
       *  was previously sized to x=[24.5, 39.5] and clipped against
       *  the viewBox top after counter-rotation, which appeared as a
       *  right-side clip on the page after the body's 92deg tilt).
       *  Right edge at 36 leaves 4 SVG units of breathing room. */}
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
            x="22"
            y="4.4"
            width="14"
            height="6.2"
            rx="3.1"
            ry="3.1"
            fill="white"
            stroke="currentColor"
            strokeWidth="0.5"
          />
          <text
            x="29"
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
