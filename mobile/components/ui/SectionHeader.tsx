/**
 * SectionHeader primitive. A labelled section divider with an optional
 * trailing action (e.g. a "Clear" link button).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/design';

export interface SectionHeaderProps {
  title: string;
  /** Optional action label (e.g. "Clear"). */
  action?: string;
  /** Fires when the action label is pressed. */
  onAction?: () => void;
}

export function SectionHeader({ title, action, onAction }: SectionHeaderProps) {
  const { surface, type, spacing } = useTheme();

  return (
    <View style={[styles.row, { marginTop: spacing.lg, marginBottom: spacing.xs }]}>
      <Text style={[styles.title, { color: surface.text }]}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.action, { color: surface.tabBarActiveTint }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  action: {
    fontSize: 14,
    fontWeight: '600',
  },
});
