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
import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ThemedText } from '@/components/themed-text';
import { MarkdownLite } from '@/components/MarkdownLite';
import { useTodayState } from '@/lib/today-store';
import { typeMeta } from '@/lib/method-library';
import { usePairing } from '@/lib/pairing';
import { captureToExperiment } from '@/lib/experiment-capture';
import { postAppendLine } from '@/lib/calc-export';
import { fetchSnapshot, type ExperimentNotesSnapshot } from '@/lib/snapshots';
import { signWithDevice } from '@/lib/device-identity';
import type { RouteTab } from '@/lib/route-capture';
import { useTheme, palette, fonts } from '@/lib/design';
import type { SnapshotTask } from '@/lib/snapshots';

export default function ExperimentDetailScreen() {
  const { surface, spacing } = useTheme();
  const router = useRouter();
  const { pairing } = usePairing();
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const { snapshot } = useTodayState();
  const [busyTab, setBusyTab] = useState<RouteTab | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteTab, setNoteTab] = useState<RouteTab>('notes');
  const [noteSending, setNoteSending] = useState(false);
  const [notesSnap, setNotesSnap] = useState<ExperimentNotesSnapshot | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);

  // Pull the experiment's notes/results docs (read-only). One-time on mount plus
  // a manual refresh; the laptop publishes the latest sealed projection.
  const loadNotes = useCallback(async () => {
    if (!pairing) return;
    setNotesLoading(true);
    try {
      const snap = (await fetchSnapshot(
        'experiment-notes',
        pairing,
        signWithDevice,
      )) as ExperimentNotesSnapshot | null;
      setNotesSnap(snap);
    } catch {
      // Leave whatever we had; the section shows its empty/last state.
    } finally {
      setNotesLoading(false);
    }
  }, [pairing]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

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

  // Routing a capture to this experiment needs its numeric id + owner. The
  // snapshot id is the Task record id as a string; parse it and require an owner.
  const numericTaskId = task?.id ? Number(task.id) : NaN;
  const canAdd = Number.isFinite(numericTaskId) && !!task?.owner;

  const addTo = async (tab: RouteTab) => {
    if (!canAdd || !task?.owner || busyTab) return;
    setBusyTab(tab);
    setStatus(null);
    try {
      const result = await captureToExperiment({
        taskId: numericTaskId,
        owner: task.owner,
        tab,
        pairing,
      });
      const where = tab === 'results' ? 'Results' : 'Lab Notes';
      setStatus(
        result === 'routed'
          ? `Photo sent to ${where} for this experiment.`
          : result === 'queued-offline'
            ? 'Saved. It will sync when this phone is back online.'
            : result === 'sent-no-routing'
              ? 'Sent to your inbox (re-pair this phone to file it on the experiment).'
              : result === 'no-permission'
                ? 'Camera permission is needed to add a photo.'
                : null,
      );
    } finally {
      setBusyTab(null);
    }
  };

  const sendNote = async () => {
    const text = noteText.trim();
    if (!canAdd || !task?.owner || !text || noteSending) return;
    const pub = pairing?.userX25519PubHex ?? '';
    const where = noteTab === 'results' ? 'Results' : 'Lab Notes';
    setNoteSending(true);
    setStatus(null);
    try {
      if (!pairing) {
        setStatus('Pair this phone to send a note to the experiment.');
        return;
      }
      if (!pub) {
        setStatus('Re-pair this phone to send notes (missing key).');
        return;
      }
      // postAppendLine seals + posts the append-line command the laptop already
      // handles (appends to the experiment's notes/results markdown doc).
      await postAppendLine(numericTaskId, task.owner, noteTab, text, pub, pairing.relayUrl);
      setNoteText('');
      setStatus(`Note added to ${where} for this experiment.`);
    } catch {
      setStatus('Could not send the note. Try again when back online.');
    } finally {
      setNoteSending(false);
    }
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

        {notesSnap?.notes?.markdown || notesSnap?.results?.markdown ? (
          <View style={styles.docSection}>
            <View style={styles.docHeaderRow}>
              <ThemedText style={[styles.sectionLabel, { color: surface.muted }]}>
                NOTES & RESULTS
              </ThemedText>
              <Pressable
                onPress={() => void loadNotes()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Refresh notes"
              >
                {notesLoading ? (
                  <ActivityIndicator size="small" color={surface.muted} />
                ) : (
                  <Ionicons name="refresh" size={16} color={palette.sky} />
                )}
              </Pressable>
            </View>
            {notesSnap?.notes?.markdown ? (
              <View style={[styles.docCard, { backgroundColor: surface.surface, borderColor: surface.border }]}>
                <ThemedText style={[styles.docTabLabel, { color: palette.sky }]}>Lab Notes</ThemedText>
                <MarkdownLite markdown={notesSnap.notes.markdown} />
              </View>
            ) : null}
            {notesSnap?.results?.markdown ? (
              <View style={[styles.docCard, { backgroundColor: surface.surface, borderColor: surface.border }]}>
                <ThemedText style={[styles.docTabLabel, { color: palette.violet }]}>Results</ThemedText>
                <MarkdownLite markdown={notesSnap.results.markdown} />
              </View>
            ) : null}
          </View>
        ) : null}

        {canAdd ? (
          <View style={styles.addSection}>
            <ThemedText style={[styles.sectionLabel, { color: surface.muted }]}>
              ADD TO THIS EXPERIMENT
            </ThemedText>
            <ThemedText style={[styles.subLabel, { color: surface.muted }]}>
              Photo
            </ThemedText>
            <View style={styles.addRow}>
              <Pressable
                onPress={() => addTo('notes')}
                disabled={busyTab !== null}
                style={[
                  styles.addBtn,
                  { backgroundColor: surface.surface, borderColor: surface.border },
                  busyTab !== null ? styles.addBtnDisabled : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add a photo to this experiment's Lab Notes"
              >
                {busyTab === 'notes' ? (
                  <ActivityIndicator size="small" color={palette.sky} />
                ) : (
                  <Ionicons name="camera-outline" size={18} color={palette.sky} />
                )}
                <ThemedText style={[styles.addBtnText, { color: surface.text }]}>
                  Lab Notes
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => addTo('results')}
                disabled={busyTab !== null}
                style={[
                  styles.addBtn,
                  { backgroundColor: surface.surface, borderColor: surface.border },
                  busyTab !== null ? styles.addBtnDisabled : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add a photo to this experiment's Results"
              >
                {busyTab === 'results' ? (
                  <ActivityIndicator size="small" color={palette.violet} />
                ) : (
                  <Ionicons name="bar-chart-outline" size={18} color={palette.violet} />
                )}
                <ThemedText style={[styles.addBtnText, { color: surface.text }]}>
                  Results
                </ThemedText>
              </Pressable>
            </View>

            <ThemedText style={[styles.subLabel, { color: surface.muted }]}>
              Note
            </ThemedText>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Write a note for this experiment..."
              placeholderTextColor={surface.muted}
              multiline
              style={[
                styles.noteInput,
                { backgroundColor: surface.surface, borderColor: surface.border, color: surface.text },
              ]}
            />
            <View style={styles.noteRow}>
              <View style={styles.tabToggle}>
                {(['notes', 'results'] as RouteTab[]).map((tb) => {
                  const active = noteTab === tb;
                  return (
                    <Pressable
                      key={tb}
                      onPress={() => setNoteTab(tb)}
                      style={[
                        styles.tabPill,
                        {
                          backgroundColor: active ? palette.sky : surface.surface,
                          borderColor: active ? palette.sky : surface.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <ThemedText
                        style={[
                          styles.tabPillText,
                          { color: active ? palette.white : surface.muted },
                        ]}
                      >
                        {tb === 'results' ? 'Results' : 'Lab Notes'}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={sendNote}
                disabled={noteSending || noteText.trim().length === 0}
                style={[
                  styles.sendBtn,
                  {
                    backgroundColor: palette.sky,
                    opacity: noteSending || noteText.trim().length === 0 ? 0.5 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send note to this experiment"
              >
                {noteSending ? (
                  <ActivityIndicator size="small" color={palette.white} />
                ) : (
                  <ThemedText style={[styles.sendBtnText, { color: palette.white }]}>
                    Send
                  </ThemedText>
                )}
              </Pressable>
            </View>
            {status ? (
              <ThemedText style={[styles.statusText, { color: surface.muted }]}>
                {status}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
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
  docSection: { marginTop: 22 },
  docHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  docCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  docTabLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    fontFamily: fonts.bold,
    fontWeight: '700',
    marginBottom: 6,
  },
  addSection: { marginTop: 8 },
  subLabel: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 12,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },
  addRow: { flexDirection: 'row', gap: 10 },
  noteInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 72,
    fontSize: 15,
    fontFamily: fonts.medium,
    textAlignVertical: 'top',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 10,
  },
  tabToggle: { flexDirection: 'row', gap: 8, flex: 1 },
  tabPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabPillText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },
  sendBtn: {
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 10,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
  },
  addBtnDisabled: { opacity: 0.55 },
  addBtnText: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    fontWeight: '600',
  },
  statusText: {
    marginTop: 10,
    fontSize: 13,
    fontFamily: fonts.medium,
  },
});
