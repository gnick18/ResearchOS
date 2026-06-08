import { useCallback } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { clearPairing, usePairing } from '@/lib/pairing';

const BRAND_SKY = '#1AA0E6';

// ResearchOS companion, v0 shell (Chunk 0) + v0 pairing. The laptop stays the
// main workspace; this is the bench-side companion. v0 pairing just means
// "scanned + stored a payload", crypto + device keys + network come next.
// House style: no em-dashes, no emojis.
export default function HomeScreen() {
  const router = useRouter();
  const { pairing, loading, refresh } = usePairing();

  // Re-read the pairing whenever the tab regains focus, so it updates right
  // after the pair screen pops back here.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const onUnpair = useCallback(async () => {
    await clearPairing();
    refresh();
  }, [refresh]);

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

        {loading ? (
          <ThemedView style={styles.card}>
            <ThemedText style={styles.cardHint}>Checking pairing...</ThemedText>
          </ThemedView>
        ) : pairing ? (
          <ThemedView style={styles.card}>
            <ThemedText type="defaultSemiBold">
              {pairing.labName ?? 'Paired'}
            </ThemedText>
            <ThemedText style={styles.cardHint}>
              Paired {formatPairedAt(pairing.pairedAt)}
            </ThemedText>
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.push('/(tabs)/capture')}
              accessibilityRole="button"
            >
              <ThemedText style={styles.primaryButtonText}>
                Take a bench photo
              </ThemedText>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={onUnpair}
              accessibilityRole="button"
            >
              <ThemedText style={styles.secondaryButtonText}>Unpair</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <ThemedView style={styles.card}>
            <ThemedText type="defaultSemiBold">Not paired yet</ThemedText>
            <ThemedText style={styles.cardHint}>
              Scan the pairing code from your desktop to link this phone to your
              lab.
            </ThemedText>
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.push('/pair')}
              accessibilityRole="button"
            >
              <ThemedText style={styles.primaryButtonText}>
                Pair your phone
              </ThemedText>
            </Pressable>
          </ThemedView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

// Friendly local rendering of the stored ISO timestamp; falls back to the raw
// string if it cannot be parsed.
function formatPairedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
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
    gap: 10,
  },
  cardHint: {
    opacity: 0.7,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: BRAND_SKY,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: BRAND_SKY,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: BRAND_SKY,
    fontWeight: '600',
  },
});
