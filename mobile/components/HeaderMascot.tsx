/**
 * HeaderMascot. A tiny live BeakerBot that floats in the top-right corner of
 * every screen. He is already "awake" (full lockup), breathes and sways a hair,
 * and blinks on a gentle cadence. Tapping him pops a little burst of hearts,
 * gives a soft squish, and fires a light haptic.
 *
 * Drawn with @shopify/react-native-skia using the verbatim brand geometry
 * (viewBox "8 3 24 31"), the same paths the splash uses. One useClock() drives
 * the idle breathe + blink; a Reanimated `burst` shared value drives the hearts.
 *
 * Mounted once in app/_layout.tsx as a fixed overlay, so it rides above every
 * route without each screen having to place it. It is a small absolutely
 * positioned Pressable, so taps anywhere else pass straight through.
 *
 * Reduce-motion: idle breathe/blink freeze to a static awake mark; the tap
 * burst still plays since it is user-initiated.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  Skia,
  useClock,
  vec,
} from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

// ---- Brand geometry (verbatim, viewBox "8 3 24 31") -----------------------
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

const EYE_L = { cx: 17, cy: 18, r: 1.2 };
const EYE_R = { cx: 23, cy: 18, r: 1.2 };
const STROKE = 2;

const SKY = '#1AA0E6';
const GLASS_LIGHT = '#ffffff';
const GLASS_DARK = '#0f1626';
const RAINBOW_LIGHT = ['#FFD2B0', '#FFF1A8', '#B7EBB1', '#A6D2F4', '#D6B5F0'];
const RAINBOW_DARK = ['#F97316', '#E8920B', '#16A34A', '#0284C7', '#9333EA'];
const RAINBOW_POS = [0, 0.25, 0.5, 0.75, 1];

// Art bounds in view-box units (matches AppSplash: x 11..29, y 4..32).
const ART = (() => {
  const minX = 11, maxX = 29, minY = 4, maxY = 32;
  return {
    minX, maxX, minY, maxY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
})();

// ---- Container + mark sizing ----------------------------------------------
const BOX_W = 64;
const BOX_H = 96; // headroom above the beaker for the hearts to rise into
const MARK_PX = 38; // beaker height in pixels
const MARK_CX = BOX_W / 2;
const MARK_CY = BOX_H - 30; // beaker sits low; hearts rise into the top space

// Heart centered roughly on (0,0), spans about x[-5,5] y[-3.5,4].
const D_HEART =
  'M0 4 C -3 1, -5 -1, -2.6 -2.6 C -1.1 -3.4, 0 -2.1, 0 -1 C 0 -2.1, 1.1 -3.4, 2.6 -2.6 C 5 -1, 3 1, 0 4 Z';

// Six hearts with fixed drift + color so each tap looks lively (no Math.random).
const HEARTS = [
  { dx: -16, color: '#FF6B8B', lead: 0.0, size: 3.2, rise: 56 },
  { dx: 14, color: '#1AA0E6', lead: 0.08, size: 2.6, rise: 64 },
  { dx: -6, color: '#FF8FA3', lead: 0.04, size: 3.6, rise: 70 },
  { dx: 20, color: '#FFB3C1', lead: 0.16, size: 2.4, rise: 52 },
  { dx: 4, color: '#9333EA', lead: 0.12, size: 2.8, rise: 66 },
  { dx: -22, color: '#FF6B8B', lead: 0.2, size: 2.5, rise: 58 },
];

export function HeaderMascot() {
  const scheme = useColorScheme() ?? 'light';
  const dark = scheme === 'dark';
  const insets = useSafeAreaInsets();

  const glassFill = dark ? GLASS_DARK : GLASS_LIGHT;
  const ramp = dark ? RAINBOW_DARK : RAINBOW_LIGHT;

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => active && setReduceMotion(on))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const clock = useClock();
  const burst = useSharedValue(0); // 0..1 heart burst progress, 0 at rest
  const squish = useSharedValue(1);

  // View-box -> pixel transform, beaker centered on (MARK_CX, MARK_CY).
  const scale = MARK_PX / ART.h;
  const markTransform = useMemo(
    () => [
      { translateX: MARK_CX },
      { translateY: MARK_CY },
      { scale },
      { translateX: -ART.cx },
      { translateY: -ART.cy },
    ],
    [scale],
  );
  const beakerClip = useMemo(() => Skia.Path.MakeFromSVGString(D_GLASS_FILL)!, []);
  const artOrigin = useMemo(() => vec(ART.cx, ART.cy), []);

  // Idle breathe + sway + tap squish, all on the whole-mark group.
  const idleTransform = useDerivedValue(() => {
    if (reduceMotion) return [{ translateY: 0 }, { rotate: 0 }, { scale: squish.value }];
    const lift = 0.7 * Math.sin(clock.value / 850);
    const tilt = 0.03 * Math.sin(clock.value / 1500);
    return [{ translateY: -lift }, { rotate: tilt }, { scale: squish.value }];
  });

  // Eyes: blink on a gentle ~3.6s cadence (quick V dip of scaleY).
  const eyeTransform = useDerivedValue(() => {
    let s = 1;
    if (!reduceMotion) {
      const period = 3600;
      const t = clock.value % period;
      const dur = 150;
      if (t < dur) {
        const bt = t / dur; // 0..1
        s = 1 - 0.9 * (1 - Math.abs(bt * 2 - 1));
      }
    }
    return [{ translateY: 18 }, { scaleY: s }, { translateY: -18 }];
  });

  // Per-heart opacity + transform derived from `burst`.
  const heartBaseX = MARK_CX;
  const heartBaseY = MARK_CY - 16; // near the beaker rim
  const heartOpacity = HEARTS.map((h) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useDerivedValue(() => {
      const t = Math.max(0, Math.min(1, (burst.value - h.lead) / (1 - h.lead)));
      return Math.sin(Math.PI * t); // 0 -> 1 -> 0
    }),
  );
  const heartTransform = HEARTS.map((h) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useDerivedValue(() => {
      const t = Math.max(0, Math.min(1, (burst.value - h.lead) / (1 - h.lead)));
      const ty = heartBaseY - h.rise * t;
      const tx = heartBaseX + h.dx * t;
      const sc = (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.4))) * h.size;
      return [{ translateX: tx }, { translateY: ty }, { scale: sc }];
    }),
  );

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    burst.value = 0;
    burst.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) });
    squish.value = withSequence(
      withTiming(0.84, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 260, easing: Easing.elastic(1.4) }),
    );
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="BeakerBot"
      style={[styles.wrap, { top: insets.top + 2, width: BOX_W, height: BOX_H }]}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Hearts (behind/around the beaker, rising up) */}
        {HEARTS.map((h, i) => (
          <Group key={i} transform={heartTransform[i]} opacity={heartOpacity[i]}>
            <Path path={D_HEART} color={h.color} />
          </Group>
        ))}

        {/* The awake BeakerBot */}
        <Group transform={markTransform}>
          <Group transform={idleTransform} origin={artOrigin}>
            <Path path={D_GLASS_FILL} color={glassFill} />
            <Group clip={beakerClip}>
              <Path path={D_LIQUID}>
                <LinearGradient start={vec(0, 12)} end={vec(0, 32)} colors={ramp} positions={RAINBOW_POS} />
              </Path>
            </Group>
            <Path path={D_SPOUT} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" />
            <Path path={D_OUTLINE} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" />
            <Path path={D_RIM} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" />
            <Path path={D_FOOT_L} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" />
            <Path path={D_FOOT_R} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" />
            <Group transform={eyeTransform}>
              <Circle cx={EYE_L.cx} cy={EYE_L.cy} r={EYE_L.r} color={SKY} />
              <Circle cx={EYE_R.cx} cy={EYE_R.cy} r={EYE_R.r} color={SKY} />
            </Group>
            <Path path={D_SMILE} color={SKY} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" />
          </Group>
        </Group>
      </Canvas>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 10,
    zIndex: 60,
  },
});
