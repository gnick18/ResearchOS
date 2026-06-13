/**
 * ScreenHeader. A lightweight in-screen header for stack (pushed) screens: a back
 * chevron (and an optional title) rendered as plain JS inside the screen content.
 *
 * Why not the native nav header: a JS overlay over the native-screens header can
 * leave the native back button unresponsive, so we hide the native header
 * (headerShown false) on these screens and use this guaranteed-working back
 * (router.back()) instead. It also matches the large-in-screen-title look of the
 * mockups. House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useTheme, palette } from '@/lib/design';

export function ScreenHeader({ title }: { title?: string }) {
  const router = useRouter();
  const { surface } = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={14}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={26} color={palette.sky} />
      </Pressable>
      {title ? (
        <ThemedText style={[styles.title, { color: surface.text }]}>{title}</ThemedText>
      ) : null}
      {/* The single sync/connection cue lives on the Notebook pairing card
          (live / last-synced / offline + tap to Sync now), so pushed stack
          screens carry no connection chip. */}
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 2,
    minHeight: 38,
    paddingRight: 12,
  },
  spacer: { flex: 1 },
  back: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  title: { fontSize: 17, fontWeight: '700' },
});
