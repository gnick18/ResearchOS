/**
 * ConnectionStatusChip. A subtle rounded pill for the header-right that tells
 * the user, app-wide, which sync world they are in:
 *
 *   synced  - "Synced" + relative time (cloud-done, success tint)
 *   offline - "Offline, queued" (cloud-offline, muted tint)
 *   stale   - "Laptop asleep" (time-outline, warning tint)
 *
 * Captures always queue locally, so this is information, not an error. Tapping
 * the chip surfaces a one-line explainer so the meaning is never a mystery.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Alert, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { useTheme, palette } from '@/lib/design';
import {
  useConnectionStatus,
  relativeSyncTime,
  type ConnectionState,
} from '@/lib/connection-status';

type ChipLook = {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  bg: string;
  border: string;
  label: string;
  explain: string;
};

function look(state: ConnectionState, lastSyncAt: number | null): ChipLook {
  if (state === 'offline') {
    return {
      icon: 'cloud-offline-outline',
      tint: palette.faint,
      bg: 'rgba(107, 114, 128, 0.12)',
      border: 'rgba(107, 114, 128, 0.30)',
      label: 'Offline, queued',
      explain:
        'No network right now. Captures stay on your phone and send themselves when you are back online.',
    };
  }
  if (state === 'stale') {
    return {
      icon: 'time-outline',
      tint: palette.warning,
      bg: palette.warningLight,
      border: 'rgba(217, 119, 6, 0.30)',
      label: 'Laptop asleep',
      explain:
        'You are online but your laptop has not published fresh data. It is likely asleep or closed. Captures still queue and send.',
    };
  }
  const rel = relativeSyncTime(lastSyncAt);
  return {
    icon: 'cloud-done-outline',
    tint: palette.success,
    bg: palette.successLight,
    border: 'rgba(22, 163, 74, 0.30)',
    label: rel ? `Synced ${rel}` : 'Synced',
    explain: 'Online and in sync with your laptop.',
  };
}

export function ConnectionStatusChip() {
  const { state, lastSyncAt } = useConnectionStatus();
  const l = look(state, lastSyncAt);

  return (
    <Pressable
      onPress={() => Alert.alert(l.label, l.explain)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Connection status, ${l.label}`}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: l.bg, borderColor: l.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={l.icon} size={13} color={l.tint} />
      <ThemedText style={[styles.label, { color: l.tint }]} numberOfLines={1}>
        {l.label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
    maxWidth: 150,
  },
  label: { fontSize: 11.5, fontWeight: '700' },
});
