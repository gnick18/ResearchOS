// v0 lab timers screen. Start a countdown at the bench (PCR step, incubation),
// watch it tick down live, and get an OS notification when it fires even if the
// app is backgrounded. Fully on-device, no network. The in-app countdown plus a
// Done state work regardless of notification permission, the OS alert is a
// bonus. SDK 54 expo-notifications: local scheduled notifications fire in Expo
// Go (only remote push needs a development build). House style: no em-dashes,
// no emojis, no mid-sentence colons.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { TabHeader } from '@/components/ui/TabHeader';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useTheme, palette, fonts } from '@/lib/design';
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

// HH:MM:SS display glyphs. place 0..5 maps to a HHMMSS digit (filled at render),
// place -1 is a literal colon separator. "#" is a digit placeholder.
const DISPLAY_GLYPHS: { ch: string; place: number }[] = [
  { ch: '#', place: 0 },
  { ch: '#', place: 1 },
  { ch: ':', place: -1 },
  { ch: '#', place: 2 },
  { ch: '#', place: 3 },
  { ch: ':', place: -1 },
  { ch: '#', place: 4 },
  { ch: '#', place: 5 },
];

// One-tap quick-start presets (the common bench durations). Compact labels to
// match the contract chip row (1m / 5m / 10m / 30m / 1h).
const PRESETS = [
  { label: '1m', sec: 60 },
  { label: '5m', sec: 300 },
  { label: '10m', sec: 600 },
  { label: '30m', sec: 1800 },
  { label: '1h', sec: 3600 },
];

export default function TimersScreen() {
  const { timers, refresh } = useTimers();
  const { pairing } = usePairing();
  const { surface, spacing, radii } = useTheme();
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
          <TabHeader title="Timers" />

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
          <View style={{ gap: spacing.lg }}>
            <View>
              <ThemedText style={[styles.lbl, { color: surface.faint }]}>
                QUICK START
              </ThemedText>
              <View style={styles.presetRow}>
                {PRESETS.map((p) => (
                  <Pressable
                    key={p.sec}
                    testID={`timer-preset-${p.label.replace(/\s+/g, '')}`}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: pressed ? palette.sky : surface.surface,
                        borderColor: pressed ? palette.sky : surface.border,
                      },
                    ]}
                    onPress={() => startPreset(p.sec)}
                    accessibilityRole="button"
                    accessibilityLabel={`Start ${p.label} timer`}
                  >
                    {({ pressed }) => (
                      <ThemedText
                        style={[styles.chipText, { color: pressed ? palette.white : surface.muted }]}
                      >
                        {p.label}
                      </ThemedText>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>

            <View>
              <ThemedText style={[styles.lbl, { color: surface.faint }]}>
                CUSTOM
              </ThemedText>

              {/* Mono display. Leading zero-pad digits read faint (contract .z),
                  the entered digits in full text color, matching .timer-display.
                  Each glyph is a place index 0..5; a place is "pad" while it sits
                  left of the entered digits (digits fill right-to-left). */}
              <View style={styles.displayWrap}>
                <ThemedText style={styles.display}>
                  {DISPLAY_GLYPHS.map(({ ch, place }, i) => {
                    const isPad = place < 0 || place < 6 - digits.length;
                    return (
                      <ThemedText
                        key={i}
                        style={[
                          styles.displayChar,
                          { color: isPad ? surface.faint : surface.text },
                        ]}
                      >
                        {ch === '#' ? `${hh}${mm}${ss}`[place] : ch}
                      </ThemedText>
                    );
                  })}
                </ThemedText>
                <ThemedText style={[styles.displayHint, { color: surface.faint }]}>
                  HH : MM : SS
                </ThemedText>
              </View>
            </View>

            <View style={styles.keypad}>
              {KEYS.map((key) => {
                const isClear = key === 'back';
                return (
                  <Pressable
                    key={key}
                    style={({ pressed }) => [
                      styles.key,
                      {
                        backgroundColor: isClear ? palette.coralDim : surface.surface,
                        borderColor: isClear ? palette.coralBorder : surface.border,
                        borderRadius: radii.md,
                      },
                      !isClear && styles.keyShadow,
                      pressed &&
                        (isClear
                          ? { backgroundColor: palette.coral }
                          : { backgroundColor: palette.skyDim, borderColor: palette.sky }),
                    ]}
                    onPress={() => pushKey(key)}
                    accessibilityRole="button"
                    accessibilityLabel={isClear ? 'delete' : key}
                  >
                    {({ pressed }) =>
                      isClear ? (
                        <Ionicons
                          name="backspace-outline"
                          size={23}
                          color={pressed ? palette.white : palette.coral}
                        />
                      ) : (
                        <ThemedText style={[styles.keyText, { color: surface.text }]}>
                          {key}
                        </ThemedText>
                      )
                    }
                  </Pressable>
                );
              })}
            </View>

            <Button
              testID="timer-start"
              variant="primary"
              label={duration > 0 ? `Start timer (${formatClock(duration)})` : 'Start timer'}
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
  const { surface, dark } = useTheme();
  const isRunning = timer.status === 'running';
  const fromLaptop = timer.origin === 'laptop';
  // Remaining seconds, clamped at zero. Recomputed every render, the 1s tick in
  // useTimers drives the re-render.
  const remainingSec = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));

  // Running cards follow the contract .timer-live: a soft accent-tinted gradient
  // card with a conic-style ring + stopwatch glyph, name, note, and a mono
  // countdown. Laptop-mirrored timers take the sky accent, on-device take amber.
  if (isRunning) {
    const accent = fromLaptop ? palette.sky : palette.amber;
    const accentDim = fromLaptop ? palette.skyDim : palette.amberDim;
    const accentBorder = fromLaptop ? palette.skyBorder : palette.amberBorder;
    const tint = fromLaptop ? palette.skyDim : palette.amberDim;
    return (
      <View
        style={[
          styles.liveWrap,
          // Solid base UNDER the gradient: tint is a translucent accent (0.14
          // alpha), so without an opaque base it bleeds the gray screen behind
          // and muddies to tan. Over surface it reads as a clean accent wash.
          { backgroundColor: surface.surface, borderColor: accentBorder, ...shadowSm(dark) },
        ]}
      >
        <LinearGradient
          colors={[tint, surface.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.liveBody}>
          {/* Ring: an accent annulus (the gradient ring) with an inner surface
              disc holding the stopwatch glyph. */}
          <View style={[styles.ring, { backgroundColor: accentDim, borderColor: accent }]}>
            <View style={[styles.ringInner, { backgroundColor: surface.surface }]}>
              <Ionicons name="stopwatch-outline" size={17} color={accent} />
            </View>
          </View>
          <View style={styles.liveText}>
            <ThemedText style={[styles.liveName, { color: surface.text }]} numberOfLines={1}>
              {timer.label.length > 0 ? timer.label : 'Lab timer'}
            </ThemedText>
            <View style={styles.liveMetaRow}>
              <ThemedText style={[styles.liveNote, { color: surface.muted }]}>
                {fromLaptop ? 'From laptop' : 'On this phone'}
              </ThemedText>
              <ThemedText style={[styles.liveNote, { color: surface.faint }]}>·</ThemedText>
              <Pressable onPress={() => onCancel(timer.id)} accessibilityRole="button" hitSlop={8}>
                <ThemedText style={[styles.liveCancel, { color: palette.coral }]}>Cancel</ThemedText>
              </Pressable>
            </View>
          </View>
          <ThemedText style={[styles.countdown, { color: accent }]}>
            {formatClock(remainingSec)}
          </ThemedText>
        </View>
      </View>
    );
  }

  // Finished / cancelled timers keep a quiet plain card with a status pill.
  const pillBg = timer.status === 'done' ? palette.successLight : palette.skyDim;
  const pillColor = timer.status === 'done' ? palette.success : surface.muted;
  return (
    <View
      style={[
        styles.doneRow,
        { backgroundColor: surface.surface, borderColor: surface.border, ...shadowSm(dark) },
      ]}
    >
      <View style={styles.rowBody}>
        <ThemedText style={[styles.rowTitle, { color: surface.text }]} numberOfLines={2}>
          {timer.label.length > 0 ? timer.label : 'Lab timer'}
        </ThemedText>
        <ThemedText style={[styles.rowMeta, { color: surface.muted }]}>
          {formatClock(timer.durationSec)} total{fromLaptop ? ' · from laptop' : ''}
        </ThemedText>
      </View>
      <View style={[styles.pill, { backgroundColor: pillBg }]}>
        <ThemedText style={[styles.pillText, { color: pillColor }]}>
          {timer.status === 'done' ? 'Done' : 'Cancelled'}
        </ThemedText>
      </View>
    </View>
  );
}

// Soft contract shadow-sm, theme-aware. Hook-free helper so TimerRow stays a
// plain function but still gets the right elevation per scheme.
function shadowSm(dark: boolean) {
  return dark
    ? { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.4, shadowRadius: 3, elevation: 2 }
    : { shadowColor: '#0F1722', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 };
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 112,
    gap: 16,
  },
  // Section label, contract .lbl: 12px, 700, .08em tracking, faint, uppercase.
  lbl: {
    fontSize: 12,
    fontFamily: fonts.bold,
    letterSpacing: 0.96,
    textTransform: 'uppercase',
    marginBottom: 9,
    marginLeft: 2,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Contract .ch: pill, surface bg, 1px border, muted text. Pressed -> sky fill.
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
  },
  displayWrap: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  // Contract .timer-display: Geist Mono, 46px, tabular, slight negative tracking.
  display: {
    flexDirection: 'row',
  },
  displayChar: {
    fontSize: 46,
    lineHeight: 54,
    fontFamily: fonts.monoSemibold,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.9,
  },
  displayHint: {
    fontSize: 10,
    fontFamily: fonts.mono,
    letterSpacing: 1.6,
    marginTop: 2,
    // Android floors text-view width without trailing tracking; pad both sides.
    paddingHorizontal: 3,
  },
  // Contract .keypad: 3-col grid, 10px gutters.
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  // Contract .key: 58px tall, r-md, surface card with hairline border + sm shadow.
  key: {
    width: '31.5%',
    height: 58,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyShadow: {
    shadowColor: '#0F1722',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  // Contract .key text: Geist Mono, 21px, 600.
  keyText: {
    fontSize: 21,
    fontFamily: fonts.monoSemibold,
    fontVariant: ['tabular-nums'],
  },
  permNote: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Running timer card, contract .timer-live.
  liveWrap: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  liveBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  ring: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveText: {
    flex: 1,
    gap: 3,
  },
  liveName: {
    fontSize: 14.5,
    fontFamily: fonts.semibold,
  },
  liveMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveNote: {
    fontSize: 12,
    fontFamily: fonts.ui,
  },
  liveCancel: {
    fontSize: 12,
    fontFamily: fonts.semibold,
  },
  // Contract .timer-live .cd: mono, 22px, tabular, slight negative tracking.
  countdown: {
    fontSize: 22,
    fontFamily: fonts.monoSemibold,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  // Quiet finished/cancelled card.
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    lineHeight: 20,
  },
  rowMeta: {
    fontSize: 13,
    fontFamily: fonts.ui,
    lineHeight: 18,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontFamily: fonts.semibold,
  },
});
