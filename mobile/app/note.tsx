// v0 quick text note compose screen. Type a short note at the bench and send it
// straight to your lab inbox over the encrypted relay. Single purpose, no
// outbox, the note sends immediately and the screen shows an inline status with
// a retry on failure and a "send another" once it lands. Optional title rides
// along as the note title on the laptop. House style: no em-dashes, no emojis,
// no mid-sentence colons, brand-sky (#1AA0E6) accents.
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import { sendTextNote } from '@/lib/notes';

const BRAND_SKY = '#1AA0E6';

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; error: string };

export default function NoteScreen() {
  const { pairing } = usePairing();
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
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText style={styles.tagline}>
            Jot a quick note and send it to your lab inbox.
          </ThemedText>

          {!paired ? (
            <ThemedView style={styles.hintCard}>
              <ThemedText style={styles.cardHint}>
                Pair this phone from the home tab to send notes to your lab.
              </ThemedText>
            </ThemedView>
          ) : null}

          {sent ? (
            <ThemedView style={styles.statusCard}>
              <ThemedText type="defaultSemiBold" style={styles.sentText}>
                Sent to your lab.
              </ThemedText>
              <Pressable
                style={styles.secondaryButton}
                onPress={onSendAnother}
                accessibilityRole="button"
              >
                <ThemedText style={styles.secondaryButtonText}>
                  Send another
                </ThemedText>
              </Pressable>
            </ThemedView>
          ) : (
            <>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Title, optional"
                placeholderTextColor="rgba(128, 128, 128, 0.8)"
                style={styles.titleInput}
                editable={!sending}
                returnKeyType="next"
              />
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Write your note"
                placeholderTextColor="rgba(128, 128, 128, 0.8)"
                style={styles.bodyInput}
                editable={!sending}
                multiline
                autoFocus
                textAlignVertical="top"
              />

              {state.kind === 'failed' ? (
                <ThemedText style={styles.errorText}>{state.error}</ThemedText>
              ) : null}

              <Pressable
                style={[styles.primaryButton, !canSend && styles.buttonDisabled]}
                onPress={onSend}
                disabled={!canSend}
                accessibilityRole="button"
              >
                {sending ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.primaryButtonText}>
                    {state.kind === 'failed' ? 'Retry' : 'Send to lab'}
                  </ThemedText>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
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
  hintCard: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 14,
    padding: 16,
  },
  cardHint: {
    opacity: 0.7,
    lineHeight: 20,
  },
  statusCard: {
    borderWidth: 1,
    borderColor: 'rgba(22, 163, 74, 0.4)',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  sentText: {
    color: '#16a34a',
  },
  titleInput: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#888888',
  },
  bodyInput: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 200,
    color: '#888888',
    textAlignVertical: 'top',
  },
  errorText: {
    color: '#dc2626',
    lineHeight: 20,
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
  buttonDisabled: {
    opacity: 0.4,
  },
});
