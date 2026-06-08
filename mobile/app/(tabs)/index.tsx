/**
 * Home tab (v2 visual foundation).
 *
 * All feature logic is unchanged (usePairing, routes to /pair, /note,
 * /reorder, capture, clearPairing). This pass restyles with the new design
 * tokens + primitives from lib/design and components/ui/.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { BeakerBotMark } from '@/components/ui/BeakerBotMark';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { clearPairing, usePairing } from '@/lib/pairing';
import { useTheme } from '@/lib/design';

export default function HomeScreen() {
  const router = useRouter();
  const { pairing, loading, refresh } = usePairing();
  const { surface, spacing, type } = useTheme();

  // Re-read pairing whenever the tab regains focus, so it updates right
  // after the pair screen pops back.
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
    <ScreenFrame>
      <View style={styles.safe}>
        {/* Hero */}
        <View style={[styles.hero, { gap: spacing.lg }]}>
          <BeakerBotMark size="lg" alive />
          <View style={[styles.heroText, { gap: spacing.sm }]}>
            <ThemedText
              style={[
                styles.wordmark,
                { color: surface.text },
              ]}
            >
              ResearchOS
            </ThemedText>
            <ThemedText
              style={[
                styles.tagline,
                { color: surface.muted },
              ]}
            >
              Bench companion. Snap photos, glance at today, and stay in sync
              with your lab. Your laptop stays the main workspace.
            </ThemedText>
          </View>
        </View>

        {/* Pairing card */}
        {loading ? (
          <Card>
            <ThemedText style={{ color: surface.muted }}>Checking pairing...</ThemedText>
          </Card>
        ) : pairing ? (
          <PairedCard
            labName={pairing.labName}
            pairedAt={pairing.pairedAt}
            onCapture={() => router.push('/(tabs)/capture')}
            onNote={() => router.push('/note')}
            onReorder={() => router.push('/reorder')}
            onUnpair={onUnpair}
          />
        ) : (
          <NotPairedCard onPair={() => router.push('/pair')} />
        )}
      </View>
    </ScreenFrame>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PairedCard({
  labName,
  pairedAt,
  onCapture,
  onNote,
  onReorder,
  onUnpair,
}: {
  labName?: string;
  pairedAt: string;
  onCapture: () => void;
  onNote: () => void;
  onReorder: () => void;
  onUnpair: () => void;
}) {
  const { surface, spacing } = useTheme();

  return (
    <Card style={{ gap: spacing.sm }}>
      {/* Lab name + paired-at */}
      <View style={{ gap: 3 }}>
        <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
          {labName ?? 'Paired'}
        </ThemedText>
        <ThemedText style={[styles.cardMeta, { color: surface.muted }]}>
          Paired {formatPairedAt(pairedAt)}
        </ThemedText>
      </View>

      {/* Primary action */}
      <Button
        variant="primary"
        label="Take a bench photo"
        onPress={onCapture}
        style={{ marginTop: spacing.xs }}
      />

      {/* Secondary actions */}
      <Button variant="secondary" label="Quick note" onPress={onNote} />
      <Button variant="secondary" label="Scan to reorder" onPress={onReorder} />
      <Button variant="ghost" label="Unpair" onPress={onUnpair} />
    </Card>
  );
}

function NotPairedCard({ onPair }: { onPair: () => void }) {
  const { surface, spacing } = useTheme();

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ gap: 3 }}>
        <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
          Not paired yet
        </ThemedText>
        <ThemedText style={[styles.cardMeta, { color: surface.muted }]}>
          Scan the pairing code from your desktop to link this phone to your lab.
        </ThemedText>
      </View>
      <Button
        variant="primary"
        label="Pair your phone"
        onPress={onPair}
        style={{ marginTop: spacing.xs }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPairedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
  },
  heroText: {
    alignItems: 'center',
  },
  wordmark: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 300,
    marginTop: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  cardMeta: {
    fontSize: 14,
    lineHeight: 20,
  },
});
