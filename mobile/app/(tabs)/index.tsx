import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

// ResearchOS companion, v0 shell (Chunk 0). The laptop stays the main
// workspace; this is the bench-side companion. Identity pairing + bench
// capture come next (Chunks 1-2). House style: no em-dashes, no emojis.
export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ThemedView style={styles.hero}>
          <ThemedText type="title" style={styles.center}>
            ResearchOS
          </ThemedText>
          <ThemedText type="subtitle" style={styles.center}>
            Companion
          </ThemedText>
          <ThemedText style={styles.tagline}>
            Snap a photo at the bench, glance at today, and stay in sync with
            your lab. Your laptop stays the main workspace.
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.card}>
          <ThemedText type="defaultSemiBold">Not paired yet</ThemedText>
          <ThemedText style={styles.cardHint}>
            Pairing with your desktop is the next step. For now this is the v0
            shell, running on your phone.
          </ThemedText>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 28,
  },
  hero: {
    alignItems: 'center',
    gap: 10,
  },
  center: {
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
    opacity: 0.7,
    lineHeight: 22,
  },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  cardHint: {
    opacity: 0.7,
    lineHeight: 20,
  },
});
