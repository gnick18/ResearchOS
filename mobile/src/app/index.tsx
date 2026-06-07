import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

// ResearchOS companion, v0 shell (Chunk 0). The laptop stays the main
// workspace; this is the bench-side companion. Identity pairing + bench
// capture come next (Chunks 1-2). House style: no em-dashes, no emojis.
export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.hero}>
          <ThemedText type="title" style={styles.centered}>
            ResearchOS
          </ThemedText>
          <ThemedText type="subtitle" style={styles.centered}>
            Companion
          </ThemedText>
          <ThemedText style={styles.tagline}>
            Snap a photo at the bench, glance at today, and stay in sync with
            your lab. Your laptop stays the main workspace.
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Not paired yet</ThemedText>
          <ThemedText type="small" style={styles.cardHint}>
            Pairing with your desktop is the next step. For now this is the v0
            shell, running on your phone.
          </ThemedText>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  centered: {
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
    opacity: 0.7,
  },
  card: {
    alignSelf: 'stretch',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
  cardHint: {
    opacity: 0.7,
  },
});
