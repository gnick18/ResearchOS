"use client";

import { useEffect, useRef, useState } from "react";
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
 *  - `double-wave`    - both arms raised up in the air (reuses the
 *                       `cheering` two-arm V geometry, hand dots, no
 *                       triangle), waving continuously. Each arm runs
 *                       the same infinite 700ms wave keyframe as
 *                       `waving`, with the right arm phase-shifted by
 *                       half a cycle so the two arms wave out of
 *                       lockstep (like the typing-on-laptop hands). The
 *                       arms stay UP the whole time, they do not lower.
 *                       Continuous infinite loop, direction-agnostic.
 *                       Used by the /thanks Lab sponsor tier.
 *  - `twirl`          - BeakerBot spins gently and continuously, a
 *                       playful happy twirl. A full 360deg rotation
 *                       around the figure centre (20, 20) over ~3.6s,
 *                       looping infinite. The whole silhouette (face,
 *                       beaker, features) rides along with the rotation.
 *                       Continuous infinite loop, direction-agnostic.
 *                       Used by the /thanks Institute sponsor tier.
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
 *                       walkthrough project-overview-typing-demo step.
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
 *  - `panicked`       - scene-tone pose: wide circle eyes with small
 *                       pupils, small "O" mouth, both arms thrown
 *                       wide in a Y-shape. Used for "something
 *                       startling just happened" beats (Ladder fall,
 *                       Centrifuge out-of-control explosion).
 *                       Static silhouette, no looping animation.
 *  - `amazed`         - scene-tone pose: wide oval eyes with small
 *                       pupils + raised brows, open ellipse mouth
 *                       ("wow"), both hands clasped low in front.
 *                       Used for "something wondrous" beats (Eureka
 *                       bulb-on, TooManyBeakers phew save). Static
 *                       silhouette.
 *  - `embarrassed`    - scene-tone pose: half-closed eyes glancing
 *                       aside, slight wavy mouth, one hand rubbing
 *                       the back of the head (sheepish neck-rub),
 *                       small pink blush dots on each cheek. Used
 *                       for "post-mistake reaction" beats (Centrifuge
 *                       post-explosion, TooManyBeakers post-drop).
 *                       Static silhouette.
 *
 * The `pointing*` poses emit a triangle tip used by pointer-line
 * overlays; the non-pointing poses (`cheering`, `waving`,
 * `double-wave`, `twirl`, `bouncing`,
 * `thinking`, `typing`, `typing-on-laptop`, `bow-wink`,
 * `volcano-eruption`, `sleeping`, `hiccup`, `yawn`, `reading`,
 * `panicked`, `amazed`, `embarrassed`) are used in the modal mascot
 * slot and don't drive a pointer line.
 */

export type BeakerBotPose =
  | "idle"
  | "pointing"
  | "pointing-up"
  | "pointing-down"
  | "cheering"
  | "waving"
  | "double-wave"
  | "twirl"
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
  | "reading"
  | "panicked"
  | "amazed"
  | "embarrassed";

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
  /** Opt the neutral/standing BeakerBot into a subtle "alive" idle:
   *  a slow body sway, a periodic blink, and a slow gaze drift, all
   *  pure CSS keyframes. Default false, so every existing call site is
   *  unchanged unless it opts in. This is for the decorative standing
   *  case (a BeakerBot sitting on a hero, header, or empty state); it
   *  layers gentle life onto an otherwise static figure.
   *
   *  It only takes effect when ALL of these hold:
   *    - `alive` is true,
   *    - `animated` is true (the existing animation gate), and
   *    - the OS is not set to `prefers-reduced-motion: reduce`
   *      (handled in CSS, the idle keyframes go to `animation: none`).
   *
   *  Pose gate: the alive idle ONLY applies on the benign standing
   *  poses that have no eye or body loop of their own, namely `idle`,
   *  `pointing`, `pointing-up`, and `pointing-down` (see ALIVE_POSES).
   *  Any pose that already drives the eyes or body (sleeping, thinking,
   *  reading, bow-wink, the laugh / scene poses, etc.) keeps its own
   *  motion and the alive idle yields entirely, so the two never
   *  double-animate the same element. On `idle` the alive sway also
   *  REPLACES the default idle-bob root animation (rather than stacking
   *  a second transform on the root) so only one root keyframe runs. */
  alive?: boolean;
  /** Per-instance click easter-egg selector.
   *  - `"heart"` (default): click triggers a brief 200ms body wobble
   *    plus a pink heart that pops, drifts upward, and fades. Multiple
   *    rapid clicks stack hearts (capped at 6 simultaneous, staggered
   *    fan-out via per-spawn translateX) for a "hearts everywhere"
   *    feel without one click eating another. Used everywhere
   *    BeakerBot is interactive.
   *  - `"none"`: click is inert visually. The SVG is still focusable
   *    and accepts the click handler shape, just no animation runs.
   *
   *  Note: the prior `"tickle"` mode (click + mouse-jiggle escalating
   *  into the giggle / rolling-laughing poses) was retired 2026-05-25
   *  per Grant. The giggle and rolling-laughing POSES are still in the
   *  union and still render correctly when invoked directly via the
   *  `pose` prop — they're available for scenes / future features —
   *  but the auto-escalation interaction is gone. */
  easterEgg?: "heart" | "none";
}

const DIRECTIONAL_POSES: ReadonlySet<BeakerBotPose> = new Set([
  "pointing",
  "pointing-up",
  "pointing-down",
  "waving",
  "typing",
  "typing-on-laptop",
]);

// Poses the `alive` idle is allowed to decorate. These are the neutral
// standing / pointing poses that have NO eye animation and NO body loop
// of their own (pointing* have no root animation; idle has only the
// idle-bob, which the alive sway replaces). Every other pose drives the
// eyes and/or body itself, so the alive idle yields to avoid two
// keyframes fighting over the same element. Keeping this an explicit
// allowlist (rather than a denylist) means a future pose is static under
// `alive` until it is deliberately added here.
const ALIVE_POSES: ReadonlySet<BeakerBotPose> = new Set([
  "idle",
  "pointing",
  "pointing-up",
  "pointing-down",
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
    case "twirl":
      // Continuous 360deg spin around the figure centre. This pose owns
      // the root animation slot (its own infinite loop), so like
      // `thinking` it is NOT in ALIVE_POSES and the alive idle never
      // composes with it.
      return `${styles.twirling} ${styles.animated}`;
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

// Heart easter-egg config: cap concurrent hearts so a spam-click doesn't
// queue an unbounded number of timeout closures. Six reads as "hearts
// everywhere" without thrashing the React reconciler. Lifetime matches
// the .heartPop keyframe duration (700ms) so each instance is GC'd as
// soon as its animation completes.
const HEART_LIFETIME_MS = 700;
const HEART_MAX_CONCURRENT = 6;
// Brief root wobble duration; mirrors the beakerBotHeartWobble keyframe.
const HEART_WOBBLE_DURATION_MS = 200;

// Horizontal drift presets for sequential heart spawns. Each click cycles
// through these (modulo length) so rapid spam fans the hearts out left +
// right instead of stacking exactly on top of each other. Units are SVG
// view-box pixels; the keyframe applies them via the --heart-drift-x var.
const HEART_DRIFT_X_PATTERN = [0, -4, 3, -2, 5, -5, 2, -3];

// Heart fill: warm pink/rose that reads against the sky-blue BeakerBot
// silhouette. Picked over a saturated red (would clash with currentColor
// outline) and over magenta (too cool against the pastel-rainbow liquid).
const HEART_FILL = "#ff5b8a";

// Heart SVG path, positioned at the heart's spawn point (20, 14) in
// view-box units (just above BeakerBot's beaker lip). Classic two-curve
// heart with a downward point. ~7 view-box units wide. We bake the
// position into the path data (instead of using a wrapping <g transform>)
// because the keyframe animation rewrites `transform` on the same node,
// which would clobber a static <g transform>. The CSS animation's
// transform-origin (set in .heartPop to 20px 14px) is what anchors the
// scale + drift to the heart's center.
const HEART_PATH =
  "M 20 12 C 18.5 10.5, 16.5 10.5, 16.5 12.8 C 16.5 14.8, 18.5 16, 20 17 C 21.5 16, 23.5 14.8, 23.5 12.8 C 23.5 10.5, 21.5 10.5, 20 12 Z";

// Mouse-follow pupil constants. How far the pupils may slide from center,
// in viewBox user units. BeakerBot's eyes sit at cx 17/23, cy 18, inside
// a beaker body that spans x 12-28, so 1.3 horizontal / 0.9 vertical
// keeps them well clear of the glass rim. These are the same values used
// by IntroBeaker because both components share identical eye geometry.
// GAZE_FULL_DISTANCE_PX is screen-space and does not depend on viewBox.
const PUPIL_REACH_X = 1.3;
const PUPIL_REACH_Y = 0.9;
const GAZE_FULL_DISTANCE_PX = 420;

interface HeartInstance {
  /** Monotonic id used as the React key + setTimeout target. */
  id: number;
  /** Per-spawn horizontal drift offset (SVG view-box units). Passed to
   *  the .heartPop keyframe via the --heart-drift-x CSS custom property
   *  on inline style. */
  driftX: number;
}

export default function BeakerBot({
  pose,
  direction = "right",
  className,
  ariaLabel = "ResearchOS assistant",
  noLiquid = false,
  animated = true,
  alive = false,
  easterEgg = "heart",
}: BeakerBotProps) {
  // Fixed gradient id. Was `useId()` historically (one per mount, to avoid
  // url(#...) collisions across multiple BeakerBots), but that triggered a
  // React 19 hydration mismatch warning whenever any upstream layout drift
  // shifted the useId counter between server + client renders. Every
  // BeakerBot uses the IDENTICAL hardcoded gradient stops, so duplicate
  // ids across instances are visually harmless — `url(#beaker-liquid)`
  // resolves to the same colors no matter which `<linearGradient>` the
  // browser picks. Same logic for the hiccup-bubble radial gradient.
  const gradId = "beaker-liquid";

  // Heart easter-egg state. Only active when easterEgg === "heart".
  // - hearts: live list of heart instances currently animating. Each entry
  //   carries its own id + driftX so React can key + position it. After
  //   HEART_LIFETIME_MS each instance is filtered out by a setTimeout.
  // - heartWobble: brief boolean that triggers the .heartWobbling root
  //   class for HEART_WOBBLE_DURATION_MS, giving BeakerBot a "you tapped
  //   me" squash beat.
  // - heartSpawnCounterRef: monotonic counter for unique heart ids AND
  //   the index into HEART_DRIFT_X_PATTERN so sequential spawns fan out.
  const [hearts, setHearts] = useState<HeartInstance[]>([]);
  const [heartWobble, setHeartWobble] = useState(false);
  const heartSpawnCounterRef = useRef(0);
  const heartCleanupTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  const heartWobbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Ref to the root svg node so the pointer-follow effect can call
  // getBoundingClientRect() without a DOM query.
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Mouse-follow pupil offset, in viewBox user units. Starts at (0,0) so
  // the SSR render and the first client paint are identical (no hydration
  // mismatch). The effect below writes non-zero values only after mount and
  // only when aliveFaceActive, so non-alive poses always see centered pupils.
  const [pupil, setPupil] = useState({ x: 0, y: 0 });

  // Alive-idle de-sync. Two BeakerBots painted at once must not blink or
  // sway in lockstep, so each instance gets randomized animation delays
  // and a slight duration jitter, fed to the keyframes as CSS custom
  // properties on the root <svg>. We compute them in an effect AFTER
  // mount (NOT during render) so the server-rendered HTML and the first
  // client render both use the same deterministic defaults (delay 0, the
  // CSS base durations); that avoids a React 19 hydration mismatch. Once
  // mounted, the randomized values swap in and the keyframes pick them up
  // via the var() fallbacks. The vars only matter when `alive` is on, but
  // computing them is cheap and harmless otherwise.
  const [aliveVars, setAliveVars] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    // Stagger each channel independently so blink, sway, and gaze don't
    // start on the same beat even within one instance. Negative delays
    // start the loops mid-cycle on first paint (no "everyone frozen at 0"
    // beat). Small duration jitter (+/- ~12%) keeps two instances from
    // re-converging after a few cycles.
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    setAliveVars({
      "--alive-sway-delay": `${rand(-6, 0).toFixed(2)}s`,
      "--alive-sway-dur": `${rand(5.6, 7.2).toFixed(2)}s`,
      "--alive-blink-delay": `${rand(-5, 0).toFixed(2)}s`,
      "--alive-blink-dur": `${rand(4.4, 6.4).toFixed(2)}s`,
      "--alive-gaze-delay": `${rand(-7, 0).toFixed(2)}s`,
      "--alive-gaze-dur": `${rand(6.5, 9).toFixed(2)}s`,
    } as React.CSSProperties);
  }, []);

  useEffect(() => {
    const cleanupTimeouts = heartCleanupTimeoutsRef.current;
    return () => {
      if (heartWobbleTimeoutRef.current)
        clearTimeout(heartWobbleTimeoutRef.current);
      // Drain any in-flight heart cleanup timers so we don't try to
      // setHearts on an unmounted component.
      for (const t of cleanupTimeouts) clearTimeout(t);
      cleanupTimeouts.clear();
    };
  }, []);

  const spawnHeart = () => {
    const id = heartSpawnCounterRef.current++;
    const driftX =
      HEART_DRIFT_X_PATTERN[id % HEART_DRIFT_X_PATTERN.length] ?? 0;
    setHearts((prev) => {
      // Cap concurrent hearts: drop the oldest if we'd exceed the cap.
      // Keeps the visual feeling of "more hearts on rapid clicks" while
      // bounding the number of live keyframes the browser is animating.
      const next = [...prev, { id, driftX }];
      if (next.length > HEART_MAX_CONCURRENT) {
        return next.slice(next.length - HEART_MAX_CONCURRENT);
      }
      return next;
    });
    // Schedule removal after the animation completes so the <g> unmounts
    // and the browser releases its keyframe state.
    const timeout = setTimeout(() => {
      heartCleanupTimeoutsRef.current.delete(timeout);
      setHearts((prev) => prev.filter((h) => h.id !== id));
    }, HEART_LIFETIME_MS);
    heartCleanupTimeoutsRef.current.add(timeout);

    // Trigger the brief body wobble. Restart by toggling false -> true
    // across a microtask boundary so a rapid second click re-fires the
    // keyframe even if the previous wobble is still mid-animation.
    if (heartWobbleTimeoutRef.current)
      clearTimeout(heartWobbleTimeoutRef.current);
    setHeartWobble(false);
    // Use rAF (and not setTimeout(0)) so React commits the false state
    // before we flip back to true; otherwise the same render reads true
    // and no class change is observed.
    requestAnimationFrame(() => {
      setHeartWobble(true);
      heartWobbleTimeoutRef.current = setTimeout(() => {
        setHeartWobble(false);
      }, HEART_WOBBLE_DURATION_MS);
    });
  };

  const handleClick = () => {
    if (easterEgg === "none") return;
    // Only "heart" remains (tickle retired 2026-05-25). Future easter
    // eggs would branch here.
    spawnHeart();
  };

  const effectivePose = pose;

  // Alive idle only takes effect on the benign standing poses (idle +
  // pointing*) and only when the animation gate is on. Reduced-motion is
  // handled in CSS (the idle keyframes resolve to `animation: none`), so
  // it deliberately does NOT gate this boolean; the classes are still
  // applied, they just don't move.
  const aliveActive = alive && animated && ALIVE_POSES.has(effectivePose);
  // Living wave: blink + gaze live on the eye / pupil nodes (not the root
  // body), so they compose with the `waving` greeting pose without touching
  // its arm animation. Sway stays gated to ALIVE_POSES (the wave owns the
  // root body-animation slot and the two would fight), but the face still
  // comes alive on a wave, so a greeting BeakerBot blinks and glances instead
  // of freezing mid-wave.
  const aliveFaceActive =
    alive &&
    animated &&
    (ALIVE_POSES.has(effectivePose) || effectivePose === "waving");

  // Pupils track the cursor when aliveFaceActive is true and the user has
  // not requested reduced motion. The state update runs only after mount
  // (the initial value is {x:0,y:0} to match the SSR render), and the
  // listener is torn down and reset to center when aliveFaceActive turns
  // off, so every non-alive pose keeps perfectly centered pupils.
  useEffect(() => {
    if (
      !aliveFaceActive ||
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setPupil({ x: 0, y: 0 });
      return;
    }
    let frame = 0;
    let mx = 0;
    let my = 0;
    const apply = () => {
      frame = 0;
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      // Eyes sit at cy 18 in a 40-unit-tall viewBox = 45% from the top.
      const cy = rect.top + rect.height * 0.45;
      const dx = mx - cx;
      const dy = my - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, dist / GAZE_FULL_DISTANCE_PX);
      setPupil({
        x: (dx / dist) * PUPIL_REACH_X * reach,
        y: (dy / dist) * PUPIL_REACH_Y * reach,
      });
    };
    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [aliveFaceActive]);

  // Mirror via CSS transform so the path data stays canonical
  // (cheaper than maintaining two mirrored sets).
  const flip = DIRECTIONAL_POSES.has(effectivePose) && direction === "left";

  // On `idle`, the alive sway is the root body animation and it REPLACES
  // the default idle-bob so only one keyframe runs on the root. On
  // pointing* the pose has no root animation, so the alive sway is the
  // only root animation. For every other pose aliveActive is false and
  // the pose's own root animation is used unchanged.
  const baseRootAnim = rootAnimationClass(effectivePose, animated);
  const rootAnim = aliveActive
    ? `${styles.aliveSway} ${styles.animated}`
    : baseRootAnim;
  // Heart-wobble override: when easterEgg=heart and we're currently
  // mid-wobble after a click, override the pose's root animation class
  // with the brief 200ms beakerBotHeartWobble keyframe so the click
  // reads as "BeakerBot reacted." We override (not stack) because two
  // simultaneous root animations on the same element fight; the wobble
  // is the more salient feedback for the moment after a click.
  const showHeartWobble = easterEgg === "heart" && heartWobble && animated;
  const effectiveRootAnim = showHeartWobble
    ? `${styles.heartWobbling} ${styles.animated}`
    : rootAnim;
  // Brand guarantee: BeakerBot's outline/eyes are stroke="currentColor", so the
  // color comes from a text-* class. If a caller passes `className` WITHOUT a
  // text color (e.g. only a size like "h-28 w-28"), currentColor would fall back
  // to the inherited text color, which on a dark-text surface renders BeakerBot
  // BLACK. That is off-brand: the mark must ALWAYS be the signature sky-blue
  // (brand/README.md). So we force `text-brand-sky` unless the caller has
  // deliberately set their own text color. This makes an off-brand BeakerBot
  // impossible by construction. See BeakerBot.brand.test.tsx.
  const callerHasTextColor = !!className && /(^|\s)text-/.test(className);
  const wrapperClass = [
    styles.root,
    effectiveRootAnim,
    className ?? "w-10 h-10",
    callerHasTextColor ? "" : "text-brand-sky",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      ref={svgRef}
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
      data-easter-egg={easterEgg}
      className={wrapperClass}
      style={{
        ...(flip ? { transform: "scaleX(-1)" } : undefined),
        // Per-instance alive-idle de-sync vars (delay + duration jitter).
        // Set only once mounted (aliveVars is null on the SSR + first
        // client render) so there's no hydration mismatch; the keyframes
        // fall back to deterministic defaults until then. Applied on the
        // root so they cascade to the eye + pupil descendants too.
        ...(aliveFaceActive && aliveVars ? aliveVars : undefined),
        cursor: "pointer",
        // overflow:visible lets the heart easter-egg paint outside the
        // 40x40 viewBox (hearts drift upward to y=-3 in view-box units
        // and would otherwise clip at small render sizes like the 24px
        // AppShell brand-mark logo). Harmless for other poses because
        // none of them draw outside the viewBox.
        overflow: "visible",
      }}
      onClick={handleClick}
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
      {/* Outer mouse-follow wrapper: slides BOTH eyes toward the cursor
          when aliveFaceActive is true. The offset is zero when not alive,
          so all non-alive poses keep perfectly centered pupils. The inner
          per-eye <g> handles blink/wink/scan animations (unchanged); the
          default dot pupils keep their aliveGaze CSS drift keyframe on
          the inner <circle> (unchanged). Two nested elements = two
          composing transforms, no conflict. */}
      <g transform={`translate(${pupil.x} ${pupil.y})`}>
        {/* Left eye: wrapped in a <g> so the sleeping pose can close it
            to a flat line and the reading pose can horizontally scan it
            across the book. Scene-tone poses (panicked, amazed,
            embarrassed) override the inner geometry to convey emotion
            (wide circles, wide ovals, half-closed slits respectively).
            Idle / pointing / etc. leave the wrapper as a no-op pass-
            through with the default dot pupil. */}
        <g
          className={
            animated && effectivePose === "sleeping"
              ? `${styles.sleepEye} ${styles.animated}`
              : animated && effectivePose === "reading"
                ? `${styles.readEye} ${styles.animated}`
                : aliveFaceActive
                  ? `${styles.aliveBlink} ${styles.animated}`
                  : undefined
          }
        >
          {effectivePose === "panicked" ? (
            <>
              {/* Wide circle eye + small dark pupil = startled. */}
              <circle
                cx="17"
                cy="18"
                r="1.9"
                fill="white"
                stroke="currentColor"
                strokeWidth="0.7"
              />
              <circle cx="17" cy="18" r="0.7" fill="currentColor" stroke="none" />
            </>
          ) : effectivePose === "amazed" ? (
            <>
              {/* Wide vertical oval + small pupil = wondrous "wow." */}
              <ellipse
                cx="17"
                cy="18"
                rx="1.4"
                ry="1.9"
                fill="white"
                stroke="currentColor"
                strokeWidth="0.7"
              />
              <circle cx="17" cy="18" r="0.6" fill="currentColor" stroke="none" />
              {/* Raised brow: small arc above the eye. */}
              <path
                d="M 15.4 14.6 Q 17 13.8, 18.6 14.6"
                stroke="currentColor"
                strokeWidth="0.7"
                fill="none"
              />
            </>
          ) : effectivePose === "embarrassed" ? (
            /* Half-closed eye: thin horizontal ellipse glancing aside.
               Slight offset on cx shifts the gaze to the right (away
               from whatever just went wrong). */
            <ellipse
              cx="17.3"
              cy="18.2"
              rx="1.2"
              ry="0.4"
              fill="currentColor"
              stroke="none"
            />
          ) : (
            <circle
              cx="17"
              cy="18"
              r="1.2"
              fill="currentColor"
              stroke="none"
              className={aliveFaceActive ? styles.aliveGaze : undefined}
            />
          )}
        </g>
        {/* Right eye: wrapped in a <g> so the bow-wink pose can scale
            it to a closed line independently of the body's bow tilt.
            Also closes for the sleeping pose and scans for reading.
            Scene-tone poses override the inner geometry the same way the
            left eye does (panicked = wide circle, amazed = wide oval
            + brow, embarrassed = half-closed slit). */}
        <g
          className={
            animated && effectivePose === "bow-wink"
              ? `${styles.winkEye} ${styles.animated}`
              : animated && effectivePose === "sleeping"
                ? `${styles.sleepEye} ${styles.animated}`
                : animated && effectivePose === "reading"
                  ? `${styles.readEye} ${styles.animated}`
                  : aliveFaceActive
                    ? `${styles.aliveBlink} ${styles.animated}`
                    : undefined
          }
        >
          {effectivePose === "panicked" ? (
            <>
              <circle
                cx="23"
                cy="18"
                r="1.9"
                fill="white"
                stroke="currentColor"
                strokeWidth="0.7"
              />
              <circle cx="23" cy="18" r="0.7" fill="currentColor" stroke="none" />
            </>
          ) : effectivePose === "amazed" ? (
            <>
              <ellipse
                cx="23"
                cy="18"
                rx="1.4"
                ry="1.9"
                fill="white"
                stroke="currentColor"
                strokeWidth="0.7"
              />
              <circle cx="23" cy="18" r="0.6" fill="currentColor" stroke="none" />
              <path
                d="M 21.4 14.6 Q 23 13.8, 24.6 14.6"
                stroke="currentColor"
                strokeWidth="0.7"
                fill="none"
              />
            </>
          ) : effectivePose === "embarrassed" ? (
            <ellipse
              cx="22.7"
              cy="18.2"
              rx="1.2"
              ry="0.4"
              fill="currentColor"
              stroke="none"
            />
          ) : (
            <circle
              cx="23"
              cy="18"
              r="1.2"
              fill="currentColor"
              stroke="none"
              className={aliveFaceActive ? styles.aliveGaze : undefined}
            />
          )}
        </g>
      </g>
      {/* Mouth: smile by default, open-laugh for giggle/rolling, yawn-
       *  oval for yawn (wrapped in a scaling <g> to animate open/close),
       *  closed flat line for sleeping (peaceful).
       *  Scene-tone poses (panicked, amazed, embarrassed) get their own
       *  shapes: panicked = small "O", amazed = wider open ellipse,
       *  embarrassed = small wavy lip line.
       *  Open-mouth path is wider + filled so it reads as "ha ha"
       *  rather than a static smile during the laugh poses. */}
      {effectivePose === "yawn" ? (
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
      ) : effectivePose === "panicked" ? (
        /* Panicked: small "O" of surprise. Slightly taller than wide so
         * it reads as a quick gasp rather than a yawn. */
        <ellipse
          cx="20"
          cy="23"
          rx="0.9"
          ry="1.1"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="0.4"
        />
      ) : effectivePose === "amazed" ? (
        /* Amazed: wider open ellipse "wow." Larger than panicked but
         * still distinct from the yawn shape. */
        <ellipse
          cx="20"
          cy="23.2"
          rx="1.4"
          ry="1.6"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="0.4"
        />
      ) : effectivePose === "embarrassed" ? (
        /* Embarrassed: small wavy lip — slight S-curve to suggest a
         * sheepish, off-center grimace rather than a clean smile. */
        <path d="M17.8 22.6 Q 19 23.4, 20 22.8 T 22.2 22.6" />
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

      {effectivePose === "double-wave" && (
        <>
          {/* BOTH arms raised in the air, waving continuously. Geometry
              is reused verbatim from the `cheering` two-arm V (hand
              dots, no triangle fingers). Each arm is wrapped in its own
              <g> running the same infinite 700ms wave keyframe as the
              single-arm `waving` pose, rotating about that arm's
              shoulder joint. The right arm uses .waveArmRight, whose
              keyframe is phase-shifted by half a cycle (same trick as
              the typing-on-laptop hands) so the two arms wave out of
              lockstep rather than mirroring perfectly. The arms stay UP
              the whole time; the wave is a small rotation about the
              shoulder, never a lowering. Symmetric, so no flip. */}
          <g
            className={
              animated
                ? `${styles.waveArmLeftUp} ${styles.animated}`
                : undefined
            }
          >
            <path d="M12 18 L8 10" />
            <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
          </g>
          <g
            className={
              animated
                ? `${styles.waveArmRightUp} ${styles.animated}`
                : undefined
            }
          >
            <path d="M28 18 L32 10" />
            <circle cx="32" cy="10" r="1" fill="currentColor" stroke="none" />
          </g>
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
          {/* Classic thought-bubble convention: two small cascading
           *  mini-bubbles trailing up from the head to a fluffy cloud
           *  containing a question mark. Distinct from `sleeping` (which
           *  uses Zzz letters), so a glance reads as "thinking" not
           *  "snoozing." Cloud + bubbles use white fill with a
           *  currentColor outline so the silhouette pops against any
           *  background. The "?" inherits currentColor (sky-500) and
           *  sits centered in the cloud at extra-bold weight for crisp
           *  legibility at small sizes. */}
          <circle
            cx="28.5"
            cy="11"
            r="0.7"
            fill="white"
            stroke="currentColor"
            strokeWidth="0.4"
          />
          <circle
            cx="30.5"
            cy="9"
            r="1"
            fill="white"
            stroke="currentColor"
            strokeWidth="0.5"
          />
          {/* Cloud silhouette: single path with 4 rounded bumps along
           *  the top, gentle curves on the sides, flat bottom. */}
          <path
            d="M 31 6.5 Q 29.5 6.5 29.5 5 Q 29.5 3.5 31 3 Q 31 1.5 33 1.5 Q 34 0.5 35.5 1.5 Q 37 0.5 38 2 Q 40 2.5 40 4 Q 41 5.5 39.5 6 Q 38 7 31 6.5 Z"
            fill="white"
            stroke="currentColor"
            strokeWidth="0.6"
          />
          {/* Thinking ellipsis — three small dots inside the cloud, the
           *  universal "loading thoughts" indicator. Swapped from "?"
           *  (Grant 2026-05-23) because the question-mark curl + tail
           *  dot inside the rounded cloud read unfortunately. Ellipsis
           *  is anatomically unambiguous + matches the generic-thinking
           *  read better than "?" (which implies confusion / puzzlement
           *  rather than processing). */}
          <circle cx="33" cy="4" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="35" cy="4" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="37" cy="4" r="0.7" fill="currentColor" stroke="none" />
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

      {/* Panicked: scene-tone pose for "something startling just
       *  happened" beats (Ladder fall, Centrifuge explosion). Wide
       *  circle eyes + small "O" mouth render above. Here we add the
       *  arm geometry: both arms thrown out wide in a Y-shape, palms
       *  open (hand dots), direction-agnostic so flipping is
       *  unnecessary. The wider angle (vs. cheering's V) is what makes
       *  this read as "alarm" rather than "celebration." */}
      {effectivePose === "panicked" && (
        <>
          {/* Left arm: out and slightly down, wider than cheering's V. */}
          <path d="M12 18 L6 12" />
          {/* Right arm: mirror of the left, out and slightly down. */}
          <path d="M28 18 L34 12" />
          {/* Open palms: hand dots at the ends of each arm. */}
          <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="34" cy="12" r="1" fill="currentColor" stroke="none" />
          {/* Two small surprise marks at the upper corners — a single
           *  short stroke each, suggesting motion lines. */}
          <path
            d="M 4 8 L 5.2 9.2"
            stroke="currentColor"
            strokeWidth="0.9"
          />
          <path
            d="M 36 8 L 34.8 9.2"
            stroke="currentColor"
            strokeWidth="0.9"
          />
        </>
      )}

      {/* Amazed: scene-tone pose for "wondrous moment" beats (Eureka
       *  bulb-on, TooManyBeakers phew save). Wide oval eyes + open
       *  ellipse mouth render above. Here we add the arms: hands
       *  clasped low in front of the body, suggesting reverent /
       *  amazed posture (both arms come in toward the centerline at
       *  roughly waist height). Sparkles flank the head to amplify
       *  the "wow." */}
      {effectivePose === "amazed" && (
        <>
          {/* Left arm: in toward the centerline at waist height. */}
          <path d="M14 22 L18 26" />
          {/* Right arm: mirror, meeting the left at the clasp point. */}
          <path d="M26 22 L22 26" />
          {/* Clasped hands: small overlapping circles at the meet
           *  point, slightly larger than a single hand dot so the
           *  clasp reads as two hands held together. */}
          <circle cx="19" cy="26.4" r="1" fill="currentColor" stroke="none" />
          <circle cx="21" cy="26.4" r="1" fill="currentColor" stroke="none" />
          {/* Sparkles flanking the head: classic four-point sparkle
           *  glyphs that amplify the "wow" mood. */}
          <path
            d="M 5 10 L 7 10 M 6 9 L 6 11"
            stroke="currentColor"
            strokeWidth="0.9"
          />
          <path
            d="M 33 10 L 35 10 M 34 9 L 34 11"
            stroke="currentColor"
            strokeWidth="0.9"
          />
          <path
            d="M 8 5 L 9 5 M 8.5 4.5 L 8.5 5.5"
            stroke="currentColor"
            strokeWidth="0.7"
          />
          <path
            d="M 31 5 L 32 5 M 31.5 4.5 L 31.5 5.5"
            stroke="currentColor"
            strokeWidth="0.7"
          />
        </>
      )}

      {/* Embarrassed: scene-tone pose for "post-mistake reaction"
       *  beats (Centrifuge post-explosion, TooManyBeakers post-drop).
       *  Half-closed eyes + wavy mouth render above. Here we add the
       *  characteristic sheepish "rubbing the back of the head" hand
       *  gesture: one arm raised up and curving back, hand dot
       *  positioned just above and behind the head. The other arm
       *  hangs down loosely at the side. Two small pink blush dots
       *  on each cheek. */}
      {effectivePose === "embarrassed" && (
        <>
          {/* Right arm: raised up and back toward the head — classic
           *  "rubbing the back of the neck" sheepish gesture. The
           *  curve uses a quadratic so the arm reads as bent at the
           *  elbow rather than a straight stick. */}
          <path d="M 28 18 Q 33 14, 30 8" fill="none" />
          {/* Hand at the back of the head. */}
          <circle cx="30" cy="8" r="1" fill="currentColor" stroke="none" />
          {/* Left arm: hangs down loosely at the side, slightly bent. */}
          <path d="M 12 20 Q 10 24, 11 28" fill="none" />
          <circle cx="11" cy="28" r="0.9" fill="currentColor" stroke="none" />
          {/* Cheek blush: small pink semicircle dots on each cheek.
           *  Sits just above the measurement-mark cheek dashes (y=26)
           *  so the blush + dashes don't visually collide. */}
          <circle
            cx="14.5"
            cy="22"
            r="1"
            fill="#F9A8D4"
            stroke="none"
            opacity="0.85"
          />
          <circle
            cx="25.5"
            cy="22"
            r="1"
            fill="#F9A8D4"
            stroke="none"
            opacity="0.85"
          />
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

      {/* Heart easter-egg overlay layer. Rendered LAST in document order
       *  so the hearts paint on top of everything else (SVG has no z-index;
       *  paint order is document order). Each heart is keyed by its spawn
       *  id and applies its own staggered .heartPop animation via the
       *  inline --heart-drift-x var. The container itself never renders
       *  unless easterEgg="heart" so other instances pay zero DOM cost. */}
      {easterEgg === "heart" && hearts.length > 0 && (
        <g className={styles.heartLayer} aria-hidden="true">
          {hearts.map((h) => (
            <g
              key={h.id}
              className={styles.heartPop}
              style={
                {
                  ["--heart-drift-x" as string]: `${h.driftX}px`,
                } as React.CSSProperties
              }
            >
              <path d={HEART_PATH} fill={HEART_FILL} stroke="none" />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
