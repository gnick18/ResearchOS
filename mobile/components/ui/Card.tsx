/**
 * Card primitive. A rounded, bordered, themed surface for grouping content.
 * Matches the web app Card aesthetic in React Native terms.
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
  const { surface, radii, spacing } = useTheme();

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: surface.surface,
          borderColor: surface.border,
          borderRadius: radii.lg,
          padding: compact ? spacing.md : spacing.lg,
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
