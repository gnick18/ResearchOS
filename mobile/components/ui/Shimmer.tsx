// Shimmer: a very subtle, occasional left-to-right "glint" overlay for
// high-value buttons/cards. A narrow, slightly-tilted highlight band sweeps
// across the surface once, then rests off-screen for a few seconds before the
// next pass — a premium sheen, not an attention-grabber.
//
// Drop it as the LAST child inside a clipping container (the parent must set
// overflow:'hidden' + a borderRadius; pass the same radius here so the glint is
// masked to the rounded corners). It is pointer-transparent and fills the
// parent. Honors reduce-motion (renders nothing) and runs entirely on the UI
// thread via reanimated, so it costs ~nothing on the JS thread.
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useReduceMotion } from '@/lib/interaction-prefs';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

type ShimmerProps = {
  /** Match the parent's borderRadius so the glint is clipped to the corners. */
  borderRadius?: number;
  /** ms for one left→right pass. */
  duration?: number;
  /** ms the band rests off-screen between passes (the quiet gap). */
  interval?: number;
  /** ms before the very first pass after mount. */
  startDelay?: number;
  /** Peak opacity of the highlight — keep low (≈0.10–0.18) for subtlety. */
  intensity?: number;
  /** Highlight color as #rrggbb (default white). */
  tint?: string;
  /** Toggle the effect off without unmounting. */
  enabled?: boolean;
};

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function Shimmer({
  borderRadius = 0,
  duration = 1150,
  interval = 5200,
  startDelay = 1400,
  intensity = 0.14,
  tint = '#ffffff',
  enabled = true,
}: ShimmerProps) {
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);

  // Band geometry: a narrow tilted highlight, wider than the card so the tilt
  // never reveals a hard edge. It travels from fully off the left to fully off
  // the right.
  const band = Math.max(96, width * 0.42);
  const startX = -band * 1.3;
  const endX = width + band * 0.3;

  useEffect(() => {
    if (width <= 0) return;
    progress.value = 0;
    progress.value = withDelay(
      startDelay,
      withRepeat(
        withSequence(
          // one sweep across
          withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }),
          // hold off the right edge = the quiet gap between passes
          withTiming(1, { duration: interval }),
          // snap instantly back off the left edge for the next pass
          withTiming(0, { duration: 0 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(progress);
  }, [width, duration, interval, startDelay, progress]);

  const glintStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: startX + progress.value * (endX - startX) },
      { rotate: '18deg' },
    ],
  }));

  // Reduce-motion (or explicitly disabled) = no glint at all, no overlay.
  if (reduceMotion || !enabled) return null;

  return (
    <View
      pointerEvents="none"
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}
    >
      {width > 0 ? (
        <AnimatedGradient
          colors={[hexToRgba(tint, 0), hexToRgba(tint, intensity), hexToRgba(tint, 0)]}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.band, { width: band }, glintStyle]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    // taller than any button so the 18° tilt never shows a top/bottom edge
    top: '-60%',
    height: '220%',
    left: 0,
  },
});
