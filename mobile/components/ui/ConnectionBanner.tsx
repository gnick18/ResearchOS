/**
 * ConnectionBanner. A slim, full-width contextual banner that sits directly
 * under the shared TabHeader on every tab. It is the app-wide home for the
 * sync/connection cue, replacing the old per-header ConnectionStatusChip.
 *
 * It renders NOTHING when the phone is synced (the happy path stays quiet) and
 * only appears when the user needs to know something:
 *
 *   offline - no network. Captures queue locally and send when back online.
 *   stale   - online but the laptop has not published fresh data (asleep / not
 *             publishing). Captures still queue and send.
 *
 * Tapping the banner surfaces the same one-line explainer the old chip used, so
 * the meaning is never a mystery. The tone is amber for laptop-asleep and a
 * danger tint for offline. No emoji, Ionicons only.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Alert, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { palette } from '@/lib/design';
import { useConnectionStatus, type ConnectionState } from '@/lib/connection-status';

type BannerLook = {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  bg: string;
  label: string;
  explain: string;
};

// Only non-synced states return a look. 'synced' yields null so the banner is
// hidden entirely on the happy path.
function look(state: ConnectionState): BannerLook | null {
  if (state === 'offline') {
    return {
      icon: 'cloud-offline-outline',
      tint: palette.danger,
      bg: palette.dangerLight,
      label: 'Offline, captures queued',
      explain:
        'No network right now. Captures stay on your phone and send themselves when you are back online.',
    };
  }
  if (state === 'stale') {
    return {
      icon: 'moon-outline',
      tint: palette.warning,
      bg: palette.warningLight,
      label: 'Laptop asleep, nothing syncing',
      explain:
        'You are online but your laptop has not published fresh data. It is likely asleep or closed. Captures still queue and send.',
    };
  }
  return null;
}

export function ConnectionBanner() {
  const { state } = useConnectionStatus();
  const l = look(state);

  // Synced (or any future happy state): render nothing.
  if (!l) return null;

  return (
    <Pressable
      onPress={() => Alert.alert(l.label, l.explain)}
      accessibilityRole="button"
      accessibilityLabel={`Connection status, ${l.label}`}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: l.bg, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Ionicons name={l.icon} size={15} color={l.tint} />
      <ThemedText style={[styles.label, { color: l.tint }]} numberOfLines={1}>
        {l.label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 16,
    marginHorizontal: -16,
    marginTop: 4,
    marginBottom: 4,
  },
  label: { fontSize: 12, fontWeight: '700' },
});
