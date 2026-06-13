/**
 * Home hub — the glance surface and anchor destination (UI contract 01).
 * Sync status, live timers, Today, a tool launcher (Timers/Calc/Wiki), and
 * recent captures. First pass uses representative content; live snapshot data
 * is wired when the data layer screens are migrated.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { useTheme, fonts, spacing, radii } from '@/lib/design';

const Ic = ({ d, color, size = 21, sw = 1.8 }: { d: string; color: string; size?: number; sw?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d={d} stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Svg>
);

export default function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = t.surface;

  const Label = ({ children, action }: { children: string; action?: string }) => (
    <View style={styles.lblRow}>
      <Text style={[styles.lbl, { color: s.faint }]}>{children}</Text>
      {action ? <Text style={[styles.lblAction, { color: t.palette.sky }]}>{action}</Text> : null}
    </View>
  );

  const tile = (key: string, label: string, bg: string, color: string, d: string, onPress: () => void) => (
    <Pressable key={key} style={[styles.tile, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]} onPress={onPress}>
      <View style={[styles.tileIc, { backgroundColor: bg }]}>
        <Ic d={d} color={color} />
      </View>
      <Text style={[styles.tileNm, { color: s.muted }]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScreenFrame edges={['top']}>
      {/* header */}
      <View style={styles.head}>
        <View>
          <Text style={[styles.greet, { color: s.muted }]}>Good morning, Grant</Text>
          <Text style={[styles.title, { color: s.text }]}>Home</Text>
        </View>
        <View style={styles.headActions}>
          <Pressable style={[styles.iconBtn, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]} onPress={() => router.push('/notifications')}>
            <View style={[styles.badge, { backgroundColor: t.palette.coral, borderColor: s.surface }]}>
              <Text style={styles.badgeTxt}>2</Text>
            </View>
            <Ic d="M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M9.5 21a2.5 2.5 0 0 0 5 0" color={s.text} size={19} sw={1.7} />
          </Pressable>
          <Pressable style={[styles.iconBtn, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]} onPress={() => router.push('/modal')}>
            <Svg width={19} height={19} viewBox="0 0 24 24">
              <Circle cx={12} cy={12} r={3.2} stroke={s.text} strokeWidth={1.7} fill="none" />
              <Path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" stroke={s.text} strokeWidth={1.7} strokeLinecap="round" />
            </Svg>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 96 }} showsVerticalScrollIndicator={false}>
        {/* status */}
        <View style={[styles.statusCard, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]}>
          <View style={[styles.pulse, { backgroundColor: t.palette.successDim }]}>
            <View style={[styles.pulseCore, { backgroundColor: t.palette.success }]} />
          </View>
          <View>
            <Text style={[styles.statusLab, { color: s.text }]}>Maple Lab · Live</Text>
            <Text style={[styles.statusMeta, { color: s.muted }]}>Synced just now · 24 methods offline</Text>
          </View>
        </View>

        {/* running timer */}
        <Label>Running now</Label>
        <View style={[styles.timerLive, { borderColor: t.palette.amberDim }, t.shadow.sm]}>
          <View style={[styles.ring, { borderColor: t.palette.amber }]}>
            <Ic d="M12 13V9M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" color={t.palette.amber} size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.timerNm, { color: s.text }]}>PCR denaturation</Text>
            <Text style={[styles.timerSub, { color: s.muted }]}>Step 2 of 6</Text>
          </View>
          <Text style={[styles.timerCd, { color: s.text }]}>04:12</Text>
        </View>

        {/* today */}
        <Label action="3 due">Today</Label>
        <View style={[styles.card, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]}>
          {[
            { t: 'Image the gel', w: 'Overdue', over: true, due: true },
            { t: 'Restock pipette tips', w: '2:00 PM', over: false, due: false },
            { t: '1:1 with Priya', w: '4:30 PM', over: false, due: false },
          ].map((row, i) => (
            <View key={row.t} style={[styles.taskRow, i > 0 && { borderTopWidth: 1, borderTopColor: s.hairline }]}>
              <View style={[styles.checkbox, { borderColor: row.due ? t.palette.amber : s.borderStrong }]} />
              <Text style={[styles.taskT, { color: s.text }]}>{row.t}</Text>
              <Text style={[styles.taskW, { color: row.over ? t.palette.danger : s.muted }]}>{row.w}</Text>
            </View>
          ))}
        </View>

        {/* tools launcher */}
        <Label>Tools</Label>
        <View style={styles.launch}>
          {tile('timers', 'Timers', t.palette.amberDim, t.palette.amber, 'M12 13V9M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', () => router.push('/(tabs)/timers'))}
          {tile('calc', 'Calc', t.palette.skyDim, t.palette.sky, 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM8 7h8M8 11h3M8 15h3', () => router.push('/(tabs)/calc'))}
          {tile('wiki', 'Wiki', t.palette.violetDim, t.palette.violet, 'M5 4h11l3 3v13H5zM9 12h6M9 16h6', () => router.push('/(tabs)/wiki'))}
          {tile('sync', 'Sync', t.palette.successDim, t.palette.success, 'M21 11.5a8.5 8.5 0 1 1-3-6.5M21 4v5h-5', () => {})}
        </View>

        {/* recent */}
        <Label>Recent</Label>
        <View style={[styles.card, { backgroundColor: s.surface, borderColor: s.border }, t.shadow.sm]}>
          <View style={styles.lrow}>
            <View style={[styles.thumb, { backgroundColor: s.sunken, borderColor: s.border }]}>
              <Ic d="M4 8h16v11H4z" color={s.faint} size={18} sw={1.6} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.lrowT, { color: s.text }]}>Western blot, rep 2</Text>
              <View style={styles.lrowSub}>
                <View style={[styles.dot, { backgroundColor: t.palette.success }]} />
                <Text style={[styles.lrowSubT, { color: s.muted }]}>Filed to Gel imaging</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: spacing.lg, paddingTop: 6, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  greet: { fontSize: 12.5, fontFamily: fonts.semibold, marginBottom: 5 },
  title: { fontSize: 27, fontFamily: fonts.extrabold, letterSpacing: -0.8, lineHeight: 30 },
  headActions: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  badgeTxt: { color: '#fff', fontSize: 10, fontFamily: fonts.bold },
  scroll: { flex: 1 },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radii.lg, borderWidth: 1 },
  pulse: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  pulseCore: { width: 11, height: 11, borderRadius: 6 },
  statusLab: { fontSize: 15, fontFamily: fonts.bold },
  statusMeta: { fontSize: 12.5, fontFamily: fonts.ui, marginTop: 2 },
  lblRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 9, marginHorizontal: 4 },
  lbl: { fontSize: 12, fontFamily: fonts.bold, letterSpacing: 1, textTransform: 'uppercase' },
  lblAction: { fontSize: 12.5, fontFamily: fonts.semibold },
  timerLive: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14, borderRadius: radii.lg, borderWidth: 1, backgroundColor: 'rgba(245,158,11,0.06)' },
  ring: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  timerNm: { fontSize: 14.5, fontFamily: fonts.semibold },
  timerSub: { fontSize: 12, fontFamily: fonts.ui, marginTop: 1 },
  timerCd: { fontSize: 22, fontFamily: fonts.monoSemibold, letterSpacing: -0.4 },
  card: { borderRadius: radii.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 2 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
  checkbox: { width: 21, height: 21, borderRadius: 7, borderWidth: 2 },
  taskT: { flex: 1, fontSize: 14.5, fontFamily: fonts.medium },
  taskW: { fontSize: 12, fontFamily: fonts.semibold },
  launch: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, borderRadius: radii.md, borderWidth: 1, paddingVertical: 13, paddingHorizontal: 4, alignItems: 'center', gap: 7 },
  tileIc: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileNm: { fontSize: 11.5, fontFamily: fonts.semibold },
  lrow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
  thumb: { width: 46, height: 46, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  lrowT: { fontSize: 14, fontFamily: fonts.semibold },
  lrowSub: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  lrowSubT: { fontSize: 12, fontFamily: fonts.ui },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
