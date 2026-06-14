/**
 * LabAlarm. A full-screen takeover that fires when a lab timer runs out, on any
 * screen. BeakerBot bounces while a big bell rings above him (he has no arms, so
 * the bell swings on its own) with sound-wave lines pulsing out. Shows the
 * timer's name and a Stop button, and gives a gentle repeating haptic until the
 * user stops it.
 *
 * Two pieces, both mounted once in app/_layout.tsx (native only, like the other
 * Skia overlays):
 *   - LabAlarmWatcher: polls the timer store while foregrounded and raises an
 *     alarm the moment a running timer crosses its end time. Seeds itself so
 *     already-finished timers (including ones that finished while backgrounded,
 *     which the OS notification already announced) do not retro-fire.
 *   - LabAlarm: the overlay itself, subscribed to the alarm bus.
 *
 * Drawn with @shopify/react-native-skia using the verbatim BeakerBot geometry.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { hapticNotify, NotifyType, useReduceMotion } from '@/lib/interaction-prefs';
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
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { listTimers } from '@/lib/timers';
import { ALARM_SOURCES, getAlarmPrefs, loadAlarmPrefs } from '@/lib/alarm-prefs';
import {
  clearAlarm,
  showAlarm,
  subscribeAlarm,
  type ActiveAlarm,
} from '@/lib/lab-alarm';

// ---- BeakerBot geometry (verbatim, viewBox "8 3 24 31") -------------------
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

// Bell, amber/gold, authored with its handle pivot at local (0,0).
const BELL_AMBER = '#F59E0B';
const BELL_EDGE = '#C97A0A';
const BELL_CLAPPER = '#92400E';
const D_BELL_BODY =
  'M0 2 C -7.5 2, -10.5 10, -10.5 19 L -12.5 23 L 12.5 23 L 10.5 19 C 10.5 10, 7.5 2, 0 2 Z';
const D_BELL_RIM = 'M-12.5 23 L 12.5 23';
const D_WAVE_L1 = 'M-15 9 Q -19 15, -15 21';
const D_WAVE_L2 = 'M-19 6 Q -25 15, -19 24';
const D_WAVE_R1 = 'M15 9 Q 19 15, 15 21';
const D_WAVE_R2 = 'M19 6 Q 25 15, 19 24';

const ART = (() => {
  const minX = 11, maxX = 29, minY = 4, maxY = 32;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, h: maxY - minY };
})();

// ---------------------------------------------------------------------------
// Watcher: raise an alarm when a running timer crosses its end time.
// ---------------------------------------------------------------------------
export function LabAlarmWatcher() {
  useEffect(() => {
    let mounted = true;
    const alarmed = new Set<string>();
    // Hydrate alarm prefs so the overlay can read the chosen sound synchronously.
    void loadAlarmPrefs();

    // Seed so timers already past their end (e.g. finished while the app was
    // closed) do not fire on mount. Only crossings during this session alarm.
    const seed = async () => {
      try {
        const now = Date.now();
        for (const t of await listTimers()) {
          if (t.endsAt <= now) alarmed.add(t.id);
        }
      } catch {
        // storage unavailable; nothing to seed
      }
    };
    let seeded = seed();

    const tick = async () => {
      if (!mounted) return;
      await seeded;
      try {
        const now = Date.now();
        for (const t of await listTimers()) {
          if (t.endsAt <= now && !alarmed.has(t.id)) {
            alarmed.add(t.id);
            showAlarm({
              id: t.id,
              title: t.label.trim() || 'Lab timer',
              subtitle: `${formatDuration(t.durationSec)} timer`,
            });
          }
        }
      } catch {
        // ignore a single failed read
      }
    };

    const interval = setInterval(tick, 1000);
    // On return to foreground, re-seed so completions during background (already
    // announced by the OS notification) do not retro-fire.
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') seeded = seed();
    });

    return () => {
      mounted = false;
      clearInterval(interval);
      appSub.remove();
    };
  }, []);

  return null;
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m} min`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------
export function LabAlarm() {
  const [alarm, setAlarm] = useState<ActiveAlarm | null>(null);
  useEffect(() => subscribeAlarm(setAlarm), []);

  if (!alarm) return null;
  return <LabAlarmOverlay alarm={alarm} onStop={clearAlarm} />;
}

function LabAlarmOverlay({ alarm, onStop }: { alarm: ActiveAlarm; onStop: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const dark = scheme === 'dark';
  const { width, height } = useWindowDimensions();

  const glassFill = dark ? GLASS_DARK : GLASS_LIGHT;
  const ramp = dark ? RAINBOW_DARK : RAINBOW_LIGHT;

  // Read prefs once at mount (the overlay remounts per alarm, so this is fresh).
  const prefs = useMemo(() => getAlarmPrefs(), []);
  const player = useAudioPlayer(ALARM_SOURCES[prefs.sound]);

  const reduceMotion = useReduceMotion();

  // Loop the chosen sound until stopped (plays even on silent), if enabled.
  useEffect(() => {
    if (!prefs.soundOn) return;
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    player.loop = true;
    player.volume = 1;
    player.play();
    return () => {
      try {
        player.pause();
      } catch {
        // player already released
      }
    };
  }, [player, prefs.soundOn]);

  // Repeating haptic + one immediate buzz, until the overlay unmounts (stopped).
  useEffect(() => {
    if (!prefs.vibrateOn) return;
    hapticNotify(NotifyType.Warning);
    const id = setInterval(() => {
      hapticNotify(NotifyType.Warning);
    }, 850);
    return () => clearInterval(id);
  }, []);

  const clock = useClock();

  // Entrance pop.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.back(1.6)) });
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.value * 1.4),
    transform: [{ scale: 0.84 + 0.16 * enter.value }],
  }));

  // ---- Layout ----
  const beakerPx = Math.min(width, height) * 0.32;
  const beakerScale = beakerPx / ART.h;
  const beakerCx = width / 2;
  const beakerCy = height * 0.45;
  const bellScale = beakerPx / 16; // bell ~ a touch smaller than the beaker
  const bellCx = width / 2;
  const bellPivotY = beakerCy - beakerPx * 0.95;

  const beakerClip = useMemo(() => Skia.Path.MakeFromSVGString(D_GLASS_FILL)!, []);

  // ---- Animation ----
  const bellTransform = useDerivedValue(() => {
    const swing = reduceMotion ? 0.12 : 0.32 * Math.sin(clock.value / 115);
    return [
      { translateX: bellCx },
      { translateY: bellPivotY },
      { scale: bellScale },
      { rotate: swing },
    ];
  });
  const waveTransform = useMemo(
    () => [
      { translateX: bellCx },
      { translateY: bellPivotY },
      { scale: bellScale },
    ],
    [bellCx, bellPivotY, bellScale],
  );
  const wave1Opacity = useDerivedValue(() =>
    reduceMotion ? 0.5 : Math.abs(Math.sin(clock.value / 115)),
  );
  const wave2Opacity = useDerivedValue(() =>
    reduceMotion ? 0.3 : 0.7 * Math.abs(Math.sin((clock.value - 160) / 115)),
  );

  const beakerTransform = useDerivedValue(() => {
    const bounce = reduceMotion ? 0 : -beakerPx * 0.07 * Math.abs(Math.sin(clock.value / 230));
    return [
      { translateX: beakerCx },
      { translateY: beakerCy + bounce },
      { scale: beakerScale },
      { translateX: -ART.cx },
      { translateY: -ART.cy },
    ];
  });
  const eyeTransform = useDerivedValue(() => {
    let s = 1;
    if (!reduceMotion) {
      const t = clock.value % 2400;
      if (t < 150) {
        const bt = t / 150;
        s = 1 - 0.9 * (1 - Math.abs(bt * 2 - 1));
      }
    }
    return [{ translateY: 18 }, { scaleY: s }, { translateY: -18 }];
  });

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Animated.View style={[StyleSheet.absoluteFill, enterStyle]}>
        <Canvas style={StyleSheet.absoluteFill}>
          {/* Sound waves (static position, pulsing opacity) */}
          <Group transform={waveTransform}>
            <Group opacity={wave1Opacity}>
              <Path path={D_WAVE_L1} color={BELL_AMBER} style="stroke" strokeWidth={1.6} strokeCap="round" />
              <Path path={D_WAVE_R1} color={BELL_AMBER} style="stroke" strokeWidth={1.6} strokeCap="round" />
            </Group>
            <Group opacity={wave2Opacity}>
              <Path path={D_WAVE_L2} color={BELL_AMBER} style="stroke" strokeWidth={1.4} strokeCap="round" />
              <Path path={D_WAVE_R2} color={BELL_AMBER} style="stroke" strokeWidth={1.4} strokeCap="round" />
            </Group>
          </Group>

          {/* Bell, swinging from its handle */}
          <Group transform={bellTransform}>
            <Circle cx={0} cy={-4} r={3} color={BELL_EDGE} style="stroke" strokeWidth={1.6} />
            <Path path={D_BELL_BODY} color={BELL_AMBER} />
            <Path path={D_BELL_BODY} color={BELL_EDGE} style="stroke" strokeWidth={1.4} strokeJoin="round" />
            <Path path={D_BELL_RIM} color={BELL_EDGE} style="stroke" strokeWidth={1.6} strokeCap="round" />
            <Circle cx={0} cy={26} r={2.6} color={BELL_CLAPPER} />
          </Group>

          {/* BeakerBot, bouncing */}
          <Group transform={beakerTransform}>
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
        </Canvas>

        {/* Text + Stop, positioned below the lockup */}
        <View style={[styles.textWrap, { top: beakerCy + beakerPx * 0.62 }]} pointerEvents="box-none">
          <Text style={styles.kicker}>TIME&apos;S UP</Text>
          <Text style={styles.title} numberOfLines={2}>{alarm.title}</Text>
          {alarm.subtitle ? <Text style={styles.subtitle}>{alarm.subtitle}</Text> : null}
          <Pressable
            onPress={onStop}
            style={({ pressed }) => [styles.stop, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Stop alarm"
          >
            <Text style={styles.stopLabel}>Stop</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 12, 24, 0.62)',
    zIndex: 9000,
  },
  textWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  kicker: {
    color: BELL_AMBER,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    // Android floors the text-view width without counting the trailing
    // letter-spacing, clipping the last glyph. Pad by >= letterSpacing.
    paddingRight: 2,
    marginBottom: 6,
  },
  title: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 6,
  },
  stop: {
    marginTop: 26,
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    paddingHorizontal: 56,
    borderRadius: 16,
  },
  stopLabel: {
    color: '#0c1830',
    fontSize: 17,
    fontWeight: '800',
  },
});
