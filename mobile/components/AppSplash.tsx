/**
 * AppSplash. A full-screen branded launch overlay that hands off from the native
 * Expo splash without a white flash, holds for a beat, then shrinks and fades out
 * to reveal the app underneath.
 *
 * Flow: the native splash (a static BeakerBot on sky, see app.json) stays up via
 * SplashScreen.preventAutoHideAsync until JS is ready. The root layout then hides
 * the native splash and mounts this overlay, whose background matches the native
 * splash exactly (sky #1AA0E6 light, black dark) so the swap is seamless. After a
 * short hold the overlay runs a Reanimated exit (scale 1 -> 0.85, opacity 1 -> 0,
 * 450ms, Easing.out(Easing.cubic)) and calls onFinish when done.
 *
 * Brand: BeakerBot mark, the ResearchOS wordmark, and the signature rainbow as a
 * soft glow behind the mark plus a thin accent bar under the wordmark. Rainbow is
 * drawn with react-native-svg (no expo-linear-gradient). Light/pastel vs
 * dark/vivid ramp is picked by color scheme.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Defs,
  Ellipse,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { BeakerBot } from '@/components/ui/BeakerBot';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Background colors mirror app.json's expo-splash-screen config so there is no
// flash when the native splash hands off to this JS overlay.
const SKY = '#1AA0E6';
const BLACK = '#000000';

// Signature rainbow stops (from the brand). Light = pastel, dark = vivid.
const RAINBOW_LIGHT = ['#FFD2B0', '#FFF1A8', '#B7EBB1', '#A6D2F4', '#D6B5F0'];
const RAINBOW_DARK = ['#F97316', '#E8920B', '#16A34A', '#0284C7', '#9333EA'];
const RAINBOW_OFFSETS = ['0%', '25%', '50%', '75%', '100%'];
const RAINBOW_OFFSETS_DARK = ['0%', '22%', '48%', '72%', '100%'];

// Wordmark color per scheme (white reads cleanly on both sky and black).
const WORDMARK_COLOR = '#ffffff';

// Timings.
const HOLD_MS = 420;
const EXIT_MS = 450;
const ENTRANCE_MS = 480;

export interface AppSplashProps {
  /** Called once the shrink-out exit animation has fully finished. */
  onFinish: () => void;
}

export function AppSplash({ onFinish }: AppSplashProps) {
  const scheme = useColorScheme() ?? 'light';
  const dark = scheme === 'dark';
  const { width } = useWindowDimensions();

  const bg = dark ? BLACK : SKY;
  const ramp = dark ? RAINBOW_DARK : RAINBOW_LIGHT;
  const offsets = dark ? RAINBOW_OFFSETS_DARK : RAINBOW_OFFSETS;

  // Whole-overlay shrink + fade on exit.
  const overlayScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);

  // Gentle entrance for the brand cluster (subtle scale-in + fade-in).
  const markScale = useSharedValue(0.86);
  const markOpacity = useSharedValue(0);

  useEffect(() => {
    // Entrance: the mark eases up while the overlay holds.
    markOpacity.value = withTiming(1, {
      duration: ENTRANCE_MS,
      easing: Easing.out(Easing.cubic),
    });
    markScale.value = withTiming(1, {
      duration: ENTRANCE_MS,
      easing: Easing.out(Easing.cubic),
    });

    // Exit: hold for a beat, then shrink the whole overlay and fade it out.
    overlayScale.value = withDelay(
      HOLD_MS,
      withTiming(0.85, { duration: EXIT_MS, easing: Easing.out(Easing.cubic) }),
    );
    overlayOpacity.value = withDelay(
      HOLD_MS,
      withTiming(
        0,
        { duration: EXIT_MS, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) {
            runOnJS(onFinish)();
          }
        },
      ),
    );
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
    transform: [{ scale: overlayScale.value }],
  }));

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));

  // Soft rainbow glow sizing relative to the screen width.
  const glow = Math.min(width * 0.82, 360);
  const beakerSize = 132;
  const barWidth = Math.min(width * 0.5, 220);
  const barHeight = 6;

  return (
    <Animated.View
      style={[styles.overlay, { backgroundColor: bg }, overlayStyle]}
      pointerEvents="none"
    >
      <Animated.View style={[styles.cluster, markStyle]}>
        {/* Soft rainbow glow behind the mark */}
        <View style={[styles.glowWrap, { width: glow, height: glow }]}>
          <Svg width={glow} height={glow}>
            <Defs>
              <RadialGradient id="glowFade" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor="#ffffff" stopOpacity={dark ? 0.55 : 0.85} />
                <Stop offset="60%" stopColor="#ffffff" stopOpacity={dark ? 0.18 : 0.32} />
                <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
              </RadialGradient>
              <LinearGradient id="glowRamp" x1="0" y1="0" x2="1" y2="1">
                {ramp.map((c, i) => (
                  <Stop key={i} offset={offsets[i]} stopColor={c} />
                ))}
              </LinearGradient>
            </Defs>
            {/* Rainbow disc, softened toward the edges by the radial mask drawn on top */}
            <Ellipse
              cx={glow / 2}
              cy={glow / 2}
              rx={glow / 2}
              ry={glow / 2}
              fill="url(#glowRamp)"
              opacity={dark ? 0.45 : 0.6}
            />
            <Ellipse
              cx={glow / 2}
              cy={glow / 2}
              rx={glow / 2}
              ry={glow / 2}
              fill="url(#glowFade)"
            />
          </Svg>
        </View>

        {/* BeakerBot mark, centered over the glow */}
        <View style={styles.beakerWrap}>
          <BeakerBot size={beakerSize} color="#ffffff" />
        </View>

        {/* Wordmark */}
        <Animated.Text style={[styles.wordmark, { color: WORDMARK_COLOR }]}>
          ResearchOS
        </Animated.Text>

        {/* Thin rainbow accent bar under the wordmark */}
        <View
          style={[styles.barWrap, { width: barWidth, height: barHeight }]}
        >
          <Svg width={barWidth} height={barHeight}>
            <Defs>
              <LinearGradient id="barRamp" x1="0" y1="0" x2="1" y2="0">
                {ramp.map((c, i) => (
                  <Stop key={i} offset={offsets[i]} stopColor={c} />
                ))}
              </LinearGradient>
            </Defs>
            <Rect
              x={0}
              y={0}
              width={barWidth}
              height={barHeight}
              rx={barHeight / 2}
              ry={barHeight / 2}
              fill="url(#barRamp)"
            />
          </Svg>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  cluster: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beakerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    marginTop: 18,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  barWrap: {
    marginTop: 16,
    overflow: 'hidden',
  },
});
