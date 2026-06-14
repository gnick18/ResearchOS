/**
 * EmptyState. A calm, muted placeholder shown when a list has no items.
 * Renders a small @expo/vector-icons icon above the copy text, centred inside
 * a Card. Keeps the visual weight low: icon is muted (not branded), copy uses
 * the existing text.
 *
 * Usage:
 *   <EmptyState icon="camera-outline" text="No captures yet. Snap a bench photo above." />
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { palette, useTheme } from '@/lib/design';
import { Card } from './Card';

// We use Ionicons (bundled with @expo/vector-icons, already a dep). The icon
// name type is inferred from the Ionicons glyph map.
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface EmptyStateProps {
  /** Ionicons glyph name, e.g. "camera-outline". */
  icon: IoniconName;
  /** The copy to show below the icon. Keep it short and actionable. */
  text: string;
}

export function EmptyState({ icon, text }: EmptyStateProps) {
  const { palette: p, radii } = useTheme();
  return (
    <Card>
      <View style={styles.inner}>
        {/* Contract .empty .ei: a sky-tinted rounded chip carrying a sky glyph,
            so an empty list still reads as branded and calm, not just grey. */}
        <View
          style={[
            styles.iconChip,
            { backgroundColor: p.skyDim, borderRadius: radii.lg },
          ]}
        >
          <Ionicons name={icon} size={27} color={p.sky} />
        </View>
        <ThemedText style={[styles.text, { color: palette.faint }]}>
          {text}
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  inner: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 18,
  },
  iconChip: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 240,
  },
});
