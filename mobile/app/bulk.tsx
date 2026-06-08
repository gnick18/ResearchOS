// Bulk label screen. After picking many photos from the camera roll, label them
// together (one caption applied to all), deselect any you do not want, and send
// the batch to your lab. Each selected photo is queued through the same outbox
// pipeline a single capture uses, with the shared caption. When paired they
// upload right away, when not paired they wait in the outbox. Annotate (draw or
// markup per photo) is a separate heavier feature, the entry is here but the
// editor is not built yet. House style: no em-dashes, no emojis, no mid-sentence
// colons.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { useTheme, palette } from '@/lib/design';
import { addCapture, sendCapture } from '@/lib/captures';
import { takePendingBatch } from '@/lib/bulk-batch';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';

export default function BulkScreen() {
  const router = useRouter();
  const { pairing } = usePairing();
  const { surface, spacing, radii } = useTheme();

  const [uris, setUris] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);

  // Take the picked batch on mount, all photos selected by default.
  useEffect(() => {
    const batch = takePendingBatch();
    setUris(batch);
    setSelected(new Set(batch.map((_, i) => i)));
  }, []);

  const paired = !!pairing;
  const count = selected.size;

  const toggle = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const onAnnotate = useCallback(() => {
    Alert.alert(
      'Annotate is coming soon',
      'Drawing and markup on photos is on the way. For now you can label and send the batch.',
    );
  }, []);

  const onSend = useCallback(async () => {
    if (count === 0 || sending) return;
    setSending(true);
    const chosen = uris.filter((_, i) => selected.has(i));
    try {
      for (const uri of chosen) {
        const queued = await addCapture({ uri, caption });
        if (pairing) {
          try {
            await sendCapture(queued, pairing, signWithDevice);
          } catch {
            // Leave it queued in the outbox, the Send tab can retry.
          }
        }
      }
      Alert.alert(
        paired ? 'Sent' : 'Added to outbox',
        paired
          ? `${chosen.length} photo${chosen.length === 1 ? '' : 's'} sent to your lab.`
          : `${chosen.length} photo${chosen.length === 1 ? '' : 's'} queued. Pair this phone to send them.`,
      );
      router.back();
    } finally {
      setSending(false);
    }
  }, [count, sending, uris, selected, caption, pairing, paired, router]);

  const sendLabel = useMemo(
    () => (paired ? `Send ${count} to lab` : `Add ${count} to outbox`),
    [paired, count],
  );

  return (
    <ScreenFrame edges={['bottom']}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ThemedText type="title">Label {uris.length} photo{uris.length === 1 ? '' : 's'}</ThemedText>
        <ThemedText style={[styles.sub, { color: surface.muted }]}>
          Tap to include or skip. The caption applies to every selected photo.
        </ThemedText>

        <View style={styles.grid}>
          {uris.map((uri, i) => {
            const on = selected.has(i);
            return (
              <Pressable key={`${uri}-${i}`} onPress={() => toggle(i)} style={styles.cellWrap}>
                <Image source={{ uri }} style={[styles.cell, { borderRadius: radii.md }]} />
                <View
                  style={[
                    styles.check,
                    { backgroundColor: on ? palette.sky : 'rgba(0,0,0,0.35)', borderColor: palette.white },
                  ]}
                >
                  {on ? <Ionicons name="checkmark" size={15} color={palette.white} /> : null}
                </View>
                {!on ? <View style={[styles.dim, { borderRadius: radii.md }]} /> : null}
              </Pressable>
            );
          })}
        </View>

        <ThemedText style={[styles.secLabel, { color: surface.muted }]}>APPLY TO ALL</ThemedText>
        <Card style={{ gap: spacing.sm }}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Caption, applied to every selected photo"
            placeholderTextColor={surface.placeholder}
            style={[styles.input, { borderColor: surface.border, borderRadius: radii.md, color: surface.text }]}
            multiline
          />
        </Card>

        <Button variant="secondary" label="Annotate selected" onPress={onAnnotate} disabled={count === 0} />
        <Button variant="primary" label={sendLabel} loading={sending} disabled={count === 0 || sending} onPress={onSend} />
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 14 },
  sub: { fontSize: 14, lineHeight: 20 },
  secLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cellWrap: { width: '31%', aspectRatio: 1, position: 'relative' },
  cell: { width: '100%', height: '100%', backgroundColor: '#00000010' },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.28)' },
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 48 },
});
