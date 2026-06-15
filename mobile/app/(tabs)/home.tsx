/**
 * Home hub — the glance surface and anchor destination (UI contract 01).
 * Wired to live data: pairing + connection freshness drive the status card, the
 * today snapshot drives the active-experiments band and the Today section, the
 * local timers store drives the running-timer card, and the capture outbox
 * drives Recent. Data-backed cards hide when empty, so nothing shows mock
 * content (the running-timer and Recent cards simply do not render with no data).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { ActiveExperimentsBand } from '@/components/TodayPanel';
import { useTheme, fonts, spacing, radii } from '@/lib/design';
import { usePairing } from '@/lib/pairing';
import { fetchSnapshot, type TodaySnapshot } from '@/lib/snapshots';
import { signWithDevice } from '@/lib/device-identity';
import {
  useConnectionStatus,
  recordSyncSuccess,
  recordSyncFailure,
} from '@/lib/connection-status';
import { useTimers } from '@/lib/timers';
import { listCaptures, type Capture } from '@/lib/captures';

const Ic = ({ d, color, size = 21, sw = 1.8 }: { d: string; color: string; size?: number; sw?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d={d} stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Svg>
);

// "Good morning" before noon, "Good afternoon" before 6pm, "Good evening" after.
function timeOfDayGreeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Reduce a stored display name to a friendly first name for the greeting. Strips
// a leading honorific (Dr, Prof, Mr, Mrs, Ms, Mx) then takes the first token, so
// "Dr. Grant Nickles" greets as "Grant". Returns null when there is no usable
// name so the caller can greet by time of day alone.
function firstNameOf(name?: string): string | null {
  if (!name) return null;
  const cleaned = name.trim().replace(/^(dr|prof|mr|mrs|ms|mx)\.?\s+/i, '');
  const first = cleaned.split(/\s+/)[0] ?? '';
  return first.length > 0 ? first : null;
}

// Compact "last synced" label from an epoch-ms timestamp.
function relTime(ms?: number | null): string {
  if (!ms) return '';
  const delta = Date.now() - ms;
  if (delta < 60_000) return 'just now';
  const m = Math.floor(delta / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// mm:ss countdown from a remaining-ms value.
function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Short date like "Jun 16" from an ISO/date string.
function shortDate(value?: string): string {
  if (!value) return '';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = t.surface;
  const p = t.palette;
  const { pairing } = usePairing();
  const conn = useConnectionStatus();
  const { timers } = useTimers();

  const [today, setToday] = useState<TodaySnapshot | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);

  // Pull the today snapshot on focus (the laptop publishes it; demo mode returns
  // the bundled fixture). Record sync freshness so the status card stays honest.
  const loadToday = useCallback(async () => {
    if (!pairing) {
      setToday(null);
      return;
    }
    try {
      const data = (await fetchSnapshot('today', pairing, signWithDevice)) as TodaySnapshot | null;
      setToday(data);
      recordSyncSuccess();
    } catch {
      recordSyncFailure();
    }
  }, [pairing]);

  const loadCaptures = useCallback(async () => {
    try {
      setCaptures(await listCaptures());
    } catch {
      // Best-effort glance; a read failure just leaves Recent empty.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadToday();
      void loadCaptures();
    }, [loadToday, loadCaptures]),
  );

  // Greet by time of day, adding the paired user's first name when present.
  const first = firstNameOf(pairing?.userName);
  const greeting = first
    ? `${timeOfDayGreeting(new Date().getHours())}, ${first}`
    : timeOfDayGreeting(new Date().getHours());

  // Status card: lab label + live connection state + last-synced freshness.
  const labName = pairing?.labName ?? 'Your lab';
  const connLabel = !pairing
    ? 'Not connected'
    : conn.state === 'synced'
      ? 'Live'
      : conn.state === 'offline'
        ? 'Offline'
        : 'Idle';
  const dotColor = !pairing
    ? s.faint
    : conn.state === 'synced'
      ? p.success
      : conn.state === 'offline'
        ? p.danger
        : p.amber;
  const dotDim = !pairing
    ? s.sunken
    : conn.state === 'synced'
      ? p.successDim
      : conn.state === 'offline'
        ? p.dangerLight ?? s.sunken
        : p.amberDim;
  const synced = relTime(conn.lastSyncAt);
  const statusMeta = !pairing
    ? 'Connect a laptop to sync'
    : synced
      ? `Synced ${synced}`
      : 'Waiting for first sync';

  // Today snapshot, partitioned the same way the Today panel does it.
  const allTasks = today?.tasks ?? [];
  const experiments = allTasks.filter((task) => task.task_type === 'experiment');
  const todayTasks = allTasks.filter((task) => task.task_type !== 'experiment');
  const overdueTasks = today?.overdueTasks ?? [];
  const upcomingTasks = today?.upcomingTasks ?? [];
  const dueCount = todayTasks.length + overdueTasks.length;
  const hasAnyToday = todayTasks.length + overdueTasks.length + upcomingTasks.length > 0;

  // Running timer (local store, ticks once a second). Hidden when none.
  const running = timers.find((tm) => tm.status === 'running');

  const recent = captures.slice(0, 3);

  const Label = ({ children, action }: { children: string; action?: string }) => (
    <View style={styles.lblRow}>
      <Text style={[styles.lbl, { color: s.faint }]} numberOfLines={1}>{children}</Text>
      {action ? <Text style={[styles.lblAction, { color: p.sky }]} numberOfLines={1}>{action}</Text> : null}
    </View>
  );

  const tile = (key: string, label: string, bg: string, color: string, d: string, onPress: () => void) => (
    <Pressable key={key} style={[styles.tile, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]} onPress={onPress}>
      <View style={[styles.tileIc, { backgroundColor: bg }]}>
        <Ic d={d} color={color} />
      </View>
      <Text style={[styles.tileNm, { color: s.muted }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  // One Today/Overdue/Coming-up row in the Home card style.
  const taskRow = (
    name: string | undefined,
    rightLabel: string,
    tone: 'today' | 'over' | 'soon',
    key: string,
    first: boolean,
  ) => {
    const tickColor = tone === 'over' ? p.danger : tone === 'soon' ? p.amber : p.sky;
    return (
      <View key={key} style={[styles.taskRow, !first && { borderTopWidth: 1, borderTopColor: s.hairline }]}>
        <View style={[styles.checkbox, { borderColor: tickColor }]} />
        <Text style={[styles.taskT, { color: tone === 'over' ? p.danger : s.text }]} numberOfLines={1}>
          {name && name.length > 0 ? name : 'Untitled task'}
        </Text>
        <Text style={[styles.taskW, { color: tone === 'over' ? p.danger : s.muted }]}>{rightLabel}</Text>
      </View>
    );
  };

  return (
    <ScreenFrame edges={['top']}>
      {/* header */}
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={[styles.greet, { color: s.muted }]} numberOfLines={1}>{greeting}</Text>
          <Text style={[styles.title, { color: s.text }]} numberOfLines={1}>Home</Text>
        </View>
        <View style={styles.headActions}>
          <Pressable style={[styles.iconBtn, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]} onPress={() => router.push('/notifications')}>
            <Ic d="M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M9.5 21a2.5 2.5 0 0 0 5 0" color={s.text} size={19} sw={1.7} />
          </Pressable>
          <Pressable style={[styles.iconBtn, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]} onPress={() => router.push('/modal')}>
            <Svg width={19} height={19} viewBox="0 0 24 24">
              {/* Settings gear (matches TabHeader's settings-outline; the old
                  rayed glyph read as a sun). */}
              <Circle cx={12} cy={12} r={3} stroke={s.text} strokeWidth={1.7} fill="none" />
              <Path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                stroke={s.text}
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 96 }} showsVerticalScrollIndicator={false}>
        {/* status */}
        <LinearGradient
          colors={[s.surface, s.surface2]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.statusCard, { borderColor: s.border }, t.shadow.sm]}
        >
          <View style={[styles.pulse, { backgroundColor: dotDim }]}>
            <View style={[styles.pulseCore, { backgroundColor: dotColor, shadowColor: dotColor }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusLab, { color: s.text }]} numberOfLines={1}>{`${labName} · ${connLabel}`}</Text>
            <Text style={[styles.statusMeta, { color: s.muted }]} numberOfLines={1}>{statusMeta}</Text>
          </View>
        </LinearGradient>

        {/* active experiments (hidden when none) */}
        {experiments.length > 0 ? (
          <View style={{ marginTop: 14 }}>
            <ActiveExperimentsBand
              experiments={experiments}
              dark={t.dark}
              onPress={() => router.push('/method-detail?read=1')}
            />
          </View>
        ) : null}

        {/* running timer (hidden when nothing is running) */}
        {running ? (
          <>
            <Label>Running now</Label>
            <Pressable onPress={() => router.push('/(tabs)/timers')}>
              <LinearGradient
                colors={[t.dark ? 'rgba(245,158,11,0.20)' : 'rgba(245,158,11,0.14)', s.surface]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.timerLive, { borderColor: p.amberBorder }, t.shadow.sm]}
              >
                <View style={[styles.ring, { borderColor: p.amber }]}>
                  <Ic d="M12 13V9M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" color={p.amber} size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.timerNm, { color: s.text }]} numberOfLines={1}>
                    {running.label && running.label.length > 0 ? running.label : 'Timer'}
                  </Text>
                  <Text style={[styles.timerSub, { color: s.muted }]}>Running</Text>
                </View>
                <Text style={[styles.timerCd, { color: s.text }]}>{fmtCountdown(running.endsAt - Date.now())}</Text>
              </LinearGradient>
            </Pressable>
          </>
        ) : null}

        {/* today */}
        <Label action={dueCount > 0 ? `${dueCount} due` : undefined}>Today</Label>
        {hasAnyToday ? (
          <View style={[styles.card, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]}>
            {overdueTasks.map((task, i) =>
              taskRow(task.name, 'Overdue', 'over', task.id ?? `over-${i}`, i === 0),
            )}
            {todayTasks.map((task, i) =>
              taskRow(
                task.name,
                task.task_type ?? 'Today',
                'today',
                task.id ?? `today-${i}`,
                overdueTasks.length === 0 && i === 0,
              ),
            )}
            {upcomingTasks.map((task, i) =>
              taskRow(
                task.name,
                shortDate(task.start_date) || 'Soon',
                'soon',
                task.id ?? `soon-${i}`,
                overdueTasks.length === 0 && todayTasks.length === 0 && i === 0,
              ),
            )}
          </View>
        ) : (
          <View style={[styles.card, styles.emptyCard, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]}>
            <Text style={[styles.emptyTxt, { color: s.muted }]}>
              {pairing ? 'Nothing scheduled for today.' : 'Connect a laptop to see your schedule.'}
            </Text>
          </View>
        )}

        {/* tools launcher */}
        <Label>Tools</Label>
        <View style={styles.launch}>
          {tile('timers', 'Timers', p.amberDim, p.amber, 'M12 13V9M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', () => router.push('/(tabs)/timers'))}
          {tile('calc', 'Calc', p.skyDim, p.sky, 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM8 7h8M8 11h3M8 15h3', () => router.push('/(tabs)/calc'))}
          {tile('wiki', 'Wiki', p.violetDim, p.violet, 'M5 4h11l3 3v13H5zM9 12h6M9 16h6', () => router.push('/(tabs)/wiki'))}
          {tile('sync', 'Sync', p.successDim, p.success, 'M21 11.5a8.5 8.5 0 1 1-3-6.5M21 4v5h-5', () => { void loadToday(); void loadCaptures(); })}
        </View>

        {/* recent (hidden when no captures) */}
        {recent.length > 0 ? (
          <>
            <Label>Recent</Label>
            <View style={[styles.card, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]}>
              {recent.map((c, i) => {
                const statusText =
                  c.status === 'sent' ? 'Sent' : c.status === 'failed' ? 'Failed' : c.status === 'sending' ? 'Sending' : 'Queued';
                const statusColor =
                  c.status === 'sent' ? p.success : c.status === 'failed' ? p.danger : p.amber;
                return (
                  <View key={c.id} style={[styles.lrow, i > 0 && { borderTopWidth: 1, borderTopColor: s.hairline }]}>
                    <LinearGradient
                      colors={t.dark ? ['#1c2433', '#10161f'] : ['#cfe0ee', '#e7eef6']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[styles.thumb, { borderColor: s.border }]}
                    >
                      <Ic d="M4 8h16v11H4z" color={s.faint} size={18} sw={1.6} />
                    </LinearGradient>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.lrowT, { color: s.text }]} numberOfLines={1}>
                        {c.caption && c.caption.length > 0 ? c.caption : 'Photo capture'}
                      </Text>
                      <View style={styles.lrowSub}>
                        <View style={[styles.dot, { backgroundColor: statusColor }]} />
                        <Text style={[styles.lrowSubT, { color: s.muted }]}>{statusText}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: spacing.lg, paddingTop: 6, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 },
  headText: { flex: 1, minWidth: 0 },
  greet: { fontSize: 12.5, fontFamily: fonts.semibold, marginBottom: 5 },
  title: { fontSize: 27, fontFamily: fonts.extrabold, letterSpacing: -0.8, lineHeight: 30 },
  headActions: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 15, borderRadius: radii.lg, borderWidth: 1 },
  pulse: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  pulseCore: { width: 11, height: 11, borderRadius: 6, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 4, elevation: 3 },
  statusLab: { fontSize: 15, fontFamily: fonts.bold },
  statusMeta: { fontSize: 12.5, fontFamily: fonts.ui, marginTop: 2 },
  lblRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 9, marginHorizontal: 4 },
  lbl: { fontSize: 12, fontFamily: fonts.bold, letterSpacing: 0.9, textTransform: 'uppercase', paddingRight: 5 },
  lblAction: { fontSize: 12.5, fontFamily: fonts.semibold },
  timerLive: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14, paddingHorizontal: 15, borderRadius: radii.lg, borderWidth: 1 },
  ring: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  timerNm: { fontSize: 14.5, fontFamily: fonts.semibold },
  timerSub: { fontSize: 12, fontFamily: fonts.ui, marginTop: 1 },
  timerCd: { fontSize: 22, fontFamily: fonts.monoSemibold, letterSpacing: -0.4 },
  card: { borderRadius: radii.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 2 },
  emptyCard: { paddingVertical: 16, alignItems: 'center' },
  emptyTxt: { fontSize: 13, fontFamily: fonts.ui },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
  checkbox: { width: 21, height: 21, borderRadius: 7, borderWidth: 2 },
  taskT: { flex: 1, fontSize: 14.5, fontFamily: fonts.medium },
  taskW: { fontSize: 12, fontFamily: fonts.semibold },
  launch: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, borderRadius: radii.md, borderWidth: 1, paddingTop: 13, paddingBottom: 11, paddingHorizontal: 2, alignItems: 'center', gap: 7 },
  tileIc: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileNm: { fontSize: 11.5, fontFamily: fonts.semibold, textAlign: 'center', alignSelf: 'stretch' },
  lrow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
  thumb: { width: 46, height: 46, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  lrowT: { fontSize: 14, fontFamily: fonts.semibold },
  lrowSub: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  lrowSubT: { fontSize: 12, fontFamily: fonts.ui },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
