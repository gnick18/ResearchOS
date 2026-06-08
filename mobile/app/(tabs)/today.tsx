// Today-glance screen (piece B). A read-only bench view of what is scheduled
// today, fetched as an E2E-encrypted snapshot the laptop published to the relay.
// The phone fetches with a device-Ed25519-signed request, unseals it with its
// own X25519 key, and shows the task list plus overdue/upcoming chips and a last
// synced line. No write-back, no inventory. Pull to refresh. House style: no
// em-dashes, no emojis, no mid-sentence colons, brand-sky (#1AA0E6) accents.
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import {
  fetchSnapshot,
  type TodaySnapshot,
  type SnapshotTask,
} from '@/lib/snapshots';

const BRAND_SKY = '#1AA0E6';

export default function TodayScreen() {
  const router = useRouter();
  const { pairing, loading: pairingLoading, refresh: refreshPairing } =
    usePairing();
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  // null = not yet loaded; once loaded we know whether the laptop published.
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!pairing) {
      setSnapshot(null);
      setLoaded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = (await fetchSnapshot(
        'today',
        pairing,
        signWithDevice,
      )) as TodaySnapshot | null;
      setSnapshot(data);
      setLoaded(true);
    } catch {
      setError('Could not sync. Pull down to try again.');
    } finally {
      setLoading(false);
    }
  }, [pairing]);

  // Re-read pairing and reload the snapshot whenever the tab regains focus.
  useFocusEffect(
    useCallback(() => {
      refreshPairing();
      load();
    }, [refreshPairing, load]),
  );

  const tasks: SnapshotTask[] = Array.isArray(snapshot?.tasks)
    ? snapshot!.tasks!
    : [];
  const overdue = typeof snapshot?.overdue === 'number' ? snapshot.overdue : 0;
  const upcoming =
    typeof snapshot?.upcoming === 'number' ? snapshot.upcoming : 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={load}
              tintColor={BRAND_SKY}
            />
          }
        >
          <ThemedText type="title">Today</ThemedText>
          <ThemedText style={styles.tagline}>
            A read-only glance at what is scheduled today, synced from your
            laptop.
          </ThemedText>

          {!pairing && (pairingLoading || !loaded) ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={BRAND_SKY} />
            </View>
          ) : null}

          {!pairing && loaded ? (
            <ThemedView style={styles.card}>
              <ThemedText type="defaultSemiBold">
                This phone is not paired
              </ThemedText>
              <ThemedText style={styles.cardHint}>
                Pair with your desktop to see today at the bench.
              </ThemedText>
              <Pressable
                style={styles.primaryButton}
                onPress={() => router.push('/pair')}
                accessibilityRole="button"
              >
                <ThemedText style={styles.primaryButtonText}>
                  Pair this phone
                </ThemedText>
              </Pressable>
            </ThemedView>
          ) : null}

          {pairing ? (
            <>
              {snapshot ? (
                <View style={styles.chipRow}>
                  <View style={[styles.statChip, styles.overdueChip]}>
                    <ThemedText style={styles.overdueChipText}>
                      Overdue {overdue}
                    </ThemedText>
                  </View>
                  <View style={[styles.statChip, styles.upcomingChip]}>
                    <ThemedText style={styles.upcomingChipText}>
                      Upcoming {upcoming}
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {error ? (
                <ThemedView style={styles.errorBanner}>
                  <ThemedText style={styles.errorText}>{error}</ThemedText>
                </ThemedView>
              ) : null}

              {loading && !loaded ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={BRAND_SKY} />
                </View>
              ) : null}

              {loaded && snapshot === null && !error ? (
                <ThemedView style={styles.card}>
                  <ThemedText type="defaultSemiBold">Not synced yet</ThemedText>
                  <ThemedText style={styles.cardHint}>
                    Open ResearchOS on your laptop to sync today.
                  </ThemedText>
                </ThemedView>
              ) : null}

              {loaded && snapshot !== null && tasks.length === 0 && !error ? (
                <ThemedView style={styles.card}>
                  <ThemedText type="defaultSemiBold">
                    Nothing scheduled for today
                  </ThemedText>
                  <ThemedText style={styles.cardHint}>
                    Enjoy the clear bench.
                  </ThemedText>
                </ThemedView>
              ) : null}

              {tasks.map((task, i) => (
                <TaskRow key={task.id ?? `task-${i}`} task={task} />
              ))}

              {snapshot?.generatedAt ? (
                <ThemedText style={styles.synced}>
                  Last synced {formatSynced(snapshot.generatedAt)}
                </ThemedText>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function TaskRow({ task }: { task: SnapshotTask }) {
  const meta = [formatDateRange(task.start_date, task.end_date), task.task_type]
    .filter((part): part is string => !!part && part.length > 0)
    .join('  -  ');
  return (
    <ThemedView style={styles.row}>
      <ThemedText type="defaultSemiBold" numberOfLines={2}>
        {task.name && task.name.length > 0 ? task.name : 'Untitled task'}
      </ThemedText>
      {meta.length > 0 ? (
        <ThemedText style={styles.rowMeta}>{meta}</ThemedText>
      ) : null}
    </ThemedView>
  );
}

// Short, human date range. Single day collapses to one date; a missing or
// unparseable value is dropped rather than shown raw.
function formatDateRange(start?: string, end?: string): string {
  const s = formatShortDate(start);
  const e = formatShortDate(end);
  if (s && e) return s === e ? s : `${s} to ${e}`;
  return s || e || '';
}

function formatShortDate(value?: string): string {
  if (!value) return '';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

// "last synced" line. Shows a clock time when it parses, else the raw string.
function formatSynced(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 14,
  },
  tagline: {
    opacity: 0.7,
    lineHeight: 22,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  overdueChip: {
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
  },
  overdueChipText: {
    color: '#dc2626',
    fontWeight: '600',
    fontSize: 13,
  },
  upcomingChip: {
    backgroundColor: 'rgba(22, 160, 230, 0.12)',
  },
  upcomingChipText: {
    color: BRAND_SKY,
    fontWeight: '600',
    fontSize: 13,
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
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  row: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 13,
  },
  synced: {
    opacity: 0.5,
    fontSize: 12,
    marginTop: 4,
  },
  errorBanner: {
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.5)',
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    color: '#dc2626',
    lineHeight: 20,
  },
});
