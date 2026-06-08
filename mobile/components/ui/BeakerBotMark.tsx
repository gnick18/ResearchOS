/**
 * BeakerBotMark. A rounded branded tile that renders the BeakerBot vector mark.
 * Uses the react-native-svg BeakerBot component (ported from brand/beakerbot-mark.svg)
 * so it scales crisply at any resolution. The icon.png dependency is removed.
 *
 * Sizes: sm=56, md=80, lg=108. A soft sky-tinted rounded rect sits behind the
 * mark and frames it intentionally in the hero context.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme, palette } from '@/lib/design';
import { BeakerBot } from './BeakerBot';

export type BeakerBotMarkSize = 'sm' | 'md' | 'lg';

// Tile size (outer container), bot size (vector height inside the tile).
const SIZE_MAP: Record<BeakerBotMarkSize, { tile: number; bot: number }> = {
  sm: { tile: 56, bot: 36 },
  md: { tile: 80, bot: 52 },
  lg: { tile: 108, bot: 72 },
};

export interface BeakerBotMarkProps {
  size?: BeakerBotMarkSize;
}

export function BeakerBotMark({ size = 'md' }: BeakerBotMarkProps) {
  const { radii, dark } = useTheme();
  const { tile, bot } = SIZE_MAP[size];
  const radius = size === 'sm' ? radii.md : size === 'md' ? radii.lg : radii.xl;

  return (
    <View
      style={[
        styles.tile,
        {
          width: tile,
          height: tile,
          borderRadius: radius,
          backgroundColor: dark ? 'rgba(26,160,230,0.18)' : palette.skyLight,
        },
      ]}
    >
      <BeakerBot size={bot} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
