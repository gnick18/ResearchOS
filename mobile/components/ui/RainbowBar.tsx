/**
 * RainbowBar. The thin signature ResearchOS rainbow, 4px by default. Grant's
 * rule (2026-06-08): it sits on BOTH the top and bottom of every screen, thin
 * and subtle. Pastel stops on light, vivid stops on dark, matching the web app
 * and the mobile mockups. Rendered with react-native-svg (already a dep) for a
 * smooth gradient rather than hard color bands.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/lib/design';

const LIGHT_STOPS = ['#FFD2B0', '#FFF1A8', '#B7EBB1', '#A6D2F4', '#D6B5F0'];
const DARK_STOPS = ['#F97316', '#E8920B', '#16A34A', '#0284C7', '#9333EA'];

export function RainbowBar({ height = 4 }: { height?: number }) {
  const { dark } = useTheme();
  const stops = dark ? DARK_STOPS : LIGHT_STOPS;
  return (
    <View style={{ height }} pointerEvents="none">
      <Svg width="100%" height={height}>
        <Defs>
          <LinearGradient id="rainbowBar" x1="0" y1="0" x2="1" y2="0">
            {stops.map((c, i) => (
              <Stop key={c} offset={i / (stops.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={height} fill="url(#rainbowBar)" />
      </Svg>
    </View>
  );
}
