/**
 * BeakerBotMark. A rounded branded tile that renders the BeakerBot app icon
 * image. Uses the bundled icon.png asset via require() — zero new dependencies.
 *
 * Sizes: sm=56, md=80, lg=108. The container is a sky-tinted rounded rect
 * behind the image so it looks intentional even while the asset loads.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme, palette } from '@/lib/design';

// The app icon is BeakerBot. Require at module level so Metro bundles it.
const ICON = require('@/assets/images/icon.png') as number;

export type BeakerBotMarkSize = 'sm' | 'md' | 'lg';

const SIZE_MAP: Record<BeakerBotMarkSize, number> = {
  sm: 56,
  md: 80,
  lg: 108,
};

export interface BeakerBotMarkProps {
  size?: BeakerBotMarkSize;
}

export function BeakerBotMark({ size = 'md' }: BeakerBotMarkProps) {
  const { radii, dark } = useTheme();
  const dim = SIZE_MAP[size];
  const radius = size === 'sm' ? radii.md : size === 'md' ? radii.lg : radii.xl;

  return (
    <View
      style={[
        styles.tile,
        {
          width: dim,
          height: dim,
          borderRadius: radius,
          backgroundColor: dark ? 'rgba(26,160,230,0.18)' : palette.skyLight,
        },
      ]}
    >
      <Image
        source={ICON}
        style={{ width: dim * 0.78, height: dim * 0.78 }}
        resizeMode="contain"
      />
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
