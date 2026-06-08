// v0 quick text note compose screen. Type a short note at the bench and send it
// straight to your lab inbox over the encrypted relay. Single purpose, no
// outbox, the note sends immediately and the screen shows an inline status with
// a retry on failure and a "send another" once it lands. Optional title rides
// along as the note title on the laptop. House style: no em-dashes, no emojis,
// no mid-sentence colons.
import { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTheme, palette } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { sendTextNote } from '@/lib/notes';

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; error: string };

export default function NoteScreen() {
  const { pairing } = usePairing();
  const { surface, spacing, radii } = useTheme();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<SendState>({ kind: 'idle' });

  const paired = !!pairing;
  const sending = state.kind === 'sending';
  const sent = state.kind === 'sent';
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

  return (
    <ScreenFrame>
      <ScreenHeader />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
          <ThemedText type="title">Quick note</ThemedText>
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>
            Jot a quick note and send it to your lab inbox.
          </ThemedText>

          {!paired ? (
            <Card>
              <ThemedText style={[styles.cardHint, { color: surface.muted }]}>
                Pair this phone from the home tab to send notes to your lab.
              </ThemedText>
            </Card>
          ) : null}

          {sent ? (
            <Card
              style={[
                styles.statusCard,
                {
                  borderColor: palette.successLight,
                  gap: spacing.md,
                },
              ]}
            >
              <ThemedText style={[styles.sentText, { color: palette.success }]}>
                Sent to your lab.
              </ThemedText>
              <Button
                variant="secondary"
                label="Send another"
                onPress={onSendAnother}
              />
            </Card>
          ) : (
            <>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Title, optional"
                placeholderTextColor={surface.placeholder}
                style={[
                  styles.titleInput,
                  {
                    borderColor: surface.border,
                    borderRadius: radii.md,
                    color: surface.text,
                  },
                ]}
                editable={!sending}
                returnKeyType="next"
              />
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Write your note"
                placeholderTextColor={surface.placeholder}
                style={[
                  styles.bodyInput,
                  {
                    borderColor: surface.border,
                    borderRadius: radii.md,
                    color: surface.text,
                  },
                ]}
                editable={!sending}
                multiline
                autoFocus
                textAlignVertical="top"
              />

              {state.kind === 'failed' ? (
                <ThemedText style={[styles.errorText, { color: palette.danger }]}>
                  {state.error}
                </ThemedText>
              ) : null}

              <Button
                variant="primary"
                label={state.kind === 'failed' ? 'Retry' : 'Send to lab'}
                loading={sending}
                onPress={onSend}
                disabled={!canSend}
              />
            </>
          )}
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
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
  cardHint: {
    lineHeight: 20,
  },
  statusCard: {
    borderWidth: 1,
  },
  sentText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  titleInput: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  bodyInput: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 200,
    textAlignVertical: 'top',
  },
  errorText: {
    lineHeight: 20,
  },
});
