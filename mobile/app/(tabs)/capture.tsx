// v0 bench photo capture screen. Snap a photo at the bench, caption it, and
// queue it to the outbox. Local-only for v0, no network yet, syncing is the
// next increment. SDK 54 expo-image-picker API: requestCameraPermissionsAsync()
// for the camera grant, launchCameraAsync({ mediaTypes: ['images'], quality })
// which returns { canceled, assets } where each asset has a uri. We hold the
// asset uri in preview state, then addCapture writes it to the AsyncStorage
// queue. House style: no em-dashes, no emojis, brand-sky (#1AA0E6) accents.
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  addCapture,
  removeCapture,
  sendCapture,
  useCaptures,
  type Capture,
  type CaptureStatus,
} from '@/lib/captures';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';

const BRAND_SKY = '#1AA0E6';

export default function CaptureScreen() {
  const { captures, refresh } = useCaptures();
  const { pairing } = usePairing();
  // The just-snapped photo, held before the user decides to queue or discard.
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);

  const paired = !!pairing;

  // Upload one capture, surfacing failures via an alert. Refreshes the list so
  // the status pill reflects sending -> sent or failed.
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
        await refresh();
      }
    },
    [pairing, refresh],
  );

  // Send every capture that is not already sent or in flight.
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
          // Keep going; the failed pill plus a per-item retry covers this one.
        }
      }
    } finally {
      await refresh();
      setSendingAll(false);
    }
  }, [pairing, sendingAll, captures, refresh]);

  // Refresh the outbox whenever the tab regains focus, so a capture made and
  // then a tab-switch-and-back still shows the latest queue.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const onTakePhoto = useCallback(async () => {
    // Ask for the camera grant. The OS only prompts the first time.
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
    setCaption('');
  }, []);

  const onAddToOutbox = useCallback(async () => {
    if (!previewUri) return;
    setSaving(true);
    try {
      const queued = await addCapture({ uri: previewUri, caption });
      setPreviewUri(null);
      setCaption('');
      await refresh();
      // Auto-attempt the upload when paired so a snap-and-go works hands-free.
      if (pairing) {
        await sendOne(queued);
      }
    } finally {
      setSaving(false);
    }
  }, [previewUri, caption, refresh, pairing, sendOne]);

  const onDiscard = useCallback(() => {
    setPreviewUri(null);
    setCaption('');
  }, []);

  const onRemove = useCallback(
    async (id: string) => {
      await removeCapture(id);
      await refresh();
    },
    [refresh],
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="title">Capture</ThemedText>
          <ThemedText style={styles.tagline}>
            Snap a photo at the bench and queue it to your lab.
          </ThemedText>

          {previewUri ? (
            <ThemedView style={styles.card}>
              <Image source={{ uri: previewUri }} style={styles.preview} />
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Add a caption, optional"
                placeholderTextColor="rgba(128, 128, 128, 0.8)"
                style={styles.input}
                editable={!saving}
                multiline
              />
              <Pressable
                style={styles.primaryButton}
                onPress={onAddToOutbox}
                disabled={saving}
                accessibilityRole="button"
              >
                {saving ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.primaryButtonText}>Add to outbox</ThemedText>
                )}
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={onDiscard}
                disabled={saving}
                accessibilityRole="button"
              >
                <ThemedText style={styles.secondaryButtonText}>Discard</ThemedText>
              </Pressable>
            </ThemedView>
          ) : (
            <Pressable
              style={styles.primaryButton}
              onPress={onTakePhoto}
              accessibilityRole="button"
            >
              <ThemedText style={styles.primaryButtonText}>Take a bench photo</ThemedText>
            </Pressable>
          )}

          <View style={styles.outboxHeader}>
            <ThemedText type="subtitle">Outbox</ThemedText>
            <ThemedText style={styles.outboxNote}>
              {paired
                ? 'Captures upload to your lab inbox over the encrypted relay.'
                : 'Pair this phone from the home tab to send captures to your lab.'}
            </ThemedText>
          </View>

          {captures.length === 0 ? (
            <ThemedView style={styles.emptyCard}>
              <ThemedText style={styles.cardHint}>
                No captures yet. Snap a bench photo above.
              </ThemedText>
            </ThemedView>
          ) : (
            <>
              {paired && captures.some((c) => c.status === 'queued' || c.status === 'failed') ? (
                <Pressable
                  style={[styles.secondaryButton, sendingAll && styles.buttonDisabled]}
                  onPress={onSendAll}
                  disabled={sendingAll}
                  accessibilityRole="button"
                >
                  {sendingAll ? (
                    <ActivityIndicator color={BRAND_SKY} />
                  ) : (
                    <ThemedText style={styles.secondaryButtonText}>Send all</ThemedText>
                  )}
                </Pressable>
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
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
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
  const isSending = capture.status === 'sending';
  const canSend = !!onSend && (capture.status === 'queued' || capture.status === 'failed');
  return (
    <ThemedView style={styles.row}>
      <Image source={{ uri: capture.uri }} style={styles.thumb} />
      <View style={styles.rowBody}>
        <ThemedText type="defaultSemiBold" numberOfLines={2}>
          {capture.caption.length > 0 ? capture.caption : 'No caption'}
        </ThemedText>
        <ThemedText style={styles.rowMeta}>{formatCreatedAt(capture.createdAt)}</ThemedText>
        <View style={styles.rowFooter}>
          <View style={[styles.pill, statusPillStyle(capture.status)]}>
            <ThemedText style={[styles.pillText, statusTextStyle(capture.status)]}>
              {STATUS_LABEL[capture.status]}
            </ThemedText>
          </View>
          <View style={styles.rowActions}>
            {isSending ? <ActivityIndicator color={BRAND_SKY} /> : null}
            {canSend ? (
              <Pressable
                onPress={() => onSend?.(capture)}
                accessibilityRole="button"
                hitSlop={8}
              >
                <ThemedText style={styles.actionText}>
                  {capture.status === 'failed' ? 'Retry' : 'Send'}
                </ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => onRemove(capture.id)}
              accessibilityRole="button"
              hitSlop={8}
            >
              <ThemedText style={styles.removeText}>Remove</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </ThemedView>
  );
}

function statusPillStyle(status: CaptureStatus) {
  if (status === 'sent') return styles.pillSent;
  if (status === 'failed') return styles.pillFailed;
  return null;
}

function statusTextStyle(status: CaptureStatus) {
  if (status === 'sent') return styles.pillTextSent;
  if (status === 'failed') return styles.pillTextFailed;
  return null;
}

// Friendly local rendering of the stored ISO timestamp; falls back to the raw
// string if it cannot be parsed.
function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
  },
  tagline: {
    opacity: 0.7,
    lineHeight: 22,
  },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: '#000000',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
    color: '#888888',
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: BRAND_SKY,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
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
  },
  secondaryButtonText: {
    color: BRAND_SKY,
    fontWeight: '600',
  },
  outboxHeader: {
    gap: 6,
    marginTop: 8,
  },
  outboxNote: {
    opacity: 0.7,
    lineHeight: 20,
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 14,
    padding: 16,
  },
  cardHint: {
    opacity: 0.7,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 14,
    padding: 12,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: '#000000',
  },
  rowBody: {
    flex: 1,
    gap: 6,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 13,
  },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  pill: {
    backgroundColor: 'rgba(26, 160, 230, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    color: BRAND_SKY,
    fontSize: 12,
    fontWeight: '600',
  },
  pillSent: {
    backgroundColor: 'rgba(22, 163, 74, 0.15)',
  },
  pillTextSent: {
    color: '#16a34a',
  },
  pillFailed: {
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
  },
  pillTextFailed: {
    color: '#dc2626',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  actionText: {
    color: BRAND_SKY,
    fontWeight: '600',
  },
  removeText: {
    color: BRAND_SKY,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
