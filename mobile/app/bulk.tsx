// Bulk label screen. After picking many photos from the camera roll, label them
// together (one caption applied to all), deselect any you do not want, and send
// the batch to your lab. Each selected photo is queued through the same outbox
// pipeline a single capture uses, with the shared caption. When paired they
// upload right away, when not paired they wait in the outbox. Annotate (draw or
// markup) opens the editor for the FIRST selected photo and rides its doc along
// with that photo on send. FLAG: per-photo annotation across the whole grid is
// not built yet, only the first selected photo is annotatable here. House style:
// no em-dashes, no emojis, no mid-sentence colons.
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
import { useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { AnnotationOverlay } from '@/components/AnnotationOverlay';
import { Button } from '@/components/ui/Button';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useTheme, palette, fonts } from '@/lib/design';
import { addCapture, sendCapture } from '@/lib/captures';
import { takePendingBatch } from '@/lib/bulk-batch';
import {
  setAnnotateTarget,
  takeAnnotateResult,
} from '@/lib/annotate-handoff';
import type { AnnotationDoc } from '@/lib/annotations';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';

export default function BulkScreen() {
  const router = useRouter();
  const { pairing } = usePairing();
  const { surface, spacing, radii, shadow, dark } = useTheme();

  const [uris, setUris] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [caption, setCaption] = useState('');
  const [captionFocused, setCaptionFocused] = useState(false);
  const [sending, setSending] = useState(false);
  // Annotation docs keyed by the photo uri they belong to. Only the first
  // selected photo can be annotated for now (see FLAG in the header).
  const [docs, setDocs] = useState<Record<string, AnnotationDoc>>({});

  // Take the picked batch on mount, all photos selected by default.
  useEffect(() => {
    const batch = takePendingBatch();
    setUris(batch);
    setSelected(new Set(batch.map((_, i) => i)));
  }, []);

  // Returning from the annotate editor: take the saved doc and key it to its uri
  // so it sends with that photo.
  useFocusEffect(
    useCallback(() => {
      const result = takeAnnotateResult();
      if (result) {
        setDocs((prev) => ({ ...prev, [result.uri]: result.doc }));
      }
    }, []),
  );

  const paired = !!pairing;
  const count = selected.size;
  const total = uris.length;
  const allSelected = total > 0 && count === total;

  const toggle = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  // Select-all / select-none toggle in the header (contract navhead action).
  const onToggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === uris.length ? new Set() : new Set(uris.map((_, i) => i)),
    );
  }, [uris]);

  // The first selected photo, in grid order, or null when nothing is selected.
  const firstSelectedUri = useMemo(() => {
    for (let i = 0; i < uris.length; i += 1) {
      if (selected.has(i)) return uris[i];
    }
    return null;
  }, [uris, selected]);

  // Annotate the first selected photo. The doc comes back on focus return and is
  // keyed to that uri so it sends with the photo. FLAG: only the first selected
  // photo is annotatable; per-photo annotation across the grid is a follow-up.
  const onAnnotate = useCallback(() => {
    if (!firstSelectedUri) return;
    setAnnotateTarget(firstSelectedUri);
    router.push('/annotate');
  }, [firstSelectedUri, router]);

  const onSend = useCallback(async () => {
    if (count === 0 || sending) return;
    setSending(true);
    const chosen = uris.filter((_, i) => selected.has(i));
    try {
      for (const uri of chosen) {
        const queued = await addCapture({ uri, caption, annotation: docs[uri] });
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
  }, [count, sending, uris, selected, caption, docs, pairing, paired, router]);

  const sendLabel = useMemo(
    () => (paired ? `Send ${count} to lab` : `Add ${count} to outbox`),
    [paired, count],
  );

  const firstSelectedHasDoc = !!(firstSelectedUri && docs[firstSelectedUri]);

  // Caption field chrome. Focus lifts to the elevated surface and wraps the
  // field in the contract sky focus ring (matches .input.focus).
  const captionChrome = captionFocused
    ? {
        backgroundColor: surface.surface,
        borderColor: palette.sky,
        shadowColor: palette.sky,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: dark ? 0.5 : 0.28,
        shadowRadius: 6,
        elevation: 0,
      }
    : {
        backgroundColor: surface.surface2,
        borderColor: surface.borderStrong,
      };

  return (
    <ScreenFrame edges={['top', 'bottom']}>
      {/* Pushed-screen header with a select-all / select-none action on the
          right, matching the contract navhead. */}
      <View style={styles.head}>
        <ScreenHeader title="From camera roll" />
        {total > 0 ? (
          <Pressable
            onPress={onToggleAll}
            hitSlop={10}
            style={styles.headAction}
            accessibilityRole="button"
            accessibilityLabel={allSelected ? 'Select none' : 'Select all'}
          >
            <ThemedText style={[styles.headActionText, { color: palette.sky }]}>
              {allSelected ? 'Select none' : 'Select all'}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Count note (contract .note): how many are selected and where they go. */}
        <View
          style={[
            styles.note,
            {
              backgroundColor: surface.surface2,
              borderColor: surface.border,
              borderRadius: radii.md,
            },
          ]}
        >
          <Ionicons name="checkmark-circle" size={16} color={palette.sky} />
          <ThemedText style={[styles.noteText, { color: surface.muted }]}>
            <ThemedText style={[styles.noteCount, { color: surface.text }]}>
              {count} of {total}
            </ThemedText>{' '}
            selected.{' '}
            {paired
              ? 'They send to your lab inbox.'
              : 'They queue to your outbox until this phone is paired.'}
          </ThemedText>
        </View>

        <View style={styles.grid}>
          {uris.map((uri, i) => {
            const on = selected.has(i);
            const hasDoc = !!docs[uri];
            return (
              <Pressable
                key={`${uri}-${i}`}
                onPress={() => toggle(i)}
                style={styles.cellWrap}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Photo ${i + 1}${on ? ', selected' : ''}`}
              >
                <View
                  style={[
                    styles.cell,
                    {
                      borderRadius: radii.md,
                      borderColor: on ? palette.skyBorder : surface.border,
                      backgroundColor: surface.sunken,
                      ...(on ? shadow.sm : null),
                    },
                  ]}
                >
                  <Image source={{ uri }} style={styles.cellImage} />
                  {hasDoc ? <AnnotationOverlay doc={docs[uri]} /> : null}
                  {!on ? <View style={styles.dim} /> : null}
                </View>

                {/* Selection check (contract .chk): sky fill on, translucent
                    hollow ring off, both with a white border and soft shadow. */}
                <View
                  style={[
                    styles.check,
                    on
                      ? { backgroundColor: palette.sky, ...shadow.sm }
                      : { backgroundColor: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.85)' },
                  ]}
                >
                  {on ? <Ionicons name="checkmark" size={15} color={palette.white} /> : null}
                </View>

                {/* Annotation badge: this photo carries markup that rides on send. */}
                {hasDoc ? (
                  <View style={[styles.annotBadge, { backgroundColor: palette.violet, ...shadow.sm }]}>
                    <Ionicons name="brush" size={11} color={palette.white} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* Caption applied to every selected photo (contract .field). */}
        <View style={styles.field}>
          <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>
            Caption
          </ThemedText>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Applied to every selected photo"
            placeholderTextColor={surface.placeholder}
            style={[
              styles.input,
              { borderRadius: radii.md, color: surface.text },
              captionChrome,
            ]}
            onFocus={() => setCaptionFocused(true)}
            onBlur={() => setCaptionFocused(false)}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Annotate the first selected photo (FLAG: first photo only for now). */}
        <View
          style={[
            styles.callout,
            {
              backgroundColor: palette.violetDim,
              borderColor: 'rgba(124,92,224,0.30)',
              borderRadius: radii.md,
            },
          ]}
        >
          <Ionicons name="brush-outline" size={18} color={palette.violet} style={styles.calloutIcon} />
          <ThemedText style={[styles.calloutText, { color: surface.text }]}>
            <ThemedText style={[styles.calloutLead, { color: palette.violet }]}>
              Markup rides along.
            </ThemedText>{' '}
            Annotate the first selected photo and its markup sends with it.
          </ThemedText>
        </View>

        <View style={styles.toolbar}>
          <Button
            variant="secondary"
            label={firstSelectedHasDoc ? 'Edit annotations on first photo' : 'Annotate first photo'}
            icon={<Ionicons name="brush-outline" size={18} color={palette.violet} />}
            onPress={onAnnotate}
            disabled={count === 0}
          />
          <Button
            variant="primary"
            label={sendLabel}
            icon={
              !sending ? (
                <Ionicons name="paper-plane-outline" size={17} color={palette.white} />
              ) : undefined
            }
            loading={sending}
            disabled={count === 0 || sending}
            onPress={onSend}
          />
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 14 },

  // Header row: ScreenHeader fills the left, the select-all action floats right.
  head: { flexDirection: 'row', alignItems: 'center' },
  headAction: { position: 'absolute', right: 16, paddingVertical: 8, paddingHorizontal: 4 },
  headActionText: { fontSize: 13.5, fontFamily: fonts.semibold, fontWeight: '600' },

  // Count note (contract .note): tinted inset line with the count emphasized.
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteText: { flex: 1, fontSize: 13, fontFamily: fonts.ui, lineHeight: 19 },
  noteCount: { fontFamily: fonts.semibold, fontWeight: '600' },

  // Grid of selectable photo cells (contract .bulk-grid, 3 columns).
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cellWrap: { width: '31.5%', aspectRatio: 1, position: 'relative' },
  cell: {
    width: '100%',
    height: '100%',
    borderWidth: 1,
    overflow: 'hidden',
  },
  cellImage: { width: '100%', height: '100%' },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,12,20,0.32)' },

  // Selection check (contract .bulk-cell .chk).
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Annotation badge, bottom-left of an annotated cell.
  annotBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Caption field (contract .field / .input).
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontFamily: fonts.semibold, fontWeight: '600', lineHeight: 16 },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: fonts.ui,
    minHeight: 80,
    lineHeight: 22,
  },

  // Markup callout (contract .callout): tinted inset with an accent lead word.
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  calloutIcon: { marginTop: 1 },
  calloutText: { flex: 1, fontSize: 13, fontFamily: fonts.ui, lineHeight: 20 },
  calloutLead: { fontSize: 13, fontFamily: fonts.semibold, fontWeight: '600', lineHeight: 20 },

  // Action toolbar (contract .toolbar-bottom column): annotate + send stacked.
  toolbar: { gap: 9, marginTop: 4 },
});
