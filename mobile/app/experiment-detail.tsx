// Experiment hub screen. The screen "before the method": for a task that has one
// or more attached methods, show the task name + its full method list, then tap a
// method to open it. Reached from the Today panel + Home Active Experiments band
// (always, even for a single method, so the experiment has one consistent home).
//
// The method LIST is per-task and correct: it reads the task's linkedMethods from
// the global Today snapshot (published by the laptop), so different experiments
// show different methods. Opening one method still routes to /method-detail, which
// resolves the published method snapshot (per-method precise content is a later
// relay follow-up, same limitation the band card has).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ThemedText } from '@/components/themed-text';
import { useTodayState } from '@/lib/today-store';
import { typeMeta } from '@/lib/method-library';
import { useTheme, fonts } from '@/lib/design';
import type { SnapshotTask } from '@/lib/snapshots';

export default function ExperimentDetailScreen() {
  const { surface, spacing } = useTheme();
  const router = useRouter();
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const { snapshot } = useTodayState();

  // Find the task across all three buckets (today / overdue / upcoming).
  const allTasks: SnapshotTask[] = [
    ...(snapshot?.tasks ?? []),
    ...(snapshot?.overdueTasks ?? []),
    ...(snapshot?.upcomingTasks ?? []),
  ];
  const task = taskId ? allTasks.find((t) => t.id === taskId) : undefined;

  // Prefer the full per-task method list; fall back to the single-method glance
  // fields so older snapshots (no linkedMethods array) still render one row.
  const methods =
    task?.linkedMethods && task.linkedMethods.length > 0
      ? task.linkedMethods
      : task?.linkedMethodName
        ? [{ name: task.linkedMethodName, methodType: task.linkedMethodType }]
        : [];

  const openMethod = () => {
    // Per-method precise content is a later relay follow-up; for now every method
    // opens the published method view (which itself lists the protocols).
    router.push('/method-detail');
  };

  if (!task) {
    return (
      <ScreenFrame>
        <ScreenHeader title="Experiment" />
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="flask-outline"
            text="Open Today and tap an experiment to see its methods."
          />
        </View>
      </ScreenFrame>
    );
  }

  const meta = [task.task_type].filter((p): p is string => !!p && p.length > 0).join('');

  return (
    <ScreenFrame>
      <ScreenHeader />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText type="title">
          {task.name && task.name.length > 0 ? task.name : 'Experiment'}
        </ThemedText>
        {meta.length > 0 ? (
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>{meta}</ThemedText>
        ) : null}

        <ThemedText style={[styles.sectionLabel, { color: surface.muted }]}>
          {methods.length === 1 ? 'METHOD' : `METHODS · ${methods.length}`}
        </ThemedText>

        {methods.length === 0 ? (
          <EmptyState
            icon="flask-outline"
            text="No methods attached to this experiment yet."
          />
        ) : (
          methods.map((m, i) => {
            const tm = typeMeta(m.methodType);
            return (
              <Pressable
                key={`${m.name ?? 'method'}-${i}`}
                onPress={openMethod}
                style={[
                  styles.methodCard,
                  { backgroundColor: surface.surface, borderColor: surface.border },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Open method ${m.name ?? 'method'}`}
              >
                <View style={[styles.typeBadge, { backgroundColor: `${tm.color}1A` }]}>
                  <ThemedText style={[styles.typeBadgeText, { color: tm.color }]}>
                    {tm.label}
                  </ThemedText>
                </View>
                <ThemedText
                  style={[styles.methodName, { color: surface.text }]}
                  numberOfLines={2}
                >
                  {m.name && m.name.length > 0 ? m.name : 'Untitled method'}
                </ThemedText>
                <Ionicons name="chevron-forward" size={18} color={surface.muted} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 4 },
  emptyWrap: { paddingHorizontal: 20, paddingTop: 12 },
  tagline: { marginTop: 4, fontSize: 13, fontFamily: fonts.medium },
  sectionLabel: {
    marginTop: 22,
    marginBottom: 8,
    fontSize: 11,
    letterSpacing: 0.6,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  typeBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
  },
  typeBadgeText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
  methodName: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },
});
