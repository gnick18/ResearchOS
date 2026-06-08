// v0 bench photo capture screen. Snap a photo at the bench, caption it, and
// queue it to the outbox. Local-only for v0, no network yet, syncing is the
// next increment. SDK 54 expo-image-picker API: requestCameraPermissionsAsync()
// for the camera grant, launchCameraAsync({ mediaTypes: ['images'], quality })
// which returns { canceled, assets } where each asset has a uri. We hold the
// asset uri in preview state, then addCapture writes it to the AsyncStorage
// queue. House style: no em-dashes, no emojis, no mid-sentence colons.
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
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';

export default function CaptureScreen() {
  const { captures, refresh } = useCaptures();
  const { pairing } = usePairing();
  const { surface, spacing, radii } = useTheme();
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
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>
            Snap a photo at the bench and queue it to your lab.
          </ThemedText>

          {previewUri ? (
            <Card style={{ gap: spacing.md }}>
              <Image
                source={{ uri: previewUri }}
                style={[styles.preview, { borderRadius: radii.md }]}
              />
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Add a caption, optional"
                placeholderTextColor={surface.placeholder}
                style={[
                  styles.input,
                  {
                    borderColor: surface.border,
                    borderRadius: radii.md,
                    color: surface.text,
                  },
                ]}
                editable={!saving}
                multiline
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
          ) : (
            <Button
              variant="primary"
              label="Take a bench photo"
              onPress={onTakePhoto}
            />
          )}

          <View style={styles.outboxHeader}>
            <SectionHeader title="Outbox" />
            <ThemedText style={[styles.outboxNote, { color: surface.muted }]}>
              {paired
                ? 'Captures upload to your lab inbox over the encrypted relay.'
                : 'Pair this phone from the home tab to send captures to your lab.'}
            </ThemedText>
          </View>

          {captures.length === 0 ? (
            <Card>
              <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
                No captures yet. Snap a bench photo above.
              </ThemedText>
            </Card>
          ) : (
            <>
              {paired && captures.some((c) => c.status === 'queued' || c.status === 'failed') ? (
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
  const { surface, spacing, radii, palette: p } = useTheme();
  const isSending = capture.status === 'sending';
  const canSend = !!onSend && (capture.status === 'queued' || capture.status === 'failed');

  const pillBg =
    capture.status === 'sent' ? palette.successLight :
    capture.status === 'failed' ? palette.dangerLight :
    palette.skyDim;
  const pillColor =
    capture.status === 'sent' ? palette.success :
    capture.status === 'failed' ? palette.danger :
    palette.sky;

  return (
    <Card compact style={[styles.rowCard, { gap: spacing.md }]}>
      <View style={styles.rowInner}>
        <Image
          source={{ uri: capture.uri }}
          style={[styles.thumb, { borderRadius: radii.sm }]}
        />
        <View style={styles.rowBody}>
          <ThemedText
            style={[styles.rowTitle, { color: surface.text }]}
            numberOfLines={2}
          >
            {capture.caption.length > 0 ? capture.caption : 'No caption'}
          </ThemedText>
          <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>
            {formatCreatedAt(capture.createdAt)}
          </ThemedText>
          <View style={styles.rowFooter}>
            <View style={[styles.pill, { backgroundColor: pillBg }]}>
              <ThemedText style={[styles.pillText, { color: pillColor }]}>
                {STATUS_LABEL[capture.status]}
              </ThemedText>
            </View>
            <View style={styles.rowActions}>
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
    lineHeight: 22,
  },
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
  outboxHeader: {
    gap: 6,
  },
  outboxNote: {
    lineHeight: 20,
    fontSize: 14,
  },
  cardHint: {
    lineHeight: 20,
  },
  rowCard: {},
  rowInner: {
    flexDirection: 'row',
    gap: 12,
  },
  thumb: {
    width: 64,
    height: 64,
    backgroundColor: '#000000',
  },
  rowBody: {
    flex: 1,
    gap: 6,
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
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  actionText: {
    fontWeight: '600',
    fontSize: 14,
  },
});
