/**
 * Card primitive. A rounded, bordered, themed surface for grouping content.
 * Applies a subtle, theme-aware elevation shadow so cards lift off the
 * background without looking heavy. Shadow is soft on light, slightly deeper on
 * dark (both pulled from the design.ts elevation token).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme } from '@/lib/design';

export interface CardProps extends ViewProps {
  /** Reduces padding for dense contexts. Defaults to false. */
  compact?: boolean;
}

export function Card({ compact = false, style, children, ...rest }: CardProps) {
  const { surface, radii, spacing, elevation } = useTheme();

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: surface.surface,
          borderColor: surface.border,
          borderRadius: radii.lg,
          padding: compact ? spacing.md : spacing.lg,
          // Elevation shadow (theme-aware, soft)
          ...elevation,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    gap: 10,
  },
});
