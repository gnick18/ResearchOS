// v0 lab timers screen. Start a countdown at the bench (PCR step, incubation),
// watch it tick down live, and get an OS notification when it fires even if the
// app is backgrounded. Fully on-device, no network. The in-app countdown plus a
// Done state work regardless of notification permission, the OS alert is a
// bonus. SDK 54 expo-notifications: local scheduled notifications fire in Expo
// Go (only remote push needs a development build). House style: no em-dashes,
// no emojis, no mid-sentence colons.
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
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useTheme, palette } from '@/lib/design';
import { ensureNotificationPermission } from '@/lib/notifications';
import {
  addTimer,
  cancelTimer,
  clearFinished,
  useTimers,
  type Timer,
} from '@/lib/timers';

// Keypad layout, read right-to-left as HHMMSS like a bench timer.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'];

export default function TimersScreen() {
  const { timers, refresh } = useTimers();
  const { surface, spacing, radii } = useTheme();
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
    <ScreenFrame>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
          <ThemedText type="title">Timers</ThemedText>
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>
            Start a countdown at the bench and get an alert when it finishes.
          </ThemedText>

          <Card style={{ gap: spacing.md }}>
            <ThemedText style={[styles.cardSectionTitle, { color: surface.text }]}>
              New timer
            </ThemedText>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="What are you timing, optional"
              placeholderTextColor={surface.placeholder}
              style={[
                styles.input,
                {
                  borderColor: surface.border,
                  borderRadius: radii.md,
                  color: surface.text,
                },
              ]}
            />

            <View style={styles.displayWrap}>
              <ThemedText
                style={[
                  styles.display,
                  { color: palette.sky },
                  duration <= 0 && styles.displayDim,
                ]}
              >
                {hh}:{mm}:{ss}
              </ThemedText>
              <ThemedText style={[styles.displayHint, { color: surface.muted }]}>
                hours : min : sec
              </ThemedText>
            </View>

            <View style={styles.keypad}>
              {KEYS.map((key) => (
                <Pressable
                  key={key}
                  style={({ pressed }) => [
                    styles.key,
                    {
                      borderColor: surface.border,
                      borderRadius: radii.sm,
                    },
                    pressed && {
                      backgroundColor: palette.skyDim,
                      borderColor: palette.sky,
                    },
                  ]}
                  onPress={() => pushKey(key)}
                  accessibilityRole="button"
                  accessibilityLabel={key === 'back' ? 'delete' : key}
                >
                  <ThemedText style={[styles.keyText, { color: surface.text }]}>
                    {key === 'back' ? 'del' : key}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <Button
              variant="primary"
              label={duration > 0 ? `Start timer (${formatClock(duration)})` : 'Enter a time'}
              onPress={onStart}
              disabled={duration <= 0}
            />

            {notifyGranted === false ? (
              <ThemedText style={[styles.permNote, { color: surface.muted }]}>
                Notifications are off, so this timer runs in-app but you will not
                get a background alert. Turn on notifications in Settings to be
                alerted when the app is closed.
              </ThemedText>
            ) : null}
          </Card>

          <SectionHeader title="Running" />

          {running.length === 0 ? (
            <EmptyState
              icon="timer-outline"
              text="No timers running. Start one above."
            />
          ) : (
            running.map((timer) => (
              <TimerRow key={timer.id} timer={timer} onCancel={onCancel} />
            ))
          )}

          {finished.length > 0 ? (
            <>
              <SectionHeader
                title="Finished"
                action="Clear"
                onAction={onClearFinished}
              />
              {finished.map((timer) => (
                <TimerRow key={timer.id} timer={timer} onCancel={onCancel} />
              ))}
            </>
          ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

function TimerRow({
  timer,
  onCancel,
}: {
  timer: Timer;
  onCancel: (id: string) => void;
}) {
  const { surface } = useTheme();
  const isRunning = timer.status === 'running';
  // Remaining seconds, clamped at zero. Recomputed every render, the 1s tick in
  // useTimers drives the re-render.
  const remainingSec = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));

  const pillBg =
    timer.status === 'done' ? palette.successLight : palette.skyDim;
  const pillColor =
    timer.status === 'done' ? palette.success : surface.muted;

  return (
    <Card compact style={styles.timerRow}>
      <View style={styles.rowBody}>
        <ThemedText style={[styles.rowTitle, { color: surface.text }]} numberOfLines={2}>
          {timer.label.length > 0 ? timer.label : 'Lab timer'}
        </ThemedText>
        {isRunning ? (
          <ThemedText style={[styles.countdown, { color: palette.sky }]}>
            {formatClock(remainingSec)}
          </ThemedText>
        ) : (
          <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>
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
            <ThemedText style={[styles.actionText, { color: palette.sky }]}>
              Cancel
            </ThemedText>
          </Pressable>
        ) : (
          <View style={[styles.pill, { backgroundColor: pillBg }]}>
            <ThemedText style={[styles.pillText, { color: pillColor }]}>
              {timer.status === 'done' ? 'Done' : 'Cancelled'}
            </ThemedText>
          </View>
        )}
      </View>
    </Card>
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
  cardSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
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
  },
  displayDim: {
    opacity: 0.35,
  },
  displayHint: {
    fontSize: 12,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    fontSize: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  permNote: {
    fontSize: 13,
    lineHeight: 18,
  },
  cardHint: {
    lineHeight: 20,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowBody: {
    flex: 1,
    gap: 4,
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
  countdown: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    paddingVertical: 2,
  },
  rowActions: {
    alignItems: 'flex-end',
  },
  actionText: {
    fontWeight: '600',
    fontSize: 14,
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
});
