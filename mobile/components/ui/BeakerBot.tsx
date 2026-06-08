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
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
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
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const SKY = '#1AA0E6';

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
}

// Inclusive random in [min, max). Called at runtime (in an effect, never module
// scope) so each living instance picks its own de-synced timings.
function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function BeakerBot({ size = 80, color = SKY, alive = false }: BeakerBotProps) {
  const width = size * ASPECT;
  const height = size;

  // Reduce-motion gate. Start permissive, flip to true if the OS asks for less
  // motion. A living instance that learns reduce-motion is on cancels its loops
  // and falls back to the static silhouette.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (active) setReduceMotion(on);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (on) => setReduceMotion(on),
    );
    return () => {
      active = false;
      sub?.remove?.();
    };
  }, []);

  const animate = alive && !reduceMotion;

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
    return {
      transform: [
        { translateY: lift },
        { translateX: baseShift },
        { rotate: `${rotate}deg` },
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
    </Svg>
  );

  if (!animate) return svg;

  // Wrap in an Animated.View for the whole-body sway. Sized to the svg so the
  // rotate pivots near its own footprint.
  return (
    <Animated.View style={[{ width, height }, swayStyle]}>{svg}</Animated.View>
  );
}
