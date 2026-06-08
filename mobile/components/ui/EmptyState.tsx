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
import { useTheme } from '@/lib/design';
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
  const { surface } = useTheme();
  return (
    <Card>
      <View style={styles.inner}>
        <Ionicons name={icon} size={28} color={surface.muted} />
        <ThemedText style={[styles.text, { color: surface.muted }]}>
          {text}
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  inner: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
