// Today-glance screen (piece B). A read-only bench view of what is scheduled
// today, fetched as an E2E-encrypted snapshot the laptop published to the relay.
// The phone fetches with a device-Ed25519-signed request, unseals it with its
// own X25519 key, and shows the task list plus overdue/upcoming chips and a last
// synced line. No write-back, no inventory. Pull to refresh. House style: no
// em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useTheme, palette } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import {
  fetchSnapshot,
  type TodaySnapshot,
  type SnapshotTask,
} from '@/lib/snapshots';

export default function TodayScreen() {
  const router = useRouter();
  const { surface, spacing } = useTheme();
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

  // Reload the snapshot whenever the resolved pairing IDENTITY changes (covers
  // the async pairing load and a re-pair). Keyed on the stable u+relayUrl, not
  // the pairing object reference, because usePairing returns a fresh object on
  // every refresh, keying on the object would re-fire this forever.
  const pairingKey = pairing ? `${pairing.u}:${pairing.relayUrl}` : 'none';
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingKey]);

  // On focus, re-read the pairing record once. refresh is stable (useCallback
  // with empty deps), so this runs once per focus and cannot loop.
  useFocusEffect(
    useCallback(() => {
      refreshPairing();
    }, [refreshPairing]),
  );

  const tasks: SnapshotTask[] = Array.isArray(snapshot?.tasks)
    ? snapshot!.tasks!
    : [];
  const overdue = typeof snapshot?.overdue === 'number' ? snapshot.overdue : 0;
  const upcoming =
    typeof snapshot?.upcoming === 'number' ? snapshot.upcoming : 0;
  const overdueTasks: SnapshotTask[] = Array.isArray(snapshot?.overdueTasks)
    ? snapshot!.overdueTasks!
    : [];
  const upcomingTasks: SnapshotTask[] = Array.isArray(snapshot?.upcomingTasks)
    ? snapshot!.upcomingTasks!
    : [];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={load}
              tintColor={palette.sky}
            />
          }
        >
          <ThemedText type="title">Today</ThemedText>
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>
            A read-only glance at what is scheduled today, synced from your
            laptop.
          </ThemedText>

          {!pairing && (pairingLoading || !loaded) ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={palette.sky} />
            </View>
          ) : null}

          {!pairing && loaded ? (
            <Card style={{ gap: spacing.sm }}>
              <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
                This phone is not paired
              </ThemedText>
              <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
                Pair with your desktop to see today at the bench.
              </ThemedText>
              <Button
                variant="primary"
                label="Pair this phone"
                onPress={() => router.push('/pair')}
                style={{ marginTop: spacing.xs }}
              />
            </Card>
          ) : null}

          {pairing ? (
            <>
              <ScanHeroCard onPress={() => router.push('/scan')} />

              {error ? (
                <View
                  style={[
                    styles.errorBanner,
                    {
                      borderColor: palette.dangerBorder,
                      backgroundColor: palette.dangerLight,
                      borderRadius: 12,
                    },
                  ]}
                >
                  <ThemedText style={[styles.errorText, { color: palette.danger }]}>
                    {error}
                  </ThemedText>
                </View>
              ) : null}

              {loading && !loaded ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={palette.sky} />
                </View>
              ) : null}

              {loaded && snapshot === null && !error ? (
                <Card>
                  <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
                    Not synced yet
                  </ThemedText>
                  <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
                    Open ResearchOS on your laptop to sync today.
                  </ThemedText>
                </Card>
              ) : null}

              {loaded && snapshot !== null && !error ? (
                <>
                  <SectionHeader title="Today" />
                  {tasks.length > 0 ? (
                    tasks.map((task, i) => (
                      <TaskRow key={task.id ?? `today-${i}`} task={task} />
                    ))
                  ) : (
                    <EmptyState
                      icon="calendar-outline"
                      text="Nothing scheduled for today."
                    />
                  )}

                  {overdueTasks.length > 0 ? (
                    <>
                      <SectionHeader title={`Overdue (${overdue})`} />
                      {overdueTasks.map((task, i) => (
                        <TaskRow key={task.id ?? `overdue-${i}`} task={task} overdue />
                      ))}
                    </>
                  ) : overdue > 0 ? (
                    <ThemedText style={[styles.emptyLine, { color: palette.danger }]}>
                      {overdue} overdue
                    </ThemedText>
                  ) : null}

                  {upcomingTasks.length > 0 ? (
                    <>
                      <SectionHeader title={`Coming up (${upcoming})`} />
                      {upcomingTasks.map((task, i) => (
                        <TaskRow key={task.id ?? `upcoming-${i}`} task={task} />
                      ))}
                    </>
                  ) : upcoming > 0 ? (
                    <ThemedText style={[styles.emptyLine, { color: surface.muted }]}>
                      {upcoming} upcoming
                    </ThemedText>
                  ) : null}
                </>
              ) : null}

              {snapshot?.generatedAt ? (
                <ThemedText style={[styles.synced, { color: surface.muted }]}>
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

// The primary Scan entry point. A sky-filled hero card at the top of Today,
// because "I just got a package" is the moment you open the app. Tapping it
// opens the scan flow (receive, track, deduct, reorder). Mirrored by a smaller
// scan affordance in Send.
function ScanHeroCard({ onPress }: { onPress: () => void }) {
  const { radii, elevation } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.scanHero,
        {
          backgroundColor: palette.sky,
          borderRadius: radii.lg,
          opacity: pressed ? 0.92 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        elevation,
      ]}
    >
      <View style={styles.scanHeroIcon}>
        <Ionicons name="scan-outline" size={26} color={palette.white} />
      </View>
      <View style={styles.scanHeroText}>
        <ThemedText style={styles.scanHeroTitle}>Scan a package</ThemedText>
        <ThemedText style={styles.scanHeroSub}>
          Receive, track, and reorder supplies
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
    </Pressable>
  );
}

function TaskRow({ task, overdue }: { task: SnapshotTask; overdue?: boolean }) {
  const { surface } = useTheme();
  const meta = [formatDateRange(task.start_date, task.end_date), task.task_type]
    .filter((part): part is string => !!part && part.length > 0)
    .join('  -  ');
  return (
    <Card compact>
      <ThemedText
        style={[
          styles.rowTitle,
          { color: overdue ? palette.danger : surface.text },
        ]}
        numberOfLines={2}
      >
        {task.name && task.name.length > 0 ? task.name : 'Untitled task'}
      </ThemedText>
      {meta.length > 0 ? (
        <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>{meta}</ThemedText>
      ) : null}
    </Card>
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
    lineHeight: 22,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  cardHint: {
    lineHeight: 20,
  },
  emptyLine: {
    lineHeight: 20,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  rowMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  synced: {
    fontSize: 12,
    marginTop: 4,
  },
  errorBanner: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    lineHeight: 20,
  },
  scanHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  scanHeroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanHeroText: {
    flex: 1,
  },
  scanHeroTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  scanHeroSub: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
});
