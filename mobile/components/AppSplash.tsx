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
 * Brand: the horizontal LOCKUP (see brand/researchos-banner-lockup.svg). The
 * LIVING BeakerBot mark sits on the LEFT, the "ResearchOS" wordmark to its
 * RIGHT, the pair centered as a single row, vertically aligned, with clear
 * spacing between mark and text (no overlap, the prior stacked layout cropped
 * the wordmark's ascenders). The signature rainbow paints as a soft glow behind
 * the mark plus a thin accent bar under the wordmark. Rainbow is drawn with
 * react-native-svg (no expo-linear-gradient). Light/pastel vs dark/vivid ramp is
 * picked by color scheme. On narrow screens the whole row scales down (font +
 * mark + gap + glow all derive from screen width) so it never runs off the edge.
 *
 * The living mark blinks/breathes during the hold and is tappable for the heart
 * easter egg (BeakerBot's `easterEgg` defaults to "heart" when alive). The
 * overlay deliberately does NOT set pointerEvents="none" so a tap reaches the
 * bot; the shrink-out exit + no-white-flash handoff are unchanged.
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
    // Entrance: the lockup eases up while the overlay holds.
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

  // ---- Lockup sizing -------------------------------------------------------
  // The whole horizontal row must fit inside the screen with comfortable side
  // margins. We derive every dimension from the available width so the lockup
  // scales down gracefully on narrow phones (and never runs off the edge).
  // Reserve ~12% total horizontal margin, cap the row at a tasteful max so it
  // does not balloon on tablets.
  const rowMaxWidth = Math.min(width * 0.88, 460);

  // Wordmark "ResearchOS" is ~10 glyphs at weight 800. As a rough advance we
  // budget ~0.58em per glyph for the layout estimate, then let the font size be
  // whatever keeps mark + gap + text within rowMaxWidth. Solve for fontSize.
  // rowMaxWidth = markW + gap + textW, where markW and gap scale with fontSize.
  //   beakerSize  = fontSize * 1.6   (mark height vs cap height, from the brand)
  //   markW       = beakerSize * (24/34)  (BeakerBot aspect)
  //   gap         = fontSize * 0.42
  //   textW       = fontSize * TEXT_EM
  const TEXT_EM = 5.8; // measured advance of "ResearchOS" at weight 800
  const MARK_EM = 1.6 * (24 / 34); // beaker width in em of fontSize
  const GAP_EM = 0.42;
  const denom = MARK_EM + GAP_EM + TEXT_EM;
  // Clamp the font size to a pleasant range after fitting to the row width.
  let fontSize = rowMaxWidth / denom;
  fontSize = Math.max(22, Math.min(fontSize, 40));

  const beakerSize = fontSize * 1.6;
  const gap = fontSize * GAP_EM;
  // Glow scales with the mark, softly larger so it haloes him.
  const glow = beakerSize * 1.9;
  // Accent bar under the wordmark, width derived from the (approximate) text
  // advance so it tucks neatly beneath "ResearchOS".
  const barWidth = fontSize * TEXT_EM;
  const barHeight = Math.max(4, fontSize * 0.16);

  return (
    <Animated.View style={[styles.overlay, { backgroundColor: bg }, overlayStyle]}>
      <Animated.View style={[styles.lockup, { maxWidth: rowMaxWidth }, markStyle]}>
        {/* LEFT: glow + living, tappable BeakerBot mark */}
        <View style={[styles.markWrap, { width: beakerSize, height: beakerSize }]}>
          {/* Soft rainbow glow behind the mark */}
          <View
            style={[
              styles.glowWrap,
              { width: glow, height: glow, left: (beakerSize - glow) / 2, top: (beakerSize - glow) / 2 },
            ]}
            pointerEvents="none"
          >
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

          {/* Living, tappable BeakerBot (heart easter egg on by default) */}
          <BeakerBot size={beakerSize} color="#ffffff" alive />
        </View>

        {/* RIGHT: wordmark + thin rainbow accent bar beneath it */}
        <View style={[styles.textCol, { marginLeft: gap }]}>
          <Animated.Text
            style={[
              styles.wordmark,
              { color: WORDMARK_COLOR, fontSize, lineHeight: fontSize * 1.1 },
            ]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            ResearchOS
          </Animated.Text>

          {/* Thin rainbow accent bar under the wordmark */}
          <View
            style={[
              styles.barWrap,
              { width: barWidth, height: barHeight, marginTop: fontSize * 0.28 },
            ]}
            pointerEvents="none"
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
  // The lockup is a single horizontal row, mark on the left, text on the right,
  // both vertically centered on the row.
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    // Vertically centered against the mark. The accent bar sits just under the
    // wordmark; the column as a whole is centered on the row.
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  wordmark: {
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  barWrap: {
    overflow: 'hidden',
  },
});
