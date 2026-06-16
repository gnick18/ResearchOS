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
import { Fragment, useCallback, useEffect, useState } from 'react';
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
import {
  postInsertNoteBlock,
  END_ANCHOR_INDEX,
  TOP_ANCHOR_INDEX,
} from '@/lib/calc-export';
import { splitBlocks, blockAnchor } from '@/lib/note-anchor';
import { buildPhoneNoteBlock } from '@/lib/phone-note-format';
import { fetchSnapshot, type ExperimentNotesSnapshot } from '@/lib/snapshots';
import { signWithDevice } from '@/lib/device-identity';
import type { RouteTab } from '@/lib/route-capture';
import { useTheme, palette, fonts } from '@/lib/design';
import type { SnapshotTask } from '@/lib/snapshots';

/** A note the user has composed + placed locally but not yet pushed. anchorHash
 *  + anchorIndex identify the block it sits AFTER (top/end sentinels for the
 *  ends); body is the raw text; id is a stable key (also the push clientId). */
type StagedNote = {
  id: string;
  anchorHash: string;
  anchorIndex: number;
  body: string;
};

/** A simple unique-ish id for a staged note (also reused as the push clientId). */
function makeStagedId(): string {
  return `pn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * One tab's doc rendered as an ordered list of blocks with a "+ note here"
 * affordance at the top, between every pair of blocks, and at the bottom. A
 * composed note shows inline as a pending phone-note card at its slot. Staged
 * notes live in the parent (so the Push tray can count + send across tabs).
 *
 * anchorIndex convention matches calc-export: slot 0 sits before block 0 (top
 * sentinel), slot i (1..n-1) sits after block i-1 (anchored), and slot n sits
 * after the last block (end sentinel). The hash is blockAnchor of the block the
 * note sits after, empty for the top sentinel.
 */
function DocBlocks({
  markdown,
  tab,
  accent,
  label,
  placing,
  staged,
  composingSlot,
  composeText,
  onOpenCompose,
  onChangeCompose,
  onCommitCompose,
  onCancelCompose,
  onRemoveStaged,
}: {
  markdown: string;
  tab: RouteTab;
  accent: string;
  label: string;
  /** When false the doc is a clean read view (no insertion affordances). The
   *  "+ note here" slots only appear in placement mode (the Add note toggle). */
  placing: boolean;
  staged: StagedNote[];
  composingSlot: number | null;
  composeText: string;
  onOpenCompose: (slot: number, anchorHash: string, anchorIndex: number) => void;
  onChangeCompose: (text: string) => void;
  onCommitCompose: () => void;
  onCancelCompose: () => void;
  onRemoveStaged: (id: string) => void;
}) {
  const { surface } = useTheme();
  const blocks = splitBlocks(markdown);

  // Resolve the anchor a given insertion slot maps to.
  const anchorForSlot = (slot: number): { hash: string; index: number } => {
    if (slot <= 0) return { hash: '', index: TOP_ANCHOR_INDEX };
    if (slot >= blocks.length) {
      // After the last block. Carry the real last-block anchor so a re-pull that
      // grew the doc still lands right after it; END sentinel when the doc is
      // empty so it appends rather than fixing on a missing block.
      if (blocks.length === 0) return { hash: '', index: END_ANCHOR_INDEX };
      return { hash: blockAnchor(blocks[blocks.length - 1]), index: blocks.length - 1 };
    }
    // Between block slot-1 and slot: anchored to block slot-1.
    return { hash: blockAnchor(blocks[slot - 1]), index: slot - 1 };
  };

  // Staged notes that belong to a given slot (matched by resolved anchor).
  const stagedForSlot = (slot: number): StagedNote[] => {
    const a = anchorForSlot(slot);
    return staged.filter((n) => n.anchorHash === a.hash && n.anchorIndex === a.index);
  };

  // The number of insertion slots is blocks.length + 1 (top, between, bottom).
  const slots = Array.from({ length: blocks.length + 1 }, (_, i) => i);

  return (
    <View style={[styles.docCard, { backgroundColor: surface.surface, borderColor: surface.border }]}>
      <ThemedText style={[styles.docTabLabel, { color: accent }]}>{label}</ThemedText>
      {slots.map((slot) => {
        const a = anchorForSlot(slot);
        const slotStaged = stagedForSlot(slot);
        const composing = composingSlot === slot;
        return (
          <Fragment key={`slot-${slot}`}>
            {/* Insertion affordance for this slot. */}
            {composing ? (
              <View style={[styles.composer, { borderColor: accent }]}>
                <TextInput
                  value={composeText}
                  onChangeText={onChangeCompose}
                  placeholder="Write a note to place here..."
                  placeholderTextColor={surface.muted}
                  multiline
                  autoFocus
                  style={[styles.composerInput, { color: surface.text }]}
                />
                <View style={styles.composerRow}>
                  <Pressable
                    onPress={onCancelCompose}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel this note"
                    style={styles.composerCancel}
                  >
                    <ThemedText style={[styles.composerCancelText, { color: surface.muted }]}>
                      Cancel
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={onCommitCompose}
                    disabled={composeText.trim().length === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Place this note"
                    style={[
                      styles.composerPlace,
                      { backgroundColor: accent, opacity: composeText.trim().length === 0 ? 0.5 : 1 },
                    ]}
                  >
                    <ThemedText style={[styles.composerPlaceText, { color: palette.white }]}>
                      Place
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : placing ? (
              <Pressable
                onPress={() => onOpenCompose(slot, a.hash, a.index)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`Add a note here in ${label}`}
                style={styles.addHereRow}
              >
                <View style={[styles.addHereLine, { backgroundColor: accent }]} />
                <View style={[styles.addHereChip, { borderColor: accent, backgroundColor: `${accent}14` }]}>
                  <Ionicons name="add" size={13} color={accent} />
                  <ThemedText style={[styles.addHereText, { color: accent }]}>place here</ThemedText>
                </View>
                <View style={[styles.addHereLine, { backgroundColor: accent }]} />
              </Pressable>
            ) : null}

            {/* Pending notes placed at this slot. */}
            {slotStaged.map((n) => (
              <View
                key={n.id}
                style={[styles.pendingNote, { borderColor: accent, backgroundColor: `${accent}14` }]}
              >
                <View style={styles.pendingHeader}>
                  <Ionicons name="phone-portrait-outline" size={14} color={accent} />
                  <ThemedText style={[styles.pendingLabel, { color: accent }]}>
                    Pending phone note
                  </ThemedText>
                  <Pressable
                    onPress={() => onRemoveStaged(n.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Discard this pending note"
                  >
                    <Ionicons name="close" size={15} color={surface.muted} />
                  </Pressable>
                </View>
                <MarkdownLite markdown={n.body} />
              </View>
            ))}

            {/* The block itself (none after the last slot). */}
            {slot < blocks.length ? (
              <View style={styles.docBlock}>
                <MarkdownLite markdown={blocks[slot]} />
              </View>
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

export default function ExperimentDetailScreen() {
  const { surface, spacing } = useTheme();
  const router = useRouter();
  const { pairing } = usePairing();
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const { snapshot } = useTodayState();
  const [busyTab, setBusyTab] = useState<RouteTab | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [notesSnap, setNotesSnap] = useState<ExperimentNotesSnapshot | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);

  // Phone notes P2 staging. Staged notes are placed locally and pushed on demand;
  // each carries the tab it belongs to + the anchor of the block it sits after.
  const [stagedNotes, setStagedNotes] = useState<Array<StagedNote & { tab: RouteTab }>>([]);
  // The active composer slot, keyed by tab so only one composer is open at a time.
  const [composer, setComposer] = useState<
    { tab: RouteTab; slot: number; anchorHash: string; anchorIndex: number } | null
  >(null);
  const [composeText, setComposeText] = useState('');
  const [pushing, setPushing] = useState(false);
  // Placement mode: off = clean read view; on = the "place here" slots appear so
  // a note can be dropped between blocks. Toggled by the Add note / Done button.
  const [placing, setPlacing] = useState(false);
  const exitPlacing = () => {
    setPlacing(false);
    setComposer(null);
    setComposeText('');
  };

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
  // The laptop emits Task.id as a NUMBER, but taskId arrives as a string from the
  // route params, so a raw === never matched (number === string) and the screen
  // fell to its empty state. Compare both coerced to strings.
  const task = taskId
    ? allTasks.find((t) => String(t.id) === String(taskId))
    : undefined;

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

  // ── Phone notes P2 staging handlers ────────────────────────────────────────

  const openCompose = (tab: RouteTab, slot: number, anchorHash: string, anchorIndex: number) => {
    setComposer({ tab, slot, anchorHash, anchorIndex });
    setComposeText('');
  };

  const cancelCompose = () => {
    setComposer(null);
    setComposeText('');
  };

  const commitCompose = () => {
    const body = composeText.trim();
    if (!composer || !body) return;
    setStagedNotes((prev) => [
      ...prev,
      {
        id: makeStagedId(),
        tab: composer.tab,
        anchorHash: composer.anchorHash,
        anchorIndex: composer.anchorIndex,
        body,
      },
    ]);
    setComposer(null);
    setComposeText('');
  };

  const removeStaged = (id: string) => {
    setStagedNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const discardStaged = () => {
    setStagedNotes([]);
    cancelCompose();
  };

  const pushStaged = async () => {
    if (stagedNotes.length === 0 || pushing) return;
    const pub = pairing?.userX25519PubHex ?? '';
    if (!pairing || !canAdd || !task?.owner) {
      setStatus('Pair this phone to push notes to the experiment.');
      return;
    }
    if (!pub) {
      setStatus('Re-pair this phone to push notes (missing key).');
      return;
    }
    setPushing(true);
    setStatus(null);
    const author = pairing.userName ?? 'Phone';
    const failed: Array<StagedNote & { tab: RouteTab }> = [];
    try {
      for (const note of stagedNotes) {
        const block = buildPhoneNoteBlock(note.body, author);
        if (!block) continue;
        const ok = await postInsertNoteBlock(
          numericTaskId,
          task.owner,
          note.tab,
          note.anchorHash,
          note.anchorIndex,
          block,
          note.id,
          pub,
          pairing.relayUrl,
        );
        if (!ok) failed.push(note);
      }
      if (failed.length === 0) {
        setStagedNotes([]);
        setStatus(
          stagedNotes.length === 1
            ? 'Note pushed to this experiment.'
            : `${stagedNotes.length} notes pushed to this experiment.`,
        );
        // Re-pull so the canonical laptop doc (with the embeds in place) shows.
        await loadNotes();
      } else {
        // Keep the ones that did not send so the user can retry (offline flush).
        setStagedNotes(failed);
        setStatus('Some notes did not send. They will retry when back online.');
      }
    } finally {
      setPushing(false);
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

        <ThemedText style={[styles.sectionLabel, { color: palette.sky }]}>
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
              <ThemedText style={[styles.sectionLabel, { color: palette.sky }]}>
                NOTES & RESULTS
              </ThemedText>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => (placing ? exitPlacing() : setPlacing(true))}
                  accessibilityRole="button"
                  accessibilityLabel={placing ? 'Done adding notes' : 'Add a note'}
                  style={[
                    styles.addNoteBtn,
                    placing
                      ? { backgroundColor: palette.sky, borderColor: palette.sky }
                      : { backgroundColor: `${palette.sky}14`, borderColor: `${palette.sky}40` },
                  ]}
                >
                  {!placing ? (
                    <Ionicons name="add" size={15} color={palette.sky} />
                  ) : null}
                  <ThemedText
                    style={[
                      styles.addNoteBtnText,
                      { color: placing ? palette.white : palette.sky },
                    ]}
                  >
                    {placing ? 'Done' : 'Add note'}
                  </ThemedText>
                </Pressable>
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
            </View>
            {notesSnap?.notes?.markdown ? (
              <DocBlocks
                markdown={notesSnap.notes.markdown}
                tab="notes"
                accent={palette.sky}
                label="Lab Notes"
                placing={placing}
                staged={stagedNotes.filter((n) => n.tab === 'notes')}
                composingSlot={composer?.tab === 'notes' ? composer.slot : null}
                composeText={composeText}
                onOpenCompose={(slot, hash, index) => openCompose('notes', slot, hash, index)}
                onChangeCompose={setComposeText}
                onCommitCompose={commitCompose}
                onCancelCompose={cancelCompose}
                onRemoveStaged={removeStaged}
              />
            ) : null}
            {notesSnap?.results?.markdown ? (
              <DocBlocks
                markdown={notesSnap.results.markdown}
                tab="results"
                accent={palette.violet}
                label="Results"
                placing={placing}
                staged={stagedNotes.filter((n) => n.tab === 'results')}
                composingSlot={composer?.tab === 'results' ? composer.slot : null}
                composeText={composeText}
                onOpenCompose={(slot, hash, index) => openCompose('results', slot, hash, index)}
                onChangeCompose={setComposeText}
                onCommitCompose={commitCompose}
                onCancelCompose={cancelCompose}
                onRemoveStaged={removeStaged}
              />
            ) : null}

            {stagedNotes.length > 0 ? (
              <View style={[styles.tray, { backgroundColor: surface.surface, borderColor: surface.border }]}>
                <ThemedText style={[styles.trayCount, { color: surface.text }]}>
                  {stagedNotes.length === 1
                    ? '1 note staged'
                    : `${stagedNotes.length} notes staged`}
                </ThemedText>
                <View style={styles.trayActions}>
                  <Pressable
                    onPress={discardStaged}
                    disabled={pushing}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Discard all staged notes"
                    style={styles.trayDiscard}
                  >
                    <ThemedText style={[styles.trayDiscardText, { color: surface.muted }]}>
                      Discard
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => void pushStaged()}
                    disabled={pushing}
                    accessibilityRole="button"
                    accessibilityLabel="Push staged notes to the experiment"
                    style={[styles.trayPush, { backgroundColor: palette.sky, opacity: pushing ? 0.6 : 1 }]}
                  >
                    {pushing ? (
                      <ActivityIndicator size="small" color={palette.white} />
                    ) : (
                      <ThemedText style={[styles.trayPushText, { color: palette.white }]}>
                        Push
                      </ThemedText>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {canAdd ? (
          <View style={styles.addSection}>
            <ThemedText style={[styles.sectionLabel, { color: palette.sky }]}>
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

            {/* Text notes are added via placement mode in the NOTES & RESULTS
                section above (Add note -> place here), so the experiment lands
                them at a position. This section keeps Photo capture only. */}
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
    fontSize: 13,
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addNoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  addNoteBtnText: {
    fontSize: 12.5,
    fontFamily: fonts.semibold,
    fontWeight: '600',
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
  docBlock: { marginVertical: 2 },
  addHereRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  addHereLine: { flex: 1, height: 1 },
  addHereChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  addHereText: { fontSize: 11, fontFamily: fonts.semibold, fontWeight: '600' },
  composer: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 6,
  },
  composerInput: {
    minHeight: 56,
    fontSize: 14,
    fontFamily: fonts.medium,
    textAlignVertical: 'top',
  },
  composerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  composerCancel: { paddingHorizontal: 8, paddingVertical: 6 },
  composerCancelText: { fontSize: 13, fontFamily: fonts.semibold, fontWeight: '600' },
  composerPlace: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  composerPlaceText: { fontSize: 13, fontFamily: fonts.semibold, fontWeight: '600' },
  pendingNote: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 6,
  },
  pendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  pendingLabel: {
    flex: 1,
    fontSize: 11,
    letterSpacing: 0.4,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  trayCount: { fontSize: 14, fontFamily: fonts.semibold, fontWeight: '600' },
  trayActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trayDiscard: { paddingHorizontal: 10, paddingVertical: 8 },
  trayDiscardText: { fontSize: 14, fontFamily: fonts.semibold, fontWeight: '600' },
  trayPush: {
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 9,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trayPushText: { fontSize: 14, fontFamily: fonts.semibold, fontWeight: '600' },
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
