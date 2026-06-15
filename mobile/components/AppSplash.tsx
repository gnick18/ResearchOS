/**
 * AppSplash. A full-screen branded launch overlay that hands off from the native
 * Expo splash without a white flash, plays the "BeakerBot wakes up" reveal, then
 * shrinks and fades out to reveal the app underneath.
 *
 * Flow: the native splash stays up via SplashScreen.preventAutoHideAsync until JS
 * is ready. The root layout (app/_layout.tsx) then hides the native splash and
 * mounts this overlay over the live app. The overlay background matches the theme
 * canvas (light #f2f3f7, dark #0a0e1a) so the swap is seamless. After the reveal
 * the whole lockup shrinks (scale 1 -> 0.88) and fades out, then onFinish fires
 * and the layout unmounts the overlay, revealing the real UI. The onFinish exit
 * contract and the native handoff in _layout.tsx are unchanged.
 *
 * The reveal is drawn with @shopify/react-native-skia (a Skia Canvas), using the
 * mark's verbatim brand geometry (viewBox "8 3 24 31"). Beats (about 2.4s):
 *   1. Beaker glass outline + rim + spout DRAW on (Skia Path start/end trim), a
 *      soft drop-shadow blooms underneath the mark.
 *   2. Rainbow LIQUID rises into the beaker, clipped to the beaker shape, with a
 *      wavy top surface (continuous Skia clock) and two bubbles that float up and
 *      pop.
 *   3. BeakerBot WAKES: eyes pop in, one blink, the smile draws on.
 *   4. A spout SPARKLE twinkles and the wordmark "ResearchOS" settles in with a
 *      subtle per-letter fade-up.
 *   5. One gentle breathe (the living mark), then the shrink + fade handoff.
 *
 * Animation wiring: one Reanimated shared value `progress` (0..1 over the beat
 * timeline, linear withTiming) drives the choreography, mapped per-beat through a
 * `beatOf()` worklet (sub-window + eased). A Skia `useClock()` drives the
 * continuous, non-choreographed motion (the liquid surface wave + the breathe).
 * Skia DOM nodes read Reanimated `useDerivedValue` outputs directly as props,
 * which is the idiomatic Skia 2.x + Reanimated 4.x integration (no Skia-specific
 * value system). The whole-overlay shrink + fade is a separate Reanimated value
 * pair driving an Animated.View wrapper, and the wordmark is overlaid as a set of
 * react-native Animated.Text glyphs so it reads crisply without bundling a font.
 *
 * Reduce-motion: if AccessibilityInfo.isReduceMotionEnabled() is true we skip the
 * whole choreography and just fade the static lockup in then out, then onFinish.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  Skia,
  useClock,
  vec,
} from '@shopify/react-native-skia';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

// ---- Theme colors ---------------------------------------------------------
// Canvas matches the theme background (near-white light-grey, dark navy off-black)
// so the JS overlay swaps in over the native splash without a flash.
const CANVAS_LIGHT = '#f2f3f7';
const CANVAS_DARK = '#0a0e1a';
// Beaker glass fill behind the rising liquid (white in light, a deep card in dark).
const GLASS_LIGHT = '#ffffff';
const GLASS_DARK = '#0f1626';
// Brand sky, the beaker stroke + eyes.
const SKY = '#1AA0E6';
// Wordmark color per scheme.
const WORD_LIGHT = '#0c1830';
const WORD_DARK = '#ffffff';

// Signature rainbow ramp. Light = pastel, dark = vivid (matches the app).
const RAINBOW_LIGHT = ['#FFD2B0', '#FFF1A8', '#B7EBB1', '#A6D2F4', '#D6B5F0'];
const RAINBOW_DARK = ['#F97316', '#E8920B', '#16A34A', '#0284C7', '#9333EA'];
const RAINBOW_POS = [0, 0.25, 0.5, 0.75, 1];

// ---- Verbatim brand geometry (viewBox "8 3 24 31") ------------------------
// These are the exact paths from brand/beakerbot-mark.svg / BeakerBot.tsx. They
// are expressed in view-box units; a Group transform scales them into pixels.
const D_GLASS_FILL =
  'M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z';
const D_LIQUID =
  'M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z';
const D_SPOUT = 'M22 8 C 22 6, 24 4, 26 6';
const D_OUTLINE = 'M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12';
const D_RIM = 'M11 12 L29 12';
const D_SMILE = 'M18 22 Q 20 24, 22 22';
const D_FOOT_L = 'M14 26 L15.5 26';
const D_FOOT_R = 'M24.5 26 L26 26';
// Sparkle, two crossed strokes near the spout tip (a four-point twinkle).
const D_SPARK = 'M26.5 3 L26.5 7 M24.5 5 L28.5 5';

// Eyes.
const EYE_L = { cx: 17, cy: 18, r: 1.2 };
const EYE_R = { cx: 23, cy: 18, r: 1.2 };
// Beaker stroke width in view-box units.
const STROKE = 2;

// Bubbles inside the liquid (view-box units, near the base).
const BUB_1 = { cx: 17, cy: 29, r: 0.7 };
const BUB_2 = { cx: 22, cy: 30, r: 0.6 };

// ---- Timeline (ms) --------------------------------------------------------
// The choreography runs over BEATS_MS, then a tiny settle and the exit. Total
// wall time is about 2.4s of beats + the shrink-out exit.
const BEATS_MS = 2200;
const EXIT_MS = 480;
const EXIT_DELAY_MS = 120; // tiny settle after the last beat before shrinking out
const REDUCE_IN_MS = 280;
const REDUCE_HOLD_MS = 500;

// Beat windows as fractions of `progress` (0..1 over BEATS_MS). Each entry is the
// [start, end] of that element's own animation within the timeline.
const W = {
  shadow: [0.1, 0.32],
  glass: [0.0, 0.26],
  rim: [0.06, 0.2],
  spout: [0.14, 0.34],
  liquid: [0.2, 0.62],
  bub1: [0.34, 0.62],
  bub2: [0.42, 0.7],
  feet: [0.36, 0.5],
  eyeL: [0.42, 0.56],
  eyeR: [0.46, 0.6],
  blink: [0.66, 0.74],
  smile: [0.52, 0.66],
  spark: [0.6, 0.86],
  word: [0.66, 1.0], // per-letter stagger lives inside this window
} as const;

export interface AppSplashProps {
  /** Called once the shrink-out exit animation has fully finished. */
  onFinish: () => void;
}

// beatOf() maps the global progress to a per-element 0..1, eased (cubic ease-out)
// so draw-ons and pops feel silky. A pure worklet, safe inside useDerivedValue.
function beatOf(p: number, a: number, b: number): number {
  'worklet';
  if (p <= a) return 0;
  if (p >= b) return 1;
  const t = (p - a) / (b - a);
  return 1 - Math.pow(1 - t, 3);
}

export function AppSplash({ onFinish }: AppSplashProps) {
  const scheme = useColorScheme() ?? 'light';
  const dark = scheme === 'dark';
  const { width, height } = useWindowDimensions();

  const bg = dark ? CANVAS_DARK : CANVAS_LIGHT;
  const glassFill = dark ? GLASS_DARK : GLASS_LIGHT;
  const ramp = dark ? RAINBOW_DARK : RAINBOW_LIGHT;
  const wordColor = dark ? WORD_DARK : WORD_LIGHT;
  const sparkColor = dark ? '#FFF1A8' : SKY;
  const shadowColor = dark ? '#000000' : SKY;

  // Reduce-motion gate. Resolve once on mount; until then we hold the entrance
  // back so we never start a full choreography we would have skipped.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  // Choreography driver (0..1 over BEATS_MS). Continuous clock for wave/breathe.
  const progress = useSharedValue(0);
  const clock = useClock();

  // Whole-overlay exit (shrink + fade).
  const exitScale = useSharedValue(1);
  const exitOpacity = useSharedValue(1);

  // Reduce-motion simple fade for the whole lockup.
  const reduceOpacity = useSharedValue(0);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (active) setReduceMotion(on);
      })
      .catch(() => {
        if (active) setReduceMotion(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return; // wait for the gate to resolve

    const finishExit = (finished?: boolean) => {
      'worklet';
      if (finished) {
        runOnJS(onFinish)();
      }
    };

    if (reduceMotion) {
      // Quick fade in, brief hold, quick fade out, then finish. No choreography.
      reduceOpacity.value = withTiming(1, {
        duration: REDUCE_IN_MS,
        easing: Easing.out(Easing.cubic),
      });
      exitOpacity.value = withDelay(
        REDUCE_IN_MS + REDUCE_HOLD_MS,
        withTiming(
          0,
          { duration: EXIT_MS, easing: Easing.out(Easing.cubic) },
          finishExit,
        ),
      );
      return () => {
        cancelAnimation(reduceOpacity);
        cancelAnimation(exitOpacity);
      };
    }

    // Full reveal. Drive progress linearly across the beat timeline, then settle
    // briefly and run the shrink + fade exit.
    progress.value = withTiming(1, {
      duration: BEATS_MS,
      easing: Easing.linear,
    });

    exitScale.value = withDelay(
      BEATS_MS + EXIT_DELAY_MS,
      withTiming(0.88, { duration: EXIT_MS, easing: Easing.in(Easing.cubic) }),
    );
    exitOpacity.value = withDelay(
      BEATS_MS + EXIT_DELAY_MS,
      withTiming(
        0,
        { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
        finishExit,
      ),
    );

    return () => {
      cancelAnimation(progress);
      cancelAnimation(exitScale);
      cancelAnimation(exitOpacity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // ---- Layout: scale the view-box art into pixels, centered ----------------
  // Art bounds in view-box units. The spout curl reaches y=4 and the rim spans
  // x 11..29, so use x 11..29 (w 18) and y 4..32 (h 28).
  const ART = useMemo(() => {
    const minX = 11;
    const maxX = 29;
    const minY = 4;
    const maxY = 32;
    return {
      w: maxX - minX,
      h: maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    };
  }, []);

  // Target mark height in pixels (about a third of the shorter screen edge,
  // capped so it does not balloon on tablets).
  const cappedMarkPx = Math.min(Math.min(width, height) * 0.34, 220);
  const scale = cappedMarkPx / ART.h;

  // Center the mark a touch above true center to leave room for the wordmark.
  const markCenterX = width / 2;
  const markCenterY = height / 2 - cappedMarkPx * 0.28;

  // Transform mapping view-box units to pixels, art centered on the mark center.
  const markTransform = useMemo(
    () => [
      { translateX: markCenterX },
      { translateY: markCenterY },
      { scale },
      { translateX: -ART.cx },
      { translateY: -ART.cy },
    ],
    [markCenterX, markCenterY, scale, ART.cx, ART.cy],
  );

  // Clip path for the liquid (the glass fill shape). Built once.
  const beakerClip = useMemo(() => Skia.Path.MakeFromSVGString(D_GLASS_FILL)!, []);

  // ---- Draw-on trims (Skia Path start/end) ---------------------------------
  // The stroke trims from end=0 to end=1 as its beat plays.
  const glassEnd = useDerivedValue(() => beatOf(progress.value, W.glass[0], W.glass[1]));
  const rimEnd = useDerivedValue(() => beatOf(progress.value, W.rim[0], W.rim[1]));
  const spoutEnd = useDerivedValue(() => beatOf(progress.value, W.spout[0], W.spout[1]));
  const smileEnd = useDerivedValue(() => beatOf(progress.value, W.smile[0], W.smile[1]));
  const feetEnd = useDerivedValue(() => beatOf(progress.value, W.feet[0], W.feet[1]));

  // ---- Shadow (opacity + scale) --------------------------------------------
  const shadowOpacity = useDerivedValue(() => {
    const t = beatOf(progress.value, W.shadow[0], W.shadow[1]);
    return (dark ? 0.5 : 0.22) * t;
  });
  const shadowTransform = useDerivedValue(() => {
    const t = beatOf(progress.value, W.shadow[0], W.shadow[1]);
    const s = 0.6 + 0.4 * t;
    return [{ scaleX: s }, { scaleY: s }];
  });

  // ---- Liquid rise + wavy surface ------------------------------------------
  // The liquid path is authored with its surface at y=19. We translate it down by
  // RISE units at the start and slide it up to 0 as the liquid beat plays, clipped
  // to the beaker so it reads as filling. A small continuous clock wave rides on
  // top for life.
  const RISE = 13; // view-box units the liquid starts below its resting surface
  const liquidTransform = useDerivedValue(() => {
    const t = beatOf(progress.value, W.liquid[0], W.liquid[1]);
    const ty = RISE * (1 - t);
    const wave = t * 0.18 * Math.sin(clock.value / 320);
    return [{ translateY: ty + wave }];
  });

  // ---- Bubbles: rise + pop --------------------------------------------------
  // Each bubble floats up while fading in, then pops (scales up + fades) at the
  // top of its window. Two derived values per bubble.
  const bub1Opacity = useDerivedValue(() => {
    const t = beatOf(progress.value, W.bub1[0], W.bub1[1]);
    if (t < 0.3) return (t / 0.3) * 0.85;
    if (t < 0.75) return 0.85;
    return 0.85 * (1 - (t - 0.75) / 0.25);
  });
  const bub1Transform = useDerivedValue(() => {
    const t = beatOf(progress.value, W.bub1[0], W.bub1[1]);
    const ty = -9 * t;
    const pop = t < 0.75 ? 1 : 1 + (t - 0.75) / 0.25;
    return [{ translateY: ty }, { scale: pop }];
  });
  const bub2Opacity = useDerivedValue(() => {
    const t = beatOf(progress.value, W.bub2[0], W.bub2[1]);
    if (t < 0.3) return (t / 0.3) * 0.75;
    if (t < 0.75) return 0.75;
    return 0.75 * (1 - (t - 0.75) / 0.25);
  });
  const bub2Transform = useDerivedValue(() => {
    const t = beatOf(progress.value, W.bub2[0], W.bub2[1]);
    const ty = -9 * t;
    const pop = t < 0.75 ? 1 : 1 + (t - 0.75) / 0.25;
    return [{ translateY: ty }, { scale: pop }];
  });
  const bub1Origin = useMemo(() => vec(BUB_1.cx, BUB_1.cy), []);
  const bub2Origin = useMemo(() => vec(BUB_2.cx, BUB_2.cy), []);

  // ---- Eyes: pop in + one blink --------------------------------------------
  // scaleY of the eye group. Pop from 0 to 1 with the eyeL beat, then a single
  // blink (a quick dip toward 0.1 and back) during the blink window.
  const eyeGroupTransform = useDerivedValue(() => {
    const pop = beatOf(progress.value, W.eyeL[0], W.eyeL[1]);
    let blink = 1;
    const p = progress.value;
    if (p > W.blink[0] && p < W.blink[1]) {
      const bt = (p - W.blink[0]) / (W.blink[1] - W.blink[0]); // 0..1
      // V shape: open -> closed at mid -> open.
      blink = 1 - (1 - 0.1) * (1 - Math.abs(bt * 2 - 1));
    }
    const s = pop * blink;
    // Scale about the eye baseline (y=18).
    return [{ translateY: 18 }, { scaleY: s }, { translateY: -18 }];
  });
  const eyeLOpacity = useDerivedValue(() => beatOf(progress.value, W.eyeL[0], W.eyeL[1]));
  const eyeROpacity = useDerivedValue(() => beatOf(progress.value, W.eyeR[0], W.eyeR[1]));

  // ---- Spout sparkle: twinkle ----------------------------------------------
  const sparkOpacity = useDerivedValue(() => {
    const t = beatOf(progress.value, W.spark[0], W.spark[1]);
    return Math.sin(t * Math.PI); // 0 -> 1 -> 0
  });
  const sparkTransform = useDerivedValue(() => {
    const t = beatOf(progress.value, W.spark[0], W.spark[1]);
    const s = 0.4 + 0.9 * Math.sin(t * Math.PI);
    const rot = t * 0.8; // gentle rotation, radians
    return [{ scale: s }, { rotate: rot }];
  });
  const sparkOrigin = useMemo(() => vec(26.5, 5), []);

  // ---- Breathe (continuous, subtle whole-mark lift once settled) -----------
  const breatheTransform = useDerivedValue(() => {
    const gate = Math.max(0, Math.min(1, (progress.value - 0.7) / 0.3));
    const lift = gate * 1.0 * Math.sin(clock.value / 700);
    return [{ translateY: -lift }];
  });
  const breatheOrigin = useMemo(() => vec(ART.cx, ART.cy), [ART.cx, ART.cy]);

  // ---- Wordmark glyph animations (RN Animated.Text overlay) -----------------
  // Each glyph fades up; the stagger spreads across the word window.
  const WORD = 'ResearchOS';
  const wordGlyphStyles = WORD.split('').map((_, i) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => {
      const a = W.word[0];
      const b = W.word[1];
      const span = b - a;
      const per = span * 0.55; // each letter takes ~55% of the window
      const start = a + (span - per) * (i / Math.max(1, WORD.length - 1));
      const p = progress.value;
      let t = 0;
      if (p > start) {
        t = Math.min(1, (p - start) / per);
        t = 1 - Math.pow(1 - t, 3);
      }
      return {
        opacity: t,
        transform: [{ translateY: (1 - t) * 8 }],
      };
    }),
  );

  // ---- Outer styles --------------------------------------------------------
  const exitStyle = useAnimatedStyle(() => ({
    opacity: exitOpacity.value,
    transform: [{ scale: exitScale.value }],
  }));
  const reduceStyle = useAnimatedStyle(() => ({ opacity: reduceOpacity.value }));

  // Tagline fades up just after the wordmark settles (tail of the word window),
  // mirroring the contract's wordmark + "Your bench companion" subtitle lockup.
  const taglineStyle = useAnimatedStyle(() => {
    const start = W.word[0] + (W.word[1] - W.word[0]) * 0.7;
    const p = progress.value;
    let t = 0;
    if (p > start) {
      t = Math.min(1, (p - start) / (1 - start));
      t = 1 - Math.pow(1 - t, 3);
    }
    return { opacity: t, transform: [{ translateY: (1 - t) * 6 }] };
  });

  // Wordmark sizing + placement below the mark.
  const wordFont = Math.max(22, Math.min(cappedMarkPx * 0.2, 34));
  const wordTop = markCenterY + cappedMarkPx * 0.62;
  // Tagline color: a muted reading of the wordmark color for the secondary line.
  const taglineColor = dark ? 'rgba(255,255,255,0.66)' : 'rgba(12,24,48,0.62)';
  const taglineFont = Math.max(12.5, Math.min(cappedMarkPx * 0.085, 15));

  // While the reduce-motion gate resolves, render just the matching background so
  // there is never a flash of a half-built frame.
  if (reduceMotion === null) {
    return <View style={[styles.overlay, { backgroundColor: bg }]} />;
  }

  // The static mark, shared by the reduce-motion fade path.
  const staticMark = (
    <Canvas style={StyleSheet.absoluteFill}>
      <Group transform={markTransform}>
        <Path path={D_GLASS_FILL} color={glassFill} />
        <Group clip={beakerClip}>
          <Path path={D_LIQUID}>
            <LinearGradient start={vec(0, 12)} end={vec(0, 32)} colors={ramp} positions={RAINBOW_POS} />
          </Path>
        </Group>
        <Path path={D_SPOUT} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" />
        <Path path={D_OUTLINE} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" />
        <Path path={D_RIM} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" />
        <Circle cx={EYE_L.cx} cy={EYE_L.cy} r={EYE_L.r} color={SKY} />
        <Circle cx={EYE_R.cx} cy={EYE_R.cy} r={EYE_R.r} color={SKY} />
        <Path path={D_SMILE} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" />
        <Path path={D_FOOT_L} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" />
        <Path path={D_FOOT_R} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" />
      </Group>
    </Canvas>
  );

  const wordmark = (animated: boolean) => (
    <View style={[styles.wordRow, { top: wordTop, width }]} pointerEvents="none">
      {WORD.split('').map((c, i) => (
        <Animated.Text
          key={i}
          style={
            animated
              ? [styles.word, { color: wordColor, fontSize: wordFont }, wordGlyphStyles[i]]
              : [styles.word, { color: wordColor, fontSize: wordFont }]
          }
          allowFontScaling={false}
        >
          {c}
        </Animated.Text>
      ))}
    </View>
  );

  // Tagline row, seated just under the wordmark. The contract pairs the brand
  // wordmark with "Your bench companion" on the splash.
  const tagline = (animated: boolean) => (
    <Animated.View
      style={[
        styles.tagRow,
        { top: wordTop + wordFont + 8, width },
        animated ? taglineStyle : null,
      ]}
      pointerEvents="none"
    >
      <Animated.Text
        style={[styles.tag, { color: taglineColor, fontSize: taglineFont }]}
        allowFontScaling={false}
      >
        Your bench companion
      </Animated.Text>
    </Animated.View>
  );

  // ---- Reduce-motion path: static lockup, fade in then out -----------------
  if (reduceMotion) {
    return (
      <Animated.View style={[styles.overlay, { backgroundColor: bg }, exitStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, reduceStyle]}>
          {staticMark}
          {wordmark(false)}
          {tagline(false)}
        </Animated.View>
      </Animated.View>
    );
  }

  // ---- Full reveal ---------------------------------------------------------
  return (
    <Animated.View style={[styles.overlay, { backgroundColor: bg }, exitStyle]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group transform={markTransform}>
          {/* Whole-mark breathe rides on the entire art group. */}
          <Group transform={breatheTransform} origin={breatheOrigin}>
            {/* Soft drop-shadow under the mark (blurred ellipse-like disc). */}
            <Group transform={shadowTransform} origin={vec(20, 33)}>
              <Circle cx={20} cy={33} r={9} color={shadowColor} opacity={shadowOpacity}>
                <BlurMask blur={4} style="normal" />
              </Circle>
            </Group>

            {/* Glass fill so the rising liquid reads on a clean beaker. */}
            <Path path={D_GLASS_FILL} color={glassFill} opacity={glassEnd} />

            {/* Rising rainbow liquid, clipped to the beaker shape. */}
            <Group clip={beakerClip}>
              <Group transform={liquidTransform}>
                <Path path={D_LIQUID}>
                  <LinearGradient start={vec(0, 12)} end={vec(0, 32)} colors={ramp} positions={RAINBOW_POS} />
                </Path>
                {/* Bubbles float up + pop inside the liquid. */}
                <Group transform={bub1Transform} origin={bub1Origin}>
                  <Circle cx={BUB_1.cx} cy={BUB_1.cy} r={BUB_1.r} color="rgba(255,255,255,0.85)" opacity={bub1Opacity} />
                </Group>
                <Group transform={bub2Transform} origin={bub2Origin}>
                  <Circle cx={BUB_2.cx} cy={BUB_2.cy} r={BUB_2.r} color="rgba(255,255,255,0.85)" opacity={bub2Opacity} />
                </Group>
              </Group>
            </Group>

            {/* Spout curl draws on. */}
            <Path path={D_SPOUT} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" start={0} end={spoutEnd} />

            {/* Beaker outline draws on. */}
            <Path path={D_OUTLINE} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" start={0} end={glassEnd} />

            {/* Rim draws on. */}
            <Path path={D_RIM} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" start={0} end={rimEnd} />

            {/* Feet draw on. */}
            <Path path={D_FOOT_L} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" start={0} end={feetEnd} />
            <Path path={D_FOOT_R} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" start={0} end={feetEnd} />

            {/* Eyes pop in (scaleY group) then blink once. */}
            <Group transform={eyeGroupTransform}>
              <Circle cx={EYE_L.cx} cy={EYE_L.cy} r={EYE_L.r} color={SKY} opacity={eyeLOpacity} />
              <Circle cx={EYE_R.cx} cy={EYE_R.cy} r={EYE_R.r} color={SKY} opacity={eyeROpacity} />
            </Group>

            {/* Smile draws on. */}
            <Path path={D_SMILE} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" start={0} end={smileEnd} />

            {/* Spout sparkle twinkles. */}
            <Group transform={sparkTransform} origin={sparkOrigin}>
              <Path path={D_SPARK} color={sparkColor} style="stroke" strokeWidth={0.7} strokeCap="round" opacity={sparkOpacity} />
            </Group>
          </Group>
        </Group>
      </Canvas>

      {/* Wordmark overlaid as crisp RN text, per-letter fade-up. */}
      {wordmark(true)}

      {/* Tagline settles in just after the wordmark. */}
      {tagline(true)}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  wordRow: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  word: {
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  tagRow: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: {
    fontWeight: '500',
    letterSpacing: 0.1,
    textAlign: 'center',
  },
});
