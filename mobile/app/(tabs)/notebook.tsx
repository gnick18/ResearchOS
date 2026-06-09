// Notebook tab: the bench companion. Connection card, quick-capture actions
// (Take a photo / Quick note), and the Today glance (scheduled / overdue /
// coming up / last synced). The photo-capture pipeline and outbox from the old
// Send tab live here too; the outbox section is only shown when there are
// captures so the home stays clean when empty. House style: no em-dashes,
// no emojis, no mid-sentence colons.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { AnnotationOverlay } from '@/components/AnnotationOverlay';
import {
  setAnnotateTarget,
  takeAnnotateResult,
} from '@/lib/annotate-handoff';
import type { AnnotationDoc } from '@/lib/annotations';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useTheme, palette } from '@/lib/design';
import {
  addCapture,
  removeCapture,
  sendCapture,
  useCaptures,
  type Capture,
  type CaptureStatus,
} from '@/lib/captures';
import { usePairing, clearPairing } from '@/lib/pairing';
import { setPendingBatch } from '@/lib/bulk-batch';
import { signWithDevice } from '@/lib/device-identity';
import {
  fetchSnapshot,
  type TodaySnapshot,
  type SnapshotTask,
} from '@/lib/snapshots';
import { getFocusContext, type FocusContext } from '@/lib/focus-context';
import { postRouteCapture } from '@/lib/route-capture';

export default function NotebookScreen() {
  const router = useRouter();
  const { surface, spacing, radii } = useTheme();

  // ---- Pairing ----
  const { pairing, refresh: refreshPairing } = usePairing();
  const paired = !!pairing;

  const onUnpair = useCallback(async () => {
    await clearPairing();
    refreshPairing();
  }, [refreshPairing]);

  // Keep the connection card current when returning from the pair screen.
  useFocusEffect(
    useCallback(() => {
      refreshPairing();
    }, [refreshPairing]),
  );

  // ---- Today snapshot ----
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    if (!pairing) {
      setSnapshot(null);
      setSnapshotLoaded(true);
      return;
    }
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      const data = (await fetchSnapshot(
        'today',
        pairing,
        signWithDevice,
      )) as TodaySnapshot | null;
      setSnapshot(data);
      setSnapshotLoaded(true);
    } catch {
      setSnapshotError('Could not sync. Pull down to try again.');
    } finally {
      setSnapshotLoading(false);
    }
  }, [pairing]);

  const pairingKey = pairing ? `${pairing.u}:${pairing.relayUrl}` : 'none';
  useEffect(() => {
    void loadSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingKey]);

  // ---- Photo capture pipeline ----
  const { captures, refresh: refreshCaptures } = useCaptures();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<AnnotationDoc | null>(null);
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshCaptures();
      // Returning from the annotate editor: take the saved doc and apply it to
      // the preview when it matches the photo currently in preview.
      const result = takeAnnotateResult();
      if (result) {
        setPreviewUri((current) => {
          if (current && current === result.uri) {
            setPreviewDoc(result.doc);
          }
          return current;
        });
      }
    }, [refreshCaptures]),
  );

  const sendOne = useCallback(
    async (capture: Capture) => {
      if (!pairing) return;
      try {
        await sendCapture(capture, pairing, signWithDevice);
      } catch (err) {
        Alert.alert(
          'Upload failed',
          err instanceof Error ? err.message : 'Could not send that capture. Try again.',
        );
      } finally {
        await refreshCaptures();
      }
    },
    [pairing, refreshCaptures],
  );

  const onSendAll = useCallback(async () => {
    if (!pairing || sendingAll) return;
    setSendingAll(true);
    try {
      const pending = captures.filter(
        (c) => c.status === 'queued' || c.status === 'failed',
      );
      for (const capture of pending) {
        try {
          await sendCapture(capture, pairing, signWithDevice);
        } catch {
          // Keep going; failed pill + per-item retry covers this one.
        }
      }
    } finally {
      await refreshCaptures();
      setSendingAll(false);
    }
  }, [pairing, sendingAll, captures, refreshCaptures]);

  const onTakePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Camera access needed',
        'ResearchOS needs camera access to snap a bench photo. You can turn it on in Settings.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    setPreviewUri(asset.uri);
    setPreviewDoc(null);
    setCaption('');
  }, []);

  const onUploadFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photos access needed',
        'Allow photo library access to upload from your camera roll. You can turn it on in Settings.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.7,
    });
    if (result.canceled) return;
    const picked = (result.assets ?? []).map((a) => a.uri).filter(Boolean);
    if (picked.length === 0) return;
    if (picked.length === 1) {
      setPreviewUri(picked[0]);
      setPreviewDoc(null);
      setCaption('');
      return;
    }
    setPendingBatch(picked);
    router.push('/bulk');
  }, [router]);

  // Upload a queued capture and, when a fresh experiment context is available,
  // post a route-capture command so the laptop places it in the right tab.
  // The context fetch and upload run concurrently; the command is posted only
  // after the upload succeeds so the relay holds the image when the laptop
  // processes the command.
  const sendWithRouting = useCallback(
    async (queued: import('@/lib/captures').Capture) => {
      if (!pairing) return;

      // Fetch the focus context in parallel with the upload start. We start the
      // context fetch here so the round-trip overlaps with the upload, but we
      // only act on it after the upload succeeds.
      const contextPromise = getFocusContext(pairing.relayUrl).catch(() => null);

      await sendOne(queued);

      // After the upload succeeds, check whether an experiment is open and the
      // user has a X25519 pubkey stored (i.e. the pairing data-shape gap is
      // closed). If not, fall through silently (inbox routing is the default).
      const userX25519PubHex = pairing.userX25519PubHex ?? '';
      if (!userX25519PubHex) return;

      let ctx: FocusContext | null;
      try {
        ctx = await contextPromise;
      } catch {
        return;
      }
      if (!ctx || ctx.kind !== 'experiment') return;

      const { taskId, owner, name } = ctx;

      // Show a non-blocking chooser: "Lab Notes", "Results", or inbox escape.
      // Alert.alert is used here (v1) because it matches the existing Alert
      // usage in this file and is sufficient for a two-option prompt.
      await new Promise<void>((resolve) => {
        Alert.alert(
          `Send to ${name}?`,
          'Choose where this photo should appear in your lab notebook.',
          [
            {
              text: 'Lab Notes',
              onPress: () => {
                void postRouteCapture(
                  queued.id,
                  taskId,
                  owner,
                  'notes',
                  userX25519PubHex,
                  pairing.relayUrl,
                ).finally(resolve);
              },
            },
            {
              text: 'Results',
              onPress: () => {
                void postRouteCapture(
                  queued.id,
                  taskId,
                  owner,
                  'results',
                  userX25519PubHex,
                  pairing.relayUrl,
                ).finally(resolve);
              },
            },
            {
              text: 'Send to inbox instead',
              style: 'cancel',
              onPress: () => resolve(),
            },
          ],
          { cancelable: true, onDismiss: () => resolve() },
        );
      });
    },
    [pairing, sendOne],
  );

  const onAddToOutbox = useCallback(async () => {
    if (!previewUri) return;
    setSaving(true);
    try {
      const queued = await addCapture({
        uri: previewUri,
        caption,
        // Carry the annotation doc with the queued capture when one was drawn.
        annotation: previewDoc ?? undefined,
      });
      setPreviewUri(null);
      setPreviewDoc(null);
      setCaption('');
      await refreshCaptures();
      if (pairing) {
        await sendWithRouting(queued);
      }
    } finally {
      setSaving(false);
    }
  }, [previewUri, previewDoc, caption, refreshCaptures, pairing, sendWithRouting]);

  // Stash the preview photo and open the annotation editor. The doc comes back
  // on focus return (see useFocusEffect above).
  const onAnnotate = useCallback(() => {
    if (!previewUri) return;
    setAnnotateTarget(previewUri);
    router.push('/annotate');
  }, [previewUri, router]);

  const onDiscard = useCallback(() => {
    setPreviewUri(null);
    setPreviewDoc(null);
    setCaption('');
  }, []);

  const onRemove = useCallback(
    async (id: string) => {
      await removeCapture(id);
      await refreshCaptures();
    },
    [refreshCaptures],
  );

  // ---- Today snapshot data ----
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
    <ScreenFrame>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={snapshotLoading}
            onRefresh={loadSnapshot}
            tintColor={palette.sky}
          />
        }
      >
        <ThemedText type="title">Notebook</ThemedText>
        <ThemedText style={[styles.tagline, { color: surface.muted }]}>
          Capture the bench into your lab notebook, and see what is on today.
        </ThemedText>

        {/* Connection card */}
        {paired ? (
          <ConnectionCard
            labName={pairing?.labName ?? 'Paired with your lab'}
            onUnpair={onUnpair}
          />
        ) : (
          <Card style={{ gap: spacing.sm }}>
            <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
              Not paired
            </ThemedText>
            <ThemedText style={[styles.tagline, { color: surface.muted }]}>
              Pair this phone with your laptop to send captures and notes to your lab.
            </ThemedText>
            <Button
              variant="primary"
              label="Pair this phone"
              onPress={() => router.push('/pair')}
            />
          </Card>
        )}

        {/* Quick-capture action row (per mockup: side-by-side icon-over-label cards) */}
        {!previewUri ? (
          <View style={styles.actionRow}>
            <Pressable
              onPress={onTakePhoto}
              style={({ pressed }) => [
                styles.actionCard,
                styles.actionPrimary,
                { borderRadius: radii.lg, opacity: pressed ? 0.88 : 1 },
              ]}
              accessibilityRole="button"
            >
              <Ionicons name="camera-outline" size={24} color={palette.white} />
              <ThemedText style={styles.actionLabel}>Take a photo</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/note')}
              style={({ pressed }) => [
                styles.actionCard,
                styles.actionTinted,
                { borderRadius: radii.lg, opacity: pressed ? 0.88 : 1 },
              ]}
              accessibilityRole="button"
            >
              <Ionicons name="create-outline" size={24} color={palette.white} />
              <ThemedText style={styles.actionLabel}>Quick note</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {/* Camera roll upload (below action row, no preview yet) */}
        {!previewUri ? (
          <Button
            variant="secondary"
            accent="amber"
            label="Upload from camera roll"
            onPress={onUploadFromLibrary}
          />
        ) : null}

        {/* Photo preview + caption + queue */}
        {previewUri ? (
          <Card style={{ gap: spacing.md }}>
            {/* The image and the annotation overlay both letterbox the same way
                (contain + the SVG viewBox's default xMidYMid meet) so committed
                shapes land exactly where they were drawn. */}
            <View style={[styles.preview, { borderRadius: radii.md, overflow: 'hidden' }]}>
              <Image
                source={{ uri: previewUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
              />
              {previewDoc ? <AnnotationOverlay doc={previewDoc} /> : null}
            </View>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Add a caption, optional"
              placeholderTextColor={surface.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: surface.surface,
                  borderColor: surface.border,
                  borderRadius: radii.md,
                  color: surface.text,
                },
              ]}
              editable={!saving}
              multiline
            />
            <Button
              variant="secondary"
              label={previewDoc ? 'Edit annotations' : 'Annotate'}
              icon={<Ionicons name="brush-outline" size={18} color={palette.sky} />}
              onPress={onAnnotate}
              disabled={saving}
            />
            <Button
              variant="primary"
              label="Add to outbox"
              loading={saving}
              onPress={onAddToOutbox}
              disabled={saving}
            />
            <Button
              variant="secondary"
              label="Discard"
              onPress={onDiscard}
              disabled={saving}
            />
          </Card>
        ) : null}

        {/* Outbox (only shown when there are captures) */}
        {captures.length > 0 ? (
          <>
            <SectionHeader title="Outbox" />
            {paired &&
            captures.some((c) => c.status === 'queued' || c.status === 'failed') ? (
              <Button
                variant="secondary"
                label="Send all"
                loading={sendingAll}
                onPress={onSendAll}
                disabled={sendingAll}
              />
            ) : null}
            {captures.map((capture) => (
              <CaptureRow
                key={capture.id}
                capture={capture}
                onRemove={onRemove}
                onSend={paired ? sendOne : undefined}
              />
            ))}
          </>
        ) : null}

        {/* Today glance (only shown when paired) */}
        {pairing ? (
          <>
            {snapshotError ? (
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
                  {snapshotError}
                </ThemedText>
              </View>
            ) : null}

            {snapshotLoading && !snapshotLoaded ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={palette.sky} />
              </View>
            ) : null}

            {snapshotLoaded && snapshot === null && !snapshotError ? (
              <Card>
                <ThemedText style={[styles.cardTitle, { color: surface.text }]}>
                  Not synced yet
                </ThemedText>
                <ThemedText style={[styles.tagline, { color: surface.muted }]}>
                  Open ResearchOS on your laptop to sync today.
                </ThemedText>
              </Card>
            ) : null}

            {snapshotLoaded && snapshot !== null && !snapshotError ? (
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
    </ScreenFrame>
  );
}

// Connection card: shows lab name + Unpair when paired.
function ConnectionCard({
  labName,
  onUnpair,
}: {
  labName: string;
  onUnpair: () => void;
}) {
  const { surface } = useTheme();
  return (
    <View style={styles.connCard}>
      <View style={styles.connDot} />
      <View style={styles.connText}>
        <ThemedText style={[styles.connName, { color: surface.text }]}>
          {labName}
        </ThemedText>
        <ThemedText style={[styles.connSub, { color: surface.muted }]}>
          Connected
        </ThemedText>
      </View>
      <Pressable onPress={onUnpair} hitSlop={8} accessibilityRole="button">
        <ThemedText style={[styles.unpairLabel, { color: palette.sky }]}>
          Unpair
        </ThemedText>
      </Pressable>
    </View>
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

const STATUS_LABEL: Record<CaptureStatus, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
};

function CaptureRow({
  capture,
  onRemove,
  onSend,
}: {
  capture: Capture;
  onRemove: (id: string) => void;
  onSend?: (capture: Capture) => void;
}) {
  const { surface, spacing, radii } = useTheme();
  const isSending = capture.status === 'sending';
  const canSend =
    !!onSend && (capture.status === 'queued' || capture.status === 'failed');

  const pillBg =
    capture.status === 'sent'
      ? palette.successLight
      : capture.status === 'failed'
        ? palette.dangerLight
        : palette.skyDim;
  const pillColor =
    capture.status === 'sent'
      ? palette.success
      : capture.status === 'failed'
        ? palette.danger
        : palette.sky;

  return (
    <Card compact style={[styles.captureCard, { gap: spacing.md }]}>
      <View style={styles.captureInner}>
        <Image
          source={{ uri: capture.uri }}
          style={[styles.thumb, { borderRadius: radii.sm }]}
        />
        <View style={styles.captureBody}>
          <ThemedText
            style={[styles.rowTitle, { color: surface.text }]}
            numberOfLines={2}
          >
            {capture.caption.length > 0 ? capture.caption : 'No caption'}
          </ThemedText>
          <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>
            {formatCreatedAt(capture.createdAt)}
          </ThemedText>
          <View style={styles.captureFooter}>
            <View style={[styles.pill, { backgroundColor: pillBg }]}>
              <ThemedText style={[styles.pillText, { color: pillColor }]}>
                {STATUS_LABEL[capture.status]}
              </ThemedText>
            </View>
            <View style={styles.captureActions}>
              {isSending ? <ActivityIndicator color={palette.sky} /> : null}
              {canSend ? (
                <Pressable
                  onPress={() => onSend?.(capture)}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <ThemedText style={[styles.actionText, { color: palette.sky }]}>
                    {capture.status === 'failed' ? 'Retry' : 'Send'}
                  </ThemedText>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => onRemove(capture.id)}
                accessibilityRole="button"
                hitSlop={8}
              >
                <ThemedText style={[styles.actionText, { color: palette.sky }]}>
                  Remove
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Card>
  );
}

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

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 14,
  },
  tagline: { lineHeight: 22 },
  cardTitle: { fontSize: 16, fontWeight: '700', lineHeight: 22 },

  // Connection card (compact pill matching the mockup).
  connCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  connDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: palette.success,
  },
  connText: { flex: 1 },
  connName: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  connSub: { fontSize: 12, lineHeight: 18 },
  unpairLabel: { fontSize: 13, fontWeight: '600' },

  // Quick-capture action row
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionCard: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 9,
  },
  actionPrimary: {
    backgroundColor: palette.sky,
  },
  actionTinted: {
    // Coral partner to the sky photo card: high contrast, on-brand highlight.
    backgroundColor: palette.coral,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.white,
    textAlign: 'center',
  },

  // Photo preview
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#000000',
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
    textAlignVertical: 'top',
  },

  // Capture rows
  captureCard: {},
  captureInner: { flexDirection: 'row', gap: 12 },
  thumb: { width: 64, height: 64, backgroundColor: '#000000' },
  captureBody: { flex: 1, gap: 6 },
  captureFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '600' },
  captureActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  actionText: { fontWeight: '600', fontSize: 14 },

  // Today glance
  emptyLine: { lineHeight: 20 },
  loadingWrap: { paddingVertical: 24, alignItems: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  rowMeta: { fontSize: 13, lineHeight: 18 },
  synced: { fontSize: 12, marginTop: 4 },
  errorBanner: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  errorText: { lineHeight: 20 },
});
