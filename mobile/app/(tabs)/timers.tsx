// v0 lab timers screen. Start a countdown at the bench (PCR step, incubation),
// watch it tick down live, and get an OS notification when it fires even if the
// app is backgrounded. Fully on-device, no network. The in-app countdown plus a
// Done state work regardless of notification permission, the OS alert is a
// bonus. SDK 54 expo-notifications: local scheduled notifications fire in Expo
// Go (only remote push needs a development build). House style: no em-dashes,
// no emojis, no mid-sentence colons.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { TabHeader } from '@/components/ui/TabHeader';
import { useUnreadNotificationCount } from '@/lib/unread-notifications';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { AlarmSettingsCard } from '@/components/AlarmSettingsCard';
import { useTheme, palette } from '@/lib/design';
import { ensureNotificationPermission } from '@/lib/notifications';
import {
  addTimer,
  deleteTimer,
  clearFinished,
  mergeLaptopTimers,
  useTimers,
  type Timer,
} from '@/lib/timers';
import { usePairing } from '@/lib/pairing';
import { signWithDevice } from '@/lib/device-identity';
import {
  postTimerCreate,
  postTimerDismiss,
  fetchLaptopTimers,
} from '@/lib/timer-sync';

// Keypad layout, read right-to-left as HHMMSS like a bench timer.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'];

// One-tap quick-start presets (the common bench durations).
const PRESETS = [
  { label: '1 min', sec: 60 },
  { label: '5 min', sec: 300 },
  { label: '10 min', sec: 600 },
  { label: '30 min', sec: 1800 },
  { label: '1 hr', sec: 3600 },
];

export default function TimersScreen() {
  const { timers, refresh } = useTimers();
  const { pairing } = usePairing();
  const { surface, spacing, radii } = useTheme();
  const unreadCount = useUnreadNotificationCount();
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

  // Pull the laptop "timers" snapshot so laptop-started timers mirror here and
  // unified dismisses land. Polls every 10s while the screen is focused. The
  // local 1s tick (useTimers) counts the mirrored timers down independently.
  useFocusEffect(
    useCallback(() => {
      if (!pairing || pairing.demo) return;
      let active = true;
      const sync = async () => {
        try {
          const snap = await fetchLaptopTimers(pairing, signWithDevice);
          if (!active) return;
          await mergeLaptopTimers(snap.running, snap.dismissed);
          await refresh();
        } catch {
          // Best-effort, retry next tick.
        }
      };
      void sync();
      const id = setInterval(() => void sync(), 10000);
      return () => {
        active = false;
        clearInterval(id);
      };
    }, [pairing, refresh]),
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

  // Tell the laptop a timer started, so it mirrors there. No-op when unpaired or
  // in demo mode, or when the pairing predates the user X25519 carry.
  const syncCreate = useCallback(
    (timer: Timer) => {
      if (pairing && !pairing.demo) {
        void postTimerCreate(
          timer,
          pairing.userX25519PubHex ?? '',
          pairing.relayUrl,
        );
      }
    },
    [pairing],
  );

  const onStart = useCallback(async () => {
    if (duration <= 0) return;
    const timer = await addTimer({ label: '', durationSec: duration });
    syncCreate(timer);
    setDigits('');
    // Re-check the grant, a first start may have triggered the OS prompt.
    setNotifyGranted(await ensureNotificationPermission());
    await refresh();
  }, [duration, syncCreate, refresh]);

  // One-tap preset: start a timer immediately at the chosen duration.
  const startPreset = useCallback(
    async (sec: number) => {
      const timer = await addTimer({ label: '', durationSec: sec });
      syncCreate(timer);
      setDigits('');
      setNotifyGranted(await ensureNotificationPermission());
      await refresh();
    },
    [syncCreate, refresh],
  );

  const onCancel = useCallback(
    async (id: string) => {
      await deleteTimer(id);
      // Unified dismiss: tell the laptop to drop its copy too (works for a phone
      // timer or a mirrored laptop one).
      if (pairing && !pairing.demo) {
        void postTimerDismiss(id, pairing.userX25519PubHex ?? '', pairing.relayUrl);
      }
      await refresh();
    },
    [pairing, refresh],
  );

  const onClearFinished = useCallback(async () => {
    await clearFinished();
    await refresh();
  }, [refresh]);

  // Newest first, so a freshly started timer lands at the top of each list.
  const running = timers
    .filter((t) => t.status === 'running')
    .sort((a, b) => b.startedAt - a.startedAt);
  const finished = timers
    .filter((t) => t.status !== 'running')
    .sort((a, b) => b.endsAt - a.endsAt);

  return (
    <ScreenFrame>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
          <TabHeader title="Timers" unreadCount={unreadCount} />
          <ThemedText style={[styles.tagline, { color: surface.muted }]}>
            Start a countdown at the bench and get an alert when it finishes.
          </ThemedText>

          {/* Running timers float to the top, newest first. The whole section
              vanishes when nothing is running, so New timer sits at the top. */}
          {running.length > 0 ? (
            <>
              <SectionHeader title="Running" />
              {running.map((timer) => (
                <TimerRow key={timer.id} timer={timer} onCancel={onCancel} />
              ))}
            </>
          ) : null}

          {/* New-timer composer sits directly on the canvas (no wrapping card),
              so only a running timer gets a grouped card above. */}
          <View style={{ gap: spacing.md }}>
            <View>
              <ThemedText style={[styles.subLabel, { color: surface.muted }]}>
                QUICK START
              </ThemedText>
              <View style={styles.presetRow}>
                {PRESETS.map((p) => (
                  <Pressable
                    key={p.sec}
                    testID={`timer-preset-${p.label.replace(/\s+/g, '')}`}
                    style={({ pressed }) => [
                      styles.preset,
                      {
                        borderRadius: radii.pill,
                        backgroundColor: pressed ? palette.amber : palette.white,
                        borderColor: pressed ? palette.amber : palette.elevatedBorder,
                      },
                    ]}
                    onPress={() => startPreset(p.sec)}
                    accessibilityRole="button"
                    accessibilityLabel={`Start ${p.label} timer`}
                  >
                    {({ pressed }) => (
                      <ThemedText style={[styles.presetText, { color: pressed ? palette.white : palette.sky }]}>
                        {p.label}
                      </ThemedText>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>

            <ThemedText style={[styles.subLabel, { color: surface.muted }]}>
              OR SET A CUSTOM TIME
            </ThemedText>

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
              <ThemedText style={[styles.displayHint, { color: palette.faint }]}>
                HOURS : MIN : SEC
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
              testID="timer-start"
              variant="primary"
              label={duration > 0 ? `Start timer (${formatClock(duration)})` : 'Enter a time'}
              onPress={onStart}
              disabled={duration <= 0}
            />

            {notifyGranted === false ? (
              <ThemedText style={[styles.permNote, { color: palette.faint }]}>
                Notifications are off, so this timer runs in-app but you will not
                get a background alert. Turn on notifications in Settings to be
                alerted when the app is closed.
              </ThemedText>
            ) : null}
          </View>

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

          <AlarmSettingsCard />
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
          <ThemedText style={[styles.countdown, { color: palette.amber }]}>
            {formatClock(remainingSec)}
          </ThemedText>
        ) : (
          <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>
            {formatClock(timer.durationSec)} total
          </ThemedText>
        )}
        {timer.origin === 'laptop' ? (
          <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>
            from laptop
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.rowActions}>
        {isRunning ? (
          <Pressable
            onPress={() => onCancel(timer.id)}
            accessibilityRole="button"
            hitSlop={8}
          >
            <ThemedText style={[styles.actionText, { color: palette.coral }]}>
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
  subLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  preset: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderWidth: 1,
    shadowColor: '#101828',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  presetText: {
    fontSize: 14,
    fontWeight: '700',
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
