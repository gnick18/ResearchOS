/**
 * BeakerBot vector mark. Geometry ported verbatim from brand/beakerbot-mark.svg
 * (which is itself derived from frontend/src/components/BeakerBot.tsx). Rendered
 * via react-native-svg so it scales crisply at any size.
 *
 * SVG viewBox from the master: "8 3 24 31" (24-wide, 31-tall).
 * Stroke color is sky #1AA0E6 (brand primary). Rainbow liquid gradient fills
 * the lower body. Eyes are solid sky discs. Mouth is an upward arc.
 *
 * Living mascot. When `alive` is true the mark gains the website's three
 * idle channels, ported to react-native-reanimated:
 *   - blink  scaleY of the eye group, snapping closed for ~140ms once a cycle.
 *   - sway   a gentle whole-body rock (translateY + small rotate) pivoting near
 *            the beaker base, the "breathing" beat.
 *   - gaze   the pupils drift on uneven waypoints so he looks idly around.
 * Each channel runs its own randomized duration + initial offset (picked at
 * mount) so two living bots never animate in lockstep, matching the web cadence.
 * When `alive` is false (the default) the render is pixel-identical to the
 * static mark, so every existing call site is unchanged.
 *
 * Heart-on-tap easter egg. Ported from the web BeakerBot (frontend). When the
 * mark is `alive`, tapping it runs a brief body wobble (~200ms squash) and
 * spawns a pink heart that pops, drifts upward, and fades over ~700ms, then is
 * removed. Rapid taps stack hearts (capped at 6) and each spawn fans out
 * horizontally via a drift cycle, so a spam-tap reads as "hearts everywhere."
 * A light haptic fires per tap. Reduce-motion skips the wobble + heart entirely
 * (a tap is inert). The static (`alive=false`) render is unchanged and inert.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';

import { hapticImpact, useReduceMotion } from '@/lib/interaction-prefs';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const SKY = '#1AA0E6';

// ---- Heart easter-egg config (ported from web BeakerBot.tsx) ---------------
// Cap concurrent hearts so a spam-tap doesn't queue an unbounded number of
// animated nodes. Six reads as "hearts everywhere" without thrashing.
const HEART_MAX_CONCURRENT = 6;
// Lifetime matches the pop/drift/fade animation (700ms) so each instance is
// removed as soon as its animation completes.
const HEART_LIFETIME_MS = 700;
// Brief root wobble after a tap (squash beat).
const HEART_WOBBLE_MS = 200;
// Horizontal drift presets cycled per spawn so rapid taps fan out left + right
// instead of stacking exactly. Units are view-box pixels (verbatim from web).
const HEART_DRIFT_X_PATTERN = [0, -4, 3, -2, 5, -5, 2, -3];
// Warm pink/rose, reads against the sky silhouette (verbatim from web).
const HEART_FILL = '#ff5b8a';
// Classic two-lobe heart with a downward point, ~7 view-box units wide,
// centered near (20, 14) just above the eyes (eyes sit at y=18). Verbatim from
// the web mark; the mobile viewBox shares the same x/y unit system (body spans
// x 12..28 in both), so the path drops in unchanged.
const HEART_PATH =
  'M 20 12 C 18.5 10.5, 16.5 10.5, 16.5 12.8 C 16.5 14.8, 18.5 16, 20 17 C 21.5 16, 23.5 14.8, 23.5 12.8 C 23.5 10.5, 21.5 10.5, 20 12 Z';
// Heart center, used as the transform pivot for the pop scale + drift.
const HEART_CX = 20;
const HEART_CY = 14;

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface HeartInstance {
  /** Monotonic id, the React key. */
  id: number;
  /** Per-spawn horizontal drift offset (view-box units). */
  driftX: number;
}

/**
 * A single popped heart. Drives one Reanimated progress value 0..1 over 700ms
 * and maps it to scale (pop overshoot then settle), translateY (upward drift),
 * translateX (fan-out toward driftX), and opacity (in then out). On completion
 * it calls onDone so the parent removes it from state.
 */
function Heart({ driftX, onDone }: { driftX: number; onDone: () => void }) {
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withTiming(
      1,
      { duration: HEART_LIFETIME_MS, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
    return () => cancelAnimation(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirrors the web @keyframes beakerBotHeartPop waypoints:
  //   0%   opacity 0, scale 0.2, no drift
  //   15%  opacity 1, scale 0.6, ty -1
  //   25%  scale 1.2 (pop overshoot), ty -2
  //   40%  scale 1.0, ty -4
  //   100% opacity 0, scale 1.0, ty -14 + driftX
  const animatedProps = useAnimatedProps(() => {
    const t = p.value;
    let scale: number;
    let ty: number;
    let opacity: number;
    if (t < 0.15) {
      const k = t / 0.15;
      scale = 0.2 + (0.6 - 0.2) * k;
      ty = -1 * k;
      opacity = k; // 0 -> 1
    } else if (t < 0.25) {
      const k = (t - 0.15) / 0.1;
      scale = 0.6 + (1.2 - 0.6) * k;
      ty = -1 + (-2 - -1) * k;
      opacity = 1;
    } else if (t < 0.4) {
      const k = (t - 0.25) / 0.15;
      scale = 1.2 + (1.0 - 1.2) * k;
      ty = -2 + (-4 - -2) * k;
      opacity = 1;
    } else {
      const k = (t - 0.4) / 0.6;
      scale = 1;
      ty = -4 + (-14 - -4) * k;
      opacity = 1 - k; // 1 -> 0
    }
    // Fan out horizontally over the drift leg only (matches the web, where
    // --heart-drift-x is only reached at the 100% keyframe).
    const tx = driftX * Math.max(0, (t - 0.4) / 0.6);
    return {
      opacity,
      // Scale about the heart center, then drift. SVG applies the transform
      // list left-to-right, so translate-to-center -> scale -> translate-back,
      // with the drift folded into the center translate.
      transform: [
        { translateX: HEART_CX + tx },
        { translateY: HEART_CY + ty },
        { scale },
        { translateX: -HEART_CX },
        { translateY: -HEART_CY },
      ],
    } as any;
  });

  return (
    <AnimatedPath
      d={HEART_PATH}
      fill={HEART_FILL}
      stroke="none"
      animatedProps={animatedProps}
    />
  );
}

// viewBox from the master SVG was "8 3 24 31", but the spout-curl paths reach
// up to y=1, so y=3 cropped the top of his head. Widen the top (y=0, height=34)
// to give the curl room, matching x + bottom.
const VB_X = 8;
const VB_Y = 0;
const VB_W = 24;
const VB_H = 34;
const ASPECT = VB_W / VB_H; // ~0.706

// Eye geometry (view-box units). Both eyes share the y=18 baseline. The blink
// scales the eye group about this shared center so the lids close toward the
// eyes, not the svg origin. Mirrors the web blink transform-origin of 20,18.
const EYE_LEFT_X = 17;
const EYE_RIGHT_X = 23;
const EYE_Y = 18;

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface BeakerBotProps {
  /** Overall height in dp. Width scales proportionally (24:31 aspect). */
  size?: number;
  /** Override the ink/stroke color. Defaults to brand sky #1AA0E6. */
  color?: string;
  /**
   * Opt the mark into the living idle (blink + sway + gaze). Default false, so
   * every existing usage stays a static silhouette. Decorative hero contexts
   * (the Home BeakerBotMark) opt in. Honors the OS reduce-motion setting, when
   * reduce-motion is on the mark renders static even with `alive` set.
   */
  alive?: boolean;
  /**
   * Per-instance tap easter egg, mirrors the web BeakerBot.
   *  - "heart" (the default whenever the bot is `alive`): tapping runs a brief
   *    body wobble + a pink heart pop/drift/fade, rapid taps stack up to 6.
   *  - "none": tap is inert.
   * Only takes effect when `alive` is true and reduce-motion is off. Static
   * inline marks (alive=false) stay inert regardless.
   */
  easterEgg?: 'heart' | 'none';
}

// Inclusive random in [min, max). Called at runtime (in an effect, never module
// scope) so each living instance picks its own de-synced timings.
function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function BeakerBot({
  size = 80,
  color = SKY,
  alive = false,
  easterEgg = 'heart',
}: BeakerBotProps) {
  const width = size * ASPECT;
  const height = size;

  // Reduce-motion gate. Start permissive, flip to true if the OS asks for less
  // motion. A living instance that learns reduce-motion is on cancels its loops
  // and falls back to the static silhouette.
  const reduceMotion = useReduceMotion();

  const animate = alive && !reduceMotion;

  // Tap easter egg is live only when the bot is animated (alive + reduce-motion
  // off) and the caller hasn't opted out. Static inline marks stay inert.
  const eggActive = animate && easterEgg === 'heart';

  // ----- heart easter egg --------------------------------------------------
  // Live hearts (each carries its own id + driftX). A monotonic counter feeds
  // both the unique id and the index into the fan-out drift pattern.
  const [hearts, setHearts] = useState<HeartInstance[]>([]);
  const heartCounterRef = useRef(0);
  // Brief root squash after a tap. 0 = rest, 1 = mid-wobble; driven once per tap.
  const wobble = useSharedValue(0);

  const removeHeart = useCallback((id: number) => {
    setHearts((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const handleTap = useCallback(() => {
    if (!eggActive) return;
    // One clean light-impact cue per tap. A single haptic stays pleasant under a
    // rapid spam-tap (stacking a success notification on top read as buzzy).
    hapticImpact();

    const id = heartCounterRef.current++;
    const driftX =
      HEART_DRIFT_X_PATTERN[id % HEART_DRIFT_X_PATTERN.length] ?? 0;
    setHearts((prev) => {
      const next = [...prev, { id, driftX }];
      // Cap concurrent hearts: drop the oldest beyond the cap.
      return next.length > HEART_MAX_CONCURRENT
        ? next.slice(next.length - HEART_MAX_CONCURRENT)
        : next;
    });

    // Brief squash beat. Restart cleanly so a rapid second tap re-fires it.
    cancelAnimation(wobble);
    wobble.value = 0;
    wobble.value = withSequence(
      withTiming(1, { duration: HEART_WOBBLE_MS * 0.4, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: HEART_WOBBLE_MS * 0.6, easing: Easing.inOut(Easing.quad) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eggActive]);

  // ----- shared values, one driver per channel -----------------------------
  // sway: progress 0..1 fed into the rock keyframe (translateY + rotate).
  const sway = useSharedValue(0);
  // blink: 1 = eyes open, scaleY drops toward 0.08 for the snap-closed frame.
  const blink = useSharedValue(1);
  // gaze: x/y pupil offset in view-box units.
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);

  useEffect(() => {
    if (!animate) {
      // Park every channel at its resting pose so the static look is exact.
      cancelAnimation(sway);
      cancelAnimation(blink);
      cancelAnimation(gazeX);
      cancelAnimation(gazeY);
      sway.value = 0;
      blink.value = 1;
      gazeX.value = 0;
      gazeY.value = 0;
      return;
    }

    // Per-channel randomized durations (ms) + lead-in offsets, matching the web
    // ranges. The web uses negative animation-delay to start mid-cycle so bots
    // are out of phase on the first frame. Reanimated has no negative delay, so
    // we instead give each channel a random positive lead-in before its first
    // loop, which achieves the same de-sync across instances.
    const ease = Easing.inOut(Easing.sin); // smooth, breathing, never harsh.

    // SWAY 5.6-7.2s, one full there-and-back per cycle (0 -> 1 -> 0).
    const swayDur = rand(5600, 7200);
    sway.value = withRepeat(
      withSequence(
        withTiming(1, { duration: swayDur / 2, easing: ease }),
        withTiming(0, { duration: swayDur / 2, easing: ease }),
      ),
      -1,
      false,
    );

    // BLINK 4.4-6.4s cycle. Eyes hold open, snap closed (~70ms each way, ~140ms
    // total) once per cycle, then hold open for the rest. A random lead-in delay
    // de-syncs the first blink across instances.
    const blinkDur = rand(4400, 6400);
    const blinkLead = rand(0, blinkDur); // when in the cycle the first blink lands
    const openHold = Math.max(0, blinkDur - 140); // ms spent fully open per cycle
    blink.value = withDelay(
      blinkLead,
      withRepeat(
        withSequence(
          withTiming(0.08, { duration: 70, easing: ease }),
          withTiming(1, { duration: 70, easing: ease }),
          withTiming(1, { duration: openHold, easing: Easing.linear }),
        ),
        -1,
        false,
      ),
    );

    // GAZE 6.5-9s. Uneven waypoints (web: 20/45/70/85%) so it reads as idle
    // looking-around. We drive x and y as one synced sequence sharing the cycle.
    const gazeDur = rand(6500, 9000);
    const seg = (frac: number) => gazeDur * frac;
    // Web waypoints at 0,20,45,70,85,100%. Per-leg fractions + targets.
    const legs = [0.2, 0.25, 0.25, 0.15, 0.15];
    const xPts = [0.6, -0.4, 0.5, -0.6, 0]; // targets after the resting 0
    const yPts = [-0.2, 0.4, 0.3, -0.3, 0];
    const gazeLead = rand(0, gazeDur);
    gazeX.value = withDelay(
      gazeLead,
      withRepeat(
        withSequence(
          ...legs.map((f, i) =>
            withTiming(xPts[i], { duration: seg(f), easing: ease }),
          ),
        ),
        -1,
        false,
      ),
    );
    gazeY.value = withDelay(
      gazeLead,
      withRepeat(
        withSequence(
          ...legs.map((f, i) =>
            withTiming(yPts[i], { duration: seg(f), easing: ease }),
          ),
        ),
        -1,
        false,
      ),
    );

    return () => {
      cancelAnimation(sway);
      cancelAnimation(blink);
      cancelAnimation(gazeX);
      cancelAnimation(gazeY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  // ----- worklets ----------------------------------------------------------
  // Whole-body sway, applied to the wrapping Animated.View. The web pivots at
  // 50% 80% (near the beaker base). RN rotates about the view center, so we
  // approximate a base pivot by pairing the rotate with a small counter shift so
  // the top swings while the base stays roughly put, plus the breathing lift.
  // Amplitude is scaled to the rendered size so it reads the same at any size.
  const swayStyle = useAnimatedStyle(() => {
    const phase = sway.value * 2 - 1; // -1 .. 1
    const rotate = phase * 2.2; // +/-2.2deg, matches the web
    const lift = -0.006 * height * sway.value; // up to -0.6% height at mid-cycle
    const baseShift = -phase * height * 0.012; // counter-shift to fake a base pivot
    // Tap squash (mirrors the web beakerBotHeartWobble keyframe peak: a brief
    // squash to scaleX 1.08 / scaleY 0.92 with a small downward nudge, easing
    // back to rest). `wobble` ramps 0 -> 1 -> 0 over ~200ms per tap.
    const w = wobble.value;
    const scaleX = 1 + 0.08 * w;
    const scaleY = 1 - 0.08 * w;
    const wobbleLift = 0.02 * height * w; // small downward nudge at the peak
    return {
      transform: [
        { translateY: lift + wobbleLift },
        { translateX: baseShift },
        { rotate: `${rotate}deg` },
        { scaleX },
        { scaleY },
      ],
    };
  });

  // Blink scales the eye group's Y about the shared eye center. translate to the
  // origin, scaleY, translate back, expressed as an svg transform list.
  const eyeBlinkProps = useAnimatedProps(() => {
    const s = blink.value;
    return {
      transform: [
        { translateY: EYE_Y },
        { scaleY: s },
        { translateY: -EYE_Y },
      ],
    } as any;
  });

  // Gaze nudges each pupil. cx/cy animate by the same small offset so both eyes
  // track together (web drives both pupils off one keyframe set).
  const leftPupilProps = useAnimatedProps(() => ({
    cx: EYE_LEFT_X + gazeX.value,
    cy: EYE_Y + gazeY.value,
  }));
  const rightPupilProps = useAnimatedProps(() => ({
    cx: EYE_RIGHT_X + gazeX.value,
    cy: EYE_Y + gazeY.value,
  }));

  const StaticEyes = (
    <>
      <Circle cx={EYE_LEFT_X} cy={EYE_Y} r={1.2} fill={color} />
      <Circle cx={EYE_RIGHT_X} cy={EYE_Y} r={1.2} fill={color} />
    </>
  );

  const svg = (
    <Svg
      width={width}
      height={height}
      viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
      fill="none"
    >
      <Defs>
        {/* Pastel rainbow gradient identical to the SVG master (light-mode palette) */}
        <LinearGradient id="liq" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFD2B0" />
          <Stop offset="25%" stopColor="#FFF1A8" />
          <Stop offset="50%" stopColor="#B7EBB1" />
          <Stop offset="75%" stopColor="#A6D2F4" />
          <Stop offset="100%" stopColor="#D6B5F0" />
        </LinearGradient>
      </Defs>

      {/* Body fill (white behind the gradient so it shows through) */}
      <Path
        d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
        fill="white"
      />

      {/* Rainbow liquid fill in the lower body */}
      <Path
        d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"
        fill="url(#liq)"
      />

      {/* Spout / nozzle arc at the top-right */}
      <Path
        d="M22 8 C 22 6, 24 4, 26 6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Beaker outline */}
      <Path
        d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Top rim / neck */}
      <Path
        d="M11 12 L29 12"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Eyes. Static when not living, otherwise the blink group wraps two
          pupils that drift with the gaze channel. */}
      {animate ? (
        <AnimatedG animatedProps={eyeBlinkProps}>
          <AnimatedCircle animatedProps={leftPupilProps} r={1.2} fill={color} />
          <AnimatedCircle animatedProps={rightPupilProps} r={1.2} fill={color} />
        </AnimatedG>
      ) : (
        StaticEyes
      )}

      {/* Smile */}
      <Path
        d="M18 22 Q 20 24, 22 22"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Shoulder tabs (decorative tick marks at the collar) */}
      <Path
        d="M14 26 L15.5 26"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M24.5 26 L26 26"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />

      {/* Heart easter-egg layer. Painted last so hearts float over the body.
          Each heart pops, drifts upward, and fades, then removes itself. They
          spawn near (20, 14) just above the eyes and stay within the viewBox
          (drift tops out at y=0), so no clipping. */}
      {hearts.map((h) => (
        <Heart
          key={h.id}
          driftX={h.driftX}
          onDone={() => removeHeart(h.id)}
        />
      ))}
    </Svg>
  );

  if (!animate) return svg;

  // Wrap in an Animated.View for the whole-body sway + tap squash. Sized to the
  // svg so the rotate pivots near its own footprint. When the heart easter egg
  // is live, the wrapper is a Pressable so a tap fires the wobble + heart.
  const body = (
    <Animated.View style={[{ width, height }, swayStyle]}>{svg}</Animated.View>
  );

  if (!eggActive) return body;

  return (
    <Pressable
      onPress={handleTap}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="BeakerBot"
      style={{ width, height }}
    >
      {body}
    </Pressable>
  );
}
