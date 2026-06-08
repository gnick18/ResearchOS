// v0 lab timers screen. Start a countdown at the bench (PCR step, incubation),
// watch it tick down live, and get an OS notification when it fires even if the
// app is backgrounded. Fully on-device, no network. The in-app countdown plus a
// Done state work regardless of notification permission, the OS alert is a
// bonus. SDK 54 expo-notifications: local scheduled notifications fire in Expo
// Go (only remote push needs a development build). House style: no em-dashes,
// no emojis, no mid-sentence colons, brand-sky (#1AA0E6) accents.
import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ensureNotificationPermission } from '@/lib/notifications';
import {
  addTimer,
  cancelTimer,
  clearFinished,
  useTimers,
  type Timer,
} from '@/lib/timers';

const BRAND_SKY = '#1AA0E6';

// Keypad layout, read right-to-left as HHMMSS like a bench timer.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'];

export default function TimersScreen() {
  const { timers, refresh } = useTimers();
  const [label, setLabel] = useState('');
  // Up to six entered digits, read right-to-left as HHMMSS.
  const [digits, setDigits] = useState('');
  // null = not yet checked, true/false once we know the OS grant.
  const [notifyGranted, setNotifyGranted] = useState<boolean | null>(null);

  // Check the notification grant once on mount so we can show the inline note.
  // This does not prompt unless the OS still can ask, which is fine here.
  useEffect(() => {
    let active = true;
    ensureNotificationPermission().then((granted) => {
      if (active) setNotifyGranted(granted);
    });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Read the entered digits right-to-left as HH:MM:SS, the way a bench timer
  // keypad works (type 1 3 0 0 -> 13 min 00 sec).
  const padded = digits.padStart(6, '0');
  const hh = padded.slice(0, 2);
  const mm = padded.slice(2, 4);
  const ss = padded.slice(4, 6);
  const duration = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);

  const pushKey = useCallback((key: string) => {
    setDigits((prev) => {
      if (key === 'back') return prev.slice(0, -1);
      const next = key === '00' ? `${prev}00` : `${prev}${key}`;
      // Drop leading zeros and keep at most six digits (HHMMSS).
      return next.replace(/^0+/, '').slice(-6);
    });
  }, []);

  const onStart = useCallback(async () => {
    if (duration <= 0) return;
    await addTimer({ label, durationSec: duration });
    setLabel('');
    setDigits('');
    // Re-check the grant, a first start may have triggered the OS prompt.
    setNotifyGranted(await ensureNotificationPermission());
    await refresh();
  }, [label, duration, refresh]);

  const onCancel = useCallback(
    async (id: string) => {
      await cancelTimer(id);
      await refresh();
    },
    [refresh],
  );

  const onClearFinished = useCallback(async () => {
    await clearFinished();
    await refresh();
  }, [refresh]);

  const running = timers.filter((t) => t.status === 'running');
  const finished = timers.filter((t) => t.status !== 'running');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="title">Timers</ThemedText>
          <ThemedText style={styles.tagline}>
            Start a countdown at the bench and get an alert when it finishes.
          </ThemedText>

          <ThemedView style={styles.card}>
            <ThemedText type="subtitle">New timer</ThemedText>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="What are you timing, optional"
              placeholderTextColor="rgba(128, 128, 128, 0.8)"
              style={styles.input}
            />

            <View style={styles.displayWrap}>
              <ThemedText style={[styles.display, duration <= 0 && styles.displayDim]}>
                {hh}:{mm}:{ss}
              </ThemedText>
              <ThemedText style={styles.displayHint}>hours : min : sec</ThemedText>
            </View>

            <View style={styles.keypad}>
              {KEYS.map((key) => (
                <Pressable
                  key={key}
                  style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                  onPress={() => pushKey(key)}
                  accessibilityRole="button"
                  accessibilityLabel={key === 'back' ? 'delete' : key}
                >
                  <ThemedText style={styles.keyText}>
                    {key === 'back' ? 'del' : key}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={[styles.primaryButton, duration <= 0 && styles.buttonDisabled]}
              onPress={onStart}
              disabled={duration <= 0}
              accessibilityRole="button"
            >
              <ThemedText style={styles.primaryButtonText}>
                {duration > 0 ? `Start timer (${formatClock(duration)})` : 'Enter a time'}
              </ThemedText>
            </Pressable>

            {notifyGranted === false ? (
              <ThemedText style={styles.permNote}>
                Notifications are off, so this timer runs in-app but you will not
                get a background alert. Turn on notifications in Settings to be
                alerted when the app is closed.
              </ThemedText>
            ) : null}
          </ThemedView>

          <View style={styles.listHeader}>
            <ThemedText type="subtitle">Running</ThemedText>
          </View>

          {running.length === 0 ? (
            <ThemedView style={styles.emptyCard}>
              <ThemedText style={styles.cardHint}>
                No timers running. Start one above.
              </ThemedText>
            </ThemedView>
          ) : (
            running.map((timer) => (
              <TimerRow key={timer.id} timer={timer} onCancel={onCancel} />
            ))
          )}

          {finished.length > 0 ? (
            <>
              <View style={styles.listHeader}>
                <ThemedText type="subtitle">Finished</ThemedText>
                <Pressable
                  onPress={onClearFinished}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <ThemedText style={styles.actionText}>Clear</ThemedText>
                </Pressable>
              </View>
              {finished.map((timer) => (
                <TimerRow key={timer.id} timer={timer} onCancel={onCancel} />
              ))}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function TimerRow({
  timer,
  onCancel,
}: {
  timer: Timer;
  onCancel: (id: string) => void;
}) {
  const isRunning = timer.status === 'running';
  // Remaining seconds, clamped at zero. Recomputed every render, the 1s tick in
  // useTimers drives the re-render.
  const remainingSec = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));

  return (
    <ThemedView style={styles.row}>
      <View style={styles.rowBody}>
        <ThemedText type="defaultSemiBold" numberOfLines={2}>
          {timer.label.length > 0 ? timer.label : 'Lab timer'}
        </ThemedText>
        {isRunning ? (
          <ThemedText style={styles.countdown}>{formatClock(remainingSec)}</ThemedText>
        ) : (
          <ThemedText style={styles.rowMeta}>
            {formatClock(timer.durationSec)} total
          </ThemedText>
        )}
      </View>
      <View style={styles.rowActions}>
        {isRunning ? (
          <Pressable
            onPress={() => onCancel(timer.id)}
            accessibilityRole="button"
            hitSlop={8}
          >
            <ThemedText style={styles.actionText}>Cancel</ThemedText>
          </Pressable>
        ) : (
          <View
            style={[
              styles.pill,
              timer.status === 'done' ? styles.pillDone : styles.pillCancelled,
            ]}
          >
            <ThemedText
              style={[
                styles.pillText,
                timer.status === 'done'
                  ? styles.pillTextDone
                  : styles.pillTextCancelled,
              ]}
            >
              {timer.status === 'done' ? 'Done' : 'Cancelled'}
            </ThemedText>
          </View>
        )}
      </View>
    </ThemedView>
  );
}

// Render seconds as HH:MM:SS when an hour or more, else MM:SS.
function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
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
  input: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
    color: '#888888',
  },
  displayWrap: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
  },
  display: {
    fontSize: 52,
    lineHeight: 60,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: BRAND_SKY,
  },
  displayDim: {
    opacity: 0.35,
  },
  displayHint: {
    fontSize: 12,
    opacity: 0.5,
    letterSpacing: 1,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  key: {
    width: '31%',
    aspectRatio: 1.9,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    backgroundColor: 'rgba(22, 160, 230, 0.12)',
    borderColor: BRAND_SKY,
  },
  keyText: {
    fontSize: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
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
  buttonDisabled: {
    opacity: 0.4,
  },
  permNote: {
    opacity: 0.7,
    fontSize: 13,
    lineHeight: 18,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
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
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 14,
    padding: 16,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 13,
  },
  countdown: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: BRAND_SKY,
    paddingVertical: 2,
  },
  rowActions: {
    alignItems: 'flex-end',
  },
  actionText: {
    color: BRAND_SKY,
    fontWeight: '600',
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
  pillDone: {
    backgroundColor: 'rgba(22, 163, 74, 0.15)',
  },
  pillTextDone: {
    color: '#16a34a',
  },
  pillCancelled: {
    backgroundColor: 'rgba(128, 128, 128, 0.15)',
  },
  pillTextCancelled: {
    color: '#888888',
  },
});
