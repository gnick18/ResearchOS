/**
 * AppLockGate. A full-screen lock that covers the live app until the user passes
 * a Face ID / fingerprint check (with the device passcode as a fallback). It is
 * mounted once in app/_layout.tsx and gates the whole UI when the app-lock pref
 * is on.
 *
 * When the pref is OFF (the default) this renders null and adds nothing to the
 * app, so current users are unaffected.
 *
 * When the pref is ON it locks in two situations:
 *   1. Cold start. Locked until the first successful unlock.
 *   2. Return from background after a short threshold. We stamp the time the app
 *      went to the background; on return, if it was away longer than
 *      BACKGROUND_LOCK_MS (~30s) we re-lock. A quick switch away and back (under
 *      the threshold) does not nag the user.
 *
 * The overlay shows the BeakerBot mark, a calm one-line reason, and an Unlock
 * button. We also auto-trigger the biometric prompt when the lock first appears,
 * so the common path is just Face ID without a tap. The Unlock button is the
 * manual retry / fallback so the user is never trapped (no soft-lock).
 *
 * Drawn with react-native-svg using the verbatim brand geometry (viewBox
 * "8 3 24 31"), the same paths the splash uses, kept static here so the lock
 * screen is calm.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G, Path, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { useTheme, palette, spacing, radii, fonts } from '@/lib/design';
import { authenticateAppLock, useAppLockPrefs } from '@/lib/app-lock';

// Re-lock when the app was in the background longer than this. A brief switch
// away (answering a quick message, glancing at another app) stays unlocked.
const BACKGROUND_LOCK_MS = 30_000;

// Verbatim brand geometry (viewBox "8 3 24 31"), matching AppSplash / the mark.
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
const SKY = '#1AA0E6';
const RAINBOW_LIGHT = ['#FFD2B0', '#FFF1A8', '#B7EBB1', '#A6D2F4', '#D6B5F0'];
const RAINBOW_DARK = ['#F97316', '#E8920B', '#16A34A', '#0284C7', '#9333EA'];

function LockMark({ dark }: { dark: boolean }) {
  const ramp = dark ? RAINBOW_DARK : RAINBOW_LIGHT;
  const glassFill = dark ? '#0f1626' : '#ffffff';
  return (
    <Svg width={132} height={154} viewBox="8 3 24 31">
      <Defs>
        <SvgLinearGradient id="lockLiquid" x1="0" y1="12" x2="0" y2="32" gradientUnits="userSpaceOnUse">
          {ramp.map((c, i) => (
            <Stop key={i} offset={i / (ramp.length - 1)} stopColor={c} />
          ))}
        </SvgLinearGradient>
      </Defs>
      <Path d={D_GLASS_FILL} fill={glassFill} />
      <G>
        {/* Liquid clipped visually by sitting under the outline; the fill shape
            already follows the beaker contour. */}
        <Path d={D_LIQUID} fill="url(#lockLiquid)" />
      </G>
      <Path d={D_SPOUT} stroke={SKY} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={D_OUTLINE} stroke={SKY} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={D_RIM} stroke={SKY} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx={17} cy={18} r={1.2} fill={SKY} />
      <Circle cx={23} cy={18} r={1.2} fill={SKY} />
      <Path d={D_SMILE} stroke={SKY} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={D_FOOT_L} stroke={SKY} strokeWidth={2} strokeLinecap="round" fill="none" />
      <Path d={D_FOOT_R} stroke={SKY} strokeWidth={2} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function AppLockGate() {
  const { surface, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [prefs] = useAppLockPrefs();

  // Locked starts true so an armed lock covers the cold-start frame. When the
  // pref is off we keep it unlocked and the gate renders null regardless.
  const [locked, setLocked] = useState(true);
  const [authing, setAuthing] = useState(false);

  // Stamp when the app left the foreground, to measure the away duration.
  const backgroundedAt = useRef<number | null>(null);
  // Guard against firing the auto-prompt repeatedly while one is in flight.
  const promptInFlight = useRef(false);

  const enabled = prefs.enabled;

  const runUnlock = useCallback(async () => {
    if (promptInFlight.current) return;
    promptInFlight.current = true;
    setAuthing(true);
    try {
      const ok = await authenticateAppLock();
      if (ok) setLocked(false);
    } finally {
      setAuthing(false);
      promptInFlight.current = false;
    }
  }, []);

  // AppState: re-lock on a long-enough background, and stamp background entry.
  useEffect(() => {
    if (!enabled) return;
    const onChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        // Only stamp the first transition away, not inactive flickers after.
        if (backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
        }
        return;
      }
      if (next === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since !== null && Date.now() - since >= BACKGROUND_LOCK_MS) {
          setLocked(true);
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [enabled]);

  // When the lock becomes active (cold start armed, or a re-lock), and the app is
  // in the foreground, auto-trigger the biometric prompt so the common path is
  // just Face ID with no extra tap.
  useEffect(() => {
    if (!enabled || !locked) return;
    if (AppState.currentState !== 'active') return;
    void runUnlock();
  }, [enabled, locked, runUnlock]);

  // If the user turns the lock OFF in Settings, clear any standing lock so they
  // are not stranded behind a gate they just disabled (no soft-lock).
  useEffect(() => {
    if (!enabled) setLocked(false);
  }, [enabled]);

  if (!enabled || !locked) return null;

  return (
    <View
      style={[
        styles.overlay,
        { backgroundColor: surface.bg, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.center}>
        {/* Brand mascot lockup. The mark itself is brand-locked (verbatim
            geometry, sky strokes, pastel liquid). It rides a soft brand-tinted
            halo disc + a privacy-sky lock chip so the lock moment reads as a
            calm, elevated brand surface rather than a bare icon on the canvas.
            Halo + chip use theme-consistent sky, never the mascot colors. */}
        <View style={styles.markBlock}>
          <LinearGradient
            colors={
              dark
                ? ['rgba(26,160,230,0.20)', 'rgba(26,160,230,0)']
                : ['rgba(26,160,230,0.16)', 'rgba(26,160,230,0)']
            }
            start={{ x: 0.5, y: 0.1 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.halo}
            pointerEvents="none"
          />
          <LockMark dark={dark} />
          {/* Privacy chip: a small sky lock badge clipped to the mark's lower
              corner, signalling the gate without recoloring the mascot. */}
          <View
            style={[
              styles.lockChip,
              {
                backgroundColor: palette.sky,
                borderColor: surface.bg,
              },
            ]}
            pointerEvents="none"
          >
            <Ionicons name="lock-closed" size={15} color={palette.white} />
          </View>
        </View>

        <ThemedText style={[styles.title, { color: surface.text }]}>
          ResearchOS is locked
        </ThemedText>
        <ThemedText style={[styles.sub, { color: surface.muted }]}>
          Unlock with Face ID to see your bench. Your captures and notes stay
          private to you.
        </ThemedText>
        <Button
          label={authing ? 'Unlocking' : 'Unlock'}
          loading={authing}
          onPress={() => void runUnlock()}
          icon={<Ionicons name="lock-open-outline" size={18} color={palette.white} />}
          style={styles.btn}
          accessibilityLabel="Unlock the app"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // Above every route and the rainbow edges, below nothing.
    zIndex: 10000,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  center: {
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: 360,
    width: '100%',
  },
  // Holds the brand mark, its halo, and the corner lock chip.
  markBlock: {
    width: 168,
    height: 168,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Soft brand-tinted glow disc behind the mark for depth (contract glow).
  halo: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
  },
  // Sky lock badge tucked at the lower-right of the mark.
  lockChip: {
    position: 'absolute',
    right: 22,
    bottom: 20,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    // Contract --shadow-md, sky-tinted so the chip lifts off the mark.
    shadowColor: palette.sky,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  title: {
    fontSize: 22,
    lineHeight: 27,
    fontFamily: fonts.extrabold,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  sub: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.ui,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    maxWidth: 320,
  },
  // Content-sized pill (contract app-lock button: width auto, padding 13/26).
  btn: {
    marginTop: spacing.lg,
    alignSelf: 'center',
    paddingHorizontal: 26,
    paddingVertical: 14,
    minWidth: 0,
    borderRadius: radii.md,
  },
});
