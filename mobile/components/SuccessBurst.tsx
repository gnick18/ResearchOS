/**
 * SuccessBurst. A celebratory "sent to your lab" overlay that plays whenever the
 * phone successfully pushes something to the laptop. A rainbow ARC of five
 * concentric brand-color bands draws on (staggered, Skia Path start/end trim),
 * confetti dots pop in the gaps, and a label fades through, then the whole thing
 * fades out. About 1.6s. It floats over the live app, never dims or blocks taps
 * (pointerEvents none + transparent), and renders null when idle (no cost).
 *
 * Mounted once at the app root (app/_layout.tsx). It subscribes to the global
 * success hub (lib/success-burst.ts); fireSuccess() there triggers a burst (and
 * the success haptic), coalescing rapid fires so a bulk batch shows one burst.
 *
 * Drawn with @shopify/react-native-skia, mirroring AppSplash's Skia + Reanimated
 * pattern (one progress shared value + a beatOf() worklet to per-element windows;
 * Skia nodes read useDerivedValue outputs as props).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { fonts } from '@/lib/design';
import { subscribeSuccess, type SuccessPayload } from '@/lib/success-burst';
import { useReduceMotion } from '@/lib/interaction-prefs';

// Signature rainbow, theme-aware to match RainbowBar (the top/bottom edges) and
// the mascot. Light uses the pastel set; dark uses the saturated set. The burst
// previously hardcoded the dark set, so on the light-only app it clashed with
// the pastel edges.
const LIGHT_RAMP = ['#FFD2B0', '#FFF1A8', '#B7EBB1', '#A6D2F4', '#D6B5F0'];
const DARK_RAMP = ['#F97316', '#E8920B', '#16A34A', '#0284C7', '#9333EA'];
const BURST_MS = 1600;

// beatOf maps global progress (0..1) to a per-element 0..1, eased (cubic ease-out).
function beatOf(p: number, a: number, b: number): number {
  'worklet';
  if (p <= a) return 0;
  if (p >= b) return 1;
  const t = (p - a) / (b - a);
  return 1 - Math.pow(1 - t, 3);
}

// Per-arc draw window (staggered) and per-confetti pop window.
const ARC_WINDOWS: [number, number][] = [
  [0.0, 0.34],
  [0.06, 0.4],
  [0.12, 0.46],
  [0.18, 0.52],
  [0.24, 0.58],
];

interface ConfettiSpec {
  x: number;
  y: number;
  r: number;
  color: string;
  win: [number, number];
}

function ArcBand({
  d,
  color,
  win,
  progress,
  reduce,
}: {
  d: string;
  color: string;
  win: [number, number];
  progress: SharedValue<number>;
  reduce: boolean;
}) {
  const path = useMemo(() => Skia.Path.MakeFromSVGString(d), [d]);
  const end = useDerivedValue(() =>
    reduce ? beatOf(progress.value, 0, 0.3) : beatOf(progress.value, win[0], win[1]),
  );
  if (!path) return null;
  return (
    <Path
      path={path}
      color={color}
      style="stroke"
      strokeWidth={12}
      strokeCap="round"
      start={0}
      end={end}
    />
  );
}

function ConfettiPiece({
  spec,
  progress,
  reduce,
}: {
  spec: ConfettiSpec;
  progress: SharedValue<number>;
  reduce: boolean;
}) {
  const opacity = useDerivedValue(() => {
    const t = reduce
      ? beatOf(progress.value, 0.1, 0.4)
      : beatOf(progress.value, spec.win[0], spec.win[1]);
    // fade in over the first 55%, hold, then fade with the global tail
    const fadeIn = Math.min(1, t / 0.55);
    const tail = progress.value > 0.82 ? 1 - (progress.value - 0.82) / 0.18 : 1;
    return fadeIn * Math.max(0, tail);
  });
  const transform = useDerivedValue(() => {
    const t = reduce ? 1 : beatOf(progress.value, spec.win[0], spec.win[1]);
    // overshoot pop then settle, with a tiny rise
    const s = t < 0.6 ? (t / 0.6) * 1.15 : 1.15 - (t - 0.6) / 0.4 * 0.15;
    const ty = -4 * t;
    return [{ translateY: ty }, { scale: Math.max(0, s) }];
  });
  const origin = useMemo(() => vec(spec.x, spec.y), [spec.x, spec.y]);
  return (
    <Group transform={transform} origin={origin}>
      <Circle cx={spec.x} cy={spec.y} r={spec.r} color={spec.color} opacity={opacity} />
    </Group>
  );
}

export function SuccessBurst() {
  const scheme = useColorScheme() ?? 'light';
  const dark = scheme === 'dark';
  const RAMP = dark ? DARK_RAMP : LIGHT_RAMP;
  const { width, height } = useWindowDimensions();

  const [payload, setPayload] = useState<SuccessPayload | null>(null);
  const reduce = useReduceMotion();
  const progress = useSharedValue(0);

  // Subscribe to the global success hub.
  useEffect(() => subscribeSuccess((p) => setPayload(p)), []);

  // Run the animation whenever a new burst arrives (keyed on payload id).
  useEffect(() => {
    if (!payload) return;
    const clear = () => setPayload(null);
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: BURST_MS, easing: Easing.linear },
      (finished) => {
        'worklet';
        if (finished) runOnJS(clear)();
      },
    );
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.id]);

  // Arc geometry, centered. Five concentric semicircles.
  const geom = useMemo(() => {
    const cx = width / 2;
    const baseY = height * 0.46;
    const outerR = Math.min(width * 0.34, 150);
    const gap = 26;
    const arcs = ARC_WINDOWS.map((win, i) => {
      const r = outerR - i * gap;
      const d = `M ${cx - r} ${baseY} A ${r} ${r} 0 0 1 ${cx + r} ${baseY}`;
      return { d, color: RAMP[i], win, r };
    });
    return { cx, baseY, outerR, arcs };
  }, [width, height, RAMP]);

  // Confetti scattered in the arc region (fixed layout, stable hook count).
  const confetti = useMemo<ConfettiSpec[]>(() => {
    const { cx, baseY, outerR } = geom;
    const out: ConfettiSpec[] = [];
    const N = 16;
    for (let i = 0; i < N; i += 1) {
      const a = Math.PI * (0.1 + 0.8 * (i / (N - 1)));
      const rad = 36 + (outerR - 44) * (0.25 + 0.7 * Math.random());
      const x = cx - Math.cos(a) * rad;
      const y = baseY - Math.sin(a) * rad;
      const start = 0.26 + Math.random() * 0.24;
      out.push({
        x,
        y,
        r: 2.5 + Math.random() * 3,
        color: RAMP[i % RAMP.length],
        win: [start, start + 0.2],
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom]);

  // Global fade-out tail for the whole overlay.
  const overlayStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const o = p > 0.82 ? Math.max(0, 1 - (p - 0.82) / 0.18) : 1;
    return { opacity: o };
  });

  // Label fade in, hold, out.
  const labelStyle = useAnimatedStyle(() => {
    const p = progress.value;
    let o = 0;
    if (p < 0.45) o = Math.max(0, (p - 0.3) / 0.15);
    else if (p < 0.78) o = 1;
    else o = Math.max(0, 1 - (p - 0.78) / 0.22);
    return { opacity: o, transform: [{ translateY: (1 - Math.min(1, o)) * 6 }] };
  });

  if (!payload) return null;

  const labelTop = geom.baseY + 18;
  const wordColor = dark ? '#ffffff' : '#0c1830';
  const subColor = dark ? '#8b949e' : '#6b7280';

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {geom.arcs.map((arc, i) => (
          <ArcBand key={i} d={arc.d} color={arc.color} win={arc.win} progress={progress} reduce={reduce} />
        ))}
        {confetti.map((spec, i) => (
          <ConfettiPiece key={i} spec={spec} progress={progress} reduce={reduce} />
        ))}
      </Canvas>
      <Animated.View style={[styles.labelWrap, { top: labelTop, width }, labelStyle]} pointerEvents="none">
        <Animated.Text style={[styles.label, { color: wordColor }]} allowFontScaling={false}>
          {payload.title}
        </Animated.Text>
        {payload.subtitle ? (
          <Animated.Text style={[styles.sub, { color: subColor }]} allowFontScaling={false} numberOfLines={1}>
            {payload.subtitle}
          </Animated.Text>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 60, backgroundColor: 'transparent' },
  labelWrap: { position: 'absolute', alignItems: 'center' },
  label: { fontSize: 17, fontFamily: fonts.extrabold, fontWeight: '800', letterSpacing: -0.2 },
  sub: { fontSize: 12.5, fontFamily: fonts.medium, marginTop: 3 },
});
