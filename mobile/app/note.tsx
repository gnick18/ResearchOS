// v0 quick text note compose screen. Type a short note at the bench and send it
// straight to your lab inbox over the encrypted relay. Single purpose, no
// outbox, the note sends immediately and the screen shows an inline status with
// a retry on failure and a "send another" once it lands. Optional title rides
// along as the note title on the laptop. House style: no em-dashes, no emojis,
// no mid-sentence colons.
import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { useTheme, palette, fonts } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { sendTextNote } from '@/lib/notes';

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; error: string };

export default function NoteScreen() {
  const router = useRouter();
  const { pairing } = usePairing();
  const { surface, spacing, radii, shadow, dark } = useTheme();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<SendState>({ kind: 'idle' });
  // Track focus per input so the active field gets the contract focus ring
  // (sky border + soft sky glow), matching .input.focus in the UI contract.
  const [focused, setFocused] = useState<'title' | 'body' | null>(null);

  const paired = !!pairing;
  const sending = state.kind === 'sending';
  const sent = state.kind === 'sent';
  const failed = state.kind === 'failed';
  const trimmedBody = body.trim();
  const canSend = paired && trimmedBody.length > 0 && !sending && !sent;

  const onSend = useCallback(async () => {
    if (!pairing || trimmedBody.length === 0) return;
    setState({ kind: 'sending' });
    const result = await sendTextNote(
      { title, body: trimmedBody },
      pairing,
      signWithDevice,
    );
    if (result.ok) {
      setState({ kind: 'sent' });
    } else {
      setState({ kind: 'failed', error: result.error });
    }
  }, [pairing, title, trimmedBody]);

  const onSendAnother = useCallback(() => {
    setTitle('');
    setBody('');
    setState({ kind: 'idle' });
  }, []);

  // Throw the draft away and leave. The back chevron also cancels, but a
  // visible coral Discard makes the destructive exit explicit (Grant 2026-06-11).
  const onDiscard = useCallback(() => {
    setTitle('');
    setBody('');
    setState({ kind: 'idle' });
    router.back();
  }, [router]);

  // Shared input chrome. Focus state lifts the field to the elevated surface and
  // wraps it in the contract sky focus ring.
  const fieldChrome = (key: 'title' | 'body') => {
    const isFocused = focused === key;
    return {
      backgroundColor: isFocused ? surface.surface : surface.surface2,
      borderColor: isFocused ? palette.sky : surface.borderStrong,
      borderRadius: radii.md,
      color: surface.text,
      ...(isFocused
        ? {
            shadowColor: palette.sky,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: dark ? 0.5 : 0.28,
            shadowRadius: 6,
            elevation: 0,
          }
        : null),
    };
  };

  return (
    <ScreenFrame edges={['top', 'bottom']}>
      <ScreenHeader title="Quick note" />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!paired ? (
            <View
              style={[
                styles.callout,
                styles.calloutAmber,
                {
                  backgroundColor: palette.amberDim,
                  borderColor: palette.amberBorder,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Ionicons
                name="phone-portrait-outline"
                size={18}
                color={palette.amber}
                style={styles.calloutIcon}
              />
              <ThemedText style={[styles.calloutText, { color: surface.text }]}>
                <ThemedText style={[styles.calloutLead, { color: palette.amber }]}>
                  Pair this phone first.
                </ThemedText>{' '}
                Open the home tab to connect to your lab, then your notes send
                straight to the inbox.
              </ThemedText>
            </View>
          ) : null}

          {sent ? (
            <View
              style={[
                styles.sentCard,
                {
                  backgroundColor: palette.successDim,
                  borderColor: 'rgba(22,163,74,0.34)',
                  borderRadius: radii.lg,
                  gap: spacing.md,
                  ...shadow.sm,
                },
              ]}
            >
              <View style={styles.sentRow}>
                <View
                  style={[
                    styles.sentBadge,
                    { backgroundColor: palette.success, borderRadius: radii.md },
                  ]}
                >
                  <Ionicons name="checkmark" size={22} color={palette.white} />
                </View>
                <View style={styles.sentCopy}>
                  <ThemedText style={[styles.sentTitle, { color: surface.text }]}>
                    Sent to your lab
                  </ThemedText>
                  <ThemedText style={[styles.sentSub, { color: surface.muted }]}>
                    It is waiting in the inbox. Sort it into a notebook on the
                    laptop, or leave it unsorted.
                  </ThemedText>
                </View>
              </View>
              <Button
                variant="secondary"
                label="Write another"
                icon={
                  <Ionicons
                    name="add"
                    size={18}
                    color={surface.text}
                  />
                }
                onPress={onSendAnother}
              />
            </View>
          ) : (
            <>
              <View style={styles.field}>
                <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>
                  Title (optional)
                </ThemedText>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Buffer prep, 50 mL"
                  placeholderTextColor={surface.placeholder}
                  style={[styles.titleInput, fieldChrome('title')]}
                  editable={!sending}
                  returnKeyType="next"
                  onFocus={() => setFocused('title')}
                  onBlur={() => setFocused((f) => (f === 'title' ? null : f))}
                />
              </View>

              <View style={styles.field}>
                <ThemedText style={[styles.fieldLabel, { color: surface.muted }]}>
                  Note
                </ThemedText>
                <TextInput
                  value={body}
                  onChangeText={setBody}
                  placeholder="What did you do at the bench?"
                  placeholderTextColor={surface.placeholder}
                  style={[styles.bodyInput, fieldChrome('body')]}
                  editable={!sending}
                  multiline
                  autoFocus
                  textAlignVertical="top"
                  onFocus={() => setFocused('body')}
                  onBlur={() => setFocused((f) => (f === 'body' ? null : f))}
                />
              </View>

              {/* Files-to-inbox callout: filing happens on send, per the contract. */}
              <View
                style={[
                  styles.callout,
                  {
                    backgroundColor: palette.skyDim,
                    borderColor: palette.skyBorder,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Ionicons
                  name="file-tray-outline"
                  size={18}
                  color={palette.sky}
                  style={styles.calloutIcon}
                />
                <ThemedText style={[styles.calloutText, { color: surface.text }]}>
                  <ThemedText style={[styles.calloutLead, { color: palette.sky }]}>
                    Files to your inbox.
                  </ThemedText>{' '}
                  Sort it into a notebook on the laptop, or leave it unsorted.
                </ThemedText>
              </View>

              {failed ? (
                <View
                  style={[
                    styles.callout,
                    {
                      backgroundColor: palette.dangerDim,
                      borderColor: palette.dangerBorder,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color={palette.danger}
                    style={styles.calloutIcon}
                  />
                  <ThemedText style={[styles.calloutText, { color: surface.text }]}>
                    <ThemedText
                      style={[styles.calloutLead, { color: palette.danger }]}
                    >
                      Could not send.
                    </ThemedText>{' '}
                    {state.error}
                  </ThemedText>
                </View>
              ) : null}

              <View style={styles.toolbar}>
                <Button
                  variant="primary"
                  label={failed ? 'Retry' : 'Send to lab'}
                  icon={
                    !failed && !sending ? (
                      <Ionicons
                        name="paper-plane-outline"
                        size={17}
                        color={palette.white}
                      />
                    ) : undefined
                  }
                  loading={sending}
                  onPress={onSend}
                  disabled={!canSend}
                />
                <Button
                  variant="ghost"
                  accent="coral"
                  label="Discard"
                  onPress={onDiscard}
                  disabled={sending}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 12,
  },

  // Field (label + input), matching contract .field / .field label / .input.
  field: { gap: 6 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    fontWeight: '600',
    lineHeight: 16,
  },
  titleInput: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: fonts.ui,
    minHeight: 48,
  },
  bodyInput: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: fonts.ui,
    minHeight: 200,
    lineHeight: 22,
    textAlignVertical: 'top',
  },

  // Callout (contract .callout): tinted inset with an accent lead word.
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  calloutAmber: {},
  calloutIcon: { marginTop: 1 },
  calloutText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.ui,
    lineHeight: 20,
  },
  calloutLead: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    fontWeight: '600',
    lineHeight: 20,
  },

  // Sent confirmation card.
  sentCard: {
    borderWidth: 1,
    padding: 16,
  },
  sentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sentBadge: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sentCopy: { flex: 1, gap: 3 },
  sentTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    fontWeight: '700',
    lineHeight: 22,
  },
  sentSub: {
    fontSize: 13,
    fontFamily: fonts.ui,
    lineHeight: 19,
  },

  // Action toolbar (contract .toolbar-bottom column): primary + ghost stacked.
  toolbar: { gap: 9, marginTop: 4 },
});
